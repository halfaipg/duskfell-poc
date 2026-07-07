import assert from "node:assert/strict";
import test from "node:test";

import {
  TERRAIN_MATERIALS,
  biomeForTile,
  buildTerrain,
  materialForTile,
  projectTerrainTile,
  terrainDetailBlockersAtWorld,
  terrainFacets,
  terrainHeightMetadata,
  terrainHeightAtWorld,
  terrainWalkabilityAtWorld,
} from "./terrain.js";
import { PROJECTION, projectMap } from "./projection.js";

test("builds deterministic military-projection terrain with slopes and transitions", () => {
  const map = testMap();
  const terrain = buildTerrain(map);

  assert.equal(terrain.cols, 24);
  assert.equal(terrain.rows, 16);
  assert.equal(terrain.tiles.length, terrain.cols * terrain.rows);
  assert.equal(terrain.chunks.length, 6);
  assert.equal(
    terrain.chunks.reduce((count, chunk) => count + chunk.tiles.length, 0),
    terrain.tiles.length,
  );
  assert.ok(terrain.tiles.some((tile) => tile.sloped), "expected at least one sloped tile");
  assert.ok(
    terrain.tiles.every((tile) => tile.biome && typeof tile.biome === "object"),
    "expected every tile to carry explicit biome channels",
  );
  assert.ok(
    terrain.tiles.every((tile) => tile.height && typeof tile.height === "object"),
    "expected every tile to carry height metadata",
  );
  assert.ok(
    terrain.tiles.every((tile) => tile.composition && typeof tile.composition === "object"),
    "expected every tile to carry terrain composition metadata",
  );
  assert.ok(Array.isArray(terrain.compositionKits), "expected terrain to expose named composition kits");
  assert.equal(terrain.detailAuthority.schemaVersion, "duskfell-terrain-detail-authority-v1");
  assert.equal(terrain.detailAuthority.projection, PROJECTION.kind);
  assert.equal(terrain.detailAuthority.profile, map.terrain.profile);
  assert.equal(terrain.detailAuthority.seed, map.terrain.seed);
  assert.ok(
    terrain.chunks.every((chunk) => chunk.height && chunk.height.min <= chunk.height.average && chunk.height.average <= chunk.height.max),
    "expected chunks to expose aggregate height bounds",
  );
  assert.ok(
    terrain.tiles.some((tile) => tile.transitions.length > 0),
    "expected material transition edges",
  );
  const transitions = terrain.tiles.flatMap((tile) => tile.transitions);
  assert.ok(transitions.some((transition) => transition.type === "edge"), "expected edge transition masks");
  assert.ok(transitions.some((transition) => transition.type === "corner"), "expected corner transition masks");
  for (const transition of transitions) {
    assert.ok(["edge", "corner"].includes(transition.type));
    assert.ok(Object.hasOwn(TERRAIN_MATERIALS, transition.from), "expected transition from material");
    assert.ok(Object.hasOwn(TERRAIN_MATERIALS, transition.to), "expected transition to material");
    assert.equal(transition.pair, `${transition.from}->${transition.to}`);
    assert.ok(["shore", "plaza", "rocky", "path", "soft"].includes(transition.family));
    assert.ok(Number.isInteger(transition.seed) && transition.seed >= 0);
    assert.equal(transition.mask.type, transition.type);
    assert.ok(transition.mask.depth >= 0.08 && transition.mask.depth <= 0.46);
    if (transition.type === "edge") {
      assert.ok(["north", "east", "south", "west"].includes(transition.mask.edge));
    } else {
      assert.ok(["northEast", "southEast", "southWest", "northWest"].includes(transition.mask.corner));
    }
  }
  assert.ok(terrain.tiles.some((tile) => tile.decals.length > 0), "expected terrain variation decals");
  assert.ok(
    terrain.tiles.some((tile) => tile.elevationEdges.length > 0),
    "expected subtle elevation edge cues",
  );
  assert.ok(terrain.details.length > 0, "expected procedural terrain detail instances");
  assert.ok(
    terrain.details.some((detail) => detail.kind === "rock" || detail.kind === "pebble"),
    "expected rocky procedural depth details",
  );
  assert.ok(
    terrain.details.some((detail) => detail.kind === "scrub" || detail.kind === "fallen-log" || detail.kind === "stump"),
    "expected vegetation-band procedural depth details",
  );
  assert.ok(
    terrain.details.some((detail) => detail.kind === "tree"),
    "expected grove composition to place larger tree statics",
  );
  assert.ok(
    new Set(terrain.details.filter((detail) => detail.kind === "tree").map((detail) => detail.stage)).size >= 2,
    "expected trees to vary by lifecycle stage",
  );
  assert.ok(
    new Set(terrain.details.filter((detail) => detail.kind === "tree").map((detail) => `${detail.stage}:${detail.variant}`)).size >= 2,
    "expected trees to vary by stage-specific sprite variant",
  );
  assert.ok(
    terrain.details.some((detail) => detail.kind === "reeds"),
    "expected shore composition to place reed statics",
  );
  assert.ok(
    terrain.details.some((detail) => detail.kind === "ruin"),
    "expected ridge or scrub composition to place ruin statics",
  );
});

test("terrain biome channels are bounded and drive material selection", () => {
  const map = testMap();
  const terrain = buildTerrain(map);
  const biomeKeys = [
    "elevation",
    "moisture",
    "rockiness",
    "dryness",
    "settlementPressure",
    "plazaPressure",
    "pathPressure",
    "northSouthPathPressure",
    "eastWestPathPressure",
    "shorePathPressure",
    "waterPressure",
    "shorePressure",
    "vegetation",
    "detailDensity",
  ];

  for (const tile of terrain.tiles) {
    for (const key of biomeKeys) {
      assert.equal(typeof tile.biome[key], "number", `${key} should be numeric`);
      assert.ok(tile.biome[key] >= 0 && tile.biome[key] <= 1, `${key} should stay in [0, 1]`);
    }
  }

  assert.ok(terrain.tiles.some((tile) => tile.material === "water" && tile.biome.waterPressure > 0));
  assert.ok(terrain.tiles.some((tile) => tile.material === "settlement" && tile.biome.plazaPressure > 0));
  assert.ok(terrain.tiles.some((tile) => tile.biome.rockiness > 0.7));

  const directBiome = biomeForTile(0, 0, terrain.cols, terrain.rows, terrain.safeRadiusTiles, testTerrain());
  const directMaterial = materialForTile(0, 0, terrain.cols, terrain.rows, terrain.safeRadiusTiles, testTerrain());
  assert.equal(typeof directBiome.detailDensity, "number");
  assert.equal(typeof directMaterial, "string");
});

test("terrain composition zones describe roads ridges groves shores and detail bands", () => {
  const terrain = buildTerrain(testMap());
  const zones = new Set(terrain.tiles.map((tile) => tile.composition.zone));

  for (const tile of terrain.tiles) {
    assert.ok(
      ["water", "plaza", "road", "shore", "ridge", "grove", "scrub", "meadow"].includes(tile.composition.zone),
      `unexpected terrain composition zone ${tile.composition.zone}`,
    );
    assert.ok(["low", "mid", "high"].includes(tile.composition.elevationBand));
    assert.ok(["water", "wet", "dry", "temperate"].includes(tile.composition.moistureBand));
    assert.ok(["none", "north-south", "east-west", "cross", "shore"].includes(tile.composition.roadAxis));
    assert.ok(tile.composition.kitRole === "none" || typeof tile.composition.kitId === "string");
    assert.ok(tile.composition.kitKind === null || typeof tile.composition.kitKind === "string");
    assert.ok(tile.composition.detailBudget >= 0 && tile.composition.detailBudget <= 1);
    assert.ok(tile.composition.ridgeScore >= 0 && tile.composition.ridgeScore <= 1);
    assert.ok(tile.composition.groveScore >= 0 && tile.composition.groveScore <= 1);
  }

  assert.ok(zones.has("plaza"), "expected a central plaza zone");
  assert.ok(zones.has("road"), "expected coherent road zones");
  assert.ok(zones.has("ridge"), "expected rocky ridge zones");
  assert.ok(zones.has("grove"), "expected vegetation grove zones");
  assert.ok(zones.has("shore") || zones.has("water"), "expected shore or water zones");
  assert.ok(
    terrain.tiles.some((tile) => tile.composition.zone === "road" && tile.composition.roadAxis !== "none"),
    "expected road tiles to carry an axis",
  );
});

test("terrain composition kits anchor coherent ruin and ecology scenes", () => {
  const terrain = buildTerrain(testMap());
  const kitIds = new Set(terrain.compositionKits.map((kit) => kit.id));
  const kitKinds = new Set(terrain.compositionKits.map((kit) => kit.kind));
  const kitTiles = terrain.tiles.filter((tile) => tile.composition.kitId);
  const viaductTiles = terrain.tiles.filter((tile) => tile.composition.kitId === "ancient-viaduct-kit");
  const viaductDetails = terrain.details.filter((detail) => detail.kitId === "ancient-viaduct-kit");

  assert.ok(kitIds.has("settlement-crossroads"), "expected a named settlement composition kit");
  assert.ok(kitIds.has("ancient-viaduct-kit"), "expected a named ancient viaduct composition kit");
  assert.ok(kitIds.has("sunken-courtyard-kit"), "expected a named vertical courtyard composition kit");
  assert.ok(kitKinds.has("old-grove"), "expected old grove composition kit");
  assert.ok(kitKinds.has("river-reedbed"), "expected shore ecology composition kit");
  assert.ok(kitTiles.length > 0, "expected tiles to reference composition kit membership");
  assert.ok(viaductTiles.some((tile) => tile.composition.kitRole === "causeway"), "expected viaduct causeway tiles");
  assert.ok(viaductTiles.some((tile) => tile.composition.kitRole === "rubble"), "expected viaduct rubble-field tiles");
  assert.ok(
    viaductTiles.some((tile) => tile.material === "stone" && tile.composition.detailFamily === "ruin-road"),
    "expected viaduct kit to force coherent stone causeway material",
  );
  assert.ok(
    viaductTiles.some((tile) => tile.decals.some((decal) => decal.kind === "crack" || decal.kind === "moss")),
    "expected viaduct kit tiles to carry decay decals",
  );
  assert.ok(viaductDetails.length >= 3, "expected viaduct kit to place multiple coordinated statics");
  assert.ok(viaductDetails.some((detail) => detail.kind === "ruin"), "expected viaduct kit ruin statics");
  assert.ok(viaductDetails.some((detail) => detail.kind === "rock" || detail.kind === "pebble"), "expected viaduct kit rubble");
  assert.ok(new Set(viaductDetails.map((detail) => detail.kitRole)).size >= 2, "expected kit details to carry scene roles");

  const courtyardTiles = terrain.tiles.filter((tile) => tile.composition.kitId === "sunken-courtyard-kit");
  const courtyardRoles = new Set(courtyardTiles.map((tile) => tile.composition.kitRole));
  const courtyardDetails = terrain.details.filter((detail) => detail.kitId === "sunken-courtyard-kit");
  assert.ok(courtyardRoles.has("stairs"), "expected courtyard stair tiles");
  assert.ok(
    ["wall-north", "wall-south", "wall-east", "wall-west"].some((role) => courtyardRoles.has(role)),
    "expected courtyard wall tiles",
  );
  assert.ok(courtyardRoles.has("courtyard-floor"), "expected courtyard floor tiles");
  assert.ok(
    courtyardTiles.some((tile) => tile.material === "stone" && tile.composition.objectBand === "architecture"),
    "expected courtyard kit to force architecture stone material",
  );
  assert.ok(
    courtyardTiles.some((tile) => tile.decals.some((decal) => decal.kind === "masonry-joint")),
    "expected courtyard kit to carry masonry floor decals",
  );
  assert.ok(courtyardDetails.some((detail) => detail.kind === "wall"), "expected vertical wall statics");
  assert.ok(courtyardDetails.some((detail) => detail.kind === "stairs"), "expected stair statics");
  assert.ok(courtyardDetails.some((detail) => detail.kind === "foundation"), "expected broken foundation statics");
});

test("terrain details carry footprint metadata and reserve larger static spacing", () => {
  const terrain = buildTerrain(testMap());
  const reserved = terrain.details.filter((detail) => detail.footprint.reserveRadiusTiles > 0);

  assert.ok(reserved.length > 0, "expected larger terrain statics with reserved footprints");

  for (const detail of terrain.details) {
    assert.equal(typeof detail.zone, "string");
    assert.equal(typeof detail.objectBand, "string");
    assert.ok(detail.footprint.widthTiles > 0);
    assert.ok(detail.footprint.heightTiles > 0);
    assert.ok(detail.footprint.reserveRadiusTiles >= 0);
    assert.equal(typeof detail.footprint.blocksMovement, "boolean");
    assert.ok(detail.kitRole === "none" || typeof detail.kitId === "string");
    assert.equal(detail.authority.schemaVersion, "duskfell-terrain-detail-authority-v1");
    assert.ok(["composition-kit", "procedural-terrain"].includes(detail.authority.source));
    assert.equal(detail.authority.source, detail.kitId ? "composition-kit" : "procedural-terrain");
    assert.equal(detail.authority.tile.x, detailTile(detail).x);
    assert.equal(detail.authority.tile.y, detailTile(detail).y);
    assert.equal(detail.authority.anchor.u, detail.anchor.u);
    assert.equal(detail.authority.anchor.v, detail.anchor.v);
    assert.equal(detail.authority.collision.shape, "aabb");
    assert.equal(detail.authority.collision.blocksMovement, detail.footprint.blocksMovement);
    assert.equal(detail.authority.collision.widthTiles, detail.footprint.widthTiles);
    assert.equal(detail.authority.generation.kitId, detail.kitId);
    assert.equal(detail.authority.generation.kitRole, detail.kitRole);
    assert.ok(detail.authority.stableKey.includes(`${detail.kind}:${detailTile(detail).x}:${detailTile(detail).y}`));
  }

  for (let i = 0; i < reserved.length; i += 1) {
    for (let j = i + 1; j < reserved.length; j += 1) {
      const first = reserved[i];
      const second = reserved[j];
      const firstTile = detailTile(first);
      const secondTile = detailTile(second);
      const distance = Math.max(Math.abs(firstTile.x - secondTile.x), Math.abs(firstTile.y - secondTile.y));
      assert.ok(
        distance > Math.max(first.footprint.reserveRadiusTiles, second.footprint.reserveRadiusTiles),
        `reserved terrain statics ${first.id} and ${second.id} should not overlap`,
      );
    }
  }
});

test("terrain exposes detail authority manifest for future server promotion", () => {
  const terrain = buildTerrain(testMap());
  const authority = terrain.detailAuthority;
  const detailsById = new Map(terrain.details.map((detail) => [detail.id, detail]));
  const blockingDetails = terrain.details.filter((detail) => detail.footprint.blocksMovement);
  const resourceDetails = terrain.details.filter((detail) => detail.resources?.length > 0);
  const decayConsumers = terrain.details.filter((detail) => detail.consumes?.length > 0);

  assert.equal(authority.blockers.length, blockingDetails.length);
  assert.equal(authority.resourceNodes.length, resourceDetails.length);
  assert.equal(authority.decayConsumers.length, decayConsumers.length);
  assert.ok(authority.blockers.some((blocker) => blocker.source === "composition-kit"), "expected kit blockers");
  assert.ok(authority.resourceNodes.some((node) => node.source === "procedural-terrain"), "expected procedural resource nodes");
  assert.ok(authority.decayConsumers.some((consumer) => consumer.kind === "mushroom"), "expected mycelium consumers");

  for (const blocker of authority.blockers) {
    const detail = detailsById.get(blocker.id);
    assert.ok(detail, `expected blocker ${blocker.id} to reference a terrain detail`);
    assert.equal(blocker.stableKey, detail.authority.stableKey);
    assert.equal(blocker.collision.blocksMovement, true);
    assert.equal(blocker.collision.shape, "aabb");
    assert.deepEqual(blocker.tile, detail.authority.tile);
  }

  for (const node of authority.resourceNodes) {
    const detail = detailsById.get(node.id);
    assert.ok(detail, `expected resource node ${node.id} to reference a terrain detail`);
    assert.equal(node.resourceNodeId, `terrain-detail:${detail.id}`);
    assert.deepEqual(node.resources, detail.resources);
    assert.deepEqual(node.lifecycle, detail.lifecycle ?? null);
  }

  for (const consumer of authority.decayConsumers) {
    const detail = detailsById.get(consumer.id);
    assert.ok(detail, `expected decay consumer ${consumer.id} to reference a terrain detail`);
    assert.deepEqual(consumer.consumes, detail.consumes);
    assert.ok(consumer.consumes.some((resource) => resource.kind === "deadwood"));
  }
});

test("organic terrain details expose lifecycle resources and mycelium decay hooks", () => {
  const terrain = buildTerrain(testMap());
  const trees = terrain.details.filter((detail) => detail.kind === "tree");
  const mushrooms = terrain.details.filter((detail) => detail.kind === "mushroom");
  const deadwood = terrain.details.filter((detail) => detail.kind === "fallen-log" || detail.kind === "stump");
  const ruins = terrain.details.filter((detail) => detail.kind === "ruin");
  const masonry = terrain.details.filter((detail) => ["wall", "stairs", "foundation"].includes(detail.kind));

  assert.ok(trees.length > 0, "expected tree details");
  assert.ok(mushrooms.length > 0, "expected mushroom details");
  assert.ok(deadwood.length > 0, "expected deadwood details");
  assert.ok(ruins.length > 0, "expected ancient ruin details");
  assert.ok(masonry.length > 0, "expected ancient masonry details");

  for (const tree of trees) {
    assert.ok(["sapling", "mature", "ancient"].includes(tree.stage));
    assert.ok(["greenwood", "shadebark", "ironleaf", "paleoak"].includes(tree.species));
    assert.ok(tree.variant >= 0 && tree.variant <= 3);
    assert.ok(Number.isInteger(tree.ageYears) && tree.ageYears > 0);
    assert.ok(tree.health >= 0 && tree.health <= 1);
    assert.equal(tree.lifecycle.stage, tree.stage);
    assert.equal(tree.lifecycle.species, tree.species);
    assert.equal(tree.lifecycle.ageYears, tree.ageYears);
    assert.equal(tree.lifecycle.health, tree.health);
    assert.ok(tree.lifecycle.growth >= 0 && tree.lifecycle.growth <= 1);
    assert.ok(tree.lifecycle.decay >= 0 && tree.lifecycle.decay <= 1);
    assert.ok(tree.resources.some((resource) => resource.kind === "wood" && resource.amount >= 1));
    assert.ok(tree.resources.every((resource) => resource.amount <= resource.maxAmount));
  }

  assert.ok(trees.some((tree) => tree.stage === "sapling"));
  assert.ok(trees.some((tree) => tree.stage === "mature" || tree.stage === "ancient"));
  assert.ok(new Set(trees.map((tree) => tree.variant)).size >= 3, "expected at least three tree silhouettes");
  assert.ok(new Set(trees.map((tree) => tree.species)).size >= 3, "expected at least three tree species");

  for (const detail of deadwood) {
    assert.ok(["deadwood", "decaying"].includes(detail.lifecycle.stage));
    assert.ok(detail.lifecycle.decay >= 0 && detail.lifecycle.decay <= 1);
    assert.ok(detail.resources.some((resource) => resource.kind === "deadwood" && resource.amount >= 1));
  }

  for (const mushroom of mushrooms) {
    assert.equal(mushroom.lifecycle.stage, "fruiting");
    assert.ok(mushroom.lifecycle.decay > 0);
    assert.ok(mushroom.consumes.some((resource) => resource.kind === "deadwood"));
    assert.ok(mushroom.resources.some((resource) => resource.kind === "mycelium" && resource.amount >= 1));
  }

  for (const ruin of ruins) {
    assert.equal(ruin.lifecycle.family, "mineral");
    assert.equal(ruin.lifecycle.stage, "ancient-ruin");
    assert.ok(ruin.lifecycle.ageYears >= 42000);
    assert.ok(ruin.lifecycle.decay >= 0.48);
    assert.ok(ruin.resources.some((resource) => resource.kind === "stone" && resource.amount >= 1));
    assert.ok(ruin.occlusion.heightTiles > 0);
    assert.ok(ruin.occlusion.radiusTiles > 0);
    assert.ok(ruin.occlusion.fadeAlpha > 0 && ruin.occlusion.fadeAlpha < 1);
  }

  for (const detail of masonry) {
    assert.equal(detail.lifecycle.family, "mineral");
    assert.ok(["broken-wall", "eroded-stairs", "sunken-foundation"].includes(detail.lifecycle.stage));
    assert.ok(detail.lifecycle.ageYears >= 70000);
    assert.ok(detail.lifecycle.decay >= 0.42);
    assert.ok(detail.resources.some((resource) => resource.kind === "stone" && resource.amount >= 1));
    assert.equal(typeof detail.vertical, "number");
    assert.ok(detail.occlusion.heightTiles >= detail.vertical * 0.6);
    assert.ok(detail.occlusion.radiusTiles > 0);
    assert.ok(detail.occlusion.fadeAlpha > 0 && detail.occlusion.fadeAlpha < 1);
  }
});

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

function testMap() {
  return {
    width: 1536,
    height: 1024,
    safeZoneRadius: 220,
    terrain: testTerrain(),
  };
}

function testTerrain() {
  return {
    profile: "duskfell-terrain-v1",
    seed: 7341,
    unitsPerTile: 64,
    tileWidth: 64,
    tileHeight: 64,
    heightScale: 6,
    minElevation: -1,
    maxElevation: 4,
    waterLevel: -1,
    maxWalkableStep: 1,
    materials: ["grass", "field", "dirt", "stone", "water", "settlement"],
  };
}

function detailTile(detail) {
  return {
    x: Math.floor(detail.x / PROJECTION.unitsPerTile),
    y: Math.floor(detail.y / PROJECTION.unitsPerTile),
  };
}
