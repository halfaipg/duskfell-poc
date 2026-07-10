import { PROJECTION, defaultOrigin } from "./projection.js";
import { createCanvasFrame, drawLoading } from "./app-frame.js";
import { createRuntimeAssets } from "./app-assets.js";
import { createTerrainCache } from "./terrain-cache.js";
import { getAppDom } from "./app-dom.js";
import { computeCamera } from "./camera.js";
import { createEcologyRenderer } from "./ecology-renderer.js";
import { createInteriorRenderer } from "./interior-renderer.js";
import { createObjectDrawer, HIDE_WORLD_PROPS, VEGETATION_ONLY_ART_PASS } from "./object-draw.js";
import { createTerrainDrawer, normalizeTerrainDebugMode } from "./terrain-draw.js";
import { drawOverlay as drawOverlayPanel } from "./overlay.js";
import { createPlayerDrawer } from "./player-draw.js";
import { createPlayerRenderState } from "./player-render-state.js";
import { createNetworkClient } from "./network-client.js";
import { renderHud, renderPanel } from "./ui-panels.js";

const { canvas, screenCtx, ui } = getAppDom();
let ctx = screenCtx;
const params = new URLSearchParams(window.location.search);
const DAY_TINT = params.get("dayTint");
console.info("Duskfell client build: painted-terrain v3 (2026-07-09)");

const keys = new Set();
let playerId = null;
let snapshot = null;
const runtimeAssets = createRuntimeAssets();
const { sprites, terrainAssets } = runtimeAssets;
const playerRenderState = createPlayerRenderState();
const terrainCache = createTerrainCache();
const frame = createCanvasFrame({ canvas, screenCtx });
let localPlayerRenderPosition = null;

const camera = {
  x: 0,
  y: 0,
  scale: 1,
};
const terrainDebugMode = normalizeTerrainDebugMode(params.get("terrainDebug"));
// review-only camera overrides: ?viewTile=x,y pins the camera to a world
// tile, ?viewScale=0.5 zooms the whole scene — for art screenshots/tours
const viewOverride = (() => {
  const raw = params.get("viewTile");
  if (!raw) return null;
  const [x, y] = raw.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const units = PROJECTION.unitsPerTile;
  return { x: (x + 0.5) * units, y: (y + 0.5) * units };
})();
const viewScaleOverride = (() => {
  const raw = Number(params.get("viewScale"));
  return Number.isFinite(raw) && raw > 0.05 && raw <= 4 ? raw : 1;
})();
const terrainDrawer = createTerrainDrawer({
  getContext: () => ctx,
  getCanvas: () => canvas,
  getCamera: () => camera,
  getTerrain: () => terrainCache.getTerrain(),
  getTerrainCacheKey: () => terrainCache.getTerrainCacheKey(),
  getTerrainAssets: () => terrainAssets,
  getTerrainAssetVersion: () => runtimeAssets.terrainAssetVersion(),
  getTerrainDebugMode: () => terrainDebugMode,
});
const ecologyRenderer = createEcologyRenderer({
  getContext: () => ctx,
  getTerrain: () => terrainCache.getTerrain(),
});
const interiorRenderer = createInteriorRenderer({
  getContext: () => ctx,
  getTerrain: () => terrainCache.getTerrain(),
});
const playerDrawer = createPlayerDrawer({
  getContext: () => ctx,
  getTerrain: () => terrainCache.getTerrain(),
  getSnapshotTick: () => snapshot?.tick,
  getLocalPlayerId: () => playerId,
  getLocalPlayerRenderPosition: () => localPlayerRenderPosition,
  getSprites: () => sprites,
  getTerrainDebugMode: () => terrainDebugMode,
  playerRenderState,
});
const objectDrawer = createObjectDrawer({
  getContext: () => ctx,
  getTerrain: () => terrainCache.getTerrain(),
  getSprites: () => sprites,
  getTerrainDebugMode: () => terrainDebugMode,
  getLocalPlayerRenderPosition: () => localPlayerRenderPosition,
  playerDrawer,
});
const networkClient = createNetworkClient({
  getRequestedName: () => ui.nameInput.value,
  getInputState,
  setConnection,
  onWelcome: (message) => {
    playerId = message.playerId;
    snapshot = message.snapshot;
  },
  onSnapshot: (message) => {
    snapshot = message;
  },
  onServerStateChange: updatePanel,
});

runtimeAssets.loadSpriteAssets();
runtimeAssets.loadTerrainAssets();
networkClient.connect();
requestAnimationFrame(draw);

ui.renameButton.addEventListener("click", () => {
  networkClient.send({
    type: "rename",
    name: ui.nameInput.value,
  });
});

window.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "e", "E"].includes(event.key)) {
    event.preventDefault();
  }
  keys.add(event.key);
  networkClient.sendInput();
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key);
  networkClient.sendInput();
});

window.addEventListener("resize", () => {
  fitCanvas();
});

function getInputState() {
  return {
    up: keys.has("ArrowUp") || keys.has("w") || keys.has("W"),
    down: keys.has("ArrowDown") || keys.has("s") || keys.has("S"),
    left: keys.has("ArrowLeft") || keys.has("a") || keys.has("A"),
    right: keys.has("ArrowRight") || keys.has("d") || keys.has("D"),
    interact: keys.has("e") || keys.has("E") || keys.has(" "),
  };
}

function fitCanvas() {
  return frame.fitCanvas();
}

function draw(now = 0) {
  try {
    frame.updateFrameRate(now);
    const rect = fitCanvas();
    screenCtx.clearRect(0, 0, rect.width, rect.height);

    if (!snapshot) {
      drawLoading(ctx, rect);
      updateHud();
      requestAnimationFrame(draw);
      return;
    }

    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const me = players.find((player) => player.id === playerId) || players[0];
    const origin = defaultOrigin(snapshot.map);
    playerRenderState.updateRenderOffsets(players, snapshot.map, playerId, now);
    playerRenderState.updateVisualPositions(players, now);
    localPlayerRenderPosition = me ? playerRenderState.renderPosition(me) : null;
    const cameraFocus = viewOverride ?? (me ? { ...me, ...playerRenderState.renderPosition(me) } : me);
    const nextCamera = computeCamera({
      viewport: rect,
      map: snapshot.map,
      focus: cameraFocus,
      origin,
    });
    camera.scale = nextCamera.scale * viewScaleOverride;
    camera.x = nextCamera.x;
    camera.y = nextCamera.y;

    // reset the buffer each frame: stale paint (e.g. the parchment loading
    // screen) must never show through coverage gaps at elevation steps —
    // a dark base makes any residual gap read as crevice shadow
    ctx.fillStyle = "#161d18";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
    const objects = Array.isArray(snapshot.objects) ? snapshot.objects : [];
    terrainCache.terrainForMap(snapshot.map);
    terrainDrawer.drawMap(snapshot, origin, now, rect);
    if (!HIDE_WORLD_PROPS && !VEGETATION_ONLY_ART_PASS) {
      ecologyRenderer.drawEcologyGroundEffects(objects, origin, now);
      ecologyRenderer.drawEcologyEnergyLinks(objects, origin, now);
      ecologyRenderer.drawEcologyFeedLinks(objects, origin, now);
    }
    objectDrawer.drawSceneEntities(players, objects, origin, now);
    if (!HIDE_WORLD_PROPS && !VEGETATION_ONLY_ART_PASS) {
      interiorRenderer.drawInteriorRoofs(origin, localPlayerRenderPosition, now);
    }
    ctx.restore();

    // ?dayTint=dawn|dusk|night: global tint over the world — the first
    // stage of the day/night design, exposed for time-of-day demos
    if (DAY_TINT) {
      const tints = {
        dawn: ["rgba(255, 196, 140, 0.28)", "rgba(150, 120, 130, 0.55)"],
        dusk: ["rgba(255, 158, 96, 0.30)", "rgba(140, 104, 120, 0.6)"],
        night: ["rgba(70, 90, 150, 0.2)", "rgba(56, 68, 110, 0.75)"],
      };
      const [glow, shadow] = tints[DAY_TINT] ?? [];
      if (glow) {
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = shadow;
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.globalCompositeOperation = "soft-light";
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.restore();
      }
    }

    drawOverlay(rect);
    updateHud();
  } catch (error) {
    if (ui.hud) {
      ui.hud.textContent = `Render error: ${error instanceof Error ? error.message : "unknown"}`;
    }
  }
  requestAnimationFrame(draw);
}

function drawOverlay(rect) {
  drawOverlayPanel({
    ctx,
    rect,
    snapshot,
    terrain: terrainCache.getTerrain(),
    terrainDebugMode,
    localPlayerRenderPosition,
  });
}

function updateHud() {
  renderHud({
    ui,
    snapshot,
    smoothedFps: frame.smoothedFps(),
    terrainDebugMode,
    groundPatchCount: terrainAssets.groundPatches?.size ?? 0,
    terrainAssetError: runtimeAssets.terrainAssetError?.() ?? null,
  });
}

function updatePanel() {
  renderPanel({ ui, snapshot, playerId, sprites, playerSpriteFor: playerDrawer.playerSpriteFor });
}

function setConnection(text, className) {
  ui.connection.textContent = text;
  ui.connection.className = `connection ${className}`;
}
