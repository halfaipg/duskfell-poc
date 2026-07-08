import assert from "node:assert/strict";
import test from "node:test";

import { PROJECTION, projectMap } from "./projection.js";
import {
  buildTerrain,
  materialForTile,
  projectTerrainTile,
  terrainDetailBlockersAtWorld,
  terrainFacets,
  terrainHeightAtWorld,
  terrainHeightMetadata,
  terrainInteriorHeightAtWorld,
  terrainTileAt,
  terrainWalkabilityAtWorld,
} from "./terrain.js";
import { testMap, testTerrain } from "./terrain-test-fixtures.js";

test("elevation edge cues describe higher ground next to lower neighbors", () => {
  const terrain = buildTerrain(testMap());
  const tile = terrain.tiles.find((candidate) => candidate.elevationEdges.length > 0);
  assert.ok(tile, "expected at least one tile with relief edges");

  for (const edge of tile.elevationEdges) {
    assert.ok(["north", "east", "south", "west"].includes(edge.edge));
    assert.ok(edge.drop >= 0.75 && edge.drop <= 3.5);
    assert.ok(typeof edge.neighborMaterial === "string" && edge.neighborMaterial.length > 0);
  }
});

test("terrain height metadata exposes min max average slope and normalized light", () => {
  const heights = { nw: 0, ne: 1, se: 3, sw: 1 };
  const metadata = terrainHeightMetadata(heights);

  assert.equal(metadata.min, 0);
  assert.equal(metadata.max, 3);
  assert.equal(metadata.average, 1.25);
  assert.equal(metadata.range, 3);
  assert.equal(metadata.north, 0.5);
  assert.equal(metadata.south, 2);
  assert.equal(metadata.east, 2);
  assert.equal(metadata.west, 0.5);
  assert.equal(metadata.slopeX, 1.5);
  assert.equal(metadata.slopeY, 1.5);
  assert.ok(Math.abs(Math.hypot(metadata.normal.x, metadata.normal.y, metadata.normal.z) - 1) < 0.000001);
  assert.ok(metadata.light >= 0.28 && metadata.light <= 0.9);
});

test("water tiles are flat and below surrounding terrain", () => {
  const cols = 24;
  const rows = 16;
  const safeRadiusTiles = 3.5;
  let waterTile = null;

  for (let y = 0; y < rows && !waterTile; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (materialForTile(x, y, cols, rows, safeRadiusTiles) === "water") {
        waterTile = buildTerrain({
          width: cols * PROJECTION.unitsPerTile,
          height: rows * PROJECTION.unitsPerTile,
          safeZoneRadius: safeRadiusTiles * PROJECTION.unitsPerTile,
        }).tiles[y * cols + x];
        break;
      }
    }
  }

  assert.ok(waterTile, "expected deterministic test map to include water");
  assert.deepEqual(waterTile.heights, { nw: -1, ne: -1, se: -1, sw: -1 });
  assert.equal(waterTile.height.range, 0);
  assert.equal(waterTile.height.average, -1);
  assert.equal(waterTile.sloped, false);
});

test("terrain height samples stay inside the selected tile corner range", () => {
  const terrain = buildTerrain(testMap());
  const tile = terrain.tiles.find((candidate) => candidate.sloped);
  assert.ok(tile, "expected a sloped tile");

  const worldX = (tile.x + 0.5) * PROJECTION.unitsPerTile;
  const worldY = (tile.y + 0.5) * PROJECTION.unitsPerTile;
  const height = terrainHeightAtWorld(terrain, worldX, worldY);
  const corners = Object.values(tile.heights);

  assert.ok(height >= Math.min(...corners));
  assert.ok(height <= Math.max(...corners));
});

test("terrain walkability describes water steepness and blocking statics", () => {
  const terrain = buildTerrain(testMap());
  const walkableTile = terrain.tiles.find((tile) => tile.material !== "water" && tile.height.range <= terrain.profile.maxWalkableStep);
  const waterTile = terrain.tiles.find((tile) => tile.material === "water");
  const blockingDetail = terrain.details.find((detail) => detail.footprint.blocksMovement);

  assert.ok(walkableTile, "expected a walkable tile");
  assert.ok(waterTile, "expected a water tile");
  assert.ok(blockingDetail, "expected a blocking terrain detail");

  const walkable = terrainWalkabilityAtWorld(
    terrain,
    (walkableTile.x + 0.5) * terrain.profile.unitsPerTile,
    (walkableTile.y + 0.5) * terrain.profile.unitsPerTile,
  );
  assert.equal(walkable.walkable, true);
  assert.equal(walkable.reason, "walkable");

  const water = terrainWalkabilityAtWorld(
    terrain,
    (waterTile.x + 0.5) * terrain.profile.unitsPerTile,
    (waterTile.y + 0.5) * terrain.profile.unitsPerTile,
  );
  assert.equal(water.walkable, false);
  assert.equal(water.reason, "water");

  const blocked = terrainWalkabilityAtWorld(terrain, blockingDetail.x, blockingDetail.y);
  assert.equal(blocked.walkable, false);
  assert.equal(blocked.reason, "blocked-detail");
  assert.ok(blocked.blockers.some((detail) => detail.id === blockingDetail.id));
  assert.ok(terrainDetailBlockersAtWorld(terrain, blockingDetail.x, blockingDetail.y).length > 0);
});

test("sub-tile terrain height changes produce visible projected vertical motion", () => {
  const terrain = buildTerrain(testMap());
  const tile = terrain.tiles.find((candidate) => candidate.sloped && candidate.height.range >= 1);
  assert.ok(tile, "expected a sloped tile for sub-tile elevation sampling");

  const firstWorldX = (tile.x + 0.2) * PROJECTION.unitsPerTile;
  const firstWorldY = (tile.y + 0.2) * PROJECTION.unitsPerTile;
  const secondWorldX = (tile.x + 0.8) * PROJECTION.unitsPerTile;
  const secondWorldY = (tile.y + 0.8) * PROJECTION.unitsPerTile;
  const firstHeight = terrainHeightAtWorld(terrain, firstWorldX, firstWorldY);
  const secondHeight = terrainHeightAtWorld(terrain, secondWorldX, secondWorldY);
  const firstScreen = projectMap(firstWorldX / PROJECTION.unitsPerTile, firstWorldY / PROJECTION.unitsPerTile, firstHeight, { x: 0, y: 0 });
  const secondScreen = projectMap(secondWorldX / PROJECTION.unitsPerTile, secondWorldY / PROJECTION.unitsPerTile, secondHeight, { x: 0, y: 0 });
  const flatFirstScreen = projectMap(firstWorldX / PROJECTION.unitsPerTile, firstWorldY / PROJECTION.unitsPerTile, 0, { x: 0, y: 0 });
  const flatSecondScreen = projectMap(secondWorldX / PROJECTION.unitsPerTile, secondWorldY / PROJECTION.unitsPerTile, 0, { x: 0, y: 0 });

  assert.notEqual(firstHeight, secondHeight);
  assert.ok(Math.abs(flatFirstScreen.y - firstScreen.y - firstHeight * PROJECTION.zPx) < 0.000001);
  assert.ok(Math.abs(flatSecondScreen.y - secondScreen.y - secondHeight * PROJECTION.zPx) < 0.000001);
});

test("interior stair portals add floor height to terrain sampling", () => {
  const terrain = buildTerrain(testMap());
  const space = terrain.interiorSpaces.find((candidate) => candidate.kitKind === "sunken-courtyard");
  assert.ok(space, "expected generated sunken courtyard interior space");
  const portal = space.portals.find((candidate) => candidate.kind === "stairs");
  assert.ok(portal, "expected generated stair portal");

  const floorX = (space.bounds.minX + space.bounds.maxX) / 2;
  const floorY = space.bounds.minY + (space.bounds.maxY - space.bounds.minY) * 0.25;
  const floorBaseTile = terrainTileAt(
    terrain,
    Math.floor(floorX / terrain.profile.unitsPerTile),
    Math.floor(floorY / terrain.profile.unitsPerTile),
  );
  assert.ok(floorBaseTile, "expected interior sample tile");
  const floorBaseHeight = terrainHeightMetadata(floorBaseTile.heights).average;
  const floorInterior = terrainInteriorHeightAtWorld(terrain, floorX, floorY, floorBaseHeight);
  assert.equal(floorInterior.source, "floor");
  assert.equal(floorInterior.z, -0.1);

  const lowY = portal.bounds.minY;
  const highY = portal.bounds.maxY;
  const portalX = (portal.bounds.minX + portal.bounds.maxX) / 2;
  const lowBase = terrainHeightAtWorld(
    { ...terrain, interiorSpaces: [] },
    portalX,
    lowY,
  );
  const highBase = terrainHeightAtWorld(
    { ...terrain, interiorSpaces: [] },
    portalX,
    highY,
  );
  const lowHeight = terrainHeightAtWorld(terrain, portalX, lowY);
  const highHeight = terrainHeightAtWorld(terrain, portalX, highY);

  assert.ok(Math.abs(lowHeight - (lowBase + portal.fromZ)) < 0.000001);
  assert.ok(Math.abs(highHeight - (highBase + portal.toZ)) < 0.000001);
  assert.ok(highHeight - highBase - (lowHeight - lowBase) > 0.75, "expected stair portal to visibly lift actors");
});

test("terrain seed changes deterministic material placement", () => {
  const first = buildTerrain(testMap());
  const second = buildTerrain({
    ...testMap(),
    terrain: {
      ...testTerrain(),
      seed: 9127,
    },
  });

  assert.notDeepEqual(
    first.tiles.map((tile) => tile.material),
    second.tiles.map((tile) => tile.material),
  );
});

test("projected terrain corners preserve screen x while height changes screen y", () => {
  const tile = {
    x: 2,
    y: 3,
    heights: { nw: 0, ne: 1, se: 2, sw: 1 },
  };
  const origin = { x: 40, y: 70 };
  const projected = projectTerrainTile(tile, origin);
  const flatNe = projectMap(3, 3, 0, origin);

  assert.equal(projected.ne.x, flatNe.x);
  assert.equal(flatNe.y - projected.ne.y, PROJECTION.zPx);
});

test("sloped terrain exposes UO-style split facets for renderer shading", () => {
  const flat = {
    heights: { nw: 1, ne: 1, se: 1, sw: 1 },
    sloped: false,
  };
  assert.deepEqual(terrainFacets(flat), []);

  const sloped = {
    heights: { nw: 0, ne: 1, se: 3, sw: 1 },
    sloped: true,
  };
  const facets = terrainFacets(sloped);

  assert.equal(facets.length, 2);
  assert.deepEqual(facets[0].corners, ["nw", "ne", "se"]);
  assert.deepEqual(facets[1].corners, ["nw", "se", "sw"]);
  for (const facet of facets) {
    assert.ok(facet.shade >= -0.36 && facet.shade <= 0.36);
    assert.ok(facet.alpha >= 0.18 && facet.alpha <= 0.48);
  }
  assert.notEqual(facets[0].shade, facets[1].shade);
});
