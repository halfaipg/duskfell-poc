import { defaultOrigin } from "./projection.js";
import { createCanvasFrame, drawLoading } from "./app-frame.js";
import { createRuntimeAssets } from "./app-assets.js";
import { createTerrainCache } from "./terrain-cache.js";
import { getAppDom } from "./app-dom.js";
import { computeCamera } from "./camera.js";
import { createEcologyRenderer } from "./ecology-renderer.js";
import { createInteriorRenderer } from "./interior-renderer.js";
import { createObjectDrawer } from "./object-draw.js";
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

const { canvas, screenCtx, ui } = getAppDom();
let ctx = screenCtx;
const params = new URLSearchParams(window.location.search);

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
      npcSpeech.noteAwaitingReply(payload.npcId);
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

window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) return;
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
    const npcAdapters = (Array.isArray(snapshot.npcs) ? snapshot.npcs : []).map(toNpcAdapter);
    const me = players.find((player) => player.id === playerId) || players[0];
    const origin = defaultOrigin(snapshot.map);
    // NPCs share the player render state so they get the same position
    // smoothing, walk animation sampling, and crowd spreading.
    playerRenderState.updateRenderOffsets([...players, ...npcAdapters], snapshot.map, playerId);
    playerRenderState.updateVisualPositions([...players, ...npcAdapters], now);
    localPlayerRenderPosition = me ? playerRenderState.renderPosition(me) : null;
    const cameraFocus = me ? { ...me, ...playerRenderState.renderPosition(me) } : me;
    const nextCamera = computeCamera({
      viewport: rect,
      map: snapshot.map,
      focus: cameraFocus,
      origin,
    });
    camera.scale = nextCamera.scale;
    camera.x = nextCamera.x;
    camera.y = nextCamera.y;

    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
    const objects = Array.isArray(snapshot.objects) ? snapshot.objects : [];
    terrainCache.terrainForMap(snapshot.map);
    terrainDrawer.drawMap(snapshot, origin, now, rect);
    ecologyRenderer.drawEcologyGroundEffects(objects, origin, now);
    ecologyRenderer.drawEcologyEnergyLinks(objects, origin, now);
    ecologyRenderer.drawEcologyFeedLinks(objects, origin, now);
    objectDrawer.drawSceneEntities(players, objects, origin, now, npcAdapters);
    interiorRenderer.drawInteriorRoofs(origin, localPlayerRenderPosition, now);
    ctx.restore();

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
  renderHud({ ui, snapshot, smoothedFps: frame.smoothedFps(), terrainDebugMode });
}

function updatePanel() {
  renderPanel({ ui, snapshot, playerId, sprites, playerSpriteFor: playerDrawer.playerSpriteFor });
}

function setConnection(text, className) {
  ui.connection.textContent = text;
  ui.connection.className = `connection ${className}`;
}
