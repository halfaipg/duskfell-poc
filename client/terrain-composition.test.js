import assert from "node:assert/strict";
import test from "node:test";

import { buildTerrain } from "./terrain.js";
import { detailTile, testMap } from "./terrain-test-fixtures.js";

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
    assert.ok(tile.composition.landmarkPressure >= 0 && tile.composition.landmarkPressure <= 1);
    assert.ok(tile.composition.openSpace >= 0 && tile.composition.openSpace <= 1);
    assert.ok(["open", "woodland", "wetland", "rocky", "scrub"].includes(tile.composition.habitat.kind));
    assert.ok(["open", "edge", "core"].includes(tile.composition.habitat.band));
    assert.ok(tile.composition.habitat.strength >= 0 && tile.composition.habitat.strength <= 1);
    assert.ok(tile.composition.habitat.clearance >= 0 && tile.composition.habitat.clearance <= 1);
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
  const quietMeadows = terrain.tiles.filter(
    (tile) => tile.composition.zone === "meadow" && tile.composition.openSpace > 0.58,
  );
  const detailTiles = new Set(terrain.details.map((detail) => `${detailTile(detail).x}:${detailTile(detail).y}`));
  const quietMeadowsWithDetails = quietMeadows.filter((tile) => detailTiles.has(`${tile.x}:${tile.y}`));
  const quietMeadowsWithDecals = quietMeadows.filter((tile) => tile.decals.length > 0);
  assert.ok(quietMeadows.length > 0, "expected the larger world to preserve quiet open travel space");
  assert.ok(
    quietMeadowsWithDetails.length / quietMeadows.length < 0.12,
    "expected quiet meadows to stay mostly clear of terrain statics",
  );
  assert.ok(
    quietMeadowsWithDecals.length / quietMeadows.length < 0.45,
    "expected quiet meadows to suppress most procedural decal noise",
  );
  assert.ok(
    terrain.details.filter((detail) => !detail.kitId).length / terrain.tiles.length < 0.1,
    "expected the larger world to keep ambient procedural clutter sparse",
  );

  const ambientDetails = terrain.details.filter((detail) => !detail.kitId);
  const ambientTiles = new Set(ambientDetails.map((detail) => `${detail.tile.x}:${detail.tile.y}`));
  const clusteredDetails = ambientDetails.filter((detail) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
      ambientTiles.has(`${detail.tile.x + dx}:${detail.tile.y + dy}`),
    ),
  );
  assert.ok(
    clusteredDetails.length / ambientDetails.length > 0.25,
    "expected ambient details to form habitat clusters instead of uniform scatter",
  );
  assert.equal(
    ambientDetails.filter((detail) =>
      terrain.tiles[detail.tile.y * terrain.cols + detail.tile.x].biome.pathPressure > 0.4,
    ).length,
    0,
    "expected authored travel corridors to stay clear of ambient props",
  );
});

test("terrain composition kits anchor coherent ruin and ecology scenes", () => {
  const terrain = buildTerrain(testMap());
  const kitIds = new Set(terrain.compositionKits.map((kit) => kit.id));
  const kitKinds = new Set(terrain.compositionKits.map((kit) => kit.kind));
  const kitTiles = terrain.tiles.filter((tile) => tile.composition.kitId);
  const viaductTiles = terrain.tiles.filter((tile) => tile.composition.kitId === "ancient-viaduct-kit");
  const viaductDetails = terrain.details.filter((detail) => detail.kitId === "ancient-viaduct-kit");
  const groveDetails = terrain.details.filter((detail) => detail.kitId === "old-grove-ring");
  const reedbedDetails = terrain.details.filter((detail) => detail.kitId === "river-reedbed");
  const leywellDetails = terrain.details.filter((detail) => detail.kitId === "leywell-garden-kit");
  const gatehouseDetails = terrain.details.filter((detail) => detail.kitId === "north-gatehouse-kit");

  assert.ok(kitIds.has("settlement-crossroads"), "expected a named settlement composition kit");
  assert.ok(kitIds.has("ancient-viaduct-kit"), "expected a named ancient viaduct composition kit");
  assert.ok(kitIds.has("sunken-courtyard-kit"), "expected a named vertical courtyard composition kit");
  assert.ok(kitIds.has("stormroot-ruin-kit"), "expected a named stormroot charged ecology composition kit");
  assert.ok(kitIds.has("leywell-garden-kit"), "expected a named crude-electric garden composition kit");
  assert.ok(kitIds.has("north-gatehouse-kit"), "expected a named roof-revealed gatehouse composition kit");
  assert.ok(kitKinds.has("old-grove"), "expected old grove composition kit");
  assert.ok(kitKinds.has("river-reedbed"), "expected shore ecology composition kit");
  assert.ok(kitTiles.length > 0, "expected tiles to reference composition kit membership");
  assert.ok(viaductTiles.some((tile) => tile.composition.kitRole === "causeway"), "expected viaduct causeway tiles");
  assert.ok(viaductTiles.some((tile) => tile.composition.kitRole === "rubble"), "expected viaduct rubble-field tiles");
  assert.ok(
    viaductTiles.some((tile) => tile.material === "cobble" && tile.composition.detailFamily === "ruin-road"),
    "expected viaduct kit to force coherent cobble causeway material",
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
    courtyardTiles.some((tile) => tile.material === "ruin" && tile.composition.objectBand === "architecture"),
    "expected courtyard kit to force architecture ruin material",
  );
  assert.ok(
    courtyardTiles.some((tile) => tile.decals.some((decal) => decal.kind === "masonry-joint")),
    "expected courtyard kit to carry masonry floor decals",
  );
  assert.ok(courtyardDetails.some((detail) => detail.kind === "wall"), "expected vertical wall statics");
  assert.ok(courtyardDetails.some((detail) => detail.kind === "stairs"), "expected stair statics");
  assert.ok(courtyardDetails.some((detail) => detail.kind === "foundation"), "expected broken foundation statics");

  const gatehouseTiles = terrain.tiles.filter((tile) => tile.composition.kitId === "north-gatehouse-kit");
  const gatehouseRoles = new Set(gatehouseTiles.map((tile) => tile.composition.kitRole));
  assert.ok(gatehouseRoles.has("passage"), "expected gatehouse passage tiles");
  assert.ok(gatehouseRoles.has("threshold"), "expected gatehouse charged threshold tiles");
  assert.ok(gatehouseRoles.has("tower-west") || gatehouseRoles.has("tower-east"), "expected gatehouse tower tiles");
  assert.ok(
    gatehouseTiles.some((tile) => tile.material === "field" && tile.composition.objectBand === "charged-ecology"),
    "expected gatehouse threshold to use charged field material",
  );
  assert.ok(gatehouseDetails.some((detail) => detail.kind === "wall"), "expected gatehouse tower wall statics");
  assert.ok(gatehouseDetails.some((detail) => detail.kind === "foundation"), "expected gatehouse passage floor statics");
  assert.ok(
    new Set(gatehouseDetails.map((detail) => detail.kitRole)).has("threshold-plate"),
    "expected gatehouse detail roles to identify threshold plate",
  );

  const landmarkCenters = terrain.compositionKits
    .filter((kit) => kit.kind !== "settlement-core" && kit.kind !== "river-reedbed")
    .map((kit) => [kit.id, kit.x, kit.y]);
  for (let i = 0; i < landmarkCenters.length; i += 1) {
    for (let j = i + 1; j < landmarkCenters.length; j += 1) {
      const [firstId, firstX, firstY] = landmarkCenters[i];
      const [secondId, secondX, secondY] = landmarkCenters[j];
      assert.ok(
        Math.hypot(firstX - secondX, firstY - secondY) >= 5,
        `expected ${firstId} and ${secondId} to be visually separated districts`,
      );
    }
  }
  const normalizedSpanX =
    (Math.max(...landmarkCenters.map(([, x]) => x)) - Math.min(...landmarkCenters.map(([, x]) => x))) / terrain.cols;
  const normalizedSpanY =
    (Math.max(...landmarkCenters.map(([, , y]) => y)) - Math.min(...landmarkCenters.map(([, , y]) => y))) / terrain.rows;
  assert.ok(normalizedSpanX > 0.62, "expected named terrain districts to span most of the larger world width");
  assert.ok(normalizedSpanY > 0.62, "expected named terrain districts to span most of the larger world depth");

  const stormrootTiles = terrain.tiles.filter((tile) => tile.composition.kitId === "stormroot-ruin-kit");
  const stormrootRoles = new Set(stormrootTiles.map((tile) => tile.composition.kitRole));
  const stormrootDetails = terrain.details.filter((detail) => detail.kitId === "stormroot-ruin-kit");
  assert.ok(stormrootRoles.has("charged-core"), "expected stormroot kit charged core tiles");
  assert.ok(stormrootRoles.has("wire-scar"), "expected stormroot kit wire scar tiles");
  assert.ok(
    stormrootTiles.some((tile) => tile.material === "field" && tile.composition.objectBand === "charged-ecology"),
    "expected stormroot kit to force charged field material",
  );
  assert.ok(stormrootDetails.some((detail) => detail.kind === "mushroom"), "expected stormroot kit mycelium statics");
  assert.ok(
    stormrootDetails.some((detail) => detail.kind === "fallen-log" || detail.kind === "stump"),
    "expected stormroot kit deadwood feed statics",
  );
  assert.ok(stormrootDetails.some((detail) => detail.resources?.length > 0), "expected stormroot kit resource metadata");

  const leywellTiles = terrain.tiles.filter((tile) => tile.composition.kitId === "leywell-garden-kit");
  const leywellRoles = new Set(leywellTiles.map((tile) => tile.composition.kitRole));
  assert.ok(leywellRoles.has("basin"), "expected leywell basin tiles");
  assert.ok(leywellRoles.has("conduit"), "expected leywell crude-electric conduit tiles");
  assert.ok(leywellRoles.has("wet-garden"), "expected leywell wet garden tiles");
  assert.ok(
    leywellTiles.some((tile) => tile.material === "field" && tile.composition.objectBand === "charged-ecology"),
    "expected leywell conduit tiles to use charged field material",
  );
  assert.ok(leywellDetails.some((detail) => detail.kind === "foundation"), "expected leywell basin foundation static");
  assert.ok(leywellDetails.some((detail) => detail.kind === "ruin"), "expected leywell fallen rim statics");
  assert.ok(leywellDetails.some((detail) => detail.kind === "mushroom"), "expected leywell mycelium inlet");
  assert.ok(leywellDetails.some((detail) => detail.kind === "reeds"), "expected leywell overflow reeds");
  assert.ok(
    new Set(leywellDetails.map((detail) => detail.kitRole)).has("basin-mycelium"),
    "expected leywell detail roles to identify mycelium inlet",
  );
  assert.ok(leywellDetails.some((detail) => detail.resources?.length > 0), "expected leywell resource metadata");

  assert.ok(groveDetails.some((detail) => detail.kind === "tree"), "expected old grove kit tree statics");
  assert.ok(
    groveDetails.some((detail) => detail.kind === "fallen-log" || detail.kind === "stump"),
    "expected old grove kit deadfall statics",
  );
  assert.ok(groveDetails.some((detail) => detail.kind === "mushroom"), "expected old grove kit mycelium ring statics");
  assert.ok(
    new Set(groveDetails.map((detail) => detail.kitRole)).has("fairy-ring"),
    "expected old grove kit to label fairy-ring mycelium",
  );
  assert.ok(groveDetails.some((detail) => detail.resources?.length > 0), "expected old grove kit resource metadata");

  assert.ok(reedbedDetails.some((detail) => detail.kind === "reeds"), "expected reedbed kit reed statics");
  assert.ok(
    reedbedDetails.some((detail) => detail.kind === "fallen-log" || detail.kind === "stump"),
    "expected reedbed kit driftwood statics",
  );
  assert.ok(
    new Set(reedbedDetails.map((detail) => detail.kitRole)).has("wet-stone"),
    "expected reedbed kit to label wet-stone detail",
  );
  assert.ok(reedbedDetails.some((detail) => detail.resources?.length > 0), "expected reedbed kit resource metadata");
});
