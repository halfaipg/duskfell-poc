use crate::protocol::ObjectKind;

pub(in crate::sim) struct GeneratedEcologyObject {
    pub(in crate::sim) id: &'static str,
    pub(in crate::sim) kind: ObjectKind,
    pub(in crate::sim) label: &'static str,
    pub(in crate::sim) x: f32,
    pub(in crate::sim) y: f32,
    pub(in crate::sim) radius: f32,
}

pub(in crate::sim) fn generated_ecology_objects() -> [GeneratedEcologyObject; 11] {
    [
        GeneratedEcologyObject {
            id: "young-grove-sapling",
            kind: ObjectKind::SaplingTree,
            label: "Sapling",
            x: 560.0,
            y: 555.0,
            radius: 30.0,
        },
        GeneratedEcologyObject {
            id: "mossheart-grove-tree",
            kind: ObjectKind::SaplingTree,
            label: "Mossheart Tree",
            x: 620.0,
            y: 585.0,
            radius: 38.0,
        },
        GeneratedEcologyObject {
            id: "ancient-ironleaf-tree",
            kind: ObjectKind::SaplingTree,
            label: "Ancient Ironleaf",
            x: 720.0,
            y: 520.0,
            radius: 46.0,
        },
        GeneratedEcologyObject {
            id: "fallen-grove-log",
            kind: ObjectKind::Deadwood,
            label: "Fallen Log",
            x: 650.0,
            y: 470.0,
            radius: 34.0,
        },
        GeneratedEcologyObject {
            id: "shrine-mycelium-bloom",
            kind: ObjectKind::MyceliumPatch,
            label: "Mycelium Bloom",
            x: 2480.0,
            y: 610.0,
            radius: 30.0,
        },
        GeneratedEcologyObject {
            id: "decaying-grove-stump",
            kind: ObjectKind::Deadwood,
            label: "Decaying Stump",
            x: 2425.0,
            y: 575.0,
            radius: 28.0,
        },
        GeneratedEcologyObject {
            id: "hollow-grove-stump",
            kind: ObjectKind::Deadwood,
            label: "Hollow Stump",
            x: 760.0,
            y: 1710.0,
            radius: 26.0,
        },
        GeneratedEcologyObject {
            id: "veilcap-runner",
            kind: ObjectKind::MyceliumPatch,
            label: "Veilcap Runner",
            x: 810.0,
            y: 1750.0,
            radius: 26.0,
        },
        GeneratedEcologyObject {
            id: "stormroot-field-coil",
            kind: ObjectKind::FieldCoil,
            label: "Stormroot Coil",
            x: 860.0,
            y: 1810.0,
            radius: 30.0,
        },
        GeneratedEcologyObject {
            id: "field-coil",
            kind: ObjectKind::FieldCoil,
            label: "Field Coil",
            x: 2040.0,
            y: 1060.0,
            radius: 34.0,
        },
        GeneratedEcologyObject {
            id: "ancient-viaduct-ruin",
            kind: ObjectKind::Ruin,
            label: "Ancient Viaduct Ruin",
            x: 2740.0,
            y: 760.0,
            radius: 42.0,
        },
    ]
}
