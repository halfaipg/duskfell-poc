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
import { createChatUi } from "./chat-ui.js";
import { createNetworkClient } from "./network-client.js";
import { createNpcDrawer, toNpcAdapter } from "./npc-draw.js";
import { nearestNpc, npcPartyPrompt } from "./npc-interaction.js";
import { createNpcSpeech } from "./npc-speech.js";
import { renderHud, renderPanel } from "./ui-panels.js";
import { terrainHeightAtWorld } from "./terrain.js";

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
const npcSpeech = createNpcSpeech();
const npcDrawer = createNpcDrawer({
  getContext: () => ctx,
  getTerrain: () => terrainCache.getTerrain(),
  getLocalPlayerId: () => playerId,
  getBubbleFor: (npcId) => npcSpeech.bubbleFor(npcId),
  playerDrawer,
  playerRenderState,
});
const objectDrawer = createObjectDrawer({
  getContext: () => ctx,
  getTerrain: () => terrainCache.getTerrain(),
  getSprites: () => sprites,
  getTerrainDebugMode: () => terrainDebugMode,
  getLocalPlayerRenderPosition: () => localPlayerRenderPosition,
  playerDrawer,
  npcDrawer,
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
  onNpcSay: (frame) => {
    const completed = npcSpeech.handleFrame(frame);
    if (completed) {
      appendDialogueLine(completed.npcId, completed.completed);
    }
  },
  onNotice: (notice) => {
    appendSystemLine(notice.message, notice.level);
  },
  onServerStateChange: updatePanel,
});

const chatUi = createChatUi({
  input: ui.chatInput,
  send: (payload) => {
    networkClient.send(payload);
    if (payload.type === "say") {
      appendPlayerLine(payload.text);
      if (payload.npcId) {
        npcSpeech.noteAwaitingReply(payload.npcId);
      }
    }
  },
  onOpenStateChange: (open) => {
    if (open) {
      keys.clear();
      networkClient.sendInput(true);
    }
  },
});

function appendDialogueLine(npcId, text) {
  const npcs = Array.isArray(snapshot?.npcs) ? snapshot.npcs : [];
  const name = npcs.find((npc) => npc.id === npcId)?.name ?? npcId;
  const line = document.createElement("div");
  line.className = "dialogue-line";
  const speaker = document.createElement("strong");
  speaker.textContent = `${name}: `;
  line.append(speaker, document.createTextNode(text));
  appendToDialogueLog(line);
}

function appendPlayerLine(text) {
  const line = document.createElement("div");
  line.className = "dialogue-line dialogue-player";
  const speaker = document.createElement("strong");
  speaker.textContent = "You: ";
  line.append(speaker, document.createTextNode(text));
  appendToDialogueLog(line);
}

function appendSystemLine(text, level = "info") {
  const line = document.createElement("div");
  line.className = `dialogue-line dialogue-system dialogue-${level}`;
  line.textContent = text;
  appendToDialogueLog(line);
}

function appendToDialogueLog(line) {
  if (!ui.dialogueLog) return;
  if (ui.dialogueLog.dataset.hasLines !== "true") {
    ui.dialogueLog.textContent = "";
    ui.dialogueLog.dataset.hasLines = "true";
  }
  ui.dialogueLog.append(line);
  while (ui.dialogueLog.children.length > 30) {
    ui.dialogueLog.firstChild.remove();
  }
  ui.dialogueLog.scrollTop = ui.dialogueLog.scrollHeight;
}

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

window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) return;
  if (event.key === "Enter" && !event.repeat) {
    event.preventDefault();
    const npcs = Array.isArray(snapshot?.npcs) ? snapshot.npcs : [];
    chatUi.openChat(nearestNpc(npcs, localPlayerRenderPosition));
    return;
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "e", "E"].includes(event.key)) {
    event.preventDefault();
  }
  if ((event.key === "p" || event.key === "P") && !event.repeat) {
    sendPartyAction();
    return;
  }
  if ((event.key === "t" || event.key === "T") && !event.repeat) {
    const npcs = Array.isArray(snapshot?.npcs) ? snapshot.npcs : [];
    const npc = nearestNpc(npcs, localPlayerRenderPosition);
    if (npc) {
      event.preventDefault();
      chatUi.openChat(npc);
    }
    return;
  }
  keys.add(event.key);
  networkClient.sendInput();
});

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function sendPartyAction() {
  const npcs = Array.isArray(snapshot?.npcs) ? snapshot.npcs : [];
  const npc = nearestNpc(npcs, localPlayerRenderPosition);
  const prompt = npcPartyPrompt(npc, playerId);
  if (!prompt?.action) return;
  networkClient.send({
    type: prompt.action,
    npcId: prompt.npcId,
  });
}

window.addEventListener("keyup", (event) => {
  if (isTypingTarget(event.target)) return;
  keys.delete(event.key);
  networkClient.sendInput();
});

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
  moveTargetStalledSince = null;
  networkClient.sendInput();
});

function moveTargetInput() {
  if (!moveTarget || !snapshot) return null;
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
  return {
    up: dy < 0 && (diagonal || ay >= ax),
    down: dy > 0 && (diagonal || ay >= ax),
    left: dx < 0 && (diagonal || ax > ay),
    right: dx > 0 && (diagonal || ax > ay),
    interact: false,
  };
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

function draw(now = 0) {
  try {
    frame.updateFrameRate(now);
    const rect = fitCanvas();
    screenCtx.clearRect(0, 0, rect.width, rect.height);

    if (!snapshot || !runtimeAssets.assetsReady()) {
      drawLoading(ctx, rect, runtimeAssets.assetProgress());
      updateHud();
      requestAnimationFrame(draw);
      return;
    }

    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const npcAdapters = (Array.isArray(snapshot.npcs) ? snapshot.npcs : []).map(toNpcAdapter);
    const me = players.find((player) => player.id === playerId) || players[0];
    const origin = defaultOrigin(snapshot.map);
    // NPCs share the player render state so they get the same position
    // smoothing, walk animation sampling, and crowd spreading.
    playerRenderState.updateRenderOffsets([...players, ...npcAdapters], snapshot.map, playerId, now);
    playerRenderState.updateVisualPositions([...players, ...npcAdapters], now);
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
    objectDrawer.drawSceneEntities(players, objects, origin, now, npcAdapters);
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
    playerId,
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
