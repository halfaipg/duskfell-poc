import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const worldPath = path.resolve(process.argv[2] ?? "server/data/world.json");
const bundlePath = path.resolve(process.argv[3] ?? "assets/terrain/world-bundle.json");
const authorityPath = path.resolve(process.argv[4] ?? "assets/terrain/detail-authority.json");
const outputPath = path.resolve(
  process.argv[5] ?? "assets/terrain/candidates/world-map-structure-authoritative.png",
);
const metadataPath = outputPath.replace(/\.[^.]+$/, ".json");

const worldBytes = readFileSync(worldPath);
const bundleBytes = readFileSync(bundlePath);
const authorityBytes = readFileSync(authorityPath);
const world = JSON.parse(worldBytes);
const bundle = JSON.parse(bundleBytes);
const authority = JSON.parse(authorityBytes);

const terrain = world?.map?.terrain;
const rows = terrain?.materialGrid?.length;
const cols = terrain?.materialGrid?.[0]?.length;
if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
  throw new Error("world terrain must contain a non-empty materialGrid");
}
if (terrain.materialGrid.some((row) => row.length !== cols)) {
  throw new Error("world terrain materialGrid rows must have equal width");
}
if (terrain.vertexHeights?.length !== rows + 1 || terrain.vertexHeights.some((row) => row.length !== cols + 1)) {
  throw new Error("world terrain vertexHeights must be one vertex larger than materialGrid");
}
if (bundle.cols !== cols || bundle.rows !== rows) {
  throw new Error("world bundle dimensions do not match authoritative terrain");
}
for (const [name, field] of [["heathWeights", bundle.heathWeights], ["vegetation", bundle.vegetation]]) {
  const tileCentered = field?.length === rows && field.every((row) => row.length === cols);
  const vertexCentered = field?.length === rows + 1 && field.every((row) => row.length === cols + 1);
  if (!tileCentered && !vertexCentered) {
    throw new Error(`world bundle ${name} dimensions do not match authoritative terrain`);
  }
}

const SIZE = 1024;
const TILE_PX = Math.floor(Math.min((SIZE - 48) / cols, (SIZE - 48) / rows));
const mapWidth = cols * TILE_PX;
const mapHeight = rows * TILE_PX;
const offsetX = Math.floor((SIZE - mapWidth) / 2);
const offsetY = Math.floor((SIZE - mapHeight) / 2);
const pixels = Buffer.alloc(SIZE * SIZE * 3);

const MATERIAL_COLORS = {
  grass: [91, 111, 70],
  field: [115, 122, 76],
  dirt: [116, 91, 61],
  stone: [124, 121, 111],
  water: [41, 82, 98],
  settlement: [151, 129, 91],
  cobble: [132, 122, 105],
  rock: [66, 70, 72],
  ruin: [103, 91, 78],
  shore: [164, 147, 112],
};

fill([20, 24, 25]);
const materialAt = (x, y) => {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
  const index = Number.parseInt(terrain.materialGrid[y][x], 36);
  return terrain.materials[index] ?? null;
};
const tileHeight = (x, y) => {
  const x0 = clamp(x, 0, cols - 1);
  const y0 = clamp(y, 0, rows - 1);
  return (
    terrain.vertexHeights[y0][x0] +
    terrain.vertexHeights[y0][x0 + 1] +
    terrain.vertexHeights[y0 + 1][x0] +
    terrain.vertexHeights[y0 + 1][x0 + 1]
  ) / 4;
};

for (let y = 0; y < rows; y += 1) {
  for (let x = 0; x < cols; x += 1) {
    const material = materialAt(x, y);
    const base = MATERIAL_COLORS[material] ?? [96, 96, 90];
    const height = tileHeight(x, y);
    const east = tileHeight(x + 1, y);
    const south = tileHeight(x, y + 1);
    const shade = clamp(1 + (height - east) * 0.075 + (height - south) * 0.085, 0.68, 1.25);
    const heath = clamp(fieldAtTile(bundle.heathWeights, x, y), 0, 1);
    const vegetation = clamp(fieldAtTile(bundle.vegetation, x, y), 0, 1);
    let color = base.map((channel) => channel * shade);
    if (material !== "water" && material !== "settlement") {
      color = mix(color, [88, 70, 76], heath * 0.36);
      color = mix(color, [51, 75, 50], vegetation * 0.24);
    }
    if (height >= 6 && material !== "water") {
      color = mix(color, [142, 147, 150], clamp((height - 5) / 5, 0, 0.42));
    }
    paintTile(x, y, color);
  }
}

// Preserve collision-relevant material and height boundaries in the control image.
for (let y = 0; y < rows; y += 1) {
  for (let x = 0; x < cols; x += 1) {
    const material = materialAt(x, y);
    const eastMaterial = materialAt(x + 1, y);
    const southMaterial = materialAt(x, y + 1);
    if (eastMaterial && (material === "water") !== (eastMaterial === "water")) {
      line(mapX(x + 1), mapY(y), mapX(x + 1), mapY(y + 1), [27, 48, 57], 2);
    }
    if (southMaterial && (material === "water") !== (southMaterial === "water")) {
      line(mapX(x), mapY(y + 1), mapX(x + 1), mapY(y + 1), [27, 48, 57], 2);
    }
    if (eastMaterial && Math.abs(tileHeight(x, y) - tileHeight(x + 1, y)) >= 1.5) {
      line(mapX(x + 1), mapY(y), mapX(x + 1), mapY(y + 1), [35, 35, 34], 1);
    }
    if (southMaterial && Math.abs(tileHeight(x, y) - tileHeight(x, y + 1)) >= 1.5) {
      line(mapX(x), mapY(y + 1), mapX(x + 1), mapY(y + 1), [35, 35, 34], 1);
    }
  }
}

for (const blocker of authority.blockers ?? []) {
  const tile = blocker.tile;
  if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y)) continue;
  const colors = {
    tree: [34, 61, 38],
    boulder: [151, 153, 150],
    ruin: [184, 151, 103],
    wall: [174, 143, 99],
    foundation: [152, 128, 96],
  };
  dot(mapX(tile.x + 0.5), mapY(tile.y + 0.5), colors[blocker.kind] ?? [128, 111, 86], 1);
}

const unitsPerTile = terrain.unitsPerTile;
for (const object of world.objects ?? []) {
  const x = mapX(object.x / unitsPerTile);
  const y = mapY(object.y / unitsPerTile);
  ring(x, y, object.kind === "shrine" ? [166, 197, 173] : [232, 200, 125], 4);
}
for (const npc of world.npcs ?? []) {
  ring(mapX(npc.x / unitsPerTile), mapY(npc.y / unitsPerTile), [208, 130, 101], 3);
}
ring(mapX(world.spawn.x / unitsPerTile), mapY(world.spawn.y / unitsPerTile), [255, 236, 166], 6);

// Frame only; no labels are baked into the img2img control.
line(offsetX - 3, offsetY - 3, offsetX + mapWidth + 3, offsetY - 3, [93, 81, 59], 2);
line(offsetX - 3, offsetY + mapHeight + 3, offsetX + mapWidth + 3, offsetY + mapHeight + 3, [93, 81, 59], 2);
line(offsetX - 3, offsetY - 3, offsetX - 3, offsetY + mapHeight + 3, [93, 81, 59], 2);
line(offsetX + mapWidth + 3, offsetY - 3, offsetX + mapWidth + 3, offsetY + mapHeight + 3, [93, 81, 59], 2);

const ppmPath = `${outputPath}.ppm`;
writeFileSync(ppmPath, Buffer.concat([Buffer.from(`P6\n${SIZE} ${SIZE}\n255\n`), pixels]));
try {
  execFileSync("magick", [
    ppmPath,
    "-strip",
    "-define",
    "png:exclude-chunk=date,time",
    "-filter",
    "Lanczos",
    "-quality",
    "95",
    outputPath,
  ]);
} finally {
  rmSync(ppmPath, { force: true });
}

const outputBytes = readFileSync(outputPath);
writeFileSync(
  metadataPath,
  `${JSON.stringify({
    schemaVersion: "duskfell-authoritative-world-map-control-v1",
    status: "img2img-control",
    output: path.basename(outputPath),
    outputSha256: sha256(outputBytes),
    dimensions: { width: SIZE, height: SIZE },
    mapRect: { x: offsetX, y: offsetY, width: mapWidth, height: mapHeight },
    world: { path: path.relative(process.cwd(), worldPath), sha256: sha256(worldBytes) },
    bundle: { path: path.relative(process.cwd(), bundlePath), sha256: sha256(bundleBytes) },
    authority: { path: path.relative(process.cwd(), authorityPath), sha256: sha256(authorityBytes) },
    terrain: { cols, rows, unitsPerTile, seed: terrain.seed, heightScale: terrain.heightScale },
    overlays: ["material boundaries", "height discontinuities", "terrain blockers", "world objects", "npcs", "spawn"],
  }, null, 2)}\n`,
);

console.log(JSON.stringify({ output: outputPath, metadata: metadataPath, sha256: sha256(outputBytes), cols, rows }));

function fill(color) {
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
  }
}

function paintTile(tileX, tileY, color) {
  const x0 = mapX(tileX);
  const y0 = mapY(tileY);
  for (let y = y0; y < y0 + TILE_PX; y += 1) {
    for (let x = x0; x < x0 + TILE_PX; x += 1) setPixel(x, y, color);
  }
}

function mapX(tileX) { return Math.round(offsetX + tileX * TILE_PX); }
function mapY(tileY) { return Math.round(offsetY + tileY * TILE_PX); }

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const index = (Math.floor(y) * SIZE + Math.floor(x)) * 3;
  pixels[index] = clamp(Math.round(color[0]), 0, 255);
  pixels[index + 1] = clamp(Math.round(color[1]), 0, 255);
  pixels[index + 2] = clamp(Math.round(color[2]), 0, 255);
}

function line(x0, y0, x1, y1, color, width = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x0 + ((x1 - x0) * step) / steps);
    const y = Math.round(y0 + ((y1 - y0) * step) / steps);
    dot(x, y, color, Math.max(0, Math.floor((width - 1) / 2)));
  }
}

function dot(cx, cy, color, radius) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius + 0.5) setPixel(cx + x, cy + y, color);
    }
  }
}

function ring(cx, cy, color, radius) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distance = Math.hypot(x, y);
      if (distance >= radius - 1.25 && distance <= radius + 0.25) setPixel(cx + x, cy + y, color);
    }
  }
}

function mix(a, b, amount) {
  return a.map((channel, index) => channel * (1 - amount) + b[index] * amount);
}

function fieldAtTile(field, x, y) {
  if (field.length === rows) return field[y][x] ?? 0;
  return ((field[y][x] ?? 0) + (field[y][x + 1] ?? 0) + (field[y + 1][x] ?? 0) + (field[y + 1][x + 1] ?? 0)) / 4;
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
