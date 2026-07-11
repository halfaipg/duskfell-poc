use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type PlayerId = Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientMessage {
    Input {
        seq: u64,
        up: bool,
        down: bool,
        left: bool,
        right: bool,
        interact: bool,
    },
    Rename {
        name: String,
    },
    PartyInvite {
        #[serde(rename = "npcId")]
        npc_id: String,
    },
    PartyLeave {
        #[serde(rename = "npcId")]
        npc_id: String,
    },
    Say {
        #[serde(rename = "npcId")]
        npc_id: String,
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    Welcome {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        snapshot: WorldSnapshot,
    },
    Snapshot(WorldSnapshot),
    Notice {
        level: NoticeLevel,
        message: String,
    },
    NpcSay {
        #[serde(rename = "npcId")]
        npc_id: String,
        #[serde(rename = "sayId")]
        say_id: Uuid,
        seq: u32,
        text: String,
        done: bool,
        source: NpcSaySource,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NpcSaySource {
    Canned,
    Live,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoticeLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSnapshot {
    pub tick: u64,
    pub map: MapSnapshot,
    pub players: Vec<PlayerSnapshot>,
    pub npcs: Vec<NpcSnapshot>,
    pub objects: Vec<ObjectSnapshot>,
    pub settlement: SettlementSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcSnapshot {
    pub id: String,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub party_player_id: Option<PlayerId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSnapshot {
    pub width: f32,
    pub height: f32,
    pub safe_zone_radius: f32,
    pub terrain: TerrainSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainSnapshot {
    pub profile: String,
    pub seed: u32,
    pub units_per_tile: u32,
    pub tile_width: u32,
    pub tile_height: u32,
    pub height_scale: f32,
    pub min_elevation: i32,
    pub max_elevation: i32,
    pub water_level: i32,
    pub max_walkable_step: u32,
    pub materials: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub id: PlayerId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_subject: Option<String>,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub color: String,
    pub demo_deeds: Vec<String>,
    pub resources: ResourceSnapshot,
    pub inventory: InventorySnapshot,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSnapshot {
    pub wood: u32,
    pub ore: u32,
    pub stone: u32,
    pub charge: u32,
    pub deadwood: u32,
    pub fiber: u32,
    pub mycelium: u32,
    pub spores: u32,
    pub seed: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResourceKind {
    Wood,
    Ore,
    Stone,
    Charge,
    Deadwood,
    Fiber,
    Mycelium,
    Spores,
    Seed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventorySnapshot {
    pub capacity_slots: u8,
    pub items: Vec<InventoryItemSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItemSnapshot {
    pub item_id: String,
    pub label: String,
    pub quantity: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<InventoryItemLifecycleSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItemLifecycleSnapshot {
    pub family: String,
    pub stage: String,
    #[serde(rename = "ageYears")]
    pub age_years: u32,
    pub health: f32,
    pub decay: f32,
    pub compostable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectSnapshot {
    pub id: String,
    pub kind: ObjectKind,
    pub label: String,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub resources: Vec<ObjectResourceSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<ObjectLifecycleSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectResourceSnapshot {
    pub kind: ResourceKind,
    pub amount: u32,
    pub max_amount: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectLifecycleSnapshot {
    pub family: String,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub species: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age_years: Option<u32>,
    pub health: f32,
    pub growth: f32,
    pub decay: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ObjectKind {
    Registrar,
    Forge,
    Grove,
    Ore,
    Shrine,
    SaplingTree,
    Deadwood,
    MyceliumPatch,
    FieldCoil,
    Ruin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementSnapshot {
    pub chain_enabled: bool,
    pub pending_jobs: usize,
    pub confirmed_jobs: usize,
    pub owned_assets: usize,
    pub latest_receipt: Option<SettlementReceiptSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementReceiptSnapshot {
    pub job_id: Uuid,
    pub player_id: PlayerId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_subject: Option<String>,
    pub asset_id: String,
    pub status: String,
    pub chain_tx: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{ClientMessage, NpcSnapshot};

    #[test]
    fn client_input_accepts_exact_fields() {
        let message = serde_json::from_str::<ClientMessage>(
            r#"{"type":"input","seq":7,"up":true,"down":false,"left":false,"right":true,"interact":false}"#,
        )
        .expect("exact input message parses");

        match message {
            ClientMessage::Input {
                seq,
                up,
                down,
                left,
                right,
                interact,
            } => {
                assert_eq!(seq, 7);
                assert!(up);
                assert!(!down);
                assert!(!left);
                assert!(right);
                assert!(!interact);
            }
            other => panic!("expected input message, got {other:?}"),
        }
    }

    #[test]
    fn client_messages_reject_unknown_fields() {
        let input_err = serde_json::from_str::<ClientMessage>(
            r#"{"type":"input","seq":7,"up":true,"down":false,"left":false,"right":true,"interact":false,"admin":true}"#,
        )
        .expect_err("extra input field should fail");
        assert!(input_err.to_string().contains("unknown field"));

        let rename_err = serde_json::from_str::<ClientMessage>(
            r##"{"type":"rename","name":"Scout","color":"#fff"}"##,
        )
        .expect_err("extra rename field should fail");
        assert!(rename_err.to_string().contains("unknown field"));

        let party_err = serde_json::from_str::<ClientMessage>(
            r#"{"type":"partyInvite","npcId":"maren","force":true}"#,
        )
        .expect_err("extra party invite field should fail");
        assert!(party_err.to_string().contains("unknown field"));
    }

    #[test]
    fn party_messages_use_camel_case_wire_shape() {
        let invite =
            serde_json::from_str::<ClientMessage>(r#"{"type":"partyInvite","npcId":"maren"}"#)
                .expect("party invite parses");
        match invite {
            ClientMessage::PartyInvite { npc_id } => assert_eq!(npc_id, "maren"),
            other => panic!("expected party invite, got {other:?}"),
        }

        let leave =
            serde_json::from_str::<ClientMessage>(r#"{"type":"partyLeave","npcId":"maren"}"#)
                .expect("party leave parses");
        match leave {
            ClientMessage::PartyLeave { npc_id } => assert_eq!(npc_id, "maren"),
            other => panic!("expected party leave, got {other:?}"),
        }
    }

    #[test]
    fn say_message_uses_camel_case_and_rejects_unknown_fields() {
        let say = serde_json::from_str::<ClientMessage>(
            r#"{"type":"say","npcId":"maren","text":"hello"}"#,
        )
        .expect("say parses");
        match say {
            ClientMessage::Say { npc_id, text } => {
                assert_eq!(npc_id, "maren");
                assert_eq!(text, "hello");
            }
            other => panic!("expected say, got {other:?}"),
        }

        let err = serde_json::from_str::<ClientMessage>(
            r#"{"type":"say","npcId":"maren","text":"hello","admin":true}"#,
        )
        .expect_err("extra say field should fail");
        assert!(err.to_string().contains("unknown field"));
    }

    #[test]
    fn npc_say_serializes_camel_case_wire_shape() {
        let say_id = uuid::Uuid::new_v4();
        let frame = super::ServerMessage::NpcSay {
            npc_id: "maren".to_string(),
            say_id,
            seq: 0,
            text: "Mm.".to_string(),
            done: true,
            source: super::NpcSaySource::Canned,
        };
        let json = serde_json::to_string(&frame).expect("npcSay serializes");
        assert!(json.contains(r#""type":"npcSay""#));
        assert!(json.contains(r#""npcId":"maren""#));
        assert!(json.contains(&format!(r#""sayId":"{say_id}""#)));
        assert!(json.contains(r#""source":"canned""#));
        assert!(json.contains(r#""done":true"#));
    }

    #[test]
    fn npc_snapshot_serializes_camel_case_and_omits_empty_party() {
        let npc = NpcSnapshot {
            id: "maren".to_string(),
            name: "Maren".to_string(),
            x: 1.0,
            y: 2.0,
            radius: 20.0,
            party_player_id: None,
        };
        let json = serde_json::to_string(&npc).expect("npc snapshot serializes");
        assert_eq!(
            json,
            r#"{"id":"maren","name":"Maren","x":1.0,"y":2.0,"radius":20.0}"#
        );

        let player_id = uuid::Uuid::new_v4();
        let npc = NpcSnapshot {
            party_player_id: Some(player_id),
            ..npc
        };
        let json = serde_json::to_string(&npc).expect("npc snapshot serializes");
        assert!(json.contains(&format!(r#""partyPlayerId":"{player_id}""#)));
    }
}
