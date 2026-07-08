use crate::protocol::ResourceKind;

use crate::sim::ecology::model::{TREE_HARVEST_FALLOUT_AMOUNT, TREE_HARVEST_FALLOUT_RADIUS};
use crate::sim::movement::distance;
use crate::sim::{
    point_from_position, GatherTarget, LifecycleFamily, Position, ResourceNodeChangedEvent,
    SimWorld, WorldObject,
};

impl SimWorld {
    pub(in crate::sim) fn add_tree_harvest_fallout(
        &mut self,
        source_position: Position,
    ) -> Option<ResourceNodeChangedEvent> {
        let target = self.nearest_deadwood_receiver(source_position)?;
        let mut object = self.world.get_mut::<WorldObject>(target.entity)?;
        let resource_node = object.resource_node.as_mut()?;
        if resource_node.lifecycle_family != LifecycleFamily::Deadwood
            || resource_node.resource != ResourceKind::Deadwood
        {
            return None;
        }
        resource_node.feed(TREE_HARVEST_FALLOUT_AMOUNT)?;
        Some(resource_node.changed_event(&target.object_id))
    }

    fn nearest_deadwood_receiver(&self, source_position: Position) -> Option<GatherTarget> {
        self.object_index
            .query_radius(
                point_from_position(source_position),
                TREE_HARVEST_FALLOUT_RADIUS + self.max_object_radius,
            )
            .into_iter()
            .filter_map(|entity| {
                let object = self.world.get::<WorldObject>(entity)?;
                let position = self.world.get::<Position>(entity)?;
                let resource_node = object.resource_node.as_ref()?;
                if resource_node.lifecycle_family != LifecycleFamily::Deadwood
                    || resource_node.resource != ResourceKind::Deadwood
                    || resource_node.amount >= resource_node.max_amount
                {
                    return None;
                }
                let distance = distance(source_position, *position);
                if distance > TREE_HARVEST_FALLOUT_RADIUS {
                    return None;
                }
                Some(GatherTarget {
                    entity,
                    object_id: object.id.clone(),
                    resource: resource_node.resource,
                    position: *position,
                    distance,
                })
            })
            .min_by(|a, b| a.distance.total_cmp(&b.distance))
    }
}
