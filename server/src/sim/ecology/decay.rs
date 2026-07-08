use crate::sim::ecology::model::{ECOLOGY_DECAY_FEED_INTERVAL_TICKS, ECOLOGY_DECAY_FEED_RADIUS};
use crate::sim::inventory::MYCELIUM_FEED_AMOUNT;
use crate::sim::movement::distance;
use crate::sim::{ResourceNodeChangedEvent, SimWorld};

impl SimWorld {
    pub(in crate::sim) fn decay_deadwood_into_mycelium(&mut self) -> Vec<ResourceNodeChangedEvent> {
        if self.tick % ECOLOGY_DECAY_FEED_INTERVAL_TICKS != 0 {
            return Vec::new();
        }

        let (mut deadwood_sources, mut mycelium_targets) = self.ecology_feed_candidates();
        deadwood_sources.sort_by(|a, b| a.object_id.cmp(&b.object_id));
        mycelium_targets.sort_by(|a, b| a.object_id.cmp(&b.object_id));

        let mut events = Vec::new();
        for source in deadwood_sources {
            let Some(target) = mycelium_targets
                .iter()
                .filter(|target| {
                    distance(source.position, target.position) <= ECOLOGY_DECAY_FEED_RADIUS
                        && self.terrain_detail_decay_consumer_accepts(target, source.resource)
                })
                .min_by(|a, b| {
                    distance(source.position, a.position)
                        .total_cmp(&distance(source.position, b.position))
                })
                .cloned()
            else {
                continue;
            };

            let feed_amount = self
                .terrain_detail_decay_consumer_requirement(&target.object_id, source.resource)
                .map(|requirement| requirement.amount)
                .unwrap_or(MYCELIUM_FEED_AMOUNT);
            if !self.is_feedable_mycelium(target.entity) {
                continue;
            }

            let Some((harvested, source_event)) =
                self.harvest_ecology_deadwood(source.entity, &source.object_id, feed_amount)
            else {
                continue;
            };

            let Some(target_event) =
                self.feed_ecology_mycelium(target.entity, &target.object_id, harvested)
            else {
                self.restore_ecology_deadwood(source.entity, harvested);
                continue;
            };

            events.push(source_event);
            events.push(target_event);
        }

        events
    }
}
