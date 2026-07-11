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
            x: 2048.0,
            y: 1260.0,
            radius: 30.0,
        },
        GeneratedEcologyObject {
            id: "mossheart-grove-tree",
            kind: ObjectKind::SaplingTree,
            label: "Mossheart Tree",
            x: 2160.0,
            y: 1200.0,
            radius: 38.0,
        },
        GeneratedEcologyObject {
            id: "ancient-ironleaf-tree",
            kind: ObjectKind::SaplingTree,
            label: "Ancient Ironleaf",
            x: 2215.0,
            y: 1280.0,
            radius: 46.0,
        },
        GeneratedEcologyObject {
            id: "fallen-grove-log",
            kind: ObjectKind::Deadwood,
            label: "Fallen Log",
            x: 2075.0,
            y: 1140.0,
            radius: 34.0,
        },
        GeneratedEcologyObject {
            id: "shrine-mycelium-bloom",
            kind: ObjectKind::MyceliumPatch,
            label: "Mycelium Bloom",
            x: 4795.0,
            y: 930.0,
            radius: 30.0,
        },
        GeneratedEcologyObject {
            id: "decaying-grove-stump",
            kind: ObjectKind::Deadwood,
            label: "Decaying Stump",
            x: 4750.0,
            y: 895.0,
            radius: 28.0,
        },
        GeneratedEcologyObject {
            id: "hollow-grove-stump",
            kind: ObjectKind::Deadwood,
            label: "Hollow Stump",
            x: 3210.0,
            y: 2250.0,
            radius: 26.0,
        },
        GeneratedEcologyObject {
            id: "veilcap-runner",
            kind: ObjectKind::MyceliumPatch,
            label: "Veilcap Runner",
            x: 3260.0,
            y: 2290.0,
            radius: 26.0,
        },
        GeneratedEcologyObject {
            id: "stormroot-field-coil",
            kind: ObjectKind::FieldCoil,
            label: "Stormroot Coil",
            x: 3330.0,
            y: 2340.0,
            radius: 30.0,
        },
        GeneratedEcologyObject {
            id: "field-coil",
            kind: ObjectKind::FieldCoil,
            label: "Field Coil",
            x: 3450.0,
            y: 2100.0,
            radius: 34.0,
        },
        GeneratedEcologyObject {
            id: "ancient-viaduct-ruin",
            kind: ObjectKind::Ruin,
            label: "Ancient Viaduct Ruin",
            x: 5030.0,
            y: 840.0,
            radius: 42.0,
        },
    ]
}
