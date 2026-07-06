import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTerrainAtlas } from "./terrain-assets.js";

test("normalizes a complete Duskfell terrain atlas", () => {
  const atlas = normalizeTerrainAtlas(validAtlas());

  assert.equal(atlas.tileSheet.imagePath, "terrain-placeholder.png");
  assert.equal(atlas.tileSheet.sha256, "da7eca042b2fc1c95b99a75c04bcfa583d18bd78109d2d565f34c2eea6ff90a3");
  assert.equal(atlas.byMaterial.get("grass").frame, 0);
  assert.equal(atlas.slopeByMaterial.get("grass").frame, 6);
  assert.equal(atlas.transitionByMaterial.get("water").frame, 16);
  assert.equal(atlas.byMaterial.get("water").surface.walkable, false);
});

test("rejects projection drift and missing material coverage", () => {
  const atlas = validAtlas();
  atlas.projection.tileHeight = 32;
  atlas.tiles = atlas.tiles.filter((tile) => tile.material !== "stone");

  assert.throws(
    () => normalizeTerrainAtlas(atlas),
    /terrain atlas projection does not match/,
  );

  atlas.projection.tileHeight = 64;
  assert.throws(
    () => normalizeTerrainAtlas(atlas),
    /missing flat-base tile for material stone/,
  );
});

test("rejects unsafe image paths and walkable water", () => {
  const atlas = validAtlas();
  atlas.tileSheet.image = "https://example.invalid/terrain.png";
  assert.throws(() => normalizeTerrainAtlas(atlas), /safe relative PNG/);

  atlas.tileSheet.image = "terrain-placeholder.png";
  atlas.tiles.find((tile) => tile.material === "water").surface.walkable = true;
  assert.throws(() => normalizeTerrainAtlas(atlas), /water surface must not be walkable/);
});

test("rejects missing or malformed terrain atlas hashes", () => {
  const atlas = validAtlas();
  atlas.tileSheet.sha256 = "DA7E";

  assert.throws(() => normalizeTerrainAtlas(atlas), /tileSheet\.sha256/);
});

function validAtlas() {
  const materials = ["grass", "field", "dirt", "stone", "water", "settlement"];
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
      id: "terrain-placeholder",
      image: "terrain-placeholder.png",
      sha256: "da7eca042b2fc1c95b99a75c04bcfa583d18bd78109d2d565f34c2eea6ff90a3",
      cellWidth: 64,
      cellHeight: 64,
      columns: 6,
      rows: 3,
      frameCount: 18,
    },
    tiles: [
      ...materials.map((material, index) => ({
        id: `${material}-flat-placeholder`,
        material,
        kind: "flat-base",
        frame: index,
        surface: {
          walkable: material !== "water",
          role: material === "water" ? "liquid" : "ground",
        },
      })),
      ...materials.map((material, index) => ({
        id: `${material}-slope-placeholder`,
        material,
        kind: "slope-texture",
        frame: index + 6,
        surface: {
          walkable: material !== "water",
          role: material === "water" ? "liquid-slope" : "slope",
        },
      })),
      ...materials.map((material, index) => ({
        id: `${material}-transition-placeholder`,
        material,
        kind: "transition",
        frame: index + 12,
        surface: {
          walkable: material !== "water",
          role: material === "water" ? "shoreline" : "edge",
        },
      })),
    ],
  };
}
