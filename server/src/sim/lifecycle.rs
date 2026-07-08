use crate::protocol::ObjectLifecycleSnapshot;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LifecycleFamily {
    Tree,
    Deadwood,
    Mineral,
    Mycelium,
    Machine,
}

impl LifecycleFamily {
    fn snapshot_family(self) -> &'static str {
        match self {
            LifecycleFamily::Tree => "tree",
            LifecycleFamily::Deadwood => "deadwood",
            LifecycleFamily::Mineral => "mineral",
            LifecycleFamily::Mycelium => "mycelium",
            LifecycleFamily::Machine => "machine",
        }
    }

    fn stage_for_fullness(self, fullness: f32) -> &'static str {
        match self {
            LifecycleFamily::Tree if fullness < 0.25 => "cut",
            LifecycleFamily::Tree if fullness < 0.58 => "regrowing",
            LifecycleFamily::Tree if fullness < 0.9 => "mature",
            LifecycleFamily::Tree => "ancient",
            LifecycleFamily::Deadwood if fullness < 0.28 => "hollowed",
            LifecycleFamily::Deadwood if fullness < 0.7 => "decaying",
            LifecycleFamily::Deadwood => "freshfall",
            LifecycleFamily::Mineral if fullness < 0.28 => "ruined",
            LifecycleFamily::Mineral if fullness < 0.34 => "scarred",
            LifecycleFamily::Mineral if fullness < 0.82 => "veined",
            LifecycleFamily::Mineral => "rich",
            LifecycleFamily::Mycelium if fullness < 0.3 => "dormant",
            LifecycleFamily::Mycelium if fullness < 0.8 => "fruiting",
            LifecycleFamily::Mycelium => "blooming",
            LifecycleFamily::Machine if fullness < 0.25 => "spent",
            LifecycleFamily::Machine if fullness < 0.75 => "sparking",
            LifecycleFamily::Machine => "charged",
        }
    }
}

pub(super) fn lifecycle_snapshot(
    family: LifecycleFamily,
    stage_override: Option<&'static str>,
    species: Option<&'static str>,
    age_years: Option<u32>,
    base_health: f32,
    fullness: f32,
) -> ObjectLifecycleSnapshot {
    let stage = stage_override.unwrap_or_else(|| family.stage_for_fullness(fullness));
    ObjectLifecycleSnapshot {
        family: family.snapshot_family().to_string(),
        stage: stage.to_string(),
        species: species.map(str::to_string),
        age_years,
        health: lifecycle_health(family, base_health, age_years, fullness),
        growth: fullness,
        decay: lifecycle_decay(family, age_years, fullness),
    }
}

pub(super) fn lifecycle_years_per_second(family: LifecycleFamily) -> f32 {
    match family {
        LifecycleFamily::Tree => 0.04,
        LifecycleFamily::Deadwood => 1.0,
        LifecycleFamily::Mineral => 8.0,
        LifecycleFamily::Mycelium => 0.35,
        LifecycleFamily::Machine => 0.18,
    }
}

fn lifecycle_decay(family: LifecycleFamily, age_years: Option<u32>, fullness: f32) -> f32 {
    match family {
        LifecycleFamily::Mycelium => {
            (1.0 - fullness * 0.35 + age_pressure(family, age_years) * 0.05).clamp(0.0, 1.0)
        }
        LifecycleFamily::Deadwood => {
            (0.45 + fullness * 0.36 + age_pressure(family, age_years) * 0.22).clamp(0.0, 1.0)
        }
        LifecycleFamily::Tree => ((1.0 - fullness).clamp(0.0, 1.0) * 0.45
            + age_pressure(family, age_years) * 0.08)
            .clamp(0.0, 1.0),
        LifecycleFamily::Mineral => ((1.0 - fullness).clamp(0.0, 1.0) * 0.58
            + age_pressure(family, age_years) * 0.2)
            .clamp(0.0, 1.0),
        LifecycleFamily::Machine => ((1.0 - fullness).clamp(0.0, 1.0) * 0.2
            + age_pressure(family, age_years) * 0.12)
            .clamp(0.0, 1.0),
    }
}

fn lifecycle_health(
    family: LifecycleFamily,
    base_health: f32,
    age_years: Option<u32>,
    fullness: f32,
) -> f32 {
    let age_wear = 1.0 - age_pressure(family, age_years) * lifecycle_age_health_wear(family);
    match family {
        LifecycleFamily::Tree => {
            (base_health * age_wear * (0.72 + fullness * 0.28)).clamp(0.0, 1.0)
        }
        LifecycleFamily::Deadwood => {
            (base_health * age_wear * (0.4 + fullness * 0.6)).clamp(0.0, 1.0)
        }
        LifecycleFamily::Mineral => {
            (base_health * age_wear * (0.52 + fullness * 0.48)).clamp(0.0, 1.0)
        }
        LifecycleFamily::Mycelium => {
            (base_health * age_wear * (0.66 + fullness * 0.34)).clamp(0.0, 1.0)
        }
        LifecycleFamily::Machine => (base_health * age_wear * fullness).clamp(0.0, 1.0),
    }
}

fn age_pressure(family: LifecycleFamily, age_years: Option<u32>) -> f32 {
    let Some(age_years) = age_years else {
        return 0.0;
    };
    (age_years as f32 / lifecycle_age_pressure_years(family)).clamp(0.0, 1.0)
}

fn lifecycle_age_pressure_years(family: LifecycleFamily) -> f32 {
    match family {
        LifecycleFamily::Tree => 240.0,
        LifecycleFamily::Deadwood => 35.0,
        LifecycleFamily::Mineral => 160_000.0,
        LifecycleFamily::Mycelium => 18.0,
        LifecycleFamily::Machine => 45.0,
    }
}

fn lifecycle_age_health_wear(family: LifecycleFamily) -> f32 {
    match family {
        LifecycleFamily::Tree => 0.16,
        LifecycleFamily::Deadwood => 0.55,
        LifecycleFamily::Mineral => 0.42,
        LifecycleFamily::Mycelium => 0.08,
        LifecycleFamily::Machine => 0.34,
    }
}
