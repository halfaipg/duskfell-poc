export function terrainInteriorSpaces(compositionKits, profile) {
  const spaces = [];
  for (const kit of compositionKits) {
    const units = profile.unitsPerTile;
    if (kit.kind === "gatehouse-ruin") {
      const halfWidth = Math.max(0.64, kit.passageWidth + 0.42) * units;
      const halfHeight = (kit.halfHeight + 0.42) * units;
      const x = kit.x * units;
      const y = kit.y * units;
      spaces.push({
        id: `${kit.id}-interior`,
        kitId: kit.id,
        kitKind: kit.kind,
        label: "Ruined Gatehouse Passage",
        kind: "gatehouse-passage",
        x,
        y,
        bounds: {
          minX: x - halfWidth,
          maxX: x + halfWidth,
          minY: y - halfHeight,
          maxY: y + halfHeight,
        },
        revealPadding: units * 0.28,
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
    spaces.push({
      id: `${kit.id}-interior`,
      kitId: kit.id,
      kitKind: kit.kind,
      label: "Sunken Courtyard Interior",
      kind: "multi-floor-ruin",
      x,
      y,
      bounds: {
        minX: x - halfWidth,
        maxX: x + halfWidth,
        minY: y - halfHeight,
        maxY: y + halfHeight,
      },
      revealPadding: units * 0.38,
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
    });
  }
  return spaces;
}
