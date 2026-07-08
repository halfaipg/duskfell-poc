use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::protocol::PlayerId;

#[derive(Debug, Clone)]
pub struct SettlementConfig {
    pub chain_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementJob {
    pub job_id: Uuid,
    pub player_id: PlayerId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_subject: Option<String>,
    pub asset_id: String,
    pub reason: String,
}
