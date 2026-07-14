export function createContentContractCases(basePort) {
  return [
    {
      name: "missing-registrar",
      port: basePort,
      content: {
        ...validWorld(),
        objects: [
          {
            id: "north-grove",
            kind: "grove",
            label: "Ashen Grove",
            x: 430.0,
            y: 315.0,
            radius: 88.0,
          },
        ],
      },
      expected: "object id 'registrar'",
    },
    {
      name: "wrong-registrar-kind",
      port: basePort + 1,
      content: {
        ...validWorld(),
        objects: [
          {
            id: "registrar",
            kind: "grove",
            label: "Title Office",
            x: 900.0,
            y: 520.0,
            radius: 54.0,
          },
        ],
      },
      expected: "kind 'registrar'",
    },
    {
      name: "oversized-safe-zone",
      port: basePort + 2,
      content: {
        ...validWorld(),
        map: {
          width: 1800.0,
          height: 1100.0,
          safeZoneRadius: 700.0,
        },
      },
      expected: "safeZoneRadius",
    },
    {
      name: "missing-forge",
      port: basePort + 3,
      content: {
        ...validWorld(),
        objects: [
          {
            id: "registrar",
            kind: "registrar",
            label: "Title Office",
            x: 900.0,
            y: 520.0,
            radius: 54.0,
          },
        ],
      },
      expected: "object id 'field-forge'",
    },
    {
      name: "wrong-forge-kind",
      port: basePort + 4,
      content: {
        ...validWorld(),
        objects: [
          {
            id: "registrar",
            kind: "registrar",
            label: "Title Office",
            x: 900.0,
            y: 520.0,
            radius: 54.0,
          },
          {
            id: "field-forge",
            kind: "ore",
            label: "Field Forge",
            x: 1110.0,
            y: 615.0,
            radius: 56.0,
          },
        ],
      },
      expected: "kind 'forge'",
    },
    {
      name: "object-footprint-out-of-bounds",
      port: basePort + 5,
      content: {
        ...validWorld(),
        objects: [
          {
            id: "registrar",
            kind: "registrar",
            label: "Title Office",
            x: 20.0,
            y: 520.0,
            radius: 54.0,
          },
          {
            id: "field-forge",
            kind: "forge",
            label: "Field Forge",
            x: 1110.0,
            y: 615.0,
            radius: 56.0,
          },
        ],
      },
      expected: "footprint radius",
    },
    {
      name: "missing-terrain-profile",
      port: basePort + 6,
      content: {
        ...validWorld(),
        map: {
          width: 1800.0,
          height: 1100.0,
          safeZoneRadius: 260.0,
        },
      },
      expected: "map.terrain",
    },
    {
      name: "terrain-projection-drift",
      port: basePort + 7,
      content: {
        ...validWorld(),
        map: {
          ...validWorld().map,
          terrain: {
            ...validTerrain(),
            tileHeight: 32,
          },
        },
      },
      expected: "tile dimensions",
    },
  ];
}

function validWorld() {
  return {
    schemaVersion: "sundermere-world-v1",
    map: {
      width: 1800.0,
      height: 1100.0,
      safeZoneRadius: 260.0,
      terrain: validTerrain(),
    },
    spawn: {
      x: 810.0,
      y: 550.0,
    },
    objects: [
      {
        id: "registrar",
        kind: "registrar",
        label: "Title Office",
        x: 900.0,
        y: 520.0,
        radius: 54.0,
      },
      {
        id: "field-forge",
        kind: "forge",
        label: "Field Forge",
        x: 1110.0,
        y: 615.0,
        radius: 56.0,
      },
    ],
  };
}

function validTerrain() {
  return {
    profile: "duskfell-terrain-v1",
    seed: 7341,
    unitsPerTile: 64,
    tileWidth: 64,
    tileHeight: 64,
    heightScale: 20,
    minElevation: -1,
    maxElevation: 4,
    waterLevel: -1,
    maxWalkableStep: 1,
    materials: [
      "grass",
      "field",
      "dirt",
      "stone",
      "water",
      "settlement",
      "cobble",
      "rock",
      "ruin",
      "shore",
    ],
  };
}
