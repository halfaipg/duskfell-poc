mod blockers;
mod decay;
mod model;
mod resource_objects;
mod validation;

pub(super) use self::blockers::terrain_detail_authority_blockers;
pub(super) use self::decay::{
    terrain_detail_authority_decay_consumers, validate_terrain_detail_decay_consumer_targets,
};
pub use self::model::TerrainDetailAuthority;
pub(super) use self::model::{ResourceRequirement, TerrainDetailResourceObject};
#[cfg(test)]
pub(super) use self::model::{
    TerrainDetailAuthorityBlocker, TerrainDetailAuthorityCollision,
    TerrainDetailAuthorityConsumeRequirement, TerrainDetailAuthorityDecayConsumer,
    TerrainDetailAuthorityLifecycle, TerrainDetailAuthorityResource,
    TerrainDetailAuthorityResourceNode,
};
pub(super) use self::resource_objects::terrain_detail_authority_resource_objects;
