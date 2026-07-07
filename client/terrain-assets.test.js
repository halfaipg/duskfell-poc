import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTerrainAtlas, transitionMaskKey, transitionPairKey } from "./terrain-assets.js";

test("normalizes a complete Duskfell terrain atlas", () => {
  const atlas = normalizeTerrainAtlas(validAtlas());

  assert.equal(atlas.tileSheet.imagePath, "terrain-placeholder.png");
  assert.equal(atlas.tileSheet.sha256, "da7eca042b2fc1c95b99a75c04bcfa583d18bd78109d2d565f34c2eea6ff90a3");
  assert.equal(atlas.byMaterial.get("grass").frame, 0);
  assert.equal(atlas.slopeByMaterial.get("grass").frame, 6);
  assert.equal(atlas.transitionByMaterial.get("water").frame, 16);
  assert.equal(
    atlas.transitionByMaterialAndMask.get(
      transitionMaskKey("water", { type: "edge", edge: "north" }),
    ).frame,
    22,
  );
  assert.equal(
    atlas.transitionByMaterialAndMask.get(
      transitionMaskKey("dirt", { type: "corner", corner: "southWest" }),
    ).frame,
    56,
  );
  assert.equal(atlas.byMaterial.get("water").surface.walkable, false);
});

test("rejects incomplete directional transition coverage", () => {
  const atlas = validAtlas();
  atlas.tiles = atlas.tiles.filter((tile) => tile.mask?.edge !== "west");

  assert.throws(
    () => normalizeTerrainAtlas(atlas),
    /missing west transition tile for material grass/,
  );
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

test("normalizes optional material-pair transition frames", () => {
  const manifest = validAtlas();
  manifest.tileSheet.rows = 12;
  manifest.tileSheet.frameCount = 72;
  manifest.tiles.push({
    id: "dirt-to-grass-pair-transition",
    material: "grass",
    kind: "pair-transition",
    frame: 66,
    pair: {
      from: "dirt",
      to: "grass",
    },
    surface: {
      walkable: true,
      role: "edge-pair",
    },
  });

  const atlas = normalizeTerrainAtlas(manifest);
  assert.equal(atlas.pairTransitionByPair.get(transitionPairKey("dirt", "grass")).frame, 66);
});

test("rejects malformed material-pair transition frames", () => {
  const manifest = validAtlas();
  manifest.tileSheet.rows = 12;
  manifest.tileSheet.frameCount = 72;
  manifest.tiles.push({
    id: "bad-pair-transition",
    material: "grass",
    kind: "pair-transition",
    frame: 66,
    pair: {
      from: "dirt",
      to: "stone",
    },
    surface: {
      walkable: true,
      role: "edge-pair",
    },
  });

  assert.throws(() => normalizeTerrainAtlas(manifest), /material must match pair\.to/);
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
      rows: 11,
      frameCount: 66,
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
      ...["north", "east", "south", "west"].flatMap((edge, edgeIndex) =>
        materials.map((material, index) => ({
          id: `${material}-transition-${edge}`,
          material,
          kind: "transition",
          frame: 18 + edgeIndex * materials.length + index,
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
      ...["northEast", "southEast", "southWest", "northWest"].flatMap((corner, cornerIndex) =>
        materials.map((material, index) => ({
          id: `${material}-transition-${corner}`,
          material,
          kind: "transition",
          frame: 42 + cornerIndex * materials.length + index,
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
  };
}
