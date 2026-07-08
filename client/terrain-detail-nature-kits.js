import { addPlacementDetails } from "./terrain-detail-placement-utils.js";

export function oldGroveKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  const placements = [
    { dx: -3, dy: 0, kind: "tree", role: "ancient-canopy", scale: [0.86, 1.06], u: 0.48, v: 0.54 },
    { dx: 3, dy: 0, kind: "tree", role: "mature-canopy", scale: [0.78, 0.98], u: 0.54, v: 0.5 },
    { dx: 0, dy: 3, kind: "tree", role: "young-edge", scale: [0.62, 0.82], u: 0.48, v: 0.58 },
    { dx: -1, dy: 2, kind: "fallen-log", role: "deadfall-feed", scale: [0.58, 0.78], u: 0.56, v: 0.52 },
    { dx: 1, dy: 2, kind: "stump", role: "old-stump", scale: [0.48, 0.68], u: 0.44, v: 0.56 },
    { dx: 0, dy: 1, kind: "mushroom", role: "fairy-ring", scale: [0.42, 0.6], u: 0.62, v: 0.48 },
    { dx: -2, dy: 2, kind: "mushroom", role: "fairy-ring", scale: [0.34, 0.52], u: 0.38, v: 0.58 },
    { dx: 2, dy: -1, kind: "scrub", role: "understory", scale: [0.42, 0.66], u: 0.62, v: 0.6 },
    { dx: -3, dy: -1, kind: "tuft", role: "understory", scale: [0.32, 0.5], u: 0.44, v: 0.56 },
    { dx: 3, dy: -1, kind: "flower", role: "understory-bloom", scale: [0.26, 0.42], u: 0.58, v: 0.48 },
  ];

  return addPlacementDetails(kit, placements, tilesByCoord, cols, rows, profile, occupiedFootprints, { seedStride: 43 });
}

export function riverReedbedKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  const placements = [
    { dx: -3, dy: 0, kind: "reeds", role: "reedline", scale: [0.5, 0.76], u: 0.42, v: 0.64 },
    { dx: -1, dy: 1, kind: "reeds", role: "reedline", scale: [0.46, 0.72], u: 0.54, v: 0.58 },
    { dx: 1, dy: 0, kind: "reeds", role: "reedline", scale: [0.48, 0.74], u: 0.46, v: 0.62 },
    { dx: 3, dy: -1, kind: "reeds", role: "reedline", scale: [0.42, 0.68], u: 0.6, v: 0.5 },
    { dx: -2, dy: 2, kind: "fallen-log", role: "driftwood", scale: [0.48, 0.68], u: 0.58, v: 0.48 },
    { dx: 2, dy: 2, kind: "stump", role: "waterlogged-stump", scale: [0.38, 0.56], u: 0.42, v: 0.56 },
    { dx: -1, dy: -1, kind: "pebble", role: "wet-stone", scale: [0.22, 0.36], u: 0.5, v: 0.48 },
    { dx: 2, dy: 1, kind: "rock", role: "wet-stone", scale: [0.28, 0.44], u: 0.62, v: 0.58 },
    { dx: 0, dy: 2, kind: "tuft", role: "bank-grass", scale: [0.28, 0.44], u: 0.48, v: 0.6 },
  ];

  return addPlacementDetails(kit, placements, tilesByCoord, cols, rows, profile, occupiedFootprints, { seedStride: 47 });
}

export function stormrootKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  const placements = [
    { dx: 0, dy: 0, kind: "mushroom", role: "charged-mycelium", scale: [0.64, 0.86], u: 0.48, v: 0.58 },
    { dx: 1, dy: 0, kind: "stump", role: "spent-root", scale: [0.56, 0.74], u: 0.62, v: 0.46 },
    { dx: -1, dy: 1, kind: "fallen-log", role: "deadwood-feed", scale: [0.64, 0.84], u: 0.42, v: 0.6 },
    { dx: 2, dy: -1, kind: "ruin", role: "coil-plinth", scale: [0.58, 0.78], u: 0.56, v: 0.42 },
    { dx: -2, dy: -1, kind: "boulder", role: "grounding-stone", scale: [0.48, 0.68], u: 0.34, v: 0.48 },
    { dx: 0, dy: 2, kind: "tree", role: "stormroot-tree", scale: [0.72, 0.88], u: 0.5, v: 0.58 },
    { dx: -2, dy: 2, kind: "mushroom", role: "rot-runner", scale: [0.42, 0.62], u: 0.64, v: 0.54 },
    { dx: 2, dy: 2, kind: "stump", role: "hollow-conduit", scale: [0.44, 0.62], u: 0.46, v: 0.52 },
    { dx: -1, dy: -2, kind: "rock", role: "slag-chip", scale: [0.32, 0.46], u: 0.58, v: 0.38 },
    { dx: 1, dy: -2, kind: "pebble", role: "copper-shard", scale: [0.2, 0.32], u: 0.38, v: 0.44 },
    { dx: -3, dy: 0, kind: "tuft", role: "field-burn-grass", scale: [0.3, 0.46], u: 0.55, v: 0.62 },
    { dx: 3, dy: 0, kind: "flower", role: "charged-bloom", scale: [0.28, 0.42], u: 0.48, v: 0.5 },
  ];

  return addPlacementDetails(kit, placements, tilesByCoord, cols, rows, profile, occupiedFootprints, { seedStride: 37 });
}

export function leywellGardenKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  const placements = [
    { dx: 0, dy: 0, kind: "foundation", role: "basin-floor", scale: [0.9, 1.08], u: 0.5, v: 0.52 },
    { dx: -1, dy: 0, kind: "ruin", role: "fallen-rim", scale: [0.56, 0.76], u: 0.42, v: 0.5 },
    { dx: 1, dy: 0, kind: "ruin", role: "fallen-rim", scale: [0.54, 0.74], u: 0.58, v: 0.52 },
    { dx: 0, dy: -1, kind: "boulder", role: "wet-rim-stone", scale: [0.38, 0.58], u: 0.52, v: 0.42 },
    { dx: -1, dy: 1, kind: "mushroom", role: "basin-mycelium", scale: [0.42, 0.62], u: 0.62, v: 0.58 },
    { dx: 1, dy: 1, kind: "reeds", role: "overflow-reeds", scale: [0.44, 0.68], u: 0.46, v: 0.62 },
    { dx: -2, dy: 1, kind: "flower", role: "wet-garden", scale: [0.28, 0.44], u: 0.56, v: 0.58 },
    { dx: 2, dy: 1, kind: "tuft", role: "wet-garden", scale: [0.34, 0.52], u: 0.42, v: 0.56 },
    { dx: 2, dy: -1, kind: "pebble", role: "copper-chip", scale: [0.2, 0.32], u: 0.62, v: 0.44 },
    { dx: 3, dy: -2, kind: "rock", role: "conduit-stone", scale: [0.34, 0.5], u: 0.5, v: 0.48 },
    { dx: -2, dy: -1, kind: "fallen-log", role: "garden-deadfall", scale: [0.42, 0.62], u: 0.58, v: 0.56 },
    { dx: 0, dy: 2, kind: "stump", role: "waterlogged-stump", scale: [0.38, 0.56], u: 0.48, v: 0.54 },
  ];

  return addPlacementDetails(kit, placements, tilesByCoord, cols, rows, profile, occupiedFootprints, {
    seedStride: 53,
    allowSettlement: true,
  });
}
