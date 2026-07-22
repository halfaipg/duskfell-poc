import assert from "node:assert/strict";
import test from "node:test";

import {
  isTerrainDetailAuthorityObject,
  nearestInteractableObject,
  shouldDrawPlayerNameLabel,
  shouldDrawTerrainDetailAuthorityBody,
  shouldDrawTerrainDetailAuthorityCue,
  shouldDrawWorldObjectLabel,
  terrainDetailAuthorityObjectId,
  terrainDetailAuthorityObjectIds,
} from "./object-render-policy.js";

test("identifies terrain-detail authority objects from server object ids", () => {
  assert.equal(isTerrainDetailAuthorityObject({ id: "terrain-detail:old-grove-ring-tree-10-5-9526" }), true);
  assert.equal(isTerrainDetailAuthorityObject({ id: "generated-grove-1" }), false);
  assert.equal(isTerrainDetailAuthorityObject({ id: null }), false);
});

test("prefers explicit terrain detail resource node ids", () => {
  assert.equal(
    terrainDetailAuthorityObjectId({
      id: "tree-4-5-1234",
      authority: { resourceNodeId: "terrain-detail:tree-4-5-1234" },
    }),
    "terrain-detail:tree-4-5-1234",
  );
});

test("builds fallback terrain detail ids for older detail metadata", () => {
  assert.equal(terrainDetailAuthorityObjectId({ id: "stump-2-3-9000" }), "terrain-detail:stump-2-3-9000");
  assert.equal(terrainDetailAuthorityObjectId({ id: "scenic-tree", scenicOnly: true }), null);
  assert.equal(terrainDetailAuthorityObjectId({}), null);
});

test("suppresses duplicate body rendering when a matching terrain detail exists", () => {
  const ids = terrainDetailAuthorityObjectIds([
    {
      id: "mushroom-8-4-9195",
      authority: { resourceNodeId: "terrain-detail:mushroom-8-4-9195" },
    },
  ]);

  assert.equal(shouldDrawTerrainDetailAuthorityBody({ id: "terrain-detail:mushroom-8-4-9195" }, ids), false);
  assert.equal(shouldDrawTerrainDetailAuthorityBody({ id: "terrain-detail:mushroom-9-4-8042" }, ids), true);
  assert.equal(shouldDrawTerrainDetailAuthorityBody({ id: "field-coil-1" }, ids), true);
});

test("shows compact authority cues only in debug or near the player", () => {
  const object = { id: "terrain-detail:stump-10-6-6833", x: 100, y: 100 };
  assert.equal(shouldDrawTerrainDetailAuthorityCue(object, null), false);
  assert.equal(shouldDrawTerrainDetailAuthorityCue(object, null, { debug: true }), true);
  assert.equal(shouldDrawTerrainDetailAuthorityCue(object, { x: 160, y: 100 }, { radius: 75 }), true);
  assert.equal(shouldDrawTerrainDetailAuthorityCue(object, { x: 250, y: 100 }, { radius: 75 }), false);
});

test("world object labels stay local and skip ambient ecology clutter", () => {
  const player = { x: 100, y: 100 };
  assert.equal(shouldDrawWorldObjectLabel({ kind: "forge", x: 180, y: 100 }, player, { radius: 100 }), true);
  assert.equal(shouldDrawWorldObjectLabel({ kind: "forge", x: 260, y: 100 }, player, { radius: 100 }), false);
  assert.equal(shouldDrawWorldObjectLabel({ kind: "deadwood", x: 110, y: 100 }, player, { radius: 100 }), false);
  assert.equal(shouldDrawWorldObjectLabel({ kind: "forge", x: 260, y: 100 }, player, { debug: true }), true);
});

test("player labels keep self visible and suppress crowded remote names", () => {
  const local = { x: 100, y: 100 };
  const remote = { x: 120, y: 100 };
  assert.equal(shouldDrawPlayerNameLabel(remote, remote, local, { isLocal: true }), true);
  assert.equal(shouldDrawPlayerNameLabel(remote, remote, local, { nearbyPlayerCount: 2 }), true);
  assert.equal(shouldDrawPlayerNameLabel(remote, remote, local, { nearbyPlayerCount: 4 }), false);
  assert.equal(shouldDrawPlayerNameLabel({ x: 260, y: 100 }, { x: 260, y: 100 }, local), false);
  assert.equal(shouldDrawPlayerNameLabel({ x: 260, y: 100 }, { x: 260, y: 100 }, local, { debug: true }), true);
});

test("nearest interactable object ignores ambient ecology and prefers closest readable landmark", () => {
  const objects = [
    { id: "log", kind: "deadwood", label: "Fallen Log", x: 105, y: 100 },
    { id: "forge", kind: "forge", label: "Field Forge", x: 180, y: 100 },
    { id: "shrine", kind: "shrine", label: "Plain Shrine", x: 130, y: 100 },
  ];
  assert.equal(nearestInteractableObject(objects, { x: 100, y: 100 })?.id, "shrine");
  assert.equal(nearestInteractableObject(objects, { x: 100, y: 100 }, { radius: 20 }), null);
});
