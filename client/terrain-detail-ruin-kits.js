import { addPlacementDetails } from "./terrain-detail-placement-utils.js";

export function ancientViaductKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  const placements = [
    { dx: -3, dy: 3, kind: "ruin", role: "broken-pier", scale: [0.82, 1.04], u: 0.55, v: 0.48 },
    { dx: 0, dy: 0, kind: "ruin", role: "fallen-arch", scale: [0.7, 0.92], u: 0.48, v: 0.54 },
    { dx: 3, dy: -3, kind: "ruin", role: "sunken-pier", scale: [0.76, 1], u: 0.52, v: 0.5 },
    { dx: -2, dy: 1, kind: "boulder", role: "abutment-stone", scale: [0.58, 0.84], u: 0.32, v: 0.72 },
    { dx: 1, dy: -2, kind: "boulder", role: "abutment-stone", scale: [0.54, 0.8], u: 0.66, v: 0.34 },
    { dx: -4, dy: 2, kind: "rock", role: "fallen-rubble", scale: [0.46, 0.62], u: 0.44, v: 0.58 },
    { dx: 4, dy: -2, kind: "rock", role: "fallen-rubble", scale: [0.44, 0.62], u: 0.58, v: 0.44 },
    { dx: -1, dy: 2, kind: "pebble", role: "stone-chips", scale: [0.24, 0.36], u: 0.28, v: 0.42 },
    { dx: 2, dy: -1, kind: "pebble", role: "stone-chips", scale: [0.24, 0.36], u: 0.74, v: 0.52 },
    { dx: -3, dy: 4, kind: "tuft", role: "overgrowth", scale: [0.34, 0.52], u: 0.66, v: 0.68 },
    { dx: 4, dy: -3, kind: "flower", role: "overgrowth", scale: [0.28, 0.44], u: 0.4, v: 0.36 },
  ];

  return addPlacementDetails(kit, placements, tilesByCoord, cols, rows, profile, occupiedFootprints, { seedStride: 29 });
}

export function gatehouseKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  const placements = [
    { dx: -2, dy: -1, kind: "wall", role: "tower-west", scale: [0.92, 1.08], u: 0.42, v: 0.36 },
    { dx: 2, dy: -1, kind: "wall", role: "tower-east", scale: [0.92, 1.08], u: 0.58, v: 0.36 },
    { dx: -2, dy: 1, kind: "ruin", role: "fallen-parapet", scale: [0.62, 0.82], u: 0.45, v: 0.58 },
    { dx: 2, dy: 1, kind: "ruin", role: "fallen-parapet", scale: [0.62, 0.82], u: 0.55, v: 0.58 },
    { dx: 0, dy: -1, kind: "foundation", role: "gate-passage-floor", scale: [0.74, 0.94], u: 0.5, v: 0.42 },
    { dx: 0, dy: 1, kind: "foundation", role: "threshold-plate", scale: [0.82, 1.02], u: 0.5, v: 0.62 },
    { dx: -1, dy: 2, kind: "pebble", role: "copper-chip", scale: [0.22, 0.34], u: 0.42, v: 0.56 },
    { dx: 1, dy: 2, kind: "pebble", role: "copper-chip", scale: [0.22, 0.34], u: 0.58, v: 0.56 },
    { dx: -3, dy: 0, kind: "rock", role: "collapsed-gate-stone", scale: [0.34, 0.52], u: 0.55, v: 0.5 },
    { dx: 3, dy: 0, kind: "rock", role: "collapsed-gate-stone", scale: [0.34, 0.52], u: 0.45, v: 0.5 },
    { dx: -1, dy: -2, kind: "tuft", role: "gate-weeds", scale: [0.28, 0.44], u: 0.62, v: 0.52 },
    { dx: 1, dy: -2, kind: "flower", role: "field-bloom", scale: [0.24, 0.38], u: 0.44, v: 0.48 },
  ];

  return addPlacementDetails(kit, placements, tilesByCoord, cols, rows, profile, occupiedFootprints, {
    seedStride: 59,
    allowSettlement: true,
  });
}

export function courtyardKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  const placements = [
    { dx: -2, dy: -2, kind: "wall", role: "wall-north", scale: [0.92, 1.06], u: 0.5, v: 0.28 },
    { dx: 0, dy: -2, kind: "wall", role: "wall-north", scale: [0.88, 1.02], u: 0.5, v: 0.3 },
    { dx: 2, dy: -2, kind: "wall", role: "wall-north", scale: [0.9, 1.04], u: 0.5, v: 0.32 },
    { dx: -3, dy: 0, kind: "wall", role: "wall-west", scale: [0.78, 0.96], u: 0.3, v: 0.52 },
    { dx: 3, dy: 0, kind: "wall", role: "wall-east", scale: [0.8, 0.98], u: 0.7, v: 0.5 },
    { dx: -2, dy: 2, kind: "foundation", role: "broken-floor", scale: [0.72, 0.9], u: 0.48, v: 0.54 },
    { dx: 0, dy: 2, kind: "stairs", role: "stairs", scale: [0.86, 1.02], u: 0.5, v: 0.62 },
    { dx: 2, dy: 2, kind: "foundation", role: "broken-floor", scale: [0.7, 0.88], u: 0.52, v: 0.56 },
    { dx: -1, dy: 0, kind: "foundation", role: "sunken-floor", scale: [0.62, 0.8], u: 0.42, v: 0.46 },
    { dx: 1, dy: 0, kind: "foundation", role: "sunken-floor", scale: [0.62, 0.8], u: 0.58, v: 0.5 },
    { dx: -4, dy: 1, kind: "rock", role: "collapsed-masonry", scale: [0.4, 0.62], u: 0.55, v: 0.46 },
    { dx: 4, dy: 1, kind: "pebble", role: "collapsed-masonry", scale: [0.28, 0.4], u: 0.36, v: 0.58 },
    { dx: -3, dy: 3, kind: "tuft", role: "overgrowth", scale: [0.32, 0.5], u: 0.62, v: 0.62 },
    { dx: 3, dy: -3, kind: "flower", role: "overgrowth", scale: [0.28, 0.42], u: 0.42, v: 0.44 },
  ];

  return addPlacementDetails(kit, placements, tilesByCoord, cols, rows, profile, occupiedFootprints, {
    seedStride: 31,
    allowSettlement: true,
  });
}
