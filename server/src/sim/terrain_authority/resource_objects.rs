use crate::protocol::{ObjectKind, ResourceKind, TerrainSnapshot};

use super::super::lifecycle::LifecycleFamily;
use super::super::resources::ResourceNode;
use super::model::{
    TerrainDetailAuthority, TerrainDetailAuthorityLifecycle, TerrainDetailAuthorityResourceNode,
    TerrainDetailResourceObject, TERRAIN_DETAIL_RESOURCE_NODE_CAP,
};
use super::validation::validate_terrain_detail_authority_header;

pub(in crate::sim) fn terrain_detail_authority_resource_objects(
    authority: Option<&TerrainDetailAuthority>,
    terrain_snapshot: &TerrainSnapshot,
    map_width: f32,
    map_height: f32,
) -> Result<Vec<TerrainDetailResourceObject>, String> {
    let Some(authority) = authority else {
        return Ok(Vec::new());
    };
    validate_terrain_detail_authority_header(authority, terrain_snapshot)?;
    if authority.resource_nodes.len() > TERRAIN_DETAIL_RESOURCE_NODE_CAP {
        return Err(format!(
            "terrain detail authority resourceNodes count {} exceeds cap {}",
            authority.resource_nodes.len(),
            TERRAIN_DETAIL_RESOURCE_NODE_CAP
        ));
    }

    authority
        .resource_nodes
        .iter()
        .filter_map(
            |node| match terrain_detail_resource_object(node, map_width, map_height) {
                Ok(Some(object)) => Some(Ok(object)),
                Ok(None) => None,
                Err(err) => Some(Err(err)),
            },
        )
        .collect()
}

fn terrain_detail_resource_object(
    node: &TerrainDetailAuthorityResourceNode,
    map_width: f32,
    map_height: f32,
) -> Result<Option<TerrainDetailResourceObject>, String> {
    if node.id.is_empty()
        || node.resource_node_id.is_empty()
        || !node.x.is_finite()
        || !node.y.is_finite()
    {
        return Err(format!(
            "terrain detail resource node {} has invalid identity or position",
            node.id
        ));
    }
    if node.x < 0.0 || node.y < 0.0 || node.x > map_width || node.y > map_height {
        return Ok(None);
    }
    let Some(resource) = node.resources.first().copied() else {
        return Err(format!(
            "terrain detail resource node {} has no primary resource",
            node.id
        ));
    };
    if resource.amount > resource.max_amount || resource.max_amount == 0 {
        return Err(format!(
            "terrain detail resource node {} has invalid resource amount",
            node.id
        ));
    }
    let lifecycle_family = terrain_detail_lifecycle_family(&node.lifecycle, resource.kind);
    let kind = terrain_detail_object_kind(resource.kind, &node.kind, lifecycle_family);
    let label = terrain_detail_resource_label(node, resource.kind);
    Ok(Some(TerrainDetailResourceObject {
        id: node.resource_node_id.clone(),
        kind,
        label,
        x: node.x,
        y: node.y,
        radius: terrain_detail_object_radius(&node.kind, resource.kind),
        resource_node: ResourceNode {
            resource: resource.kind,
            amount: resource.amount,
            max_amount: resource.max_amount,
            regen_per_second: terrain_detail_regen_per_second(resource.kind, lifecycle_family),
            regen_progress: 0.0,
            lifecycle_family,
            stage_override: terrain_detail_stage_override(node.lifecycle.as_ref()),
            species: terrain_detail_species(node.lifecycle.as_ref(), resource.kind),
            age_years: node
                .lifecycle
                .as_ref()
                .and_then(|lifecycle| lifecycle.age_years),
            age_progress_years: 0.0,
            base_health: node
                .lifecycle
                .as_ref()
                .and_then(|lifecycle| lifecycle.health)
                .unwrap_or_else(|| terrain_detail_base_health(lifecycle_family))
                .clamp(0.0, 1.0),
        },
    }))
}

fn terrain_detail_lifecycle_family(
    lifecycle: &Option<TerrainDetailAuthorityLifecycle>,
    resource: ResourceKind,
) -> LifecycleFamily {
    if let Some(family) = lifecycle
        .as_ref()
        .and_then(|lifecycle| lifecycle.family.as_deref())
    {
        match family {
            "tree" => return LifecycleFamily::Tree,
            "deadwood" => return LifecycleFamily::Deadwood,
            "mineral" => return LifecycleFamily::Mineral,
            "mycelium" => return LifecycleFamily::Mycelium,
            "machine" => return LifecycleFamily::Machine,
            _ => {}
        }
    }
    match resource {
        ResourceKind::Wood | ResourceKind::Seed => LifecycleFamily::Tree,
        ResourceKind::Deadwood | ResourceKind::Spores => LifecycleFamily::Deadwood,
        ResourceKind::Ore | ResourceKind::Stone => LifecycleFamily::Mineral,
        ResourceKind::Mycelium => LifecycleFamily::Mycelium,
        ResourceKind::Charge => LifecycleFamily::Machine,
        ResourceKind::Fiber => LifecycleFamily::Tree,
    }
}

fn terrain_detail_object_kind(
    resource: ResourceKind,
    detail_kind: &str,
    lifecycle_family: LifecycleFamily,
) -> ObjectKind {
    match lifecycle_family {
        LifecycleFamily::Tree => ObjectKind::SaplingTree,
        LifecycleFamily::Deadwood => ObjectKind::Deadwood,
        LifecycleFamily::Mineral if detail_kind == "boulder" || resource == ResourceKind::Ore => {
            ObjectKind::Ore
        }
        LifecycleFamily::Mineral => ObjectKind::Ruin,
        LifecycleFamily::Mycelium => ObjectKind::MyceliumPatch,
        LifecycleFamily::Machine => ObjectKind::FieldCoil,
    }
}

fn terrain_detail_resource_label(
    node: &TerrainDetailAuthorityResourceNode,
    resource: ResourceKind,
) -> String {
    let role = if node.kit_role == "none" {
        node.kind.as_str()
    } else {
        node.kit_role.as_str()
    };
    let context = node
        .kit_kind
        .as_deref()
        .or(node.kit_id.as_deref())
        .unwrap_or("terrain");
    format!(
        "{} {} ({})",
        title_case_token(role),
        resource_label(resource),
        title_case_token(context)
    )
}

fn terrain_detail_object_radius(detail_kind: &str, resource: ResourceKind) -> f32 {
    match detail_kind {
        "tree" => 36.0,
        "ruin" | "wall" => 34.0,
        "boulder" => 30.0,
        "fallen-log" => 28.0,
        "stump" => 24.0,
        "mushroom" => 20.0,
        "reeds" => 22.0,
        _ => match resource {
            ResourceKind::Stone | ResourceKind::Ore => 26.0,
            ResourceKind::Wood | ResourceKind::Deadwood => 24.0,
            ResourceKind::Mycelium
            | ResourceKind::Fiber
            | ResourceKind::Seed
            | ResourceKind::Spores => 18.0,
            ResourceKind::Charge => 26.0,
        },
    }
}

fn terrain_detail_regen_per_second(
    resource: ResourceKind,
    lifecycle_family: LifecycleFamily,
) -> f32 {
    match (lifecycle_family, resource) {
        (LifecycleFamily::Tree, ResourceKind::Wood) => 0.025,
        (LifecycleFamily::Tree, ResourceKind::Seed | ResourceKind::Fiber) => 0.02,
        (LifecycleFamily::Mineral, ResourceKind::Ore) => 0.012,
        (LifecycleFamily::Mineral, ResourceKind::Stone) => 0.0,
        (LifecycleFamily::Mycelium, ResourceKind::Mycelium) => 0.035,
        (LifecycleFamily::Machine, ResourceKind::Charge) => 0.018,
        _ => 0.0,
    }
}

fn terrain_detail_base_health(lifecycle_family: LifecycleFamily) -> f32 {
    match lifecycle_family {
        LifecycleFamily::Tree => 0.78,
        LifecycleFamily::Deadwood => 0.22,
        LifecycleFamily::Mineral => 0.45,
        LifecycleFamily::Mycelium => 0.82,
        LifecycleFamily::Machine => 0.72,
    }
}

fn terrain_detail_stage_override(
    lifecycle: Option<&TerrainDetailAuthorityLifecycle>,
) -> Option<&'static str> {
    match lifecycle.and_then(|lifecycle| lifecycle.stage.as_deref()) {
        Some("sapling") => Some("sapling"),
        Some("mature") => Some("mature"),
        Some("ancient") => Some("ancient"),
        Some("ancient-ruin") => Some("ancient-ruin"),
        Some("broken-wall") => Some("broken-wall"),
        Some("eroded-stairs") => Some("eroded-stairs"),
        Some("sunken-foundation") => Some("sunken-foundation"),
        Some("deadwood") => Some("deadwood"),
        Some("decaying") => Some("decaying"),
        Some("fruiting") => Some("fruiting"),
        Some("living") => Some("living"),
        Some("mineral") => Some("mineral"),
        _ => None,
    }
}

fn terrain_detail_species(
    lifecycle: Option<&TerrainDetailAuthorityLifecycle>,
    resource: ResourceKind,
) -> Option<&'static str> {
    match lifecycle.and_then(|lifecycle| lifecycle.species.as_deref()) {
        Some("greenwood") => Some("greenwood"),
        Some("shadebark") => Some("shadebark"),
        Some("ironleaf") => Some("ironleaf"),
        Some("paleoak") => Some("paleoak"),
        Some("weathered-viaduct-stone") => Some("weathered-viaduct-stone"),
        Some("weathered-courtyard-stone") => Some("weathered-courtyard-stone"),
        _ => match resource {
            ResourceKind::Wood | ResourceKind::Seed | ResourceKind::Fiber => Some("terrain-growth"),
            ResourceKind::Deadwood | ResourceKind::Spores => Some("terrain-deadwood"),
            ResourceKind::Mycelium => Some("terrain-veilcap"),
            ResourceKind::Stone | ResourceKind::Ore => Some("terrain-stone"),
            ResourceKind::Charge => Some("terrain-coil"),
        },
    }
}

fn title_case_token(value: &str) -> String {
    value
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn resource_label(resource: ResourceKind) -> &'static str {
    match resource {
        ResourceKind::Wood => "Wood",
        ResourceKind::Ore => "Ore",
        ResourceKind::Mycelium => "Mycelium",
        ResourceKind::Deadwood => "Deadwood",
        ResourceKind::Seed => "Seed",
        ResourceKind::Spores => "Spores",
        ResourceKind::Fiber => "Fiber",
        ResourceKind::Charge => "Charge",
        ResourceKind::Stone => "Stone",
    }
}
