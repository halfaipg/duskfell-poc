import { PROJECTION, defaultOrigin } from "./projection.js";
import { createCanvasFrame, drawLoading } from "./app-frame.js";
import { createRuntimeAssets } from "./app-assets.js?v=duskfell-world-v2-75";
import { createTerrainCache } from "./terrain-cache.js";
import { getAppDom } from "./app-dom.js";
import { computeCamera } from "./camera.js";
import { createEcologyRenderer } from "./ecology-renderer.js";
import { createInteriorRenderer } from "./interior-renderer.js";
import { createObjectDrawer, HIDE_WORLD_PROPS, VEGETATION_ONLY_ART_PASS } from "./object-draw.js";
import { createTerrainDrawer, normalizeTerrainDebugMode } from "./terrain-draw.js?v=duskfell-world-v2-71";
import { createTerrainGlLayer } from "./terrain-gl-layer.js?v=duskfell-world-v2-71";
import { drawOverlay as drawOverlayPanel } from "./overlay.js";
import { createPlayerDrawer } from "./player-draw.js";
import { createPlayerRenderState } from "./player-render-state.js";
import { createNetworkClient } from "./network-client.js";
import { renderHud, renderPanel } from "./ui-panels.js";
import { terrainHeightAtWorld } from "./terrain.js";
import { assembleWorldChunkWindow } from "./world-chunk-assembly.js";
import { composeWorldVisualChunkWindow } from "./world-visual-chunk-stream.js";
import { drawWaterFish } from "./water-fish.js";
import { drawWorldMap, toggleWorldMap } from "./world-map.js";
import { setSun } from "./sun-state.js";
import { loamVerticalSliceDetails, loamVerticalSliceEnabled } from "./terrain-vertical-slice.js";
import { kimodoReviewMode } from "./kimodo-review-sprite.js?v=blender-locomotion-2";
import { drawTerrainAtmosphere } from "./terrain-atmosphere.js";
import { treeReviewMode } from "./tree-review-sprite.js?v=blender-tree-family-1";

const { canvas, screenCtx, ui } = getAppDom();
let ctx = screenCtx;
const params = new URLSearchParams(window.location.search);
// GPU terrain compositor on the canvas below; ?nogl=1 forces the 2D path
const terrainGlLayer =
  params.get("nogl") === "1" ? null : createTerrainGlLayer(document.getElementById("worldgl"));
const DAY_TINT = params.get("dayTint");
// NPCs are visible by default; ?npcs=0 is a development escape hatch.
const SHOW_NPCS = params.get("npcs") !== "0";
// live day/night: one full day per SUN_CYCLE seconds (?sunCycle=40 for a
// fast demo arc); drives the water specular sun and the world tint
const SUN_CYCLE_SECONDS = (() => {
  const raw = Number(params.get("sunCycle"));
  return Number.isFinite(raw) && raw >= 10 ? raw : 1200;
})();

function sunStateAt() {
  // wall-clock anchored so every client shares the same sun; biased so
  // roughly 70% of the cycle is daylight and night stays short
  const raw = ((Date.now() / 1000 / SUN_CYCLE_SECONDS) + 0.35) % 1;
  const phase = raw < 0.7 ? (raw / 0.7) * 0.5 : 0.5 + ((raw - 0.7) / 0.3) * 0.5;
  const angle = phase * Math.PI * 2; // 0 = sunrise, 0.25 = noon, 0.5 = sunset
  const elevation = Math.sin(angle);
  const azimuth = phase * Math.PI * 2 + Math.PI / 3;
  const cosE = Math.cos(Math.asin(Math.max(-0.999, Math.min(0.999, elevation)))) || 0.001;
  return {
    elevation,
    direction: {
      x: Math.cos(azimuth) * cosE,
      y: Math.sin(azimuth) * cosE,
      z: Math.max(-0.35, elevation),
    },
  };
}
function visualSunStateAt() {
  const live = sunStateAt();
  const forced = { day: 0.85, dawn: 0.09, dusk: -0.02, night: -0.5 }[DAY_TINT];
  if (forced == null) return live;
  return {
    elevation: forced,
    direction: {
      x: -0.45,
      y: -0.55,
      z: forced > 0 ? Math.max(0.12, forced) : -0.2,
    },
  };
}
let currentSun = visualSunStateAt();
let visualSunElevation = currentSun.elevation;
console.info("Duskfell client build: painted-terrain v3 (2026-07-09)");

const keys = new Set();
let playerId = null;
let snapshot = null;
const runtimeAssets = createRuntimeAssets({
  kimodoReview: kimodoReviewMode(window.location.search),
  treeReview: treeReviewMode(window.location.search),
});
const { sprites, terrainAssets } = runtimeAssets;
const playerRenderState = createPlayerRenderState();
const terrainCache = createTerrainCache();
const frame = createCanvasFrame({ canvas, screenCtx });
let localPlayerRenderPosition = null;
let terrainWarmed = false;
let streamedChunkKey = null;
let lastStreamPosition = null;
let streamRequestGeneration = 0;

function activeWorldBundle() {
  return terrainAssets.streamingWorldBundle ?? terrainAssets.worldBundle;
}

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
  getGlLayer: () => terrainGlLayer,
  getSun: () => currentSun,
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
  getExtraTerrainDetails: () => loamVerticalSliceDetails(terrainCache.getTerrain()),
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

// floating player card: X hides it, the Player button brings it back
ui.panelClose?.addEventListener("click", () => {
  ui.playerPanel?.classList.add("panel-hidden");
  ui.panelOpen?.removeAttribute("hidden");
});
ui.panelOpen?.addEventListener("click", () => {
  ui.playerPanel?.classList.remove("panel-hidden");
  ui.panelOpen?.setAttribute("hidden", "");
});

// UO-style speech: Enter opens the say box, Enter again sends and the words
// float above your head; Escape backs out
const chatInput = document.getElementById("chatInput");
chatInput?.addEventListener("keydown", (event) => {
  event.stopPropagation();
  if (event.key === "Enter") {
    const text = chatInput.value.trim();
    if (text) networkClient.send({ type: "say", text });
    chatInput.value = "";
    chatInput.hidden = true;
    chatInput.blur();
  } else if (event.key === "Escape") {
    chatInput.value = "";
    chatInput.hidden = true;
    chatInput.blur();
  }
});

window.addEventListener("keydown", (event) => {
  if (isTextEntryTarget(event.target)) return;
  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    document.body.classList.toggle("world-map-open", toggleWorldMap());
    return;
  }
  if (event.key === "Enter" && chatInput) {
    event.preventDefault();
    chatInput.hidden = false;
    chatInput.focus();
    return;
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "e", "E"].includes(event.key)) {
    event.preventDefault();
  }
  keys.add(event.key);
  networkClient.sendInput();
});

window.addEventListener("keyup", (event) => {
  if (isTextEntryTarget(event.target)) return;
  keys.delete(event.key);
  networkClient.sendInput();
});

function isTextEntryTarget(target) {
  return target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(target.tagName);
}

window.addEventListener("resize", () => {
  fitCanvas();
});

// click/tap-to-move: the pointer picks a world point, and until we arrive we
// synthesize the same 8-way key input the server already understands
let moveTarget = null;
let moveTargetStalledSince = null;
let moveStallKey = null;
const MOVE_ARRIVE_UNITS = 14;
const MOVE_STALL_MS = 900;

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !snapshot) return;
  const rect = canvas.getBoundingClientRect();
  const screenX = (event.clientX - rect.left) / camera.scale + camera.x;
  const screenY = (event.clientY - rect.top) / camera.scale + camera.y;
  const origin = defaultOrigin(snapshot.map);
  const units = PROJECTION.unitsPerTile;
  // invert the plan-oblique projection, refining once with terrain height
  let wx = 0;
  let wy = 0;
  let z = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    const sx = ((screenX - origin.x) * units) / PROJECTION.halfW;
    const sy = ((screenY + z * PROJECTION.zPx - origin.y) * units) / PROJECTION.halfH;
    wx = (sx + sy) / 2;
    wy = (sy - sx) / 2;
    z = terrainHeightAtWorld(terrainCache.getTerrain(), wx, wy);
  }
  moveTarget = { x: wx, y: wy };
  moveKeysCache = null;
  moveTargetStalledSince = null;
  networkClient.sendInput();
});

let moveKeysCache = null;
let moveKeysCachedAt = 0;

function moveTargetInput() {
  if (!moveTarget || !snapshot) return null;
  const nowMs = Date.now();
  if (moveKeysCache && nowMs - moveKeysCachedAt < 160) return moveKeysCache;
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  const me = players.find((player) => player.id === playerId);
  if (!me) return null;
  const dx = moveTarget.x - me.x;
  const dy = moveTarget.y - me.y;
  if (Math.hypot(dx, dy) <= MOVE_ARRIVE_UNITS) {
    moveTarget = null;
    return null;
  }
  // 8-way: press an axis when it holds a meaningful share of the remaining path
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const diagonal = Math.min(ax, ay) > Math.max(ax, ay) * 0.41;
  moveKeysCache = {
    up: dy < 0 && (diagonal || ay >= ax),
    down: dy > 0 && (diagonal || ay >= ax),
    left: dx < 0 && (diagonal || ax > ay),
    right: dx > 0 && (diagonal || ax > ay),
    interact: false,
  };
  moveKeysCachedAt = nowMs;
  return moveKeysCache;
}

function getInputState() {
  const keyState = {
    up: keys.has("ArrowUp") || keys.has("w") || keys.has("W"),
    down: keys.has("ArrowDown") || keys.has("s") || keys.has("S"),
    left: keys.has("ArrowLeft") || keys.has("a") || keys.has("A"),
    right: keys.has("ArrowRight") || keys.has("d") || keys.has("D"),
    interact: keys.has("e") || keys.has("E") || keys.has(" "),
  };
  if (keyState.up || keyState.down || keyState.left || keyState.right) {
    moveTarget = null;  // real keys always win over a pointer target
    return keyState;
  }
  const synthesized = moveTargetInput();
  return synthesized ? { ...synthesized, interact: keyState.interact } : keyState;
}

function fitCanvas() {
  return frame.fitCanvas();
}

function prefetchTerrainChunks(player) {
  const stream = terrainAssets.chunkStream;
  if (!stream || !player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return;
  const tileX = player.x / PROJECTION.unitsPerTile;
  const tileY = player.y / PROJECTION.unitsPerTile;
  const chunkX = Math.floor(tileX / stream.index.chunkTiles);
  const chunkY = Math.floor(tileY / stream.index.chunkTiles);
  const key = `${chunkX},${chunkY}`;
  if (key === streamedChunkKey) return;
  const velocityX = lastStreamPosition ? tileX - lastStreamPosition.x : 0;
  const velocityY = lastStreamPosition ? tileY - lastStreamPosition.y : 0;
  lastStreamPosition = { x: tileX, y: tileY };
  streamedChunkKey = key;
  const requestGeneration = ++streamRequestGeneration;
  const authorityRequest = stream.prefetchAhead({ tileX, tileY, velocityX, velocityY, radiusChunks: 1 });
  const visualRequest = terrainAssets.visualChunkStream
    ? terrainAssets.visualChunkStream.prefetchAhead({ tileX, tileY, velocityX, velocityY, radiusChunks: 1 })
    : Promise.resolve(null);
  Promise.all([authorityRequest, visualRequest])
    .then(([chunks, visualChunks]) => {
      if (requestGeneration !== streamRequestGeneration) return;
      const nextBundle = assembleWorldChunkWindow(stream.index, chunks);
      if (visualChunks) {
        const painting = composeWorldVisualChunkWindow(visualChunks);
        if (JSON.stringify(painting.sourceRegion) !== JSON.stringify(nextBundle.sourceRegion)) {
          throw new Error("streamed visual window drifts from terrain authority window");
        }
        const groundPatches = new Map(terrainAssets.groundPatches);
        groundPatches.set("__world-painting__", painting.image);
        terrainAssets.groundPatches = groundPatches;
        runtimeAssets.bumpTerrainAssetVersion();
      }
      terrainAssets.streamingWorldBundle = nextBundle;
    })
    .catch((error) => {
      if (requestGeneration !== streamRequestGeneration) return;
      console.error("Duskfell terrain chunk prefetch failed", error);
      streamedChunkKey = null;
    });
}

function draw(now = 0) {
  try {
    frame.updateFrameRate(now);
    const rect = fitCanvas();
    screenCtx.clearRect(0, 0, rect.width, rect.height);

    if (!snapshot || !runtimeAssets.assetsReady() || !terrainWarmed) {
      if (snapshot && runtimeAssets.assetsReady()) {
        // stage 2: raise the land — build one visible chunk per frame so
        // the bar moves instead of freezing while composites paint
        const origin = defaultOrigin(snapshot.map);
        const players = Array.isArray(snapshot.players) ? snapshot.players : [];
        const me = players.find((player) => player.id === playerId) || players[0];
        prefetchTerrainChunks(me);
        if (terrainAssets.chunkStream && !terrainAssets.streamingWorldBundle) {
          drawLoading(ctx, rect, {
            done: Math.min(
              terrainAssets.chunkStream.snapshot().cached,
              terrainAssets.visualChunkStream?.snapshot().cached ?? 9,
            ),
            total: 9,
            label: "Streaming the region…",
          });
          updateHud();
          requestAnimationFrame(draw);
          return;
        }
        terrainCache.terrainForMap(snapshot.map, activeWorldBundle());
        const warmCamera = computeCamera({
          viewport: rect,
          map: snapshot.map,
          focus: viewOverride ?? me,
          origin,
        });
        camera.scale = warmCamera.scale * viewScaleOverride;
        camera.x = warmCamera.x;
        camera.y = warmCamera.y;
        const warm = terrainDrawer.warmup(origin, rect);
        drawLoading(ctx, rect, {
          done: warm.built,
          total: Math.max(1, warm.total),
          label: "Raising the land…",
        });
        if (warm.done) terrainWarmed = true;
      } else {
        drawLoading(ctx, rect, runtimeAssets.assetProgress());
      }
      updateHud();
      requestAnimationFrame(draw);
      return;
    }

    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    // NPCs are part of the normal world; ?npcs=0 is a development escape hatch.
    const npcs = SHOW_NPCS && Array.isArray(snapshot.npcs) ? snapshot.npcs : [];
    const reviewPlayers = loamVerticalSliceEnabled()
      ? players.filter((player) => player.id === playerId)
      : players;
    const actors = [...reviewPlayers, ...npcs];
    const me = players.find((player) => player.id === playerId) || players[0];
    prefetchTerrainChunks(me);
    const origin = defaultOrigin(snapshot.map);
    playerRenderState.updateRenderOffsets(players, snapshot.map, playerId, now);
    playerRenderState.updateVisualPositions(actors, now);
    localPlayerRenderPosition = me ? playerRenderState.renderPosition(me) : null;
    if (moveTarget && me) {
      // re-evaluate the synthesized heading; sendInput dedupes so this only
      // hits the wire when the 8-way keys actually change
      networkClient.sendInput();
      const stallKey = `${Math.round(me.x)},${Math.round(me.y)}`;
      if (moveStallKey === stallKey) {
        moveTargetStalledSince ??= now;
        if (now - moveTargetStalledSince > MOVE_STALL_MS) {
          moveTarget = null;  // blocked by water or a cliff: stop pushing
          moveTargetStalledSince = null;
          networkClient.sendInput();
        }
      } else {
        moveStallKey = stallKey;
        moveTargetStalledSince = null;
      }
    }
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

    // reset the buffer each frame: with the GL terrain layer active the GL
    // canvas below provides the dark base, so the 2D canvas clears to
    // transparent; without GL, fill dark so coverage gaps read as crevices
    if (terrainGlLayer) {
      ctx.clearRect(0, 0, rect.width, rect.height);
    } else {
      ctx.fillStyle = "#161d18";
      ctx.fillRect(0, 0, rect.width, rect.height);
    }
    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
    const objects = Array.isArray(snapshot.objects) ? snapshot.objects : [];
    currentSun = visualSunStateAt();
    setSun(currentSun);
    terrainCache.terrainForMap(snapshot.map, activeWorldBundle());
    terrainDrawer.drawMap(snapshot, origin, now, rect);
    drawWaterFish(ctx, terrainCache.getTerrain(), origin, camera, rect, now);
    if (!HIDE_WORLD_PROPS && !VEGETATION_ONLY_ART_PASS) {
      ecologyRenderer.drawEcologyGroundEffects(objects, origin, now);
      ecologyRenderer.drawEcologyEnergyLinks(objects, origin, now);
      ecologyRenderer.drawEcologyFeedLinks(objects, origin, now);
    }
    objectDrawer.drawSceneEntities(actors, objects, origin, now);
    if (!HIDE_WORLD_PROPS && !VEGETATION_ONLY_ART_PASS) {
      interiorRenderer.drawInteriorRoofs(origin, localPlayerRenderPosition, now);
    }
    drawTerrainAtmosphere(
      ctx,
      terrainCache.getTerrain(),
      origin,
      camera,
      rect,
      now,
      currentSun,
    );
    ctx.restore();

    // day/night: overlay divs with mix-blend-mode darken both canvases —
    // canvas composite ops cannot reach the GL terrain layer below
    {
      const e = currentSun.elevation;
      visualSunElevation = e;
      const horizonBand = Math.max(0, 1 - Math.abs(e) * 5.5);
      const nightAlpha = Math.max(0, Math.min(0.66, 0.1 - e * 1.35));
      if (ui.nightShade) ui.nightShade.style.opacity = nightAlpha.toFixed(3);
      if (ui.dawnGlow) ui.dawnGlow.style.opacity = (horizonBand * 0.55).toFixed(3);
    }

    drawOverlay(rect);
    drawWorldMap(
      ctx,
      rect,
      terrainCache.getTerrain(),
      players,
      playerId,
      terrainAssets.worldMap,
      visualSunElevation,
    );
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
