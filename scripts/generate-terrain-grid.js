import { readFile, writeFile } from "node:fs/promises";

import { buildTerrain } from "../client/terrain.js";
import { vertexHeight } from "../client/terrain-height.js";

// Bakes the client-generated map into world.json so the server's walkability
// authority (server/src/terrain.rs) reads the exact tiles the player sees.
// The client stays procedural; this grid is a snapshot of its output — rerun
// after any worldgen change: npm run terrain:grid

const worldPath = process.argv[2] ?? "server/data/world.json";
const world = JSON.parse(await readFile(worldPath, "utf8"));
if (!world?.map?.terrain) {
  throw new Error(`${worldPath} must include map.terrain`);
}

const terrain = buildTerrain(world.map);
const { cols, rows, safeRadiusTiles, profile } = terrain;
const legend = world.map.terrain.materials;

const materialGrid = [];
for (let y = 0; y < rows; y += 1) {
  let row = "";
  for (let x = 0; x < cols; x += 1) {
    const material = terrain.tiles[y * cols + x].material;
    const index = legend.indexOf(material);
    if (index < 0) throw new Error(`material ${material} missing from legend`);
    row += index.toString(36);
  }
  materialGrid.push(row);
}

const vertexHeights = [];
for (let y = 0; y <= rows; y += 1) {
  const row = [];
  for (let x = 0; x <= cols; x += 1) {
    row.push(vertexHeight(x, y, cols, rows, safeRadiusTiles, profile));
  }
  vertexHeights.push(row);
}

world.map.terrain.materialGrid = materialGrid;
world.map.terrain.vertexHeights = vertexHeights;
await writeFile(worldPath, `${JSON.stringify(world, null, 2)}\n`);

const counts = {};
for (const row of materialGrid) {
  for (const ch of row) {
    const name = legend[parseInt(ch, 36)];
    counts[name] = (counts[name] ?? 0) + 1;
  }
}
console.log(`wrote ${worldPath} ${cols}x${rows}`, counts);
