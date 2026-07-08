use super::*;

#[test]
fn resource_node_replay_restores_depleted_world_state() {
    let mut states = HashMap::new();
    states.insert("north-grove".to_string(), (ResourceKind::Wood, 3));
    states.insert("old-shrine".to_string(), (ResourceKind::Mycelium, 2));
    states.insert("fallen-grove-log".to_string(), (ResourceKind::Deadwood, 1));
    states.insert("field-coil".to_string(), (ResourceKind::Charge, 2));
    states.insert("east-ore".to_string(), (ResourceKind::Wood, 1));
    states.insert("missing-node".to_string(), (ResourceKind::Ore, 1));

    let mut sim = SimWorld::new();
    assert_eq!(sim.apply_resource_node_replay(&states), 4);

    let snapshot = sim.snapshot(empty_settlement());
    let grove = snapshot
        .objects
        .iter()
        .find(|object| object.id == "north-grove")
        .expect("grove should be present");
    assert_eq!(grove.resources[0].amount, 3);
    assert_eq!(grove.resources[0].max_amount, 12);

    let shrine = snapshot
        .objects
        .iter()
        .find(|object| object.id == "old-shrine")
        .expect("shrine should be present");
    assert_eq!(shrine.resources[0].amount, 2);

    let ore = snapshot
        .objects
        .iter()
        .find(|object| object.id == "east-ore")
        .expect("ore should be present");
    assert_eq!(
        ore.resources[0].amount, 6,
        "replay with the wrong resource kind should not mutate the node"
    );

    let deadwood = snapshot
        .objects
        .iter()
        .find(|object| object.id == "fallen-grove-log")
        .expect("generated deadwood should be present");
    assert_eq!(deadwood.resources[0].amount, 1);

    let field_coil = snapshot
        .objects
        .iter()
        .find(|object| object.id == "field-coil")
        .expect("field coil should be present");
    assert_eq!(field_coil.resources[0].kind, ResourceKind::Charge);
    assert_eq!(field_coil.resources[0].amount, 2);
}
