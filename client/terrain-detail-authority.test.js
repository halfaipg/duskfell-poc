import assert from "node:assert/strict";
import test from "node:test";

import { buildTerrain, terrainTileAt } from "./terrain.js";
import { detailTile, testMap } from "./terrain-test-fixtures.js";

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
    assert.equal(detail.authority.generation.terrainFamily, terrainTileAt(terrain, detailTile(detail).x, detailTile(detail).y).family.id);
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
    assert.equal(blocker.terrainFamily, terrainTileAt(terrain, blocker.tile.x, blocker.tile.y).family.id);
    assert.equal(blocker.collision.blocksMovement, true);
    assert.equal(blocker.collision.shape, "aabb");
    assert.deepEqual(blocker.tile, detail.authority.tile);
  }

  for (const node of authority.resourceNodes) {
    const detail = detailsById.get(node.id);
    assert.ok(detail, `expected resource node ${node.id} to reference a terrain detail`);
    assert.equal(node.resourceNodeId, `terrain-detail:${detail.id}`);
    assert.equal(node.terrainFamily, terrainTileAt(terrain, node.tile.x, node.tile.y).family.id);
    assert.deepEqual(node.resources, detail.resources);
    assert.deepEqual(node.lifecycle, detail.lifecycle ?? null);
  }

  for (const consumer of authority.decayConsumers) {
    const detail = detailsById.get(consumer.id);
    assert.ok(detail, `expected decay consumer ${consumer.id} to reference a terrain detail`);
    assert.equal(consumer.terrainFamily, terrainTileAt(terrain, consumer.tile.x, consumer.tile.y).family.id);
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
    assert.equal(typeof tree.vertical, "number");
    assert.ok(tree.vertical > 0);
    assert.ok(tree.occlusion.heightTiles >= tree.vertical * 0.98);
    assert.ok(tree.occlusion.radiusTiles > 0);
    assert.ok(tree.occlusion.fadeAlpha > 0 && tree.occlusion.fadeAlpha < 1);
    assert.equal(typeof tree.sortBias, "number");
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
