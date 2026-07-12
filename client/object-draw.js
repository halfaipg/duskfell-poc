import { PROJECTION, projectWorld } from "./projection.js";
import {
  shouldDrawTerrainDetailAuthorityBody,
  shouldDrawWorldObjectLabel,
  terrainDetailAuthorityObjectIds,
  VEGETATION_ONLY_ART_PASS,
  VISIBLE_DETAIL_KINDS,
  VISIBLE_OBJECT_KINDS,
} from "./object-render-policy.js";
import { terrainHeightAtWorld } from "./terrain.js";
import { createObjectCueDrawer } from "./object-cue-draw.js";
import { createTerrainDetailDrawer } from "./terrain-detail-draw.js";
import { drawTerrainDetailAuthorityCue } from "./object-authority-cue-draw.js";
import { drawFallbackObject, objectColors } from "./object-fallback-draw.js";
import { drawObjectLabel, drawWorldObjectExtras } from "./object-label-draw.js";
import { drawObjectSprite } from "./object-sprite-draw.js";

// Art-reset review mode: old prop/detail sprites are retired pending the
// world-kit prop pass — draw only players until new props land.
export const HIDE_WORLD_PROPS = false;

export { VEGETATION_ONLY_ART_PASS } from "./object-render-policy.js";

export function createObjectDrawer({
  getContext,
  getTerrain,
  getSprites,
  getTerrainDebugMode,
  getLocalPlayerRenderPosition,
  playerDrawer,
  npcDrawer,
}) {
  let ctx = getContext();
  let terrain = getTerrain();
  let sprites = getSprites();
  let terrainDebugMode = getTerrainDebugMode();
  let localPlayerRenderPosition = getLocalPlayerRenderPosition();
  const cueDrawer = createObjectCueDrawer({
    getContext: () => ctx,
    getSprites: () => sprites,
  });
  const terrainDetailDrawer = createTerrainDetailDrawer({
    cueDrawer,
    getContext: () => ctx,
    getLocalPlayerRenderPosition: () => localPlayerRenderPosition,
    getSprites: () => sprites,
  });

  function refreshRendererState() {
    ctx = getContext();
    terrain = getTerrain();
    sprites = getSprites();
    terrainDebugMode = getTerrainDebugMode();
    localPlayerRenderPosition = getLocalPlayerRenderPosition();
  }

  function drawSceneEntities(players, objects, origin, now, npcs = []) {
    refreshRendererState();
    const terrainDetailObjectIds = terrainDetailAuthorityObjectIds(terrain?.details);
    const entities = [
      ...(HIDE_WORLD_PROPS
        ? []
        : (terrain?.details ?? [])
            .filter((detail) => !VEGETATION_ONLY_ART_PASS || VISIBLE_DETAIL_KINDS.has(detail.kind))
            .map((detail) => ({
              type: "terrain-detail",
              sort: terrainDetailDrawer.terrainDetailSortKey(detail, origin),
              value: detail,
            }))),
      ...(HIDE_WORLD_PROPS
        ? []
        : objects
            .filter((object) => !VEGETATION_ONLY_ART_PASS || VISIBLE_OBJECT_KINDS.has(object.kind))
            .map((object) => ({
              type: "object",
              sort: objectRenderSortKey(object, origin),
              value: object,
            }))),
      ...(npcDrawer
        ? npcs.map((npc) => ({
            type: "npc",
            sort: npcDrawer.renderSortKey(npc, origin),
            value: npc,
          }))
        : []),
      ...players.map((player) => ({
        type: "player",
        sort: playerDrawer.renderSortKey(player, origin),
        value: player,
      })),
    ].sort((a, b) => a.sort - b.sort);

    for (const entity of entities) {
      if (entity.type === "terrain-detail") {
        terrainDetailDrawer.drawTerrainDetail(entity.value, origin);
      } else if (entity.type === "object") {
        drawObject(entity.value, origin, now, terrainDetailObjectIds);
      } else if (entity.type === "npc") {
        npcDrawer.drawNpc(entity.value, origin, now);
      } else {
        playerDrawer.drawPlayer(entity.value, origin, now, players);
      }
    }
  }

  function objectRenderSortKey(object, origin) {
    const objectZ = terrainHeightAtWorld(terrain, object.x, object.y);
    return projectWorld(object.x, object.y, objectZ, origin).y - 8;
  }

  function drawObject(object, origin, now = 0, terrainDetailObjectIds = new Set()) {
    const objectZ = terrainHeightAtWorld(terrain, object.x, object.y);
    const point = projectWorld(object.x, object.y, objectZ, origin);
    if (!shouldDrawTerrainDetailAuthorityBody(object, terrainDetailObjectIds)) {
      drawTerrainDetailAuthorityCue(
        ctx,
        cueDrawer,
        object,
        point,
        localPlayerRenderPosition,
        terrainDebugMode,
      );
      return;
    }

    const footprint = Math.max(0.65, object.radius / PROJECTION.unitsPerTile);
    const showLabel = shouldDrawWorldObjectLabel(object, localPlayerRenderPosition, {
      debug: Boolean(terrainDebugMode),
    });

    if (drawObjectSprite(ctx, sprites, cueDrawer, object, point, now)) {
      drawWorldObjectExtras(cueDrawer, object, point);
      if (showLabel) drawObjectLabel(ctx, object, point, footprint);
      return;
    }

    drawFallbackObject(ctx, object, point, footprint, objectColors(object.kind));
    if (showLabel) drawObjectLabel(ctx, object, point, footprint);
    drawWorldObjectExtras(cueDrawer, object, point);
  }

  return {
    drawSceneEntities,
  };
}
