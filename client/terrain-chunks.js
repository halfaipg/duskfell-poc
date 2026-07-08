const TERRAIN_CHUNK_TILES = 8;

export function terrainChunks(tiles, cols, rows) {
  const chunks = [];
  for (let y = 0; y < rows; y += TERRAIN_CHUNK_TILES) {
    for (let x = 0; x < cols; x += TERRAIN_CHUNK_TILES) {
      const chunkTiles = [];
      const maxY = Math.min(rows, y + TERRAIN_CHUNK_TILES);
      const maxX = Math.min(cols, x + TERRAIN_CHUNK_TILES);
      for (let tileY = y; tileY < maxY; tileY += 1) {
        for (let tileX = x; tileX < maxX; tileX += 1) {
          chunkTiles.push(tiles[tileY * cols + tileX]);
        }
      }
      const height = chunkHeightMetadata(chunkTiles);
      chunks.push({
        x,
        y,
        cols: maxX - x,
        rows: maxY - y,
        height,
        tiles: chunkTiles,
      });
    }
  }
  return chunks;
}

export function elevationEdgesForTile(tile, tiles, cols, rows) {
  if (tile.material === "water") return [];
  const neighbors = [
    ["north", tile.x, tile.y - 1],
    ["east", tile.x + 1, tile.y],
    ["south", tile.x, tile.y + 1],
    ["west", tile.x - 1, tile.y],
  ];
  const currentHeight = averageHeight(tile);
  const edges = [];

  for (const [edge, nx, ny] of neighbors) {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const neighbor = tiles[ny * cols + nx];
    if (!neighbor || neighbor.material === "water") continue;
    const drop = currentHeight - averageHeight(neighbor);
    if (drop < 0.75) continue;
    edges.push({
      edge,
      drop: Math.min(3.5, drop),
      neighborMaterial: neighbor.material,
    });
  }
  return edges;
}

function averageHeight(tile) {
  return tile.height?.average ?? (tile.heights.nw + tile.heights.ne + tile.heights.se + tile.heights.sw) / 4;
}

function chunkHeightMetadata(tiles) {
  const min = Math.min(...tiles.map((tile) => tile.height.min));
  const max = Math.max(...tiles.map((tile) => tile.height.max));
  const average = tiles.reduce((sum, tile) => sum + tile.height.average, 0) / Math.max(1, tiles.length);
  return {
    min,
    max,
    average,
    range: max - min,
  };
}
