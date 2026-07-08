use std::collections::HashMap;
use std::path::Path;

use anyhow::Context;

use crate::journal::{JournalEvent, JournalEventKind};
use crate::persistence::for_each_jsonl_line;
use crate::protocol::ResourceKind;

pub(crate) fn replay_resource_node_states(
    journal_path: &Path,
    max_line_bytes: usize,
) -> anyhow::Result<HashMap<String, (ResourceKind, u32)>> {
    let mut states = HashMap::new();
    for_each_jsonl_line(
        journal_path,
        max_line_bytes,
        "journal",
        |line_number, line| {
            if line.trim().is_empty() {
                return Ok(());
            }
            let event = serde_json::from_str::<JournalEvent>(line).with_context(|| {
                format!(
                    "failed to parse journal line {} from {} for resource-node replay",
                    line_number,
                    journal_path.display()
                )
            })?;
            if let JournalEventKind::ResourceNodeChanged {
                object_id,
                resource,
                amount,
                max_amount,
            } = event.kind
            {
                states.insert(object_id, (resource, amount.min(max_amount)));
            }
            Ok(())
        },
    )?;
    Ok(states)
}
