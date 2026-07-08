import assert from "node:assert/strict";
import test from "node:test";

import {
  TERRAIN_MATERIALS,
  buildTerrain,
} from "./terrain.js";
import { PROJECTION } from "./projection.js";
import { testMap } from "./terrain-test-fixtures.js";

test("builds deterministic military-projection terrain with slopes and transitions", () => {
  const map = testMap();
  const terrain = buildTerrain(map);

  assert.equal(terrain.cols, 52);
  assert.equal(terrain.rows, 34);
  assert.equal(terrain.tiles.length, terrain.cols * terrain.rows);
  assert.equal(terrain.chunks.length, 35);
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
  assert.ok(
    terrain.tiles.every((tile) => tile.family && typeof tile.family === "object"),
    "expected every tile to carry terrain family metadata",
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
  assert.ok(Array.isArray(terrain.interiorSpaces), "expected terrain to expose interior occlusion spaces");
  assert.ok(
    terrain.interiorSpaces.some((space) => space.kitKind === "sunken-courtyard" && space.floors.length >= 2),
    "expected sunken courtyard to expose multi-floor interior metadata",
  );
  assert.ok(
    terrain.interiorSpaces.some((space) =>
      space.portals?.some((portal) => portal.kind === "stairs" && portal.fromFloor === 0 && portal.toFloor === 1),
    ),
    "expected sunken courtyard interior to expose a stair portal between floors",
  );
  assert.ok(
    terrain.interiorSpaces.some((space) => space.kitKind === "gatehouse-ruin" && space.portals?.some((portal) => portal.kind === "threshold-ramp")),
    "expected ruined gatehouse to expose roof-revealed threshold metadata",
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
