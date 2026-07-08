use bevy_ecs::prelude::Entity;

use crate::protocol::ResourceKind;

use crate::sim::ecology::model::EcologyFeedCandidate;
use crate::sim::inventory::MYCELIUM_FEED_AMOUNT;
use crate::sim::terrain_authority::ResourceRequirement;
use crate::sim::{LifecycleFamily, Position, ResourceNodeChangedEvent, SimWorld, WorldObject};

impl SimWorld {
    pub(in crate::sim::ecology) fn coil_charge_candidates(
        &mut self,
    ) -> (Vec<EcologyFeedCandidate>, Vec<EcologyFeedCandidate>) {
        let mut coils = Vec::new();
        let mut mycelium_targets = Vec::new();
        let mut query = self.world.query::<(Entity, &WorldObject, &Position)>();
        for (entity, object, position) in query.iter(&self.world) {
            let Some(resource_node) = object.resource_node.as_ref() else {
                continue;
            };

            if resource_node.lifecycle_family == LifecycleFamily::Machine
                && resource_node.resource == ResourceKind::Charge
                && resource_node.amount > 0
            {
                coils.push(EcologyFeedCandidate {
                    entity,
                    object_id: object.id.clone(),
                    position: *position,
                    resource: resource_node.resource,
                });
            } else if resource_node.lifecycle_family == LifecycleFamily::Mycelium
                && resource_node.resource == ResourceKind::Mycelium
                && resource_node.amount < resource_node.max_amount
            {
                mycelium_targets.push(EcologyFeedCandidate {
                    entity,
                    object_id: object.id.clone(),
                    position: *position,
                    resource: resource_node.resource,
                });
            }
        }
        (coils, mycelium_targets)
    }

    pub(in crate::sim::ecology) fn ecology_feed_candidates(
        &mut self,
    ) -> (Vec<EcologyFeedCandidate>, Vec<EcologyFeedCandidate>) {
        let mut deadwood_sources = Vec::new();
        let mut mycelium_targets = Vec::new();
        let mut query = self.world.query::<(Entity, &WorldObject, &Position)>();
        for (entity, object, position) in query.iter(&self.world) {
            let Some(resource_node) = object.resource_node.as_ref() else {
                continue;
            };

            if resource_node.lifecycle_family == LifecycleFamily::Deadwood
                && resource_node.resource == ResourceKind::Deadwood
                && resource_node.amount > 0
            {
                deadwood_sources.push(EcologyFeedCandidate {
                    entity,
                    object_id: object.id.clone(),
                    position: *position,
                    resource: resource_node.resource,
                });
            } else if resource_node.lifecycle_family == LifecycleFamily::Mycelium
                && resource_node.resource == ResourceKind::Mycelium
                && resource_node.amount < resource_node.max_amount
            {
                mycelium_targets.push(EcologyFeedCandidate {
                    entity,
                    object_id: object.id.clone(),
                    position: *position,
                    resource: resource_node.resource,
                });
            }
        }
        (deadwood_sources, mycelium_targets)
    }

    pub(in crate::sim::ecology) fn is_feedable_mycelium(&self, entity: Entity) -> bool {
        let Some(object) = self.world.get::<WorldObject>(entity) else {
            return false;
        };
        let Some(resource_node) = object.resource_node.as_ref() else {
            return false;
        };
        resource_node.lifecycle_family == LifecycleFamily::Mycelium
            && resource_node.resource == ResourceKind::Mycelium
            && resource_node.amount < resource_node.max_amount
    }

    pub(in crate::sim::ecology) fn harvest_ecology_deadwood(
        &mut self,
        entity: Entity,
        object_id: &str,
        amount: u32,
    ) -> Option<(u32, ResourceNodeChangedEvent)> {
        let mut object = self.world.get_mut::<WorldObject>(entity)?;
        let resource_node = object.resource_node.as_mut()?;
        if resource_node.lifecycle_family != LifecycleFamily::Deadwood
            || resource_node.resource != ResourceKind::Deadwood
        {
            return None;
        }
        let harvested = resource_node.harvest(amount)?;
        Some((harvested, resource_node.changed_event(object_id)))
    }

    pub(in crate::sim::ecology) fn terrain_detail_decay_consumer_accepts(
        &self,
        target: &EcologyFeedCandidate,
        source_resource: ResourceKind,
    ) -> bool {
        self.terrain_detail_decay_consumer_requirement(&target.object_id, source_resource)
            .is_some()
    }

    pub(in crate::sim::ecology) fn terrain_detail_decay_consumer_requirement(
        &self,
        target_object_id: &str,
        source_resource: ResourceKind,
    ) -> Option<ResourceRequirement> {
        match self.terrain_detail_decay_consumers.get(target_object_id) {
            Some(requirements) => requirements
                .iter()
                .copied()
                .find(|requirement| requirement.resource == source_resource),
            None => Some(ResourceRequirement {
                resource: source_resource,
                amount: MYCELIUM_FEED_AMOUNT,
            }),
        }
    }

    pub(in crate::sim::ecology) fn feed_ecology_mycelium(
        &mut self,
        entity: Entity,
        object_id: &str,
        amount: u32,
    ) -> Option<ResourceNodeChangedEvent> {
        let mut object = self.world.get_mut::<WorldObject>(entity)?;
        let resource_node = object.resource_node.as_mut()?;
        if resource_node.lifecycle_family != LifecycleFamily::Mycelium
            || resource_node.resource != ResourceKind::Mycelium
        {
            return None;
        }
        resource_node.feed(amount)?;
        Some(resource_node.changed_event(object_id))
    }

    pub(in crate::sim::ecology) fn restore_ecology_deadwood(
        &mut self,
        entity: Entity,
        amount: u32,
    ) {
        let Some(mut object) = self.world.get_mut::<WorldObject>(entity) else {
            return;
        };
        let Some(resource_node) = object.resource_node.as_mut() else {
            return;
        };
        if resource_node.lifecycle_family == LifecycleFamily::Deadwood
            && resource_node.resource == ResourceKind::Deadwood
        {
            resource_node.restore(amount);
        }
    }

    pub(in crate::sim::ecology) fn harvest_field_coil_charge(
        &mut self,
        entity: Entity,
        object_id: &str,
    ) -> Option<(u32, ResourceNodeChangedEvent)> {
        let mut object = self.world.get_mut::<WorldObject>(entity)?;
        let resource_node = object.resource_node.as_mut()?;
        if resource_node.lifecycle_family != LifecycleFamily::Machine
            || resource_node.resource != ResourceKind::Charge
        {
            return None;
        }
        let spent = resource_node.harvest(MYCELIUM_FEED_AMOUNT)?;
        Some((spent, resource_node.changed_event(object_id)))
    }

    pub(in crate::sim::ecology) fn restore_field_coil_charge(
        &mut self,
        entity: Entity,
        amount: u32,
    ) {
        let Some(mut object) = self.world.get_mut::<WorldObject>(entity) else {
            return;
        };
        let Some(resource_node) = object.resource_node.as_mut() else {
            return;
        };
        if resource_node.lifecycle_family == LifecycleFamily::Machine
            && resource_node.resource == ResourceKind::Charge
        {
            resource_node.restore(amount);
        }
    }
}
