use std::collections::HashMap;

use crate::protocol::TerrainSnapshot;
use bevy_ecs::prelude::Entity;

use super::model::{
    ResourceRequirement, TerrainDetailAuthority, TerrainDetailAuthorityDecayConsumer,
    TERRAIN_DETAIL_DECAY_CONSUMER_CAP, TERRAIN_DETAIL_DECAY_CONSUME_AMOUNT_CAP,
};
use super::validation::validate_terrain_detail_authority_header;

pub(in crate::sim) fn terrain_detail_authority_decay_consumers(
    authority: Option<&TerrainDetailAuthority>,
    terrain_snapshot: &TerrainSnapshot,
    map_width: f32,
    map_height: f32,
) -> Result<HashMap<String, Vec<ResourceRequirement>>, String> {
    let Some(authority) = authority else {
        return Ok(HashMap::new());
    };
    validate_terrain_detail_authority_header(authority, terrain_snapshot)?;
    if authority.decay_consumers.len() > TERRAIN_DETAIL_DECAY_CONSUMER_CAP {
        return Err(format!(
            "terrain detail authority decayConsumers count {} exceeds cap {}",
            authority.decay_consumers.len(),
            TERRAIN_DETAIL_DECAY_CONSUMER_CAP
        ));
    }

    let mut consumers = HashMap::new();
    for consumer in &authority.decay_consumers {
        let Some((target_object_id, requirements)) =
            terrain_detail_decay_consumer_rule(consumer, map_width, map_height)?
        else {
            continue;
        };
        if consumers
            .insert(target_object_id.clone(), requirements)
            .is_some()
        {
            return Err(format!(
                "terrain detail decay consumer {} is declared more than once",
                target_object_id
            ));
        }
    }
    Ok(consumers)
}

pub(in crate::sim) fn validate_terrain_detail_decay_consumer_targets(
    decay_consumers: &HashMap<String, Vec<ResourceRequirement>>,
    object_entities: &HashMap<String, Entity>,
) -> Result<(), String> {
    for target_id in decay_consumers.keys() {
        if !object_entities.contains_key(target_id) {
            return Err(format!(
                "terrain detail decay consumer {} does not map to a server-owned object",
                target_id
            ));
        }
    }
    Ok(())
}

fn terrain_detail_decay_consumer_rule(
    consumer: &TerrainDetailAuthorityDecayConsumer,
    map_width: f32,
    map_height: f32,
) -> Result<Option<(String, Vec<ResourceRequirement>)>, String> {
    if consumer.id.is_empty() || !consumer.x.is_finite() || !consumer.y.is_finite() {
        return Err(format!(
            "terrain detail decay consumer {} has invalid identity or position",
            consumer.id
        ));
    }
    if consumer.x < 0.0 || consumer.y < 0.0 || consumer.x > map_width || consumer.y > map_height {
        return Ok(None);
    }
    if consumer.consumes.is_empty() {
        return Err(format!(
            "terrain detail decay consumer {} has no consume requirements",
            consumer.id
        ));
    }

    let mut requirements: Vec<ResourceRequirement> = Vec::new();
    for requirement in &consumer.consumes {
        if requirement.amount == 0 || requirement.amount > TERRAIN_DETAIL_DECAY_CONSUME_AMOUNT_CAP {
            return Err(format!(
                "terrain detail decay consumer {} has invalid consume amount {}",
                consumer.id, requirement.amount
            ));
        }
        if let Some(index) = requirements
            .iter()
            .position(|existing| existing.resource == requirement.kind)
        {
            requirements[index].amount = requirements[index]
                .amount
                .saturating_add(requirement.amount)
                .min(TERRAIN_DETAIL_DECAY_CONSUME_AMOUNT_CAP);
        } else {
            requirements.push(ResourceRequirement {
                resource: requirement.kind,
                amount: requirement.amount,
            });
        }
    }

    Ok(Some((
        format!("terrain-detail:{}", consumer.id),
        requirements,
    )))
}
