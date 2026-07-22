export function terrainInteriorSpaces(compositionKits, profile) {
  const spaces = [];
  for (const kit of compositionKits) {
    const units = profile.unitsPerTile;
    if (kit.kind === "gatehouse-ruin") {
      const halfWidth = Math.max(0.64, kit.passageWidth + 0.42) * units;
      const halfHeight = (kit.halfHeight + 0.42) * units;
      const x = kit.x * units;
      const y = kit.y * units;
      const bounds = {
        minX: x - halfWidth,
        maxX: x + halfWidth,
        minY: y - halfHeight,
        maxY: y + halfHeight,
      };
      const rooms = splitRoomsAlongY(`${kit.id}-room`, bounds, [
        { id: "north-parapet", label: "north parapet", floorLevel: 1, share: 0.3 },
        { id: "passage", label: "gate passage", floorLevel: 0, share: 0.4 },
        { id: "south-parapet", label: "south parapet", floorLevel: 1, share: 0.3 },
      ]);
      spaces.push({
        id: `${kit.id}-interior`,
        kitId: kit.id,
        kitKind: kit.kind,
        label: "Ruined Gatehouse Passage",
        kind: "gatehouse-passage",
        x,
        y,
        bounds,
        revealPadding: units * 0.28,
        rooms,
        floors: [
          { level: 0, label: "gate passage", z: 0 },
          { level: 1, label: "broken parapet", z: 1.05 },
        ],
        portals: [
          {
            id: `${kit.id}-threshold-ramp`,
            kind: "threshold-ramp",
            label: "charged threshold ramp",
            fromFloor: 0,
            toFloor: 1,
            fromRoom: `${kit.id}-room-passage`,
            toRoom: `${kit.id}-room-south-parapet`,
            fromZ: 0,
            toZ: 0.48,
            axis: "y",
            bounds: {
              minX: x - halfWidth,
              maxX: x + halfWidth,
              minY: y + halfHeight - units * 0.82,
              maxY: y + halfHeight + units * 0.48,
            },
          },
        ],
        roof: {
          z: 1.72,
          alpha: 0.78,
          revealedAlpha: 0.12,
          material: "weathered-gate-stone",
        },
        occluders: roofOccluders(`${kit.id}-roof`, rooms, 1.72, 0.78, 0.06, "weathered-gate-stone"),
      });
      continue;
    }
    if (kit.kind !== "sunken-courtyard") continue;
    const halfWidth = kit.halfWidth * units;
    const halfHeight = kit.halfHeight * units;
    const x = kit.x * units;
    const y = kit.y * units;
    const stairWidth = Math.min(halfWidth * 0.58, units * 1.35);
    const stairDepth = Math.min(halfHeight * 0.5, units * 1.3);
    const bounds = {
      minX: x - halfWidth,
      maxX: x + halfWidth,
      minY: y - halfHeight,
      maxY: y + halfHeight,
    };
    const rooms = splitRoomsAlongY(`${kit.id}-room`, bounds, [
      { id: "north-gallery", label: "north upper gallery", floorLevel: 1, share: 0.25 },
      { id: "sunken-hall", label: "sunken hall", floorLevel: 0, share: 0.5 },
      { id: "south-gallery", label: "south upper gallery", floorLevel: 1, share: 0.25 },
    ]);
    spaces.push({
      id: `${kit.id}-interior`,
      kitId: kit.id,
      kitKind: kit.kind,
      label: "Sunken Courtyard Interior",
      kind: "multi-floor-ruin",
      x,
      y,
      bounds,
      revealPadding: units * 0.38,
      rooms,
      floors: [
        { level: 0, label: "sunken floor", z: -0.1 },
        { level: 1, label: "upper gallery", z: 1.15 },
      ],
      portals: [
        {
          id: `${kit.id}-south-stairs`,
          kind: "stairs",
          label: "eroded gallery stairs",
          fromFloor: 0,
          toFloor: 1,
          fromRoom: `${kit.id}-room-sunken-hall`,
          toRoom: `${kit.id}-room-south-gallery`,
          fromZ: -0.1,
          toZ: 1.15,
          axis: "y",
          bounds: {
            minX: x - stairWidth / 2,
            maxX: x + stairWidth / 2,
            minY: y + halfHeight - stairDepth,
            maxY: y + halfHeight + units * 0.55,
          },
        },
      ],
      roof: {
        z: 2.15,
        alpha: 0.84,
        revealedAlpha: 0.16,
        material: "weathered-stone",
      },
      occluders: roofOccluders(`${kit.id}-roof`, rooms, 2.15, 0.84, 0.05, "weathered-stone"),
    });
  }
  return spaces;
}

function splitRoomsAlongY(prefix, bounds, definitions) {
  const height = bounds.maxY - bounds.minY;
  let cursor = bounds.minY;
  return definitions.map((definition, index) => {
    const last = index === definitions.length - 1;
    const maxY = last ? bounds.maxY : cursor + height * definition.share;
    const room = {
      id: `${prefix}-${definition.id}`,
      label: definition.label,
      floorLevel: definition.floorLevel,
      bounds: { minX: bounds.minX, maxX: bounds.maxX, minY: cursor, maxY },
    };
    cursor = maxY;
    return room;
  });
}

function roofOccluders(prefix, rooms, z, alpha, revealedAlpha, material) {
  return rooms.map((room) => ({
    id: `${prefix}-${room.id.split("-").slice(-2).join("-")}`,
    kind: "roof",
    floorLevel: room.floorLevel + 1,
    roomIds: [room.id],
    bounds: room.bounds,
    z,
    alpha,
    revealedAlpha,
    material,
  }));
}
