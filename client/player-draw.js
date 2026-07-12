import { projectWorld } from "./projection.js";
import {
  drawCarriedChargeEffect,
  drawCarriedDecayEffect,
  drawPlayerFootfall,
} from "./player-effects-draw.js";
import { drawFallbackPlayer } from "./player-fallback-draw.js";
import { drawPlayerLabels, playerLabelOffset } from "./player-label-draw.js";
import { drawPlayerShadow, drawPlayerSprite } from "./player-sprite-draw.js";
import { shouldDrawPlayerNameLabel } from "./object-render-policy.js";
import { stableIndex } from "./player-draw-utils.js";
import { playerGroundingAtWorld } from "./player-grounding.js";
import { terrainHeightAtWorld } from "./terrain.js";

export function createPlayerDrawer({
  getContext,
  getTerrain,
  getSnapshotTick,
  getLocalPlayerId,
  getLocalPlayerRenderPosition,
  getSprites,
  getTerrainDebugMode,
  playerRenderState,
}) {
  function drawPlayers(players, origin, now) {
    const sorted = [...players].sort(
      (a, b) => renderSortKey(a, origin) - renderSortKey(b, origin),
    );
    for (const player of sorted) {
      drawPlayer(player, origin, now, sorted);
    }
  }

  function drawPlayer(player, origin, now, players = []) {
    const ctx = getContext();
    const terrain = getTerrain();
    const isMe = player.id === getLocalPlayerId();
    const renderPosition = playerRenderState.renderPosition(player);
    const playerZ = terrainHeightAtWorld(terrain, renderPosition.x, renderPosition.y);
    const point = projectWorld(renderPosition.x, renderPosition.y, playerZ, origin);
    const motion = playerRenderState.motionFor(player, getSnapshotTick() ?? 0, now);
    const sprite = playerSpriteFor(player);
    const grounding = playerGroundingAtWorld(terrain, renderPosition, motion);
    // Entities with their own label treatment (NPC nameplates) opt out here.
    const showLabel =
      !player.hideNameLabel &&
      shouldDrawPlayerNameLabel(player, renderPosition, getLocalPlayerRenderPosition(), {
        isLocal: isMe,
        debug: Boolean(getTerrainDebugMode()),
        nearbyPlayerCount: playerRenderState.nearbyPlayerCount(players, player),
      });

    drawPlayerShadow(ctx, point, isMe, sprite, grounding);
    drawPlayerFootfall(ctx, terrain, point, motion, renderPosition, grounding, player.id);

    if (drawPlayerSprite(ctx, player, point, motion, now, sprite, grounding)) {
      drawCarriedEffects(ctx, player, point, now);
      drawPlayerLabels(ctx, getSprites(), player, point, playerLabelOffset(sprite), sprite, showLabel);
      return;
    }

    drawFallbackPlayer(ctx, point, player.color, isMe, motion, now, player.id, grounding);
    drawCarriedEffects(ctx, player, point, now);
    drawPlayerLabels(ctx, getSprites(), player, point, -62, sprite, showLabel);
  }

  function renderSortKey(player, origin) {
    const terrain = getTerrain();
    const sprite = playerSpriteFor(player);
    const renderPosition = playerRenderState.renderPosition(player);
    const sortMode = sprite?.render?.sort ?? "footprint-y";
    const zBias = sprite?.render?.zBias ?? 0;
    if (sortMode === "fixed") return zBias;
    return (
      projectWorld(
        renderPosition.x,
        renderPosition.y,
        terrainHeightAtWorld(terrain, renderPosition.x, renderPosition.y),
        origin,
      ).y + zBias
    );
  }

  function playerSpriteFor(player) {
    const sprites = getSprites();
    if (sprites.players.length === 0) return sprites.player;
    const variantIndex = playerRenderState.variantIndexFor(player, stableIndex(player.id));
    return sprites.players[variantIndex % sprites.players.length] ?? sprites.player;
  }

  return {
    drawPlayer,
    drawPlayers,
    playerSpriteFor,
    renderSortKey,
  };
}

function drawCarriedEffects(ctx, player, point, now) {
  drawCarriedChargeEffect(ctx, player, point, now);
  drawCarriedDecayEffect(ctx, player, point, now);
}
