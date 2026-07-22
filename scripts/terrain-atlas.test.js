import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyTerrainAtlas } from "./verify-terrain-atlas.js";

test("accepts a complete clean-room terrain atlas", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "terrain.png"), makePngHeader(640, 704));
  const manifestPath = path.join(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(validAtlas(), null, 2));

  const result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.tileCount, 110);
  assert.deepEqual(result.warnings, []);
});

test("rejects projection drift and mismatched atlas dimensions", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "terrain.png"), makePngHeader(320, 64));
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = validAtlas();
  manifest.projection.tileHeight = 32;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /projection/);
  assert.match(result.errors.join("\n"), /dimensions 320x64/);
});

test("rejects missing or mismatched terrain image hashes", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "terrain.png"), makePngHeader(640, 704));
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = validAtlas();
  manifest.tileSheet.sha256 = "0".repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  let result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /tileSheet\.sha256/);
  assert.match(result.errors.join("\n"), /does not match actual image hash/);

  delete manifest.tileSheet.sha256;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /tileSheet\.sha256 must be/);
});

test("rejects UO-derived prompt text and incomplete production provenance", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "terrain.png"), makePngHeader(640, 704));
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = validAtlas();
  manifest.provenance.prompt = "terrain like Ultima Online";
  manifest.approval.state = "review";
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /disallowed UO-derived/);
  assert.match(result.errors.join("\n"), /provenance\.method/);
  assert.match(result.errors.join("\n"), /provenance\.toolVersion/);
});

test("rejects missing material coverage and walkable water", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "terrain.png"), makePngHeader(640, 704));
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = validAtlas();
  manifest.tiles = manifest.tiles.filter((tile) => tile.material !== "field");
  manifest.tiles.find((tile) => tile.material === "water").surface.walkable = true;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /field/);
  assert.match(result.errors.join("\n"), /water surface must not be walkable/);
});

test("verifies every declared biome ground patch", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "terrain.png"), makePngHeader(640, 704));
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = validAtlas();
  const biomes = ["meadow", "heath", "chalk", "frost", "fen", "moor", "ash", "blight"];
  manifest.groundPatches = [];
  for (const biome of biomes) {
    const bytes = makeWebpHeader(2048, 2048);
    const image = `${biome}.webp`;
    await writeFile(path.join(dir, image), bytes);
    manifest.groundPatches.push({
      id: `biome-${biome}`,
      biome,
      image,
      sha256: sha256Hex(bytes),
      width: 2048,
      height: 2048,
    });
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  let result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, true, result.errors.join("\n"));

  manifest.groundPatches[3].sha256 = "0".repeat(64);
  manifest.groundPatches[4].width = 1024;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /groundPatches\[3\]\.sha256/);
  assert.match(result.errors.join("\n"), /groundPatches\[4\]\.image dimensions 2048x2048/);
});

test("verifies the optional runtime world map", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "terrain.png"), makePngHeader(640, 704));
  const mapBytes = makeWebpHeader(1536, 1024);
  await writeFile(path.join(dir, "world-map.webp"), mapBytes);
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = validAtlas();
  manifest.worldMap = {
    id: "world-map-test",
    image: "world-map.webp",
    sha256: sha256Hex(mapBytes),
    width: 1536,
    height: 1024,
    worldCols: 192,
    worldRows: 128,
    tilePixelWidth: 8,
    tilePixelHeight: 8,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  let result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, true, result.errors.join("\n"));

  manifest.worldMap.sha256 = "0".repeat(64);
  manifest.worldMap.height = 512;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  result = await verifyTerrainAtlas(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /worldMap\.sha256/);
  assert.match(result.errors.join("\n"), /worldMap.image dimensions 1536x1024/);
});

function validAtlas() {
  const materials = ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"];
  const edges = ["north", "east", "south", "west"];
  const corners = ["northEast", "southEast", "southWest", "northWest"];
  return {
    schemaVersion: "duskfell-terrain-atlas-v1",
    projection: {
      kind: "military-plan-oblique",
      tileWidth: 64,
      tileHeight: 64,
      tileAspectRatio: 1,
      axisAngleDegrees: 45,
      heightAxis: "screen-y",
      unitsPerTile: 64,
    },
    tileSheet: {
      id: "terrain-test",
      image: "terrain.png",
      sha256: sha256Hex(makePngHeader(640, 704)),
      cellWidth: 64,
      cellHeight: 64,
      columns: 10,
      rows: 11,
      frameCount: 110,
    },
    tiles: [
      ...materials.map((material, index) => ({
        id: `${material}-flat`,
        material,
        kind: "flat-base",
        frame: index,
        surface: {
          walkable: material !== "water",
          role: material === "water" ? "liquid" : "ground",
        },
      })),
      ...materials.map((material, index) => ({
        id: `${material}-slope`,
        material,
        kind: "slope-texture",
        frame: index + materials.length,
        surface: {
          walkable: material !== "water",
          role: material === "water" ? "liquid-slope" : "slope",
        },
      })),
      ...materials.map((material, index) => ({
        id: `${material}-transition`,
        material,
        kind: "transition",
        frame: index + materials.length * 2,
        surface: {
          walkable: material !== "water",
          role: material === "water" ? "shoreline" : "edge",
        },
      })),
      ...edges.flatMap((edge, edgeIndex) =>
        materials.map((material, index) => ({
          id: `${material}-transition-${edge}`,
          material,
          kind: "transition",
          frame: materials.length * 3 + edgeIndex * materials.length + index,
          mask: {
            type: "edge",
            edge,
          },
          surface: {
            walkable: material !== "water",
            role: material === "water" ? "shoreline" : "edge",
          },
        })),
      ),
      ...corners.flatMap((corner, cornerIndex) =>
        materials.map((material, index) => ({
          id: `${material}-transition-${corner}`,
          material,
          kind: "transition",
          frame: materials.length * 7 + cornerIndex * materials.length + index,
          mask: {
            type: "corner",
            corner,
          },
          surface: {
            walkable: material !== "water",
            role: material === "water" ? "shoreline" : "edge",
          },
        })),
      ),
    ],
    provenance: {
      cleanRoom: true,
      source: "temporary-test-fixture",
      createdAt: "2026-07-06",
      license: "test-only",
      reviewer: "test",
      prompt: "original plan-oblique 1:1 diamond terrain atlas",
    },
    approval: {
      state: "placeholder",
    },
  };
}

async function makeTempDir() {
  return mkdir(path.join(os.tmpdir(), `duskfell-terrain-${Date.now()}-${Math.random()}`), {
    recursive: true,
  });
}

function makePngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function makeWebpHeader(width, height) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.set([0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a], 20);
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
