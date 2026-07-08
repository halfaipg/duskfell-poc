use crate::sim::ecology::model::{
    COIL_MYCELIUM_CHARGE_INTERVAL_TICKS, COIL_MYCELIUM_CHARGE_RADIUS,
};
use crate::sim::movement::distance;
use crate::sim::{ResourceNodeChangedEvent, SimWorld};

impl SimWorld {
    pub(in crate::sim) fn charge_mycelium_from_field_coils(
        &mut self,
    ) -> Vec<ResourceNodeChangedEvent> {
        if self.tick % COIL_MYCELIUM_CHARGE_INTERVAL_TICKS != 0 {
            return Vec::new();
        }

        let (mut coils, mut mycelium_targets) = self.coil_charge_candidates();
        coils.sort_by(|a, b| a.object_id.cmp(&b.object_id));
        mycelium_targets.sort_by(|a, b| a.object_id.cmp(&b.object_id));

        let mut events = Vec::new();
        for coil in coils {
            let Some(target) = mycelium_targets
                .iter()
                .filter(|target| {
                    distance(coil.position, target.position) <= COIL_MYCELIUM_CHARGE_RADIUS
                })
                .min_by(|a, b| {
                    distance(coil.position, a.position)
                        .total_cmp(&distance(coil.position, b.position))
                })
                .cloned()
            else {
                continue;
            };

            if !self.is_feedable_mycelium(target.entity) {
                continue;
            }

            let Some((spent, coil_event)) =
                self.harvest_field_coil_charge(coil.entity, &coil.object_id)
            else {
                continue;
            };

            let Some(target_event) =
                self.feed_ecology_mycelium(target.entity, &target.object_id, spent)
            else {
                self.restore_field_coil_charge(coil.entity, spent);
                continue;
            };

            events.push(coil_event);
            events.push(target_event);
        }

        events
    }
}
