mod coils;
mod compost;
mod decay;
mod fallout;
mod model;
mod transfer;

#[cfg(test)]
pub(super) use self::model::{
    COIL_MYCELIUM_CHARGE_INTERVAL_TICKS, ECOLOGY_DECAY_FEED_INTERVAL_TICKS,
};
