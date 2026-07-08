export function detailFootprint(kind) {
  const footprints = {
    tree: { widthTiles: 1.18, heightTiles: 1.04, reserveRadiusTiles: 2, blocksMovement: true },
    ruin: { widthTiles: 1.35, heightTiles: 1.1, reserveRadiusTiles: 1, blocksMovement: true },
    wall: { widthTiles: 1.16, heightTiles: 0.52, reserveRadiusTiles: 0, blocksMovement: true },
    stairs: { widthTiles: 1.1, heightTiles: 0.82, reserveRadiusTiles: 0, blocksMovement: false },
    foundation: { widthTiles: 0.92, heightTiles: 0.7, reserveRadiusTiles: 0, blocksMovement: false },
    boulder: { widthTiles: 0.86, heightTiles: 0.72, reserveRadiusTiles: 1, blocksMovement: true },
    reeds: { widthTiles: 0.58, heightTiles: 0.38, reserveRadiusTiles: 0, blocksMovement: false },
    rock: { widthTiles: 0.58, heightTiles: 0.46, reserveRadiusTiles: 0, blocksMovement: false },
    "fallen-log": { widthTiles: 0.94, heightTiles: 0.36, reserveRadiusTiles: 0, blocksMovement: false },
    stump: { widthTiles: 0.46, heightTiles: 0.36, reserveRadiusTiles: 0, blocksMovement: false },
  };
  return footprints[kind] ?? { widthTiles: 0.28, heightTiles: 0.22, reserveRadiusTiles: 0, blocksMovement: false };
}
