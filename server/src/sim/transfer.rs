use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::config::validate_account_subject;
use crate::player_identity::{color_for, player_name_key, validate_player_name};
use crate::protocol::{PlayerId, ResourceKind};
use crate::region_routing::{RegionHandoffIntent, REGION_EDGE_MARGIN};
use crate::spatial::Point;

use super::inventory::{
    CraftedItemKind, InventoryItemKind, InventoryStack, PlayerInventory, INVENTORY_CAPACITY_SLOTS,
    INVENTORY_STACK_LIMIT,
};
use super::model::{Player, PlayerInput, Position, SimWorld, Velocity, MAX_LIFECYCLE_AGE_YEARS};

pub(crate) const PLAYER_TRANSFER_SCHEMA: &str = "duskfell-player-transfer-v1";
const MAX_TRANSFER_DEEDS: usize = 64;
const MAX_TRANSFER_DEED_BYTES: usize = 128;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlayerTransferState {
    pub(crate) schema_version: String,
    pub(crate) atlas_id: String,
    pub(crate) atlas_content_sha256: String,
    pub(crate) from_region: String,
    pub(crate) to_region: String,
    pub(crate) player_id: PlayerId,
    pub(crate) account_subject: Option<String>,
    pub(crate) name: String,
    pub(crate) demo_deeds: Vec<String>,
    pub(crate) destination_x: f32,
    pub(crate) destination_y: f32,
    pub(crate) inventory_capacity_slots: u8,
    pub(crate) inventory_stacks: Vec<PlayerTransferInventoryStack>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlayerTransferInventoryStack {
    pub(crate) item_id: String,
    pub(crate) quantity: u32,
    pub(crate) age_years: u32,
    pub(crate) age_progress_years: f32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TransferStateError {
    MissingPlayer,
    MissingRegionAuthority,
    IntentMismatch,
    WrongDestination,
    PlayerAlreadyPresent,
    InvalidPlayerName,
    PlayerNameTaken,
    InvalidAccountSubject,
    InvalidDestination,
    InvalidInventory,
    InvalidDeeds,
}

impl std::fmt::Display for TransferStateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::MissingPlayer => "transfer source player is missing",
            Self::MissingRegionAuthority => "transfer requires atlas region authority",
            Self::IntentMismatch => "transfer intent does not match source authority",
            Self::WrongDestination => "transfer is not bound to this destination authority",
            Self::PlayerAlreadyPresent => "transfer player is already present",
            Self::InvalidPlayerName => "transfer player name is invalid",
            Self::PlayerNameTaken => "transfer player name is already active",
            Self::InvalidAccountSubject => "transfer account subject is invalid",
            Self::InvalidDestination => "transfer destination position is invalid",
            Self::InvalidInventory => "transfer inventory is invalid",
            Self::InvalidDeeds => "transfer deed state is invalid",
        })
    }
}

impl std::error::Error for TransferStateError {}

impl SimWorld {
    pub(crate) fn export_player_transfer(
        &self,
        intent: &RegionHandoffIntent,
    ) -> Result<PlayerTransferState, TransferStateError> {
        let region = self
            .map
            .region
            .as_ref()
            .ok_or(TransferStateError::MissingRegionAuthority)?;
        if intent.from_region != region.region_id
            || intent.player_id == PlayerId::nil()
            || !region_has_neighbor(region, &intent.to_region)
        {
            return Err(TransferStateError::IntentMismatch);
        }
        let entity = self
            .players
            .get(&intent.player_id)
            .copied()
            .ok_or(TransferStateError::MissingPlayer)?;
        let player = self
            .world
            .get::<Player>(entity)
            .ok_or(TransferStateError::MissingPlayer)?;

        Ok(PlayerTransferState {
            schema_version: PLAYER_TRANSFER_SCHEMA.to_string(),
            atlas_id: region.atlas_id.clone(),
            atlas_content_sha256: region.atlas_content_sha256.clone(),
            from_region: region.region_id.clone(),
            to_region: intent.to_region.clone(),
            player_id: player.id,
            account_subject: player.account_subject.clone(),
            name: player.name.clone(),
            demo_deeds: player.demo_deeds.clone(),
            destination_x: intent.destination_x,
            destination_y: intent.destination_y,
            inventory_capacity_slots: player.inventory.capacity_slots,
            inventory_stacks: player
                .inventory
                .stacks
                .iter()
                .map(|stack| PlayerTransferInventoryStack {
                    item_id: transfer_item_id(stack.item).to_string(),
                    quantity: stack.quantity,
                    age_years: stack.age_years,
                    age_progress_years: stack.age_progress_years,
                })
                .collect(),
        })
    }

    pub(crate) fn admit_player_transfer(
        &mut self,
        state: PlayerTransferState,
    ) -> Result<(), TransferStateError> {
        self.validate_player_transfer(&state)?;
        let name_key = player_name_key(&state.name);
        let inventory = transfer_inventory(&state)?;
        let position = Position {
            x: state.destination_x,
            y: state.destination_y,
        };
        let entity = self
            .world
            .spawn((
                Player {
                    id: state.player_id,
                    account_subject: state.account_subject,
                    name: state.name,
                    color: color_for(state.player_id),
                    demo_deeds: state.demo_deeds,
                    inventory,
                    speech: None,
                },
                position,
                Velocity::default(),
            ))
            .id();
        self.player_name_index.insert(name_key, state.player_id);
        self.players.insert(state.player_id, entity);
        self.inputs.insert(state.player_id, PlayerInput::default());
        self.interact_latches.insert(state.player_id, false);
        self.player_index.insert_or_update(
            entity,
            Point {
                x: position.x,
                y: position.y,
            },
        );
        Ok(())
    }

    fn validate_player_transfer(
        &self,
        state: &PlayerTransferState,
    ) -> Result<(), TransferStateError> {
        let region = self
            .map
            .region
            .as_ref()
            .ok_or(TransferStateError::MissingRegionAuthority)?;
        if state.schema_version != PLAYER_TRANSFER_SCHEMA
            || state.atlas_id != region.atlas_id
            || state.atlas_content_sha256 != region.atlas_content_sha256
            || state.to_region != region.region_id
            || state.from_region == state.to_region
            || !region_has_neighbor(region, &state.from_region)
        {
            return Err(TransferStateError::WrongDestination);
        }
        if self.players.contains_key(&state.player_id) {
            return Err(TransferStateError::PlayerAlreadyPresent);
        }
        let clean_name =
            validate_player_name(&state.name).map_err(|_| TransferStateError::InvalidPlayerName)?;
        if clean_name != state.name {
            return Err(TransferStateError::InvalidPlayerName);
        }
        if !self.is_player_name_available(&state.name, None) {
            return Err(TransferStateError::PlayerNameTaken);
        }
        if state
            .account_subject
            .as_deref()
            .is_some_and(|subject| validate_account_subject(subject).is_err())
        {
            return Err(TransferStateError::InvalidAccountSubject);
        }
        if !state.destination_x.is_finite()
            || !state.destination_y.is_finite()
            || state.destination_x < REGION_EDGE_MARGIN
            || state.destination_y < REGION_EDGE_MARGIN
            || state.destination_x > self.map.width - REGION_EDGE_MARGIN
            || state.destination_y > self.map.height - REGION_EDGE_MARGIN
        {
            return Err(TransferStateError::InvalidDestination);
        }
        validate_deeds(&state.demo_deeds)?;
        transfer_inventory(state)?;
        Ok(())
    }
}

fn transfer_inventory(state: &PlayerTransferState) -> Result<PlayerInventory, TransferStateError> {
    if state.inventory_capacity_slots == 0
        || state.inventory_capacity_slots > INVENTORY_CAPACITY_SLOTS
        || state.inventory_stacks.len() > usize::from(state.inventory_capacity_slots)
    {
        return Err(TransferStateError::InvalidInventory);
    }
    let mut item_ids = HashSet::new();
    let mut stacks = Vec::with_capacity(state.inventory_stacks.len());
    for stack in &state.inventory_stacks {
        let item =
            transfer_item_from_id(&stack.item_id).ok_or(TransferStateError::InvalidInventory)?;
        if !item_ids.insert(stack.item_id.as_str())
            || stack.quantity == 0
            || stack.quantity > INVENTORY_STACK_LIMIT
            || stack.age_years > MAX_LIFECYCLE_AGE_YEARS
            || !stack.age_progress_years.is_finite()
            || !(0.0..1.0).contains(&stack.age_progress_years)
        {
            return Err(TransferStateError::InvalidInventory);
        }
        stacks.push(InventoryStack {
            item,
            quantity: stack.quantity,
            age_years: stack.age_years,
            age_progress_years: stack.age_progress_years,
        });
    }
    Ok(PlayerInventory {
        capacity_slots: state.inventory_capacity_slots,
        stacks,
    })
}

fn validate_deeds(deeds: &[String]) -> Result<(), TransferStateError> {
    if deeds.len() > MAX_TRANSFER_DEEDS {
        return Err(TransferStateError::InvalidDeeds);
    }
    let mut unique = HashSet::new();
    if deeds.iter().any(|deed| {
        deed.is_empty()
            || deed.len() > MAX_TRANSFER_DEED_BYTES
            || !deed.is_ascii()
            || deed.chars().any(char::is_control)
            || !unique.insert(deed)
    }) {
        return Err(TransferStateError::InvalidDeeds);
    }
    Ok(())
}

fn region_has_neighbor(region: &crate::protocol::RegionRoutingSnapshot, region_id: &str) -> bool {
    [
        region.neighbors.north.as_deref(),
        region.neighbors.east.as_deref(),
        region.neighbors.south.as_deref(),
        region.neighbors.west.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|neighbor| neighbor == region_id)
}

fn transfer_item_id(item: InventoryItemKind) -> &'static str {
    match item {
        InventoryItemKind::Resource(ResourceKind::Wood) => "wood",
        InventoryItemKind::Resource(ResourceKind::Ore) => "ore",
        InventoryItemKind::Resource(ResourceKind::Stone) => "stone",
        InventoryItemKind::Resource(ResourceKind::Charge) => "charge",
        InventoryItemKind::Resource(ResourceKind::Deadwood) => "deadwood",
        InventoryItemKind::Resource(ResourceKind::Fiber) => "fiber",
        InventoryItemKind::Resource(ResourceKind::Mycelium) => "mycelium",
        InventoryItemKind::Resource(ResourceKind::Spores) => "spores",
        InventoryItemKind::Resource(ResourceKind::Seed) => "seed",
        InventoryItemKind::Crafted(CraftedItemKind::TrailKit) => "trail-kit",
    }
}

fn transfer_item_from_id(item_id: &str) -> Option<InventoryItemKind> {
    Some(match item_id {
        "wood" => InventoryItemKind::Resource(ResourceKind::Wood),
        "ore" => InventoryItemKind::Resource(ResourceKind::Ore),
        "stone" => InventoryItemKind::Resource(ResourceKind::Stone),
        "charge" => InventoryItemKind::Resource(ResourceKind::Charge),
        "deadwood" => InventoryItemKind::Resource(ResourceKind::Deadwood),
        "fiber" => InventoryItemKind::Resource(ResourceKind::Fiber),
        "mycelium" => InventoryItemKind::Resource(ResourceKind::Mycelium),
        "spores" => InventoryItemKind::Resource(ResourceKind::Spores),
        "seed" => InventoryItemKind::Resource(ResourceKind::Seed),
        "trail-kit" => InventoryItemKind::Crafted(CraftedItemKind::TrailKit),
        _ => return None,
    })
}
