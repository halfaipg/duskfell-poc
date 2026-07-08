export const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
export const RECEIPT_ID = "22222222-2222-4222-8222-222222222222";

export function validSnapshot() {
  return {
    tick: 42,
    map: {
      width: 1600,
      height: 1200,
      safeZoneRadius: 220,
      terrain: validTerrain(),
    },
    players: [validPlayer()],
    objects: [
      {
        id: "title-office",
        kind: "registrar",
        label: "Title Office",
        x: 760,
        y: 620,
        radius: 48,
      },
      {
        id: "field-forge",
        kind: "forge",
        label: "Field Forge",
        x: 900,
        y: 700,
        radius: 56,
      },
      validGroveObject(),
      {
        id: "shrine-mycelium-bloom",
        kind: "myceliumPatch",
        label: "Mycelium Bloom",
        x: 1018,
        y: 342,
        radius: 30,
        resources: [{ kind: "mycelium", amount: 3, maxAmount: 4 }],
        lifecycle: {
          family: "mycelium",
          stage: "fruiting",
          species: "veilcap",
          ageYears: 1,
          health: 0.85,
          growth: 0.75,
          decay: 0.74,
        },
      },
      {
        id: "field-coil",
        kind: "fieldCoil",
        label: "Field Coil",
        x: 1205,
        y: 540,
        radius: 34,
        resources: [{ kind: "charge", amount: 3, maxAmount: 5 }],
        lifecycle: {
          family: "machine",
          stage: "sparking",
          ageYears: 12,
          health: 0.49,
          growth: 0.6,
          decay: 0.08,
        },
      },
      {
        id: "ancient-viaduct-ruin",
        kind: "ruin",
        label: "Ancient Viaduct Ruin",
        x: 690,
        y: 372,
        radius: 42,
        resources: [{ kind: "stone", amount: 2, maxAmount: 12 }],
        lifecycle: {
          family: "mineral",
          stage: "ancient-ruin",
          species: "sunken-viaduct-stone",
          ageYears: 128000,
          health: 0.24,
          growth: 0.17,
          decay: 0.6,
        },
      },
    ],
    settlement: {
      chainEnabled: false,
      pendingJobs: 0,
      confirmedJobs: 1,
      ownedAssets: 1,
      latestReceipt: null,
    },
  };
}

export function validTerrain() {
  return {
    profile: "duskfell-terrain-v1",
    seed: 7341,
    unitsPerTile: 64,
    tileWidth: 64,
    tileHeight: 64,
    heightScale: 6,
    minElevation: -1,
    maxElevation: 4,
    waterLevel: -1,
    maxWalkableStep: 1,
    materials: ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"],
  };
}

export function validPlayer() {
  return {
    id: PLAYER_ID,
    accountSubject: "acct:wallet:0xabc123",
    name: "Wayfarer",
    x: 720,
    y: 640,
    color: "#2f7565",
    demoDeeds: [],
    resources: {
      wood: 2,
      ore: 1,
    },
    inventory: {
      capacitySlots: 8,
      items: [
        { itemId: "wood", label: "Wood", quantity: 2 },
        { itemId: "ore", label: "Ore", quantity: 1 },
      ],
    },
  };
}

export function validGroveObject() {
  return {
    id: "north-grove",
    kind: "grove",
    label: "Ashen Grove",
    x: 430,
    y: 315,
    radius: 88,
    resources: [{ kind: "wood", amount: 8, maxAmount: 12 }],
    lifecycle: {
      family: "tree",
      stage: "mature",
      species: "ashbark",
      ageYears: 84,
      health: 0.77,
      growth: 0.67,
      decay: 0.15,
    },
  };
}
