import { PROJECTION, projectWorld } from "./projection.js";
import {
  shouldDrawTerrainDetailAuthorityBody,
  shouldDrawWorldObjectLabel,
  terrainDetailAuthorityObjectIds,
} from "./object-render-policy.js";
import { terrainHeightAtWorld } from "./terrain.js";
import { createObjectCueDrawer } from "./object-cue-draw.js";
import { createTerrainDetailDrawer } from "./terrain-detail-draw.js";
import { drawTerrainDetailAuthorityCue } from "./object-authority-cue-draw.js";
import { drawFallbackObject, objectColors } from "./object-fallback-draw.js";
import { drawObjectLabel, drawWorldObjectExtras } from "./object-label-draw.js";
import { drawObjectSprite } from "./object-sprite-draw.js";

export function createObjectDrawer({
  getContext,
  getTerrain,
  getSprites,
  getTerrainDebugMode,
  getLocalPlayerRenderPosition,
  playerDrawer,
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

  function drawSceneEntities(players, objects, origin, now) {
    refreshRendererState();
    const terrainDetailObjectIds = terrainDetailAuthorityObjectIds(terrain?.details);
    const entities = [
      ...(terrain?.details ?? []).map((detail) => ({
        type: "terrain-detail",
        sort: terrainDetailDrawer.terrainDetailSortKey(detail, origin),
        value: detail,
      })),
      ...objects.map((object) => ({
        type: "object",
        sort: objectRenderSortKey(object, origin),
        value: object,
      })),
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
