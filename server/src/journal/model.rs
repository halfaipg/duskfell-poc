use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::protocol::{PlayerId, ResourceKind};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEvent {
    pub sequence: u64,
    pub tick: u64,
    pub kind: JournalEventKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JournalEventKind {
    PlayerJoined {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "accountSubject", skip_serializing_if = "Option::is_none")]
        account_subject: Option<String>,
    },
    PlayerLeft {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
    },
    PlayerRenamed {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        name: String,
    },
    OwnershipClaimed {
        #[serde(rename = "jobId")]
        job_id: Uuid,
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "accountSubject", skip_serializing_if = "Option::is_none")]
        account_subject: Option<String>,
        #[serde(rename = "assetId")]
        asset_id: String,
        reason: String,
    },
    ResourceGathered {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "objectId")]
        object_id: String,
        resource: ResourceKind,
        amount: u32,
        total: u32,
    },
    ResourceNodeChanged {
        #[serde(rename = "objectId")]
        object_id: String,
        resource: ResourceKind,
        amount: u32,
        #[serde(rename = "maxAmount")]
        max_amount: u32,
    },
    ResourceFed {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "objectId")]
        object_id: String,
        #[serde(rename = "inputResource")]
        input_resource: ResourceKind,
        #[serde(rename = "inputAmount")]
        input_amount: u32,
        #[serde(rename = "inputTotal")]
        input_total: u32,
        #[serde(rename = "outputResource")]
        output_resource: ResourceKind,
        #[serde(rename = "outputAmount")]
        output_amount: u32,
        #[serde(rename = "outputTotal")]
        output_total: u32,
    },
    ItemCrafted {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "objectId")]
        object_id: String,
        #[serde(rename = "itemId")]
        item_id: String,
        amount: u32,
        total: u32,
    },
    ItemFed {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "objectId")]
        object_id: String,
        #[serde(rename = "itemId")]
        item_id: String,
        #[serde(rename = "itemLabel")]
        item_label: String,
        #[serde(rename = "inputAmount")]
        input_amount: u32,
        #[serde(rename = "inputTotal")]
        input_total: u32,
        #[serde(rename = "outputResource")]
        output_resource: ResourceKind,
        #[serde(rename = "outputAmount")]
        output_amount: u32,
        #[serde(rename = "outputTotal")]
        output_total: u32,
    },
    ItemDecayed {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "targetObjectId", skip_serializing_if = "Option::is_none")]
        target_object_id: Option<String>,
        #[serde(rename = "itemId")]
        item_id: String,
        #[serde(rename = "itemLabel")]
        item_label: String,
        #[serde(rename = "itemStage")]
        item_stage: String,
        #[serde(rename = "outputResource")]
        output_resource: ResourceKind,
        #[serde(rename = "outputAmount")]
        output_amount: u32,
        #[serde(rename = "outputTotal")]
        output_total: u32,
    },
    SettlementPersistenceFailed {
        #[serde(rename = "jobId")]
        job_id: Uuid,
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "accountSubject", skip_serializing_if = "Option::is_none")]
        account_subject: Option<String>,
        #[serde(rename = "assetId")]
        asset_id: String,
        error: String,
    },
    NpcRelocated {
        #[serde(rename = "npcId")]
        npc_id: String,
        x: f32,
        y: f32,
    },
    NpcPartyInvited {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "npcId")]
        npc_id: String,
        #[serde(rename = "inviteId")]
        invite_id: Uuid,
    },
    NpcPartyJoined {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "npcId")]
        npc_id: String,
    },
    NpcPartyDeclined {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "npcId")]
        npc_id: String,
        #[serde(rename = "inviteId")]
        invite_id: Uuid,
    },
    NpcPartyLeft {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "npcId")]
        npc_id: String,
    },
    PlayerSpokeToNpc {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "npcId")]
        npc_id: String,
        text: String,
    },
    NpcSaid {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "npcId")]
        npc_id: String,
        #[serde(rename = "sayId")]
        say_id: Uuid,
        chars: usize,
        source: String,
    },
    NpcIntentRejected {
        #[serde(rename = "npcId")]
        npc_id: String,
        #[serde(rename = "decisionId")]
        decision_id: String,
        reason: String,
    },
    NpcCognitionStatusChanged {
        status: String,
    },
    BadClientMessage {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        error: String,
    },
    ClientMessageRejected {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        reason: String,
    },
}
