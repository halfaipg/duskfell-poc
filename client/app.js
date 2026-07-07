import {
  PROJECTION,
  defaultOrigin,
  projectWorld,
} from "./projection.js";
import { computeCamera } from "./camera.js";
import { coilMyceliumLinks, ecologyFeedLinks } from "./ecology-links.js";
import {
  PLAYER_MOVEMENT_EPSILON,
  PLAYER_WALK_STOP_GRACE_MS,
  directionFromWorldDelta,
  walkAnimationSample,
} from "./player-animation.js";
import { shouldUseRaisedTerrainArt } from "./terrain-rendering.js";
import { verifySha256Bytes } from "./asset-integrity.js";
import { parseServerMessage } from "./server-messages.js";
import { selectSpriteSheet } from "./sprite-assets.js";
import { normalizeTerrainAtlas, transitionMaskKey, transitionPairKey, transitionPairMaskKey } from "./terrain-assets.js";
import {
  TERRAIN_MATERIALS,
  buildTerrain,
  projectTerrainTile,
  terrainWalkabilityAtWorld,
  terrainFacets,
  terrainHeightAtWorld,
} from "./terrain.js";

const canvas = document.getElementById("world");
const screenCtx = canvas.getContext("2d");
let ctx = screenCtx;
const params = new URLSearchParams(window.location.search);

const ui = {
  connection: document.getElementById("connection"),
  hud: document.getElementById("hud"),
  nameInput: document.getElementById("nameInput"),
  renameButton: document.getElementById("renameButton"),
  deedStatus: document.getElementById("deedStatus"),
  resourceStatus: document.getElementById("resourceStatus"),
  chainMode: document.getElementById("chainMode"),
  pendingJobs: document.getElementById("pendingJobs"),
  confirmedJobs: document.getElementById("confirmedJobs"),
  latestReceipt: document.getElementById("latestReceipt"),
};

const keys = new Set();
let socket;
let playerId = null;
let snapshot = null;
let inputSeq = 0;
let lastInputSent = "";
const sprites = {
  player: null,
  players: [],
  props: null,
  items: null,
  details: null,
};
const terrainAssets = {
  atlas: null,
  image: null,
  patternSources: [],
  patternContexts: new WeakMap(),
};
const playerMotion = new Map();
const playerRenderOffsets = new Map();
const playerVariantIndexes = new Map();
let terrain = null;
let terrainCacheKey = "";
let terrainRenderCacheKey = "";
let terrainRenderCache = null;
let terrainAssetVersion = 0;
let canvasPixelWidth = 0;
let canvasPixelHeight = 0;
let lastFrameTime = 0;
let smoothedFps = 60;
let localPlayerRenderPosition = null;

const PLAYER_RENDER_SCALE = 0.66;
const PLAYER_DIRECTION_NAMES = ["south", "east", "north", "west"];
const PREFERRED_PLAYER_SHEET_ID = "duskfell-wayfarer";
const PREFERRED_PLAYER_SHEET_IDS = [
  "duskfell-wayfarer",
  "duskfell-ranger",
  "duskfell-warden",
  "duskfell-brigand",
];
const PLAYER_ARCHETYPE_LABELS = {
  "duskfell-wayfarer": "Wayfarer",
  "duskfell-ranger": "Ranger",
  "duskfell-warden": "Warden",
  "duskfell-brigand": "Brigand",
};
const GENERATED_WAYFARER_NAME_RE = /^Wayfarer-([0-9a-f]{4})$/i;
const PLAYER_CLUSTER_DISTANCE = 118;
const PLAYER_CLUSTER_SPREAD_RADIUS = 142;
const PLAYER_CLUSTER_RING_STEP = 66;
const PLAYER_CLUSTER_RING_SIZE = 8;
const PLAYER_RENDER_MARGIN = 24;
const FALLBACK_PLAYER_SHEET_ID = "player-placeholder";
const PREFERRED_PROP_SHEET_ID = "duskfell-props";
const FALLBACK_PROP_SHEET_ID = "props-placeholder";
const ITEM_SHEET_ID = "duskfell-items";
const DETAIL_SHEET_ID = "duskfell-details";
const ITEM_ICON_FRAMES = {
  wood: 0,
  ore: 1,
  stone: 1,
  charge: 3,
  deadwood: 0,
  fiber: 0,
  seed: 0,
  mycelium: 3,
  spores: 3,
  "trail-kit": 2,
  deed: 3,
};
const DETAIL_SPRITE_FRAMES = {
  rock: 0,
  pebble: 1,
  tuft: 2,
  flower: 3,
  scrub: 4,
  "fallen-log": 5,
  stump: 6,
  mushroom: 7,
  tree: {
    sapling: [8, 9, 10, 11],
    mature: [12, 13, 14, 15],
    ancient: [16, 17, 18, 19],
  },
  boulder: 20,
  reeds: 21,
  ruin: 22,
};
const DETAIL_SPRITE_SCALE = {
  rock: 1.28,
  pebble: 0.82,
  tuft: 0.9,
  flower: 0.84,
  scrub: 1.1,
  "fallen-log": 1.06,
  stump: 1,
  mushroom: 0.78,
  tree: 1.48,
  boulder: 1.42,
  reeds: 1.34,
  ruin: 1.46,
  wall: 1,
  stairs: 1,
  foundation: 1,
};
const TERRAIN_DEBUG_MODES = new Set([
  "authority",
  "biome",
  "chunks",
  "detail",
  "elevation",
  "kit",
  "material",
  "moisture",
  "path",
  "rock",
  "transition",
  "vegetation",
  "walkability",
  "zone",
]);
const terrainDebugMode = normalizeTerrainDebugMode(params.get("terrainDebug"));
const TERRAIN_STATIC_CHUNK_PADDING = 14;
const MAX_TERRAIN_STATIC_CHUNK_PIXELS = 1_200_000;

const camera = {
  x: 0,
  y: 0,
  scale: 1,
};

loadSpriteAssets();
loadTerrainAssets();
connect();
requestAnimationFrame(draw);

ui.renameButton.addEventListener("click", () => {
  send({
    type: "rename",
    name: ui.nameInput.value,
  });
});

window.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "e", "E"].includes(event.key)) {
    event.preventDefault();
  }
  keys.add(event.key);
  sendInput();
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key);
  sendInput();
});

window.addEventListener("resize", () => {
  fitCanvas();
});

async function connect() {
  setConnection("Connecting", "offline");
  const session = await issueSession();
  if (!session) {
    setConnection("Session failed", "offline");
    setTimeout(connect, 1400);
    return;
  }

  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = new URL(`${scheme}://${window.location.host}/ws`);
  wsUrl.searchParams.set("session", session.sessionToken);
  socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {
    setConnection("Online", "online");
    sendInput(true);
  });

  socket.addEventListener("close", () => {
    setConnection("Reconnecting", "offline");
    setTimeout(connect, 900);
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = parseServerMessage(event.data);
    } catch {
      return;
    }
    if (message.type === "welcome") {
      playerId = message.playerId;
      snapshot = message.snapshot;
    } else if (message.type === "snapshot") {
      snapshot = message;
    }
    updatePanel();
  });
}

async function issueSession() {
  try {
    const requestedName = ui.nameInput.value.trim();
    const body = requestedName ? { name: requestedName } : {};
    const response = await fetch("/api/session", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function sendInput(force = false) {
  const input = {
    type: "input",
    seq: ++inputSeq,
    up: keys.has("ArrowUp") || keys.has("w") || keys.has("W"),
    down: keys.has("ArrowDown") || keys.has("s") || keys.has("S"),
    left: keys.has("ArrowLeft") || keys.has("a") || keys.has("A"),
    right: keys.has("ArrowRight") || keys.has("d") || keys.has("D"),
    interact: keys.has("e") || keys.has("E") || keys.has(" "),
  };
  const comparable = JSON.stringify({ ...input, seq: 0 });
  if (!force && comparable === lastInputSent) return;
  lastInputSent = comparable;
  send(input);
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const nextWidth = Math.floor(rect.width * dpr);
  const nextHeight = Math.floor(rect.height * dpr);
  if (canvasPixelWidth !== nextWidth || canvasPixelHeight !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    canvasPixelWidth = nextWidth;
    canvasPixelHeight = nextHeight;
  }
  screenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw(now = 0) {
  try {
    updateFrameRate(now);
    fitCanvas();
    const rect = canvas.getBoundingClientRect();
    screenCtx.clearRect(0, 0, rect.width, rect.height);

    if (!snapshot) {
      drawLoading(rect);
      updateHud();
      requestAnimationFrame(draw);
      return;
    }

    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const me = players.find((player) => player.id === playerId) || players[0];
    const origin = defaultOrigin(snapshot.map);
    updatePlayerRenderOffsets(players, snapshot.map);
    localPlayerRenderPosition = me ? playerRenderPosition(me) : null;
    const nextCamera = computeCamera({
      viewport: rect,
      map: snapshot.map,
      focus: me,
      origin,
    });
    camera.scale = nextCamera.scale;
    camera.x = nextCamera.x;
    camera.y = nextCamera.y;

    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
    const objects = Array.isArray(snapshot.objects) ? snapshot.objects : [];
    drawMap(snapshot, origin, now, rect);
    drawEcologyEnergyLinks(objects, origin, now);
    drawEcologyFeedLinks(objects, origin, now);
    drawSceneEntities(players, objects, origin, now);
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

function updateFrameRate(now) {
  if (lastFrameTime > 0) {
    const delta = Math.max(1, now - lastFrameTime);
    const instantFps = 1000 / delta;
    smoothedFps = smoothedFps * 0.9 + instantFps * 0.1;
  }
  lastFrameTime = now;
}

function drawLoading(rect) {
  ctx.fillStyle = "#d9cfae";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#161a1d";
  ctx.font = "18px system-ui";
  ctx.fillText("Connecting to authoritative server...", 28, 42);
}

function drawMap(state, origin, now, viewport) {
  const worldTerrain = terrainForMap(state.map);
  const visibleBounds = visibleWorldBounds(viewport);
  const renderGeometry = terrainGeometryForMap(worldTerrain, origin);
  for (const chunk of renderGeometry.chunks) {
    if (!boundsIntersect(chunk.bounds, visibleBounds)) continue;
    if (drawTerrainStaticChunk(chunk)) {
      for (const tileView of chunk.tiles) {
        drawTerrainDynamicTile(tileView, state.tick, now, visibleBounds);
        drawTerrainDebugTile(tileView.tile, tileView.corners, terrainDebugMode);
      }
    } else {
      for (const tileView of chunk.tiles) {
        drawTerrainTile(tileView, state.tick, now, visibleBounds);
      }
    }
    drawTerrainDebugChunk(chunk, terrainDebugMode);
  }
}

function terrainGeometryForMap(worldTerrain, origin) {
  const key = `${terrainCacheKey}:${origin.x}:${origin.y}`;
  if (terrainRenderCacheKey === key && terrainRenderCache?.terrain === worldTerrain) {
    return terrainRenderCache;
  }

  const sourceChunks = Array.isArray(worldTerrain.chunks)
    ? worldTerrain.chunks
    : [{ x: 0, y: 0, cols: worldTerrain.cols, rows: worldTerrain.rows, tiles: worldTerrain.tiles }];
  const chunks = sourceChunks.map((chunk) => {
    let bounds = null;
    const tiles = chunk.tiles.map((tile) => {
      const corners = expandedTerrainCorners(projectTerrainTile(tile, origin), 0.78);
      const tileBounds = projectedTileBounds(corners, tile);
      bounds = mergeBounds(bounds, tileBounds);
      return {
        tile,
        corners,
        bounds: tileBounds,
      };
    });
    return {
      x: chunk.x,
      y: chunk.y,
      cols: chunk.cols,
      rows: chunk.rows,
      bounds: bounds ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      staticLayer: null,
      tiles,
    };
  });

  terrainRenderCacheKey = key;
  terrainRenderCache = {
    terrain: worldTerrain,
    chunks,
  };
  return terrainRenderCache;
}

function drawTerrainTile(tileView, tick, now, visibleBounds, options = {}) {
  const { drawDynamic = true, drawDebug = true } = options;
  const { tile, corners, bounds } = tileView;
  if (visibleBounds && !boundsIntersect(bounds, visibleBounds)) return;
  const palette = TERRAIN_MATERIALS[terrainUnderpaintMaterial(tile)];

  drawTerrainSideWalls(tile, corners, palette);

  ctx.beginPath();
  ctx.moveTo(corners.nw.x, corners.nw.y);
  ctx.lineTo(corners.ne.x, corners.ne.y);
  ctx.lineTo(corners.se.x, corners.se.y);
  ctx.lineTo(corners.sw.x, corners.sw.y);
  ctx.closePath();
  ctx.fillStyle = palette.fill;
  ctx.fill();
  drawTerrainUnderpaint(tile, corners);
  drawTerrainAtlasTile(tile, corners);
  drawTerrainFacetShade(tile, corners);
  drawTerrainHeightShade(tile, corners);
  drawTerrainReliefEdges(tile, corners);

  drawTerrainTransitions(tile, corners);
  if (drawDynamic) {
    drawTerrainDecals(tile, corners, tick, now);
  }

  if (palette.strokeDebug) {
    ctx.strokeStyle = palette.strokeDebug;
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(corners.nw.x, corners.nw.y);
    ctx.lineTo(corners.ne.x, corners.ne.y);
    ctx.lineTo(corners.se.x, corners.se.y);
    ctx.lineTo(corners.sw.x, corners.sw.y);
    ctx.closePath();
    ctx.stroke();
  }
  if (drawDebug) {
    drawTerrainDebugTile(tile, corners, terrainDebugMode);
  }
}

function drawTerrainDynamicTile(tileView, tick, now, visibleBounds) {
  const { tile, corners, bounds } = tileView;
  if (visibleBounds && !boundsIntersect(bounds, visibleBounds)) return;
  drawTerrainDecals(tile, corners, tick, now);
}

function drawTerrainStaticChunk(chunk) {
  const layer = terrainStaticLayerForChunk(chunk);
  if (!layer) return false;
  ctx.drawImage(layer.canvas, layer.x, layer.y, layer.width, layer.height);
  return true;
}

function terrainStaticLayerForChunk(chunk) {
  if (
    chunk.staticLayer?.assetVersion === terrainAssetVersion &&
    chunk.staticLayer?.terrainKey === terrainRenderCacheKey
  ) {
    return chunk.staticLayer;
  }

  const bounds = chunk.bounds;
  const x = Math.floor(bounds.minX - TERRAIN_STATIC_CHUNK_PADDING);
  const y = Math.floor(bounds.minY - TERRAIN_STATIC_CHUNK_PADDING);
  const width = Math.ceil(bounds.maxX - bounds.minX + TERRAIN_STATIC_CHUNK_PADDING * 2);
  const height = Math.ceil(bounds.maxY - bounds.minY + TERRAIN_STATIC_CHUNK_PADDING * 2);
  if (width <= 0 || height <= 0 || width * height > MAX_TERRAIN_STATIC_CHUNK_PIXELS) {
    chunk.staticLayer = null;
    return null;
  }

  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = width;
  layerCanvas.height = height;
  const layerContext = layerCanvas.getContext("2d");
  if (!layerContext) {
    chunk.staticLayer = null;
    return null;
  }

  withRenderContext(layerContext, () => {
    layerContext.clearRect(0, 0, width, height);
    layerContext.translate(-x, -y);
    for (const tileView of chunk.tiles) {
      drawTerrainTile(tileView, 0, 0, null, {
        drawDynamic: false,
        drawDebug: false,
      });
    }
  });

  chunk.staticLayer = {
    assetVersion: terrainAssetVersion,
    terrainKey: terrainRenderCacheKey,
    canvas: layerCanvas,
    x,
    y,
    width,
    height,
  };
  return chunk.staticLayer;
}

function withRenderContext(nextContext, drawFn) {
  const previousContext = ctx;
  ctx = nextContext;
  try {
    drawFn();
  } finally {
    ctx = previousContext;
  }
}

function normalizeTerrainDebugMode(value) {
  if (!value) return "";
  const normalized = String(value).trim().toLowerCase();
  return TERRAIN_DEBUG_MODES.has(normalized) ? normalized : "";
}

function drawTerrainDebugChunk(chunk, mode) {
  if (mode !== "chunks") return;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 244, 189, 0.72)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(
    chunk.bounds.minX,
    chunk.bounds.minY,
    chunk.bounds.maxX - chunk.bounds.minX,
    chunk.bounds.maxY - chunk.bounds.minY,
  );
  ctx.restore();
}

function drawTerrainDebugTile(tile, corners, mode) {
  if (!mode || mode === "chunks") return;
  const fill = terrainDebugFill(tile, mode);
  if (!fill) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.nw.x, corners.nw.y);
  ctx.lineTo(corners.ne.x, corners.ne.y);
  ctx.lineTo(corners.se.x, corners.se.y);
  ctx.lineTo(corners.sw.x, corners.sw.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "rgba(13, 17, 16, 0.18)";
  ctx.lineWidth = 0.45;
  ctx.stroke();
  ctx.restore();
}

function terrainDebugFill(tile, mode) {
  const biome = tile.biome ?? {};
  if (mode === "material") return materialDebugFill(tile.material);
  if (mode === "biome") {
    return `rgba(${Math.round((biome.rockiness ?? 0) * 255)}, ${Math.round((biome.vegetation ?? 0) * 220)}, ${Math.round((biome.moisture ?? 0) * 255)}, 0.42)`;
  }
  if (mode === "elevation") return debugRamp(biome.elevation ?? 0, 220, 238, 154);
  if (mode === "moisture") return debugRamp(biome.moisture ?? 0, 81, 173, 202);
  if (mode === "rock") return debugRamp(biome.rockiness ?? 0, 192, 190, 174);
  if (mode === "vegetation") return debugRamp(biome.vegetation ?? 0, 86, 175, 85);
  if (mode === "zone") return compositionDebugFill(tile.composition?.zone);
  if (mode === "kit") return compositionKitDebugFill(tile.composition?.kitRole, tile.composition?.kitKind);
  if (mode === "authority") return terrainAuthorityDebugFill(tile);
  if (mode === "path") return debugRamp(Math.max(biome.pathPressure ?? 0, biome.plazaPressure ?? 0), 231, 185, 108);
  if (mode === "detail") return debugRamp(biome.detailDensity ?? 0, 255, 215, 128);
  if (mode === "transition") return transitionDebugFill(tile);
  if (mode === "walkability") return walkabilityDebugFill(tile);
  return null;
}

function compositionDebugFill(zone) {
  const colors = {
    grove: "rgba(56, 140, 73, 0.46)",
    meadow: "rgba(117, 170, 83, 0.34)",
    plaza: "rgba(229, 206, 151, 0.48)",
    ridge: "rgba(172, 173, 161, 0.5)",
    road: "rgba(191, 132, 76, 0.48)",
    scrub: "rgba(156, 118, 77, 0.42)",
    shore: "rgba(120, 166, 143, 0.46)",
    water: "rgba(59, 144, 190, 0.5)",
  };
  return colors[zone] ?? null;
}

function compositionKitDebugFill(role, kind) {
  if (!kind || role === "none") return null;
  const colors = {
    causeway: "rgba(212, 210, 184, 0.62)",
    rubble: "rgba(153, 148, 128, 0.48)",
    "wall-north": "rgba(188, 181, 156, 0.58)",
    "wall-south": "rgba(150, 139, 115, 0.54)",
    "wall-west": "rgba(168, 160, 136, 0.52)",
    "wall-east": "rgba(168, 160, 136, 0.52)",
    stairs: "rgba(206, 196, 164, 0.56)",
    "courtyard-floor": "rgba(184, 176, 146, 0.42)",
    "courtyard-rubble": "rgba(129, 122, 103, 0.42)",
    plaza: "rgba(236, 210, 154, 0.46)",
    road: "rgba(202, 145, 84, 0.44)",
    threshold: "rgba(178, 151, 105, 0.34)",
    canopy: "rgba(57, 143, 74, 0.44)",
    understory: "rgba(70, 119, 64, 0.32)",
    reedline: "rgba(92, 152, 126, 0.46)",
    "wet-edge": "rgba(79, 134, 130, 0.32)",
  };
  return colors[role] ?? "rgba(214, 190, 132, 0.36)";
}

function terrainAuthorityDebugFill(tile) {
  const authority = terrain?.detailAuthority;
  if (!authority) return null;
  const tileMatches = (entry) => entry.tile?.x === tile.x && entry.tile?.y === tile.y;
  if (authority.blockers?.some(tileMatches)) return "rgba(218, 66, 56, 0.58)";
  if (authority.decayConsumers?.some(tileMatches)) return "rgba(161, 111, 211, 0.52)";
  if (authority.resourceNodes?.some(tileMatches)) return "rgba(75, 176, 95, 0.46)";
  return null;
}

function transitionDebugFill(tile) {
  const edgeCount = tile.transitions.filter((transition) => transition.type === "edge").length;
  const cornerCount = tile.transitions.filter((transition) => transition.type === "corner").length;
  if (edgeCount + cornerCount === 0) return null;
  const red = Math.min(255, 80 + edgeCount * 44);
  const blue = Math.min(255, 96 + cornerCount * 58);
  return `rgba(${red}, 176, ${blue}, ${Math.min(0.62, 0.18 + (edgeCount + cornerCount) * 0.1)})`;
}

function walkabilityDebugFill(tile) {
  if (!terrain) return null;
  const units = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
  const result = terrainWalkabilityAtWorld(terrain, (tile.x + 0.5) * units, (tile.y + 0.5) * units);
  if (result.reason === "water") return "rgba(53, 132, 190, 0.52)";
  if (result.reason === "blocked-detail") return "rgba(213, 70, 58, 0.56)";
  if (result.reason === "steep") return "rgba(225, 169, 67, 0.54)";
  if (result.walkable) return "rgba(73, 173, 93, 0.28)";
  return "rgba(191, 77, 118, 0.44)";
}

function materialDebugFill(material) {
  const colors = {
    dirt: "rgba(169, 105, 66, 0.42)",
    field: "rgba(185, 176, 96, 0.42)",
    grass: "rgba(78, 156, 74, 0.42)",
    settlement: "rgba(232, 218, 176, 0.46)",
    stone: "rgba(160, 166, 158, 0.46)",
    water: "rgba(64, 154, 199, 0.48)",
  };
  return colors[material] ?? "rgba(255, 255, 255, 0.25)";
}

function debugRamp(value, r, g, b) {
  const alpha = 0.08 + clamp(value, 0, 1) * 0.52;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function visibleWorldBounds(viewport) {
  const width = viewport?.width ?? canvas.clientWidth;
  const height = viewport?.height ?? canvas.clientHeight;
  const pad = 144;
  return {
    minX: camera.x - pad,
    maxX: camera.x + width / camera.scale + pad,
    minY: camera.y - pad,
    maxY: camera.y + height / camera.scale + pad,
  };
}

function projectedTileBounds(corners, tile) {
  const skirtDrop = Math.max(0, ...(tile.elevationEdges ?? []).map((edge) => edge.drop)) * PROJECTION.zPx;
  return {
    minX: Math.min(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x) - 4,
    maxX: Math.max(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x) + 4,
    minY: Math.min(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y) - 4,
    maxY: Math.max(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y) + skirtDrop + 4,
  };
}

function mergeBounds(first, second) {
  if (!first) return second;
  return {
    minX: Math.min(first.minX, second.minX),
    maxX: Math.max(first.maxX, second.maxX),
    minY: Math.min(first.minY, second.minY),
    maxY: Math.max(first.maxY, second.maxY),
  };
}

function boundsIntersect(a, b) {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

function terrainUnderpaintMaterial(tile) {
  if (tile.material === "dirt" || tile.material === "stone" || tile.material === "field") return "grass";
  return tile.material;
}

function drawTerrainSideWalls(tile, corners, palette) {
  if (!Array.isArray(tile.elevationEdges) || tile.elevationEdges.length === 0 || tile.material === "water") return;

  for (const edge of tile.elevationEdges) {
    const [from, to] = edgePoints(corners, edge.edge);
    const dropPx = Math.max(2, edge.drop * PROJECTION.zPx);
    const lowerFrom = { x: from.x, y: from.y + dropPx };
    const lowerTo = { x: to.x, y: to.y + dropPx };
    const gradient = ctx.createLinearGradient(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
      (lowerFrom.x + lowerTo.x) / 2,
      (lowerFrom.y + lowerTo.y) / 2,
    );
    const shadowAlpha = Math.min(0.52, 0.2 + edge.drop * 0.08);
    gradient.addColorStop(0, tintWithAlpha(palette.dark, shadowAlpha * 0.72));
    gradient.addColorStop(1, `rgba(8, 11, 10, ${shadowAlpha})`);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(lowerTo.x, lowerTo.y);
    ctx.lineTo(lowerFrom.x, lowerFrom.y);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = "rgba(242, 224, 166, 0.13)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
}

function drawTerrainFacetShade(tile, corners) {
  const facets = terrainFacets(tile);
  if (facets.length === 0 || tile.material === "water") return;

  for (const facet of facets) {
    const points = facet.corners.map((corner) => corners[corner]);
    const shadeAlpha = Math.abs(facet.shade) * facet.alpha;
    if (shadeAlpha <= 0.012) continue;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fillStyle =
      facet.shade >= 0
        ? `rgba(255, 239, 184, ${Math.min(0.22, shadeAlpha)})`
        : `rgba(12, 16, 14, ${Math.min(0.3, shadeAlpha * 1.2)})`;
    ctx.fill();
  }
}

function drawTerrainHeightShade(tile, corners) {
  if (!tile.sloped || tile.material === "water") return;
  const height = tile.height;
  const range = height?.range ?? Math.max(...Object.values(tile.heights)) - Math.min(...Object.values(tile.heights));
  if (range <= 0) return;

  const shade =
    height != null
      ? Math.max(-0.16, Math.min(0.18, (height.light - 0.58) * 0.52))
      : Math.max(
          -0.12,
          Math.min(
            0.18,
            (((tile.heights.sw + tile.heights.se) / 2 - (tile.heights.nw + tile.heights.ne) / 2) * 0.025) +
              (((tile.heights.ne + tile.heights.se) / 2 - (tile.heights.nw + tile.heights.sw) / 2) * 0.018),
          ),
        );
  const alpha = Math.min(0.2, 0.055 + range * 0.025);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.nw.x, corners.nw.y);
  ctx.lineTo(corners.ne.x, corners.ne.y);
  ctx.lineTo(corners.se.x, corners.se.y);
  ctx.lineTo(corners.sw.x, corners.sw.y);
  ctx.closePath();
  ctx.fillStyle = shade >= 0 ? `rgba(255, 238, 178, ${alpha * shade * 3})` : `rgba(13, 18, 16, ${alpha * Math.abs(shade) * 4})`;
  ctx.fill();
  ctx.restore();
}

function tintWithAlpha(hex, alpha) {
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  if (normalized.length !== 6) return `rgba(10, 12, 11, ${alpha})`;
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


function drawTerrainReliefEdges(tile, corners) {
  if (!Array.isArray(tile.elevationEdges) || tile.elevationEdges.length === 0) return;

  for (const edge of tile.elevationEdges) {
    const band = edgeBandPoints(corners, edge.edge, reliefBandDepth(edge.drop));
    const alpha = Math.min(0.26, 0.08 + edge.drop * 0.045);
    const [from, to] = edgePoints(corners, edge.edge);
    const center = bandCenter(band);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(band[0].x, band[0].y);
    for (const point of band.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.clip();

    const gradient = ctx.createLinearGradient(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
      center.x,
      center.y,
    );
    gradient.addColorStop(0, `rgba(11, 16, 13, ${alpha})`);
    gradient.addColorStop(0.72, `rgba(11, 16, 13, ${alpha * 0.34})`);
    gradient.addColorStop(1, "rgba(11, 16, 13, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(
      Math.min(...band.map((point) => point.x)) - 1,
      Math.min(...band.map((point) => point.y)) - 1,
      Math.max(...band.map((point) => point.x)) - Math.min(...band.map((point) => point.x)) + 2,
      Math.max(...band.map((point) => point.y)) - Math.min(...band.map((point) => point.y)) + 2,
    );
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = `rgba(244, 226, 164, ${Math.min(0.18, alpha * 0.82)})`;
    ctx.lineWidth = 1.05;
    ctx.stroke();
  }
}

function reliefBandDepth(drop) {
  return Math.min(0.42, 0.22 + drop * 0.065);
}

function bandCenter(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function expandedTerrainCorners(corners, pixels) {
  const center = {
    x: (corners.nw.x + corners.ne.x + corners.se.x + corners.sw.x) / 4,
    y: (corners.nw.y + corners.ne.y + corners.se.y + corners.sw.y) / 4,
  };
  return Object.fromEntries(
    Object.entries(corners).map(([name, point]) => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      return [
        name,
        {
          x: point.x + (dx / length) * pixels,
          y: point.y + (dy / length) * pixels,
        },
      ];
    }),
  );
}

function drawTerrainAtlasTile(tile, corners) {
  const atlasTile =
    shouldUseRaisedTerrainArt(tile)
      ? terrainAssets.atlas?.slopeByMaterial?.get(tile.material) ??
        terrainAssets.atlas?.byMaterial?.get(tile.material)
      : terrainAssets.atlas?.byMaterial?.get(tile.material);
  const image = terrainAssets.image;
  if (!atlasTile || !image?.complete || image.naturalWidth === 0) return false;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.nw.x, corners.nw.y);
  ctx.lineTo(corners.ne.x, corners.ne.y);
  ctx.lineTo(corners.se.x, corners.se.y);
  ctx.lineTo(corners.sw.x, corners.sw.y);
  ctx.closePath();
  ctx.clip();
  drawAtlasPatternFrame(atlasTile.frame, corners, terrainAtlasAlpha(tile));
  ctx.restore();
  return true;
}

function terrainAtlasAlpha(tile) {
  const hasMaterialEdge = tile.transitions.length > 0;
  if (tile.material === "dirt") return hasMaterialEdge ? 0.62 : 0.76;
  if (tile.material === "stone") return hasMaterialEdge ? 0.7 : 0.82;
  if (tile.material === "field") return hasMaterialEdge ? 0.58 : 0.7;
  return tile.sloped ? 0.82 : 0.88;
}

function drawTerrainUnderpaint(tile, corners) {
  if (tile.material === "grass" || tile.material === "water" || tile.material === "settlement") return;
  const atlasTile = terrainAssets.atlas?.byMaterial?.get("grass");
  const image = terrainAssets.image;
  if (!atlasTile || !image?.complete || image.naturalWidth === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.nw.x, corners.nw.y);
  ctx.lineTo(corners.ne.x, corners.ne.y);
  ctx.lineTo(corners.se.x, corners.se.y);
  ctx.lineTo(corners.sw.x, corners.sw.y);
  ctx.closePath();
  ctx.clip();
  drawAtlasPatternFrame(atlasTile.frame, corners, 0.74);
  ctx.restore();
}

function drawTerrainTransitions(tile, corners) {
  for (const transition of tile.transitions) {
    const drewAtlasTransition = drawTerrainTransitionAtlas(transition, corners);
    drawTransitionMaterialCues(transition, corners, drewAtlasTransition);
    const edgeStyle = transitionEdgeStyle(transition, drewAtlasTransition);
    if (edgeStyle.width <= 0 || edgeStyle.alpha <= 0) continue;
    const edge = transition.mask?.edge ?? transition.edge;
    const [from, to] = edgePoints(corners, edge);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = transitionStrokeColor(transition);
    ctx.lineWidth = edgeStyle.width;
    ctx.globalAlpha = edgeStyle.alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function transitionEdgeStyle(transition, drewAtlasTransition) {
  if (transition.mask?.type === "corner") {
    return {
      width: 0,
      alpha: 0,
    };
  }
  const family = transition.family ?? "soft";
  const styles = {
    path: { width: drewAtlasTransition ? 0.55 : 1.25, alpha: drewAtlasTransition ? 0.08 : 0.18 },
    plaza: { width: drewAtlasTransition ? 0.85 : 1.65, alpha: drewAtlasTransition ? 0.13 : 0.24 },
    rocky: { width: drewAtlasTransition ? 0.7 : 1.45, alpha: drewAtlasTransition ? 0.11 : 0.22 },
    shore: { width: drewAtlasTransition ? 0.8 : 1.9, alpha: drewAtlasTransition ? 0.14 : 0.28 },
    soft: { width: drewAtlasTransition ? 0 : 0.65, alpha: drewAtlasTransition ? 0 : 0.1 },
  };
  return styles[family] ?? styles.soft;
}

function drawTerrainTransitionAtlas(transition, corners) {
  const atlasTile = transitionAtlasTileFor(transition);
  const image = terrainAssets.image;
  if (!atlasTile || !image?.complete || image.naturalWidth === 0) return false;

  const band = transitionMaskPoints(transition, corners);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(band[0].x, band[0].y);
  for (const point of band.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.clip();
  drawAtlasFrame(atlasTile.frame, corners, transitionAtlasAlpha(transition));
  ctx.restore();
  return true;
}

function transitionAtlasAlpha(transition) {
  const family = transition.family ?? "soft";
  if (family === "shore") return 0.76;
  if (family === "plaza") return 0.68;
  if (family === "rocky") return 0.66;
  if (family === "path") return 0.62;
  return 0.54;
}

function transitionStrokeColor(transition) {
  const colors = {
    path: "rgba(82, 55, 36, 0.9)",
    plaza: "rgba(86, 80, 64, 0.9)",
    rocky: "rgba(48, 55, 52, 0.92)",
    shore: "rgba(191, 178, 120, 0.92)",
    soft: transition.color,
  };
  return colors[transition.family] ?? transition.color;
}

function drawTransitionMaterialCues(transition, corners, drewAtlasTransition) {
  if (transition.mask?.type === "corner") return;
  const family = transition.family ?? "soft";
  if (family === "soft") return;

  const edge = transition.mask?.edge ?? transition.edge;
  const [from, to] = edgePoints(corners, edge);
  const seed = transition.seed ?? stableStringHash(`${transition.pair}:${edge}`);
  const cueCount = { path: 3, plaza: 4, rocky: 4, shore: 5 }[family] ?? 0;
  if (cueCount <= 0) return;

  ctx.save();
  ctx.globalAlpha = drewAtlasTransition ? 0.34 : 0.42;
  for (let index = 0; index < cueCount; index += 1) {
    const t = (index + 1) / (cueCount + 1);
    const jitter = transitionHash01(seed, index) * 0.2 - 0.1;
    const x = from.x + (to.x - from.x) * clamp(t + jitter, 0.08, 0.92);
    const y = from.y + (to.y - from.y) * clamp(t - jitter * 0.5, 0.08, 0.92);
    drawTransitionCueChip(family, x, y, seed + index * 97);
  }
  ctx.restore();
}

function drawTransitionCueChip(family, x, y, seed) {
  const size = 1.8 + transitionHash01(seed, 13) * 2.2;
  if (family === "shore") {
    ctx.strokeStyle = "rgba(224, 216, 159, 0.82)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - size * 1.8, y + size * 0.4);
    ctx.lineTo(x + size * 1.6, y - size * 0.6);
    ctx.stroke();
    return;
  }
  if (family === "plaza") {
    ctx.fillStyle = "rgba(226, 211, 160, 0.74)";
    ctx.strokeStyle = "rgba(76, 70, 57, 0.64)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 1.6, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size * 1.6, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (family === "rocky") {
    ctx.fillStyle = "rgba(45, 50, 48, 0.74)";
    ctx.fillRect(Math.round(x - size), Math.round(y - size * 0.5), Math.max(1, Math.round(size * 2)), Math.max(1, Math.round(size)));
    return;
  }
  ctx.fillStyle = "rgba(95, 64, 40, 0.62)";
  ctx.beginPath();
  ctx.ellipse(x, y, size, size * 0.48, -0.25, 0, Math.PI * 2);
  ctx.fill();
}

function transitionHash01(seed, salt) {
  let value = Math.imul((seed + salt + 101) | 0, 1664525) + 1013904223;
  value = (value ^ (value >>> 16)) >>> 0;
  return value / 0xffffffff;
}

function transitionAtlasTileFor(transition) {
  const atlas = terrainAssets.atlas;
  if (!atlas) return null;
  const mask = transition.mask;
  if (transition.from && transition.to) {
    if (mask) {
      const maskedPair = atlas.pairTransitionByPairAndMask?.get(transitionPairMaskKey(transition.from, transition.to, mask));
      if (maskedPair) return maskedPair;
    }
    const pair = atlas.pairTransitionByPair?.get(transitionPairKey(transition.from, transition.to));
    if (pair) return pair;
  }
  if (mask) {
    const masked = atlas.transitionByMaterialAndMask?.get(transitionMaskKey(transition.to, mask));
    if (masked) return masked;
  }
  return atlas.transitionByMaterial?.get(transition.to) ?? null;
}

function transitionMaskPoints(transition, corners) {
  const mask = transition.mask;
  if (mask?.type === "corner") {
    return cornerBandPoints(corners, mask.corner, mask.depth ?? 0.32);
  }
  return edgeBandPoints(corners, mask?.edge ?? transition.edge, mask?.depth ?? 0.34);
}

function drawAtlasPatternFrame(frame, corners, alpha) {
  const pattern = terrainPatternForFrame(frame);
  if (!pattern) {
    drawAtlasFrame(frame, corners, alpha);
    return;
  }

  const minX = Math.min(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x);
  const maxX = Math.max(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x);
  const minY = Math.min(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y);
  const maxY = Math.max(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y);
  const bleed = 1.25;

  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(
    minX - bleed,
    minY - bleed,
    maxX - minX + bleed * 2,
    maxY - minY + bleed * 2,
  );
  ctx.globalAlpha = 1;
}

function terrainPatternForFrame(frame) {
  const source = terrainAssets.patternSources[frame];
  if (!source) return null;

  let contextPatterns = terrainAssets.patternContexts.get(ctx);
  if (!contextPatterns) {
    contextPatterns = [];
    terrainAssets.patternContexts.set(ctx, contextPatterns);
  }
  if (!contextPatterns[frame]) {
    contextPatterns[frame] = ctx.createPattern(source, "repeat");
  }
  return contextPatterns[frame];
}

function drawAtlasFrame(frame, corners, alpha) {
  const image = terrainAssets.image;
  const sheet = terrainAssets.atlas.tileSheet;
  const sx = (frame % sheet.columns) * sheet.cellWidth;
  const sy = Math.floor(frame / sheet.columns) * sheet.cellHeight;
  const minX = Math.min(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x);
  const maxX = Math.max(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x);
  const minY = Math.min(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y);
  const maxY = Math.max(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y);
  const bleed = 1.25;

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    image,
    sx,
    sy,
    sheet.cellWidth,
    sheet.cellHeight,
    minX - bleed,
    minY - bleed,
    maxX - minX + bleed * 2,
    maxY - minY + bleed * 2,
  );
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = previousSmoothing;
}

function drawTerrainDecals(tile, corners, tick, now) {
  if (tile.material === "water") {
    const shimmer = ((tile.x * 11 + tile.y * 7 + tick + now / 52) % 60) / 60;
    if (shimmer < 0.42) {
      const point = pointInTile(corners, 0.24 + shimmer * 0.58, 0.4);
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, 8, 1.8, -0.25, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(219, 242, 238, 0.22)";
      ctx.fill();
    }
    return;
  }

  for (const decal of tile.decals ?? []) {
    drawGroundDecal(tile, corners, decal);
  }
}

function drawGroundDecal(tile, corners, decal) {
  const point = pointInTile(corners, decal.u, decal.v);
  const size = Math.max(1.2, decal.size ?? 3);
  const zone = tile.composition?.zone;
  if (decal.kind === "crack") {
    ctx.save();
    ctx.strokeStyle = "rgba(35, 31, 27, 0.28)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(point.x - size * 1.5, point.y - size * 0.25);
    ctx.lineTo(point.x - size * 0.25, point.y + size * 0.15);
    ctx.lineTo(point.x + size * 0.85, point.y - size * 0.2);
    ctx.moveTo(point.x - size * 0.1, point.y + size * 0.1);
    ctx.lineTo(point.x + size * 0.28, point.y + size * 0.75);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (decal.kind === "moss") {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(((tile.x * 13 + tile.y * 19) % 11 - 5) * 0.06);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 1.45, size * 0.58, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(67, 104, 58, 0.25)";
    ctx.fill();
    ctx.restore();
    return;
  }
  if (decal.kind === "masonry-joint") {
    ctx.save();
    ctx.strokeStyle = "rgba(37, 35, 30, 0.22)";
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(point.x - size * 1.8, point.y);
    ctx.lineTo(point.x + size * 1.8, point.y);
    ctx.moveTo(point.x - size * 0.4, point.y - size * 0.9);
    ctx.lineTo(point.x - size * 0.4, point.y + size * 0.9);
    ctx.moveTo(point.x + size * 0.9, point.y - size * 0.75);
    ctx.lineTo(point.x + size * 0.9, point.y + size * 0.75);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (decal.kind === "pebble" || zone === "road" || zone === "ridge") {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(((tile.x * 17 + tile.y * 11) % 9 - 4) * 0.08);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 1.4, size * 0.62, 0, 0, Math.PI * 2);
    ctx.fillStyle = zone === "road" ? "rgba(71, 55, 42, 0.25)" : "rgba(62, 65, 58, 0.34)";
    ctx.fill();
    ctx.strokeStyle = "rgba(24, 27, 23, 0.16)";
    ctx.lineWidth = 0.45;
    ctx.stroke();
    ctx.restore();
    return;
  }

  const blades = decal.kind === "tuft" ? 4 : 3;
  ctx.save();
  ctx.strokeStyle = zone === "shore" ? "rgba(63, 104, 76, 0.34)" : "rgba(43, 83, 38, 0.3)";
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  for (let blade = 0; blade < blades; blade += 1) {
    const offset = (blade - (blades - 1) / 2) * size * 0.56;
    ctx.moveTo(point.x + offset, point.y + size * 0.65);
    ctx.lineTo(point.x + offset * 0.55, point.y - size * (0.65 + blade * 0.06));
  }
  ctx.stroke();
  ctx.restore();
}

function edgePoints(corners, edge) {
  switch (edge) {
    case "north":
      return [corners.nw, corners.ne];
    case "east":
      return [corners.ne, corners.se];
    case "south":
      return [corners.se, corners.sw];
    case "west":
      return [corners.sw, corners.nw];
    default:
      return [corners.nw, corners.ne];
  }
}

function edgeBandPoints(corners, edge, depth = 0.34) {
  const inset = 1 - depth;
  switch (edge) {
    case "north":
      return [corners.nw, corners.ne, pointInTile(corners, 0.78, depth), pointInTile(corners, 0.22, depth)];
    case "east":
      return [corners.ne, corners.se, pointInTile(corners, inset, 0.78), pointInTile(corners, inset, 0.22)];
    case "south":
      return [corners.se, corners.sw, pointInTile(corners, 0.22, inset), pointInTile(corners, 0.78, inset)];
    case "west":
      return [corners.sw, corners.nw, pointInTile(corners, depth, 0.22), pointInTile(corners, depth, 0.78)];
    default:
      return [corners.nw, corners.ne, pointInTile(corners, 0.78, depth), pointInTile(corners, 0.22, depth)];
  }
}

function cornerBandPoints(corners, corner, depth = 0.3) {
  const inset = Math.max(0.08, Math.min(0.48, depth));
  switch (corner) {
    case "northEast":
      return [corners.ne, pointInTile(corners, 1 - inset, 0), pointInTile(corners, 1, inset), pointInTile(corners, 1 - inset, inset)];
    case "southEast":
      return [corners.se, pointInTile(corners, 1, 1 - inset), pointInTile(corners, 1 - inset, 1), pointInTile(corners, 1 - inset, 1 - inset)];
    case "southWest":
      return [corners.sw, pointInTile(corners, inset, 1), pointInTile(corners, 0, 1 - inset), pointInTile(corners, inset, 1 - inset)];
    case "northWest":
      return [corners.nw, pointInTile(corners, 0, inset), pointInTile(corners, inset, 0), pointInTile(corners, inset, inset)];
    default:
      return [corners.nw, pointInTile(corners, 0, inset), pointInTile(corners, inset, 0), pointInTile(corners, inset, inset)];
  }
}

function pointInTile(corners, u, v) {
  return {
    x:
      corners.nw.x * (1 - u) * (1 - v) +
      corners.ne.x * u * (1 - v) +
      corners.se.x * u * v +
      corners.sw.x * (1 - u) * v,
    y:
      corners.nw.y * (1 - u) * (1 - v) +
      corners.ne.y * u * (1 - v) +
      corners.se.y * u * v +
      corners.sw.y * (1 - u) * v,
  };
}

function terrainForMap(map) {
  const terrainProfile = map.terrain;
  const key = [
    map.width,
    map.height,
    map.safeZoneRadius,
    terrainProfile?.profile,
    terrainProfile?.seed,
    terrainProfile?.unitsPerTile,
    terrainProfile?.tileWidth,
    terrainProfile?.tileHeight,
    terrainProfile?.heightScale,
    terrainProfile?.minElevation,
    terrainProfile?.maxElevation,
    terrainProfile?.waterLevel,
    terrainProfile?.maxWalkableStep,
    terrainProfile?.materials?.join(","),
  ].join(":");
  if (terrainCacheKey !== key) {
    terrain = buildTerrain(map);
    terrainCacheKey = key;
  }
  return terrain;
}

function drawSceneEntities(players, objects, origin, now) {
  const entities = [
    ...(terrain?.details ?? []).map((detail) => ({
      type: "terrain-detail",
      sort: terrainDetailSortKey(detail, origin),
      value: detail,
    })),
    ...objects.map((object) => ({
      type: "object",
      sort: objectRenderSortKey(object, origin),
      value: object,
    })),
    ...players.map((player) => ({
      type: "player",
      sort: playerRenderSortKey(player, origin),
      value: player,
    })),
  ].sort((a, b) => a.sort - b.sort);

  for (const entity of entities) {
    if (entity.type === "terrain-detail") {
      drawTerrainDetail(entity.value, origin);
    } else if (entity.type === "object") {
      drawObject(entity.value, origin, now);
    } else {
      drawPlayer(entity.value, origin, now);
    }
  }
}

function drawObjects(objects, origin) {
  for (const object of objects) {
    drawObject(object, origin, performance.now());
  }
}

function drawEcologyEnergyLinks(objects, origin, now) {
  const links = coilMyceliumLinks(objects);
  if (links.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const link of links) {
    drawEcologyEnergyLink(link, origin, now);
  }
  ctx.restore();
}

function drawEcologyEnergyLink(link, origin, now) {
  const source = ecologyObjectGroundPoint(link.source, origin);
  const target = ecologyObjectGroundPoint(link.target, origin);
  const hash = stableStringHash(`${link.source.id}:${link.target.id}:charge`);
  const pulse = Math.sin(now * 0.009 + hash * 0.013) * 0.5 + 0.5;
  const mid = {
    x: (source.x + target.x) / 2 + Math.sin(hash) * 8,
    y: (source.y + target.y) / 2 - 7 - pulse * 5,
  };
  const alpha = link.spent ? 0.1 + link.strength * 0.14 : 0.18 + link.strength * 0.42;

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = link.spent ? "rgba(74, 91, 93, 0.72)" : "rgba(95, 207, 223, 0.76)";
  ctx.lineWidth = link.spent ? 2.4 : 3.2 + pulse * 1.4;
  ctx.setLineDash(link.spent ? [9, 7] : [4, 6]);
  ctx.lineDashOffset = -now * (link.spent ? 0.006 : 0.025);
  ctx.beginPath();
  ctx.moveTo(source.x, source.y + 1);
  ctx.quadraticCurveTo(mid.x, mid.y, target.x, target.y + 3);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!link.spent) {
    ctx.globalAlpha = 0.18 + link.strength * 0.46;
    ctx.strokeStyle = "rgba(230, 251, 232, 0.86)";
    ctx.lineWidth = 1.1 + pulse * 0.9;
    ctx.beginPath();
    ctx.moveTo(source.x + 3, source.y - 2);
    ctx.lineTo(mid.x - 6 + pulse * 5, mid.y + 4);
    ctx.lineTo(mid.x + 8 - pulse * 4, mid.y - 2);
    ctx.lineTo(target.x - 2, target.y + 2);
    ctx.stroke();
  }

  const beadCount = link.spent ? 2 : 3 + Math.round(link.chargeFullness * 4);
  ctx.fillStyle = link.spent ? "rgba(113, 132, 137, 0.65)" : "rgba(215, 247, 232, 0.92)";
  ctx.globalAlpha = link.spent ? 0.22 : 0.38 + link.strength * 0.5;
  for (let bead = 0; bead < beadCount; bead += 1) {
    const t = (bead + 0.42 + pulse * 0.22) / beadCount;
    const point = quadraticPoint(source, mid, target, t);
    const radius = link.spent ? 1.3 : 1.8 + pulse * 0.7;
    ctx.beginPath();
    ctx.arc(point.x, point.y + 2, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEcologyFeedLinks(objects, origin, now) {
  const links = ecologyFeedLinks(objects);
  if (links.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const link of links) {
    drawEcologyFeedLink(link, origin, now);
  }
  ctx.restore();
}

function drawEcologyFeedLink(link, origin, now) {
  const source = ecologyObjectGroundPoint(link.source, origin);
  const target = ecologyObjectGroundPoint(link.target, origin);
  const pulse = Math.sin(now * 0.0038 + stableStringHash(`${link.source.id}:${link.target.id}`) * 0.017) * 0.5 + 0.5;
  const alpha = 0.08 + link.strength * 0.28 + link.hunger * 0.08;
  const mid = {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2 + 8 + Math.sin(now * 0.0017 + link.distance) * 3,
  };

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(69, 45, 39, 0.72)";
  ctx.lineWidth = 5 + link.strength * 3;
  ctx.beginPath();
  ctx.moveTo(source.x, source.y + 7);
  ctx.quadraticCurveTo(mid.x, mid.y + 5, target.x, target.y + 8);
  ctx.stroke();

  ctx.globalAlpha = 0.18 + link.strength * 0.46;
  ctx.strokeStyle = link.hunger > 0.05 ? "rgba(181, 135, 99, 0.82)" : "rgba(190, 166, 211, 0.68)";
  ctx.lineWidth = 1.25 + link.strength * 1.8;
  for (let strand = 0; strand < 3; strand += 1) {
    const offset = (strand - 1) * (4 + link.strength * 5);
    ctx.setLineDash(strand === 1 ? [7, 5] : [3, 6]);
    ctx.lineDashOffset = -now * (0.012 + strand * 0.004) - link.distance * 0.2;
    ctx.beginPath();
    ctx.moveTo(source.x - offset * 0.5, source.y + 4 + offset * 0.32);
    ctx.quadraticCurveTo(mid.x + offset, mid.y - offset * 0.2, target.x + offset * 0.45, target.y + 6 - offset * 0.26);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const beadCount = 2 + Math.round(link.strength * 4);
  ctx.globalAlpha = 0.28 + link.strength * 0.5;
  ctx.fillStyle = link.hunger > 0.05 ? "rgba(205, 166, 119, 0.9)" : "rgba(218, 199, 231, 0.82)";
  for (let bead = 0; bead < beadCount; bead += 1) {
    const t = (bead + 0.5 + pulse * 0.18) / beadCount;
    const point = quadraticPoint(source, mid, target, t);
    const radius = 1.4 + ((bead + Math.round(pulse * 3)) % 3) * 0.45 + link.strength * 0.7;
    ctx.beginPath();
    ctx.arc(point.x, point.y + 7, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function ecologyObjectGroundPoint(object, origin) {
  const z = terrainHeightAtWorld(terrain, object.x, object.y);
  return projectWorld(object.x, object.y, z, origin);
}

function quadraticPoint(a, b, c, t) {
  const inv = 1 - t;
  return {
    x: inv * inv * a.x + 2 * inv * t * b.x + t * t * c.x,
    y: inv * inv * a.y + 2 * inv * t * b.y + t * t * c.y,
  };
}

function objectRenderSortKey(object, origin) {
  const objectZ = terrainHeightAtWorld(terrain, object.x, object.y);
  return projectWorld(object.x, object.y, objectZ, origin).y - 8;
}

function drawObject(object, origin, now = 0) {
  const objectZ = terrainHeightAtWorld(terrain, object.x, object.y);
  const point = projectWorld(object.x, object.y, objectZ, origin);
  const colors = objectColors(object.kind);
  const footprint = Math.max(0.65, object.radius / PROJECTION.unitsPerTile);

  if (drawObjectSprite(object, point, now)) {
    drawWorldObjectExtras(object, point);
    if (objectShouldShowLabel(object)) {
      drawObjectLabel(object, point, footprint);
    }
    return;
  }

  drawFootprint(point, footprint, colors.fill, colors.stroke);
  if (objectShouldShowLabel(object)) {
    drawObjectLabel(object, point, footprint);
  }

  ctx.beginPath();
  ctx.arc(point.x, point.y + PROJECTION.halfH * footprint, 10 + 6 * footprint, 0, Math.PI * 2);
  ctx.fillStyle = colors.stroke;
  ctx.fill();

  if (object.kind === "registrar") {
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(point.x - 28, point.y - 42, 56, 48);
    ctx.fillStyle = "#b04d36";
    ctx.fillRect(point.x - 34, point.y - 54, 68, 14);
    ctx.fillStyle = "#2f7565";
    ctx.fillRect(point.x - 7, point.y - 20, 14, 26);
  } else if (object.kind === "forge") {
    ctx.fillStyle = "#4b4f53";
    ctx.fillRect(point.x - 26, point.y - 28, 52, 34);
    ctx.fillStyle = "#d98b45";
    ctx.fillRect(point.x - 16, point.y - 18, 32, 12);
    ctx.strokeStyle = "#1d2224";
    ctx.lineWidth = 4;
    ctx.strokeRect(point.x - 26, point.y - 28, 52, 34);
  }

  drawWorldObjectExtras(object, point);
}

function drawObjectLabel(object, point, footprint) {
  ctx.fillStyle = "#161a1d";
  ctx.font = "700 18px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(object.label, point.x, point.y + PROJECTION.tileH * footprint + 28);
}

function objectShouldShowLabel(object) {
  return !["saplingTree", "deadwood", "myceliumPatch", "ruin"].includes(object.kind);
}

function drawObjectSprite(object, point, now = 0) {
  if (object.kind === "fieldCoil") return drawFieldCoilObject(object, point, now);
  if (drawEcologyObjectSprite(object, point)) return true;

  const sprite = sprites.props;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;
  const frameOffset = objectSpriteFrame(object.kind);
  if (frameOffset == null || frameOffset >= sprite.frameCount) return false;

  return drawPropFrame(frameOffset, point, sprite.render?.scale ?? 1);
}

function drawEcologyObjectSprite(object, point) {
  const sprite = sprites.details;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;
  const frame = ecologyObjectFrame(object);
  if (frame == null || frame >= sprite.frameCount) return false;

  const scale = (sprite.render?.scale ?? 1) * ecologyObjectScale(object);
  const sx = (sprite.startFrame + frame) * sprite.cellWidth;
  const dx = Math.round(point.x - sprite.anchor.x * scale);
  const dy = Math.round(point.y - sprite.anchor.y * scale);
  const dw = Math.round(sprite.cellWidth * scale);
  const dh = Math.round(sprite.cellHeight * scale);

  const shadow = sprite.render?.shadow;
  if (shadow?.kind === "ellipse") {
    drawDetailShadow(
      {
        x: point.x + (shadow.x - sprite.anchor.x) * scale,
        y: point.y + (shadow.y - sprite.anchor.y) * scale,
      },
      (shadow.width * scale) / 2,
      (shadow.height * scale) / 2,
      shadow.opacity,
    );
  }

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite.image,
    sx,
    0,
    sprite.cellWidth,
    sprite.cellHeight,
    dx,
    dy,
    dw,
    dh,
  );
  ctx.imageSmoothingEnabled = previousSmoothing;
  drawEcologyLifecycleCues(object, point, scale);
  return true;
}

function ecologyObjectFrame(object) {
  if (object.kind === "saplingTree") {
    return treeDetailFrame(object.lifecycle?.stage ?? "sapling", ecologyVariant(object, 4));
  }
  if (object.kind === "deadwood") return 5;
  if (object.kind === "myceliumPatch") return 7;
  if (object.kind === "ruin") return DETAIL_SPRITE_FRAMES.ruin;
  return null;
}

function ecologyObjectScale(object) {
  const growth = object.lifecycle?.growth ?? 1;
  const health = object.lifecycle?.health ?? 1;
  if (object.kind === "saplingTree") {
    const stageScale = object.lifecycle?.stage === "ancient" ? 1.16 : object.lifecycle?.stage === "mature" ? 1.04 : 0.9;
    return stageScale + growth * 0.16 + health * 0.06;
  }
  if (object.kind === "deadwood") return 0.76 + Math.min(0.2, (object.lifecycle?.decay ?? 0) * 0.24);
  if (object.kind === "myceliumPatch") return 0.66 + growth * 0.2;
  if (object.kind === "ruin") return 1.1 + Math.min(0.18, (object.lifecycle?.decay ?? 0) * 0.2);
  return 1;
}

function ecologyVariant(object, count) {
  const speciesIndex = {
    greenwood: 0,
    shadebark: 1,
    ironleaf: 2,
    paleoak: 3,
  }[object.lifecycle?.species];
  if (speciesIndex != null) return speciesIndex % count;
  const age = object.lifecycle?.ageYears ?? 0;
  return Math.abs((stableStringHash(object.id) + age) % count);
}

function stableStringHash(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function drawEcologyLifecycleCues(object, point, scale) {
  const lifecycle = object.lifecycle;
  if (!lifecycle) return;

  if (object.kind === "saplingTree") {
    drawTreeBaseResourceCues(point, scale, lifecycle, object.resources ?? []);
    return;
  }
  if (object.kind === "deadwood") {
    drawDeadwoodDecayCues(point, scale, lifecycle);
    return;
  }
  if (object.kind === "myceliumPatch") {
    drawMyceliumGrowthCues(point, scale, lifecycle);
    return;
  }
  if (object.kind === "ruin") {
    drawStoneRuinDecayCues(point, scale, lifecycle);
  }
}

function drawTreeBaseResourceCues(point, scale, lifecycle, resources = []) {
  const health = lifecycle.health ?? 1;
  const resourceList = Array.isArray(resources) ? resources : [resources].filter(Boolean);
  const wood = resourceList.find((resource) => resource.kind === "wood");
  const seeds = resourceList.find((resource) => resource.kind === "seed");
  const fullness = wood?.maxAmount ? clamp(wood.amount / wood.maxAmount, 0, 1) : lifecycle.growth ?? 0.6;
  const seedCount = Math.min(2, seeds?.amount ?? 0);

  ctx.save();
  ctx.globalAlpha = 0.12 + health * 0.16;
  ctx.strokeStyle = health > 0.55 ? "#d4c36f" : "#9b8062";
  ctx.lineWidth = Math.max(1, scale * 0.75);
  ctx.beginPath();
  ctx.arc(point.x, point.y + 4 * scale, (6 + fullness * 5) * scale, 0.12 * Math.PI, 0.88 * Math.PI);
  ctx.stroke();

  ctx.globalAlpha = 0.38 + health * 0.18;
  ctx.fillStyle = health > 0.48 ? "#8d9454" : "#7d6145";
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 8 * scale, (2.2 + fullness * 2) * scale, 1.4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.68;
  ctx.fillStyle = "#c5b45c";
  for (let index = 0; index < seedCount; index += 1) {
    ctx.beginPath();
    ctx.ellipse(point.x + 7 * scale + index * 4 * scale, point.y + 8 * scale, 1.4 * scale, 1.9 * scale, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDeadwoodDecayCues(point, scale, lifecycle) {
  const decay = lifecycle.decay ?? 0;
  ctx.save();
  ctx.strokeStyle = `rgba(35, 24, 18, ${0.35 + decay * 0.35})`;
  ctx.lineWidth = Math.max(1, scale * 1.1);
  for (let index = 0; index < 3; index += 1) {
    ctx.beginPath();
    ctx.moveTo(point.x - 15 * scale + index * 10 * scale, point.y - 3 * scale);
    ctx.lineTo(point.x - 9 * scale + index * 8 * scale, point.y + 5 * scale);
    ctx.stroke();
  }
  if (decay > 0.55) {
    ctx.fillStyle = "rgba(176, 150, 203, 0.78)";
    for (let index = 0; index < 4; index += 1) {
      ctx.beginPath();
      ctx.arc(point.x - 13 * scale + index * 8 * scale, point.y + 9 * scale - (index % 2) * 4 * scale, 2.2 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawMyceliumGrowthCues(point, scale, lifecycle) {
  const growth = lifecycle.growth ?? 0;
  const health = lifecycle.health ?? growth;
  const hungry = growth < 0.95;
  const tendrils = Math.max(3, Math.round(3 + growth * 5));
  ctx.save();
  ctx.strokeStyle = hungry
    ? `rgba(174, 132, 92, ${0.22 + (1 - growth) * 0.22})`
    : `rgba(196, 175, 218, ${0.3 + health * 0.26})`;
  ctx.lineWidth = Math.max(1, scale * 0.9);
  for (let index = 0; index < tendrils; index += 1) {
    const angle = (Math.PI * 2 * index) / tendrils + 0.35;
    const length = (10 + growth * 14 + (index % 2) * 5) * scale;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + 3 * scale);
    ctx.quadraticCurveTo(
      point.x + Math.cos(angle + 0.5) * length * 0.45,
      point.y + Math.sin(angle + 0.5) * length * 0.26,
      point.x + Math.cos(angle) * length,
      point.y + Math.sin(angle) * length * 0.42,
    );
    ctx.stroke();
  }
  ctx.fillStyle = hungry ? "rgba(176, 139, 101, 0.62)" : "rgba(218, 201, 232, 0.78)";
  ctx.beginPath();
  ctx.arc(point.x + 11 * scale, point.y + 7 * scale, (2 + health * 2) * scale, 0, Math.PI * 2);
  ctx.fill();
  if (hungry) {
    ctx.strokeStyle = "rgba(96, 65, 43, 0.42)";
    ctx.beginPath();
    ctx.moveTo(point.x - 15 * scale, point.y + 10 * scale);
    ctx.lineTo(point.x - 5 * scale, point.y + 5 * scale);
    ctx.lineTo(point.x + 4 * scale, point.y + 11 * scale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStoneRuinDecayCues(point, scale, lifecycle) {
  const decay = lifecycle.decay ?? 0;
  const age = lifecycle.ageYears ?? 0;
  const moss = Math.min(1, decay * 0.75 + Math.min(age / 120000, 1) * 0.25);
  ctx.save();
  ctx.globalAlpha = 0.16 + decay * 0.22;
  ctx.strokeStyle = "rgba(46, 40, 34, 0.72)";
  ctx.lineWidth = Math.max(1, scale * 0.7);
  ctx.beginPath();
  ctx.moveTo(point.x - 19 * scale, point.y - 21 * scale);
  ctx.lineTo(point.x - 6 * scale, point.y - 11 * scale);
  ctx.lineTo(point.x - 13 * scale, point.y + 2 * scale);
  ctx.moveTo(point.x + 15 * scale, point.y - 17 * scale);
  ctx.lineTo(point.x + 5 * scale, point.y - 6 * scale);
  ctx.lineTo(point.x + 18 * scale, point.y + 4 * scale);
  ctx.stroke();

  ctx.globalAlpha = 0.2 + moss * 0.38;
  ctx.fillStyle = "rgba(91, 126, 67, 0.82)";
  for (let patch = 0; patch < 4; patch += 1) {
    const offset = patch - 1.5;
    ctx.beginPath();
    ctx.ellipse(
      point.x + offset * 9 * scale,
      point.y + (10 + (patch % 2) * 4) * scale,
      (2.5 + moss * 2) * scale,
      (1.2 + moss) * scale,
      -0.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawFieldCoilObject(object, point, now) {
  const fullness = object.resources?.[0]?.maxAmount
    ? Math.max(0, Math.min(1, object.resources[0].amount / object.resources[0].maxAmount))
    : 0.55;
  const health = object.lifecycle?.health ?? fullness;
  const flicker = Math.sin(now * 0.018 + object.x * 0.01) * 0.5 + 0.5;

  ctx.save();
  drawDetailShadow(point, 25, 8, 0.28);

  ctx.fillStyle = "#4a3a2e";
  ctx.fillRect(point.x - 18, point.y - 10, 36, 16);
  ctx.fillStyle = "#8b5b34";
  ctx.fillRect(point.x - 14, point.y - 16, 28, 8);
  ctx.strokeStyle = "#211c18";
  ctx.lineWidth = 2;
  ctx.strokeRect(point.x - 18.5, point.y - 10.5, 37, 17);

  ctx.strokeStyle = "#343b3c";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - 12);
  ctx.lineTo(point.x, point.y - 54);
  ctx.stroke();

  ctx.strokeStyle = "#b46b36";
  ctx.lineWidth = 2;
  for (let ring = 0; ring < 6; ring += 1) {
    const y = point.y - 18 - ring * 5;
    ctx.beginPath();
    ctx.ellipse(point.x, y, 10, 3.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = `rgba(142, 231, 238, ${0.18 + health * 0.5})`;
  ctx.lineWidth = 1.5;
  for (let arc = 0; arc < 3; arc += 1) {
    const side = arc % 2 === 0 ? -1 : 1;
    const height = point.y - 51 + arc * 9;
    ctx.beginPath();
    ctx.moveTo(point.x + side * 6, height);
    ctx.lineTo(point.x + side * (15 + flicker * 5), height - 6);
    ctx.lineTo(point.x + side * (8 + arc * 3), height - 10);
    ctx.stroke();
  }

  ctx.fillStyle = `rgba(229, 247, 221, ${0.22 + health * 0.58})`;
  ctx.beginPath();
  ctx.arc(point.x, point.y - 56, 3 + flicker * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return true;
}

function drawPropFrame(frameOffset, point, scale) {
  const sprite = sprites.props;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;
  if (frameOffset == null || frameOffset >= sprite.frameCount) return false;

  const sx = (sprite.startFrame + frameOffset) * sprite.cellWidth;
  const dx = Math.round(point.x - sprite.anchor.x * scale);
  const dy = Math.round(point.y - sprite.anchor.y * scale);
  const dw = Math.round(sprite.cellWidth * scale);
  const dh = Math.round(sprite.cellHeight * scale);
  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite.image,
    sx,
    0,
    sprite.cellWidth,
    sprite.cellHeight,
    dx,
    dy,
    dw,
    dh,
  );
  ctx.imageSmoothingEnabled = previousSmoothing;
  return true;
}

function drawWorldObjectExtras(object, point) {
  if (object.kind === "forge") {
    drawWorldItemIcon("ore", point.x - 42, point.y + 34, 0.48);
    drawWorldItemIcon("wood", point.x - 14, point.y + 42, 0.46);
    drawWorldItemIcon("trail-kit", point.x + 18, point.y + 38, 0.5);
    drawWorldItemIcon("deed", point.x + 48, point.y + 29, 0.44);
    return;
  }
  if (object.kind === "grove") {
    drawWorldItemIcon("wood", point.x + 34, point.y + 42, 0.45);
    drawObjectResourceMeter(object, point);
    return;
  }
  if (object.kind === "ore") {
    drawWorldItemIcon("ore", point.x + 26, point.y + 34, 0.45);
    drawObjectResourceMeter(object, point);
    return;
  }
  if (object.kind === "fieldCoil") {
    drawWorldItemIcon("charge", point.x + 28, point.y + 36, 0.4);
    drawObjectResourceMeter(object, point);
    return;
  }
  if (object.kind === "shrine") {
    drawWorldItemIcon("deed", point.x + 30, point.y + 32, 0.42);
  }
  if (object.kind === "ruin") {
    drawWorldItemIcon("stone", point.x + 28, point.y + 38, 0.38);
  }
  drawObjectResourceMeter(object, point);
}

function drawObjectResourceMeter(object, point) {
  const resource = object.resources?.[0];
  if (!resource || resource.maxAmount <= 0) return;

  const fullness = Math.max(0, Math.min(1, resource.amount / resource.maxAmount));
  const width = 36;
  const height = 5;
  const x = Math.round(point.x - width / 2);
  const y = Math.round(point.y + 54);
  const color = resourceMeterColor(resource.kind, object.lifecycle);

  ctx.save();
  ctx.fillStyle = "rgba(12, 15, 13, 0.48)";
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.round(width * fullness), height);
  ctx.strokeStyle = "rgba(246, 239, 217, 0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  const icon = resource.kind === "mycelium" || resource.kind === "spores" ? "deed" : resource.kind;
  drawWorldItemIcon(icon, point.x + 24, point.y + 55, 0.28);
  ctx.restore();
}

function resourceMeterColor(kind, lifecycle) {
  if (kind === "ore") return "#a8aaa0";
  if (kind === "stone") return lifecycle?.stage === "ancient-ruin" ? "#9d967f" : "#b8b3a0";
  if (kind === "charge") return lifecycle?.stage === "spent" ? "#718489" : "#8ee7ee";
  if (kind === "mycelium" || kind === "spores") return lifecycle?.stage === "dormant" ? "#8f82b8" : "#c3a7d6";
  if (kind === "fiber" || kind === "seed") return "#9fb36b";
  if (kind === "deadwood") return "#8f6b49";
  return lifecycle?.stage === "cut" ? "#a3764e" : "#6d9254";
}

function drawWorldItemIcon(itemId, x, y, scale) {
  const frame = ITEM_ICON_FRAMES[itemId];
  const sprite = sprites.items;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + 9 * scale, 19 * scale, 7 * scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(10, 13, 12, 0.24)";
  ctx.fill();

  if (sprite?.image?.complete && frame != null && frame < sprite.frameCount) {
    const sourceFrame = (sprite.startFrame ?? 0) + frame;
    const size = Math.round(sprite.cellWidth * scale);
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sprite.image,
      (sourceFrame % sprite.columns) * sprite.cellWidth,
      Math.floor(sourceFrame / sprite.columns) * sprite.cellHeight,
      sprite.cellWidth,
      sprite.cellHeight,
      Math.round(x - size / 2),
      Math.round(y - size + 7),
      size,
      size,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;
  } else {
    ctx.fillStyle = "#d5c18a";
    ctx.fillRect(x - 8 * scale, y - 14 * scale, 16 * scale, 16 * scale);
    ctx.strokeStyle = "#2a302f";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 8 * scale, y - 14 * scale, 16 * scale, 16 * scale);
  }

  ctx.restore();
}

function terrainDetailSortKey(detail, origin) {
  return projectWorld(detail.x, detail.y, detail.z, origin).y + (detail.sortBias ?? -4);
}

function drawTerrainDetail(detail, origin) {
  const point = projectWorld(detail.x, detail.y, detail.z, origin);
  const alpha = terrainDetailOcclusionAlpha(detail, localPlayerRenderPosition);
  if (alpha < 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
  }
  let drawn = false;
  if (drawTerrainDetailSprite(detail, point)) {
    drawn = true;
  } else if ((detail.kind === "rock" || detail.kind === "boulder") && drawTerrainRockDetail(detail, point)) {
    drawn = true;
  } else if (detail.kind === "tree") {
    drawTerrainTreeDetail(detail, point);
    drawn = true;
  } else if (detail.kind === "ruin") {
    drawTerrainRuinDetail(detail, point);
    drawn = true;
  } else if (detail.kind === "wall") {
    drawTerrainWallDetail(detail, point);
    drawn = true;
  } else if (detail.kind === "stairs") {
    drawTerrainStairsDetail(detail, point);
    drawn = true;
  } else if (detail.kind === "foundation") {
    drawTerrainFoundationDetail(detail, point);
    drawn = true;
  } else if (detail.kind === "reeds") {
    drawTerrainReedsDetail(detail, point);
    drawn = true;
  }
  if (!drawn) drawProceduralGroundDetail(detail, point);
  if (alpha < 1) ctx.restore();
}

function terrainDetailOcclusionAlpha(detail, playerPosition) {
  const occlusion = detail.occlusion;
  if (!occlusion || !playerPosition) return 1;
  const radius = (occlusion.radiusTiles ?? 0.5) * PROJECTION.unitsPerTile;
  const dy = playerPosition.y - detail.y;
  const dx = Math.abs(playerPosition.x - detail.x);
  const behindBand = radius * (1 + (occlusion.heightTiles ?? 0.4) * 0.55);
  if (dy < -radius * 0.25 || dy > behindBand || dx > radius * 0.95) return 1;
  const closeness = clamp(1 - Math.hypot(dx * 0.9, dy * 0.7) / Math.max(1, behindBand), 0, 1);
  const fade = occlusion.fadeAlpha ?? 0.56;
  return 1 - (1 - fade) * closeness;
}

function drawTerrainDetailSprite(detail, point) {
  const sprite = sprites.details;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;
  const frame = detailSpriteFrame(detail);
  if (frame == null || frame >= sprite.frameCount) return false;

  const scale =
    (sprite.render?.scale ?? 1) *
    detail.scale *
    (DETAIL_SPRITE_SCALE[detail.kind] ?? 1);
  const sx = (sprite.startFrame + frame) * sprite.cellWidth;
  const dx = Math.round(point.x - sprite.anchor.x * scale);
  const dy = Math.round(point.y - sprite.anchor.y * scale);
  const dw = Math.round(sprite.cellWidth * scale);
  const dh = Math.round(sprite.cellHeight * scale);

  const shadow = sprite.render?.shadow;
  if (shadow?.kind === "ellipse") {
    drawDetailShadow(
      {
        x: point.x + (shadow.x - sprite.anchor.x) * scale,
        y: point.y + (shadow.y - sprite.anchor.y) * scale,
      },
      (shadow.width * scale) / 2,
      (shadow.height * scale) / 2,
      shadow.opacity,
    );
  }

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite.image,
    sx,
    0,
    sprite.cellWidth,
    sprite.cellHeight,
    dx,
    dy,
    dw,
    dh,
  );
  ctx.imageSmoothingEnabled = previousSmoothing;
  drawTerrainDetailLifecycleCues(detail, point, scale);
  return true;
}

function detailSpriteFrame(detail) {
  const frame = DETAIL_SPRITE_FRAMES[detail.kind];
  if (detail.kind === "tree") return treeDetailFrame(detail.stage, detail.variant);
  if (frame == null || typeof frame === "number") return frame;
  const stageFrame = frame[detail.stage] ?? frame.mature ?? null;
  if (Array.isArray(stageFrame)) {
    return stageFrame[Math.abs(detail.variant ?? 0) % stageFrame.length] ?? stageFrame[0] ?? null;
  }
  return stageFrame;
}

function treeDetailFrame(stage, variant) {
  const treeFrames = DETAIL_SPRITE_FRAMES.tree;
  const stageFrame = treeFrames?.[stage] ?? treeFrames?.mature ?? null;
  if (!Array.isArray(stageFrame)) return null;
  return stageFrame[Math.abs(variant ?? 0) % stageFrame.length] ?? stageFrame[0] ?? null;
}

function drawTerrainDetailLifecycleCues(detail, point, scale) {
  if (detail.kind === "tree") {
    drawTerrainDetailTreeCues(detail, point, scale);
    return;
  }
  if (detail.kind === "fallen-log" || detail.kind === "stump") {
    drawDeadwoodDecayCues(point, Math.max(0.48, scale * 0.76), detail.lifecycle ?? {});
    return;
  }
  if (detail.kind === "mushroom") {
    drawMyceliumGrowthCues(point, Math.max(0.42, scale * 0.7), detail.lifecycle ?? {});
  }
}

function drawTerrainDetailTreeCues(detail, point, scale) {
  const lifecycle = detail.lifecycle ?? {};
  const wood = detail.resources?.find((resource) => resource.kind === "wood");
  const hasSeed = detail.resources?.some((resource) => resource.kind === "seed" && resource.amount > 0);
  const fullness = wood?.maxAmount ? clamp(wood.amount / wood.maxAmount, 0, 1) : 0.45;
  const health = clamp(lifecycle.health ?? detail.health ?? 1, 0, 1);
  const decay = clamp(lifecycle.decay ?? 0, 0, 1);
  const cueScale = Math.max(0.48, scale * 0.46);

  ctx.save();
  ctx.globalAlpha = 0.1 + health * 0.15;
  ctx.strokeStyle = decay > 0.45 ? "#9f7b55" : "#c8bb67";
  ctx.lineWidth = Math.max(1, cueScale * 0.85);
  ctx.beginPath();
  ctx.arc(point.x, point.y + 7 * cueScale, (7 + fullness * 4) * cueScale, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();

  ctx.globalAlpha = 0.4 + health * 0.18;
  ctx.fillStyle = hasSeed ? "#e0c75d" : health > 0.52 ? "#b9c56f" : "#9a7a55";
  ctx.beginPath();
  ctx.ellipse(point.x - 5 * cueScale, point.y + 9 * cueScale, (1.5 + fullness * 1.8) * cueScale, 1.2 * cueScale, 0.2, 0, Math.PI * 2);
  ctx.fill();
  if (hasSeed) {
    ctx.beginPath();
    ctx.ellipse(point.x + 5 * cueScale, point.y + 9 * cueScale, 1.3 * cueScale, 1.8 * cueScale, 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  if (decay > 0.32) {
    ctx.globalAlpha = 0.14 + decay * 0.22;
    ctx.strokeStyle = "#6f5139";
    ctx.beginPath();
    ctx.moveTo(point.x - 9 * cueScale, point.y + 2 * cueScale);
    ctx.lineTo(point.x - 2 * cueScale, point.y + 7 * cueScale);
    ctx.lineTo(point.x + 7 * cueScale, point.y + 1 * cueScale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTerrainRockDetail(detail, point) {
  const scale = Math.max(0.22, detail.scale * (detail.kind === "boulder" ? 1.05 : 0.74));
  drawDetailShadow(point, 18 * scale, 7 * scale, detail.kind === "boulder" ? 0.3 : 0.24);
  return drawPropFrame(3, point, scale);
}

function drawDetailShadow(point, width, height, opacity) {
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + height * 0.7, width, height, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(12, 15, 13, ${opacity})`;
  ctx.fill();
}

function drawProceduralGroundDetail(detail, point) {
  const scale = detail.scale;
  drawDetailShadow(point, 10 * scale, 3.5 * scale, detail.kind === "pebble" ? 0.16 : 0.1);

  if (detail.kind === "pebble") {
    drawPebbleCluster(point, scale, detail.shade);
    return;
  }
  if (detail.kind === "flower") {
    drawGrassTuft(point, scale, true, detail.shade);
    return;
  }
  drawGrassTuft(point, scale, false, detail.shade);
}

function drawTerrainTreeDetail(detail, point) {
  const scale = detail.scale;
  drawDetailShadow(point, 30 * scale, 11 * scale, 0.34);

  const trunkHeight = 28 * scale;
  const sway = detail.shade * 3 * scale;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(55, 39, 27, 0.92)";
  ctx.lineWidth = Math.max(3, 5.6 * scale);
  ctx.beginPath();
  ctx.moveTo(point.x, point.y + 3 * scale);
  ctx.lineTo(point.x + sway * 0.4, point.y - trunkHeight);
  ctx.stroke();
  ctx.strokeStyle = "rgba(32, 24, 19, 0.46)";
  ctx.lineWidth = Math.max(1, 1.8 * scale);
  ctx.beginPath();
  ctx.moveTo(point.x - 5 * scale, point.y - 9 * scale);
  ctx.lineTo(point.x + sway - 13 * scale, point.y - 33 * scale);
  ctx.moveTo(point.x + 4 * scale, point.y - 14 * scale);
  ctx.lineTo(point.x + sway + 13 * scale, point.y - 37 * scale);
  ctx.stroke();

  const crown = {
    x: point.x + sway,
    y: point.y - trunkHeight - 21 * scale,
  };
  const lobes = [
    [-15, 1, 18, 24, -0.35, "rgba(31, 68, 45, 0.98)"],
    [1, -12, 22, 30, 0.04, "rgba(54, 99, 57, 0.98)"],
    [17, 1, 18, 24, 0.34, "rgba(25, 58, 42, 0.99)"],
    [-4, 12, 25, 22, 0.02, "rgba(36, 78, 48, 0.98)"],
    [0, -29, 15, 17, -0.1, "rgba(73, 118, 64, 0.95)"],
  ];
  for (const [dx, dy, rx, ry, rotation, fill] of lobes) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(crown.x + dx * scale, crown.y + dy * scale, rx * scale, ry * scale, rotation, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(136, 156, 88, 0.22)";
  ctx.beginPath();
  ctx.ellipse(crown.x - 10 * scale, crown.y - 19 * scale, 9 * scale, 6 * scale, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(8, 23, 20, 0.28)";
  ctx.beginPath();
  ctx.ellipse(crown.x + 14 * scale, crown.y + 17 * scale, 14 * scale, 10 * scale, 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTerrainRuinDetail(detail, point) {
  const scale = detail.scale;
  drawDetailShadow(point, 30 * scale, 12 * scale, 0.3);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(detail.shade * 0.08);

  ctx.fillStyle = "rgba(92, 89, 76, 0.92)";
  ctx.strokeStyle = "rgba(28, 29, 25, 0.5)";
  ctx.lineWidth = Math.max(1, 1.4 * scale);
  for (const block of [
    [-20, -11, 16, 14],
    [-4, -16, 18, 19],
    [14, -8, 12, 12],
    [-14, 4, 28, 9],
  ]) {
    ctx.fillRect(block[0] * scale, block[1] * scale, block[2] * scale, block[3] * scale);
    ctx.strokeRect(block[0] * scale, block[1] * scale, block[2] * scale, block[3] * scale);
  }
  ctx.fillStyle = "rgba(188, 176, 130, 0.2)";
  ctx.fillRect(-18 * scale, -10 * scale, 9 * scale, 3 * scale);
  ctx.restore();
}

function drawTerrainWallDetail(detail, point) {
  const scale = detail.scale;
  const role = detail.kitRole ?? "";
  const vertical = role === "wall-east" || role === "wall-west";
  const width = (vertical ? 38 : 66) * scale;
  const height = (vertical ? 58 : 52) * scale;
  const depth = (vertical ? 22 : 16) * scale;
  const baseDrop = 12 * scale;
  const decay = clamp(detail.lifecycle?.decay ?? 0.5, 0, 1);
  const lean = (detail.shade ?? 0) * 3 * scale;

  drawDetailShadow({ x: point.x, y: point.y + 7 * scale }, width * 0.62, 11 * scale, 0.38);
  ctx.save();
  ctx.translate(point.x, point.y);

  const left = -width / 2 + lean;
  const right = width / 2 + lean;
  const top = -height;
  const broken = decay * 7 * scale;

  ctx.fillStyle = "rgba(98, 91, 78, 0.98)";
  ctx.strokeStyle = "rgba(33, 31, 27, 0.54)";
  ctx.lineWidth = Math.max(1, 1.1 * scale);
  ctx.beginPath();
  ctx.moveTo(left, -depth);
  ctx.lineTo(right, -depth);
  ctx.lineTo(right - 5 * scale, top + broken);
  ctx.lineTo(left + 7 * scale, top + broken * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(71, 66, 57, 0.98)";
  ctx.beginPath();
  ctx.moveTo(left, -depth);
  ctx.lineTo(right, -depth);
  ctx.lineTo(right - 2 * scale, baseDrop);
  ctx.lineTo(left + 2 * scale, baseDrop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(139, 128, 102, 0.96)";
  ctx.beginPath();
  ctx.moveTo(left + 7 * scale, top + broken * 0.45);
  ctx.lineTo(right - 5 * scale, top + broken);
  ctx.lineTo(right, -depth);
  ctx.lineTo(left, -depth);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(49, 47, 41, 0.45)";
  ctx.beginPath();
  ctx.moveTo(right, -depth);
  ctx.lineTo(right - 5 * scale, top + broken);
  ctx.lineTo(right + 3 * scale, top + broken + 10 * scale);
  ctx.lineTo(right - 2 * scale, baseDrop);
  ctx.closePath();
  ctx.fill();

  drawMasonryJoints(left, right, top + broken, baseDrop, scale, decay);
  drawWallMossAndCracks(left, right, top, depth, scale, decay);
  ctx.restore();
}

function drawMasonryJoints(left, right, top, bottom, scale, decay) {
  ctx.save();
  ctx.globalAlpha = 0.28 + decay * 0.18;
  ctx.strokeStyle = "rgba(37, 34, 28, 0.72)";
  ctx.lineWidth = Math.max(0.7, 0.7 * scale);
  for (let row = 0; row < 4; row += 1) {
    const y = top + ((bottom - top) * (row + 1)) / 5;
    ctx.beginPath();
    ctx.moveTo(left + 2 * scale, y);
    ctx.lineTo(right - 2 * scale, y + (row % 2 ? 0.8 : -0.5) * scale);
    ctx.stroke();
  }
  for (let col = 0; col < 5; col += 1) {
    const x = left + ((right - left) * (col + 0.5 + (col % 2) * 0.35)) / 6;
    ctx.beginPath();
    ctx.moveTo(x, top + 3 * scale);
    ctx.lineTo(x + 0.8 * scale, bottom - 1 * scale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWallMossAndCracks(left, right, top, depth, scale, decay) {
  ctx.save();
  ctx.globalAlpha = 0.14 + decay * 0.28;
  ctx.strokeStyle = "rgba(48, 43, 34, 0.86)";
  ctx.lineWidth = Math.max(0.8, 0.85 * scale);
  ctx.beginPath();
  ctx.moveTo(left + 16 * scale, top + 8 * scale);
  ctx.lineTo(left + 25 * scale, top + 18 * scale);
  ctx.lineTo(left + 20 * scale, top + 29 * scale);
  ctx.moveTo(right - 18 * scale, top + 11 * scale);
  ctx.lineTo(right - 25 * scale, top + 22 * scale);
  ctx.stroke();

  ctx.globalAlpha = 0.16 + decay * 0.24;
  ctx.fillStyle = "rgba(74, 106, 58, 0.82)";
  ctx.beginPath();
  ctx.ellipse(left + 13 * scale, -depth - 1 * scale, 10 * scale, 3.8 * scale, -0.2, 0, Math.PI * 2);
  ctx.ellipse(right - 16 * scale, -depth + 1 * scale, 8 * scale, 3.4 * scale, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTerrainStairsDetail(detail, point) {
  const scale = detail.scale;
  const decay = clamp(detail.lifecycle?.decay ?? 0.55, 0, 1);
  drawDetailShadow(point, 29 * scale, 10 * scale, 0.26);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.strokeStyle = "rgba(37, 34, 29, 0.46)";
  ctx.lineWidth = Math.max(1, scale);
  for (let step = 0; step < 5; step += 1) {
    const y = (step * 6 - 26) * scale;
    const width = (48 - step * 5) * scale;
    const chip = (step % 2) * decay * 4 * scale;
    ctx.fillStyle = step % 2 === 0 ? "rgba(145, 135, 108, 0.94)" : "rgba(111, 104, 87, 0.94)";
    ctx.beginPath();
    ctx.moveTo(-width / 2 + chip, y);
    ctx.lineTo(width / 2, y);
    ctx.lineTo(width / 2 - 7 * scale, y + 6 * scale);
    ctx.lineTo(-width / 2 - 7 * scale + chip, y + 6 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 0.26 + decay * 0.22;
  ctx.strokeStyle = "rgba(50, 44, 36, 0.72)";
  ctx.beginPath();
  ctx.moveTo(-19 * scale, -18 * scale);
  ctx.lineTo(-6 * scale, -10 * scale);
  ctx.lineTo(-13 * scale, -2 * scale);
  ctx.moveTo(14 * scale, -13 * scale);
  ctx.lineTo(4 * scale, -4 * scale);
  ctx.stroke();
  ctx.restore();
}

function drawTerrainFoundationDetail(detail, point) {
  const scale = detail.scale;
  const decay = clamp(detail.lifecycle?.decay ?? 0.6, 0, 1);
  drawDetailShadow(point, 24 * scale, 7 * scale, 0.18);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate((detail.shade ?? 0) * 0.05);
  ctx.fillStyle = "rgba(112, 105, 87, 0.84)";
  ctx.strokeStyle = "rgba(35, 32, 27, 0.32)";
  ctx.lineWidth = Math.max(0.8, 0.8 * scale);
  for (let block = 0; block < 5; block += 1) {
    const x = (block - 2) * 9 * scale;
    const y = ((block % 2) * 5 - 6) * scale;
    const width = (10 + (block % 2) * 3) * scale;
    const height = (7 + decay * 3) * scale;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
  }
  ctx.globalAlpha = 0.18 + decay * 0.24;
  ctx.fillStyle = "rgba(69, 105, 57, 0.8)";
  ctx.beginPath();
  ctx.ellipse(-8 * scale, 5 * scale, 10 * scale, 3 * scale, -0.2, 0, Math.PI * 2);
  ctx.ellipse(13 * scale, 2 * scale, 7 * scale, 2.4 * scale, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTerrainReedsDetail(detail, point) {
  const scale = detail.scale;
  drawDetailShadow(point, 12 * scale, 4 * scale, 0.16);
  ctx.save();
  ctx.strokeStyle = "rgba(58, 94, 61, 0.78)";
  ctx.lineWidth = Math.max(1, 1.2 * scale);
  ctx.beginPath();
  for (let reed = -3; reed <= 3; reed += 1) {
    const baseX = point.x + reed * 3 * scale;
    const topX = baseX + (detail.shade * 2 + reed * 0.4) * scale;
    ctx.moveTo(baseX, point.y + 5 * scale);
    ctx.lineTo(topX, point.y - (13 + Math.abs(reed)) * scale);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(126, 104, 61, 0.82)";
  for (let reed = -2; reed <= 2; reed += 2) {
    ctx.beginPath();
    ctx.ellipse(point.x + reed * 3 * scale, point.y - 10 * scale, 1.5 * scale, 4.5 * scale, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPebbleCluster(point, scale, shade) {
  const count = 2 + Math.floor(Math.abs(shade) * 3);
  for (let index = 0; index < count; index += 1) {
    const dx = (index - 1) * 4.2 * scale;
    const dy = ((index % 2) - 0.5) * 3 * scale;
    ctx.beginPath();
    ctx.ellipse(point.x + dx, point.y + dy, 3.4 * scale, 2.2 * scale, -0.35, 0, Math.PI * 2);
    ctx.fillStyle = index % 2 === 0 ? "rgba(80, 78, 68, 0.86)" : "rgba(113, 103, 82, 0.82)";
    ctx.fill();
    ctx.strokeStyle = "rgba(32, 31, 27, 0.32)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function drawGrassTuft(point, scale, flowers, shade) {
  ctx.strokeStyle = flowers ? "rgba(71, 112, 46, 0.72)" : "rgba(50, 87, 39, 0.68)";
  ctx.lineWidth = Math.max(1, 1.6 * scale);
  ctx.beginPath();
  for (let blade = -2; blade <= 2; blade += 1) {
    const lean = (blade * 2.6 + shade * 2) * scale;
    ctx.moveTo(point.x + blade * 2.8 * scale, point.y + 5 * scale);
    ctx.lineTo(point.x + lean, point.y - (6 + Math.abs(blade)) * scale);
  }
  ctx.stroke();

  if (!flowers) return;
  ctx.fillStyle = "rgba(226, 210, 132, 0.86)";
  for (let flower = 0; flower < 2; flower += 1) {
    ctx.beginPath();
    ctx.arc(point.x + (flower * 5 - 2.5) * scale, point.y - (5 + flower) * scale, 1.5 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function objectSpriteFrame(kind) {
  switch (kind) {
    case "registrar":
      return 0;
    case "forge":
      return 1;
    case "grove":
      return 2;
    case "ore":
      return 3;
    case "shrine":
      return 4;
    default:
      return null;
  }
}

function drawFootprint(point, radiusTiles, fill, stroke) {
  ctx.beginPath();
  ctx.ellipse(
    point.x,
    point.y + PROJECTION.halfH * radiusTiles,
    PROJECTION.halfW * radiusTiles,
    PROJECTION.halfH * radiusTiles,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawPlayers(players, origin, now) {
  const sorted = [...players].sort(
    (a, b) => playerRenderSortKey(a, origin) - playerRenderSortKey(b, origin),
  );
  for (const player of sorted) {
    drawPlayer(player, origin, now);
  }
}

function updatePlayerRenderOffsets(players, map) {
  playerRenderOffsets.clear();
  playerVariantIndexes.clear();

  [...players]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .forEach((player, index) => playerVariantIndexes.set(player.id, index));

  const clusters = playerProximityClusters(players);

  for (const cluster of clusters) {
    if (cluster.length < 2) continue;

    const spreadPlayers = cluster
      .filter((player) => player.id !== playerId)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (spreadPlayers.length === 0) continue;

    for (let index = 0; index < spreadPlayers.length; index += 1) {
      const player = spreadPlayers[index];
      const ring = Math.floor(index / PLAYER_CLUSTER_RING_SIZE);
      const ringIndex = index % PLAYER_CLUSTER_RING_SIZE;
      const remaining = spreadPlayers.length - ring * PLAYER_CLUSTER_RING_SIZE;
      const ringCount = Math.min(PLAYER_CLUSTER_RING_SIZE, remaining);
      const angle = -Math.PI / 2 + ((ringIndex + 0.5) / ringCount) * Math.PI * 2;
      const radius = PLAYER_CLUSTER_SPREAD_RADIUS + ring * PLAYER_CLUSTER_RING_STEP;
      const target = {
        x: player.x + Math.cos(angle) * radius,
        y: player.y + Math.sin(angle) * radius,
      };
      if (map) {
        target.x = clamp(target.x, PLAYER_RENDER_MARGIN, map.width - PLAYER_RENDER_MARGIN);
        target.y = clamp(target.y, PLAYER_RENDER_MARGIN, map.height - PLAYER_RENDER_MARGIN);
      }
      playerRenderOffsets.set(player.id, {
        x: target.x - player.x,
        y: target.y - player.y,
      });
    }
  }
}

function playerProximityClusters(players) {
  const clusters = [];
  const visited = new Set();

  for (const player of players) {
    if (visited.has(player.id)) continue;

    const cluster = [];
    const queue = [player];
    visited.add(player.id);

    while (queue.length > 0) {
      const current = queue.shift();
      cluster.push(current);

      for (const candidate of players) {
        if (visited.has(candidate.id)) continue;
        if (playerDistance(current, candidate) > PLAYER_CLUSTER_DISTANCE) continue;
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function playerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function playerRenderPosition(player) {
  const offset = playerRenderOffsets.get(player.id);
  if (!offset) {
    return { x: player.x, y: player.y };
  }
  return {
    x: player.x + offset.x,
    y: player.y + offset.y,
  };
}

function drawPlayer(player, origin, now) {
  const isMe = player.id === playerId;
  const renderPosition = playerRenderPosition(player);
  const playerZ = terrainHeightAtWorld(terrain, renderPosition.x, renderPosition.y);
  const point = projectWorld(renderPosition.x, renderPosition.y, playerZ, origin);
  const motion = playerMotionFor(player, snapshot.tick, now);
  const sprite = playerSpriteFor(player);
  drawPlayerShadow(point, isMe, sprite);

  if (drawPlayerSprite(player, point, isMe, motion, now, sprite)) {
    drawPlayerLabels(player, point, playerLabelOffset(sprite), sprite);
    return;
  }

  drawFallbackPlayer(point, player.color, isMe, motion, now, player.id);
  drawPlayerLabels(player, point, -62, sprite);
}

function playerMotionFor(player, tick, now) {
  const previous = playerMotion.get(player.id);
  if (!previous) {
    const next = {
      x: player.x,
      y: player.y,
      tick,
      moving: false,
      walkStartMs: now,
      lastMovementMs: null,
      sampleMs: now,
      speedRatio: 0,
      direction: "south",
    };
    playerMotion.set(player.id, next);
    return next;
  }

  if (previous.tick !== tick) {
    const dx = player.x - previous.x;
    const dy = player.y - previous.y;
    const distance = Math.hypot(dx, dy);
    const moved = distance > PLAYER_MOVEMENT_EPSILON;
    const sampleElapsedMs = Math.max(16, now - (previous.sampleMs ?? now));
    const wasRecentlyMoving =
      previous.lastMovementMs != null && now - previous.lastMovementMs <= PLAYER_WALK_STOP_GRACE_MS;
    const walkStartMs = moved && !previous.moving && !wasRecentlyMoving ? now : previous.walkStartMs;
    const direction = moved ? directionFromWorldDelta(dx, dy, previous.direction) : previous.direction;
    previous.x = player.x;
    previous.y = player.y;
    previous.tick = tick;
    previous.walkStartMs = walkStartMs;
    previous.lastMovementMs = moved ? now : previous.lastMovementMs;
    previous.speedRatio = moved
      ? clamp((distance / sampleElapsedMs) * 1000 / 220, 0.62, 1.45)
      : previous.speedRatio * 0.78;
    previous.sampleMs = now;
    previous.direction = direction;
  }

  const movementAge = previous.lastMovementMs == null ? Infinity : now - previous.lastMovementMs;
  previous.moving = movementAge <= PLAYER_WALK_STOP_GRACE_MS;
  if (!previous.moving) {
    previous.speedRatio = 0;
  }

  return previous;
}

function drawFallbackPlayer(point, color, isMe, motion, now, playerKey) {
  const phase = motion.moving ? (now - motion.walkStartMs) / 180 + stableIndex(playerKey) * 0.27 : 0;
  const stride = motion.moving ? Math.sin(phase) : 0;
  const counterStride = motion.moving ? Math.sin(phase + Math.PI) : 0;
  const bob = motion.moving ? Math.sin(phase * 2) * 1.1 : 0;
  const cloakSway = motion.moving ? Math.sin(phase * 0.7) * 1.6 : 0;

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.scale(PLAYER_RENDER_SCALE, PLAYER_RENDER_SCALE);
  const x = 0;
  const y = bob;

  ctx.beginPath();
  ctx.ellipse(x, 29, 22, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(11, 15, 17, 0.28)";
  ctx.fill();

  ctx.fillStyle = "#252b2d";
  ctx.fillRect(x - 12 + stride * 2, y + 21, 8, 25);
  ctx.fillRect(x + 4 + counterStride * 2, y + 21, 8, 25);
  ctx.fillStyle = "#151b1f";
  ctx.fillRect(x - 17 + stride * 3, y + 44, 14, 6);
  ctx.fillRect(x + 2 + counterStride * 3, y + 44, 14, 6);

  ctx.fillStyle = "#18252b";
  ctx.beginPath();
  ctx.moveTo(x - 23 + cloakSway, y - 12);
  ctx.lineTo(x - 17 + cloakSway * 0.4, y + 43);
  ctx.lineTo(x, y + 35);
  ctx.lineTo(x + 17 + cloakSway * 0.4, y + 43);
  ctx.lineTo(x + 23 + cloakSway, y - 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(7, 11, 13, 0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = shadePlayerColor(color, 0.84);
  ctx.fillRect(x - 15, y - 9, 30, 35);
  ctx.fillStyle = "rgba(192, 188, 163, 0.55)";
  for (let chain = -9; chain <= 9; chain += 6) {
    ctx.fillRect(x + chain, y - 2, 2, 18);
  }
  ctx.fillStyle = "#a87942";
  ctx.fillRect(x - 9, y + 14, 18, 5);
  ctx.fillStyle = "#6f472d";
  ctx.fillRect(x - 4, y + 18, 8, 20);

  ctx.fillStyle = "#b99168";
  ctx.beginPath();
  ctx.ellipse(x, y - 23, 12, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#697171";
  ctx.fillRect(x - 14, y - 35, 28, 8);
  ctx.beginPath();
  ctx.moveTo(x - 17, y - 31);
  ctx.lineTo(x, y - 48);
  ctx.lineTo(x + 17, y - 31);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#d7c693";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 36);
  ctx.lineTo(x, y - 16);
  ctx.stroke();
  ctx.fillStyle = "#f0e2bb";
  ctx.beginPath();
  ctx.arc(x - 5, y - 23, 2.2, 0, Math.PI * 2);
  ctx.arc(x + 5, y - 23, 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#5d4936";
  ctx.fillRect(x - 35 - stride * 2, y - 4, 15, 29);
  ctx.fillStyle = "#34404a";
  ctx.beginPath();
  ctx.ellipse(x - 31 - stride * 2, y + 11, 11, 17, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#b49a62";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = "#d7c693";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 23 + counterStride, y - 5);
  ctx.lineTo(x + 39 + counterStride, y - 38);
  ctx.lineTo(x + 45 + counterStride, y - 24);
  ctx.moveTo(x + 39 + counterStride, y - 38);
  ctx.lineTo(x + 34 + counterStride, y - 31);
  ctx.stroke();

  ctx.restore();
}

function shadePlayerColor(color, factor) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const hex = match[1];
  const channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${channels.map((channel) => Math.round(channel * factor)).join(", ")})`;
}

function drawPlayerSprite(player, point, isMe, motion, now, sprite = sprites.player) {
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;

  const direction = sprite.directions?.[motion.direction] ?? sprite.directions?.south;
  if (!direction) return false;
  const elapsed = Math.max(0, now - motion.walkStartMs);
  const animation = walkAnimationSample({
    moving: motion.moving,
    elapsedMs: elapsed,
    frameCount: direction.frameCount,
    stablePhase: stableIndex(player.id) * 0.15,
    speedRatio: motion.speedRatio || 1,
  });
  const sourceFrame = direction.startFrame + animation.frameIndex;
  const sx = (sourceFrame % sprite.columns) * sprite.cellWidth;
  const sy = Math.floor(sourceFrame / sprite.columns) * sprite.cellHeight;
  const scale = sprite.render?.scale ?? PLAYER_RENDER_SCALE;
  const dx = Math.round(point.x - sprite.anchor.x * scale + animation.bodyOffsetX);
  const dy = Math.round(point.y - sprite.anchor.y * scale + animation.bodyOffsetY);
  const dw = Math.round(sprite.cellWidth * scale);
  const dh = Math.round(sprite.cellHeight * scale);

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite.image, sx, sy, sprite.cellWidth, sprite.cellHeight, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = previousSmoothing;
  return true;
}

function drawPlayerShadow(point, isMe, sprite) {
  const shadow = sprite?.render?.shadow;
  if (shadow?.kind === "none") return;
  if (shadow?.kind === "ellipse") {
    const anchor = sprite.anchor;
    const scale = sprite.render?.scale ?? PLAYER_RENDER_SCALE;
    ctx.beginPath();
    ctx.ellipse(
      point.x + (shadow.x - anchor.x) * scale,
      point.y + (shadow.y - anchor.y) * scale,
      (shadow.width * scale) / 2,
      (shadow.height * scale) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = isMe
      ? `rgba(239, 217, 139, ${Math.min(0.42, shadow.opacity + 0.1)})`
      : `rgba(17, 20, 23, ${shadow.opacity})`;
    ctx.fill();
    if (isMe) {
      ctx.strokeStyle = "rgba(255, 245, 188, 0.58)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    return;
  }

  ctx.beginPath();
  ctx.ellipse(point.x, point.y - 2, isMe ? 27 : 23, isMe ? 12 : 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = isMe ? "rgba(239, 217, 139, 0.3)" : "rgba(17, 20, 23, 0.22)";
  ctx.fill();
  if (isMe) {
    ctx.strokeStyle = "rgba(255, 245, 188, 0.58)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

function playerRenderSortKey(player, origin) {
  const sprite = playerSpriteFor(player);
  const renderPosition = playerRenderPosition(player);
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
  if (sprites.players.length === 0) return sprites.player;
  const variantIndex = playerVariantIndexes.get(player.id) ?? stableIndex(player.id);
  return sprites.players[variantIndex % sprites.players.length] ?? sprites.player;
}

function playerLabelOffset(sprite) {
  if (!sprite) return -62;
  const scale = sprite.render?.scale ?? PLAYER_RENDER_SCALE;
  return -Math.max(48, sprite.anchor.y * scale + 8);
}

function playerDisplayName(player, sprite) {
  const name = player.name || "Wayfarer";
  const generatedName = GENERATED_WAYFARER_NAME_RE.exec(name);
  const archetype = sprite ? PLAYER_ARCHETYPE_LABELS[sprite.id] : null;
  if (!generatedName || !archetype) return name;
  return `${archetype}-${generatedName[1]}`;
}

function drawPlayerLabels(player, point, labelOffsetY = -62, sprite = null) {
  ctx.fillStyle = "#111417";
  ctx.font = "700 16px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(playerDisplayName(player, sprite), point.x, point.y + labelOffsetY);

  if (player.demoDeeds.length > 0) {
    ctx.fillStyle = "#f2d98b";
    ctx.fillRect(point.x - 13, point.y + 40, 26, 16);
    ctx.strokeStyle = "#7a5c25";
    ctx.lineWidth = 2;
    ctx.strokeRect(point.x - 13, point.y + 40, 26, 16);
  }

  const gathered = inventoryItemCount(player.inventory);
  if (gathered > 0) {
    drawInventoryBadge(player.inventory, point.x + 24, point.y + 44, gathered);
  }
}

function drawInventoryBadge(inventory, x, y, gathered) {
  const firstItem = inventory.items[0];
  const frame = firstItem ? ITEM_ICON_FRAMES[firstItem.itemId] : null;
  const sprite = sprites.items;

  ctx.save();
  ctx.fillStyle = "rgba(255, 253, 247, 0.92)";
  ctx.strokeStyle = "#2a302f";
  ctx.lineWidth = 2;
  ctx.fillRect(x - 13, y - 13, 26, 26);
  ctx.strokeRect(x - 13, y - 13, 26, 26);

  if (sprite?.image?.complete && frame != null && frame < sprite.frameCount) {
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sprite.image,
      (frame % sprite.columns) * sprite.cellWidth,
      Math.floor(frame / sprite.columns) * sprite.cellHeight,
      sprite.cellWidth,
      sprite.cellHeight,
      x - 10,
      y - 12,
      20,
      20,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;
  }

  ctx.fillStyle = "#2f7565";
  ctx.font = "800 11px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(String(Math.min(gathered, 99)), x + 7, y + 12);
  ctx.restore();
}

async function loadSpriteAssets() {
  try {
    const response = await fetch("/assets/sprites/manifest.json", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    const manifest = await response.json();
    const playerSheetIds = PREFERRED_PLAYER_SHEET_IDS.filter((sheetId) => hasSpriteSheet(manifest, sheetId));
    const actorSheetIds =
      playerSheetIds.length > 0
        ? playerSheetIds
        : hasSpriteSheet(manifest, PREFERRED_PLAYER_SHEET_ID)
          ? [PREFERRED_PLAYER_SHEET_ID]
          : [FALLBACK_PLAYER_SHEET_ID];
    const actorSheets = await Promise.all(
      actorSheetIds.map((sheetId) => loadActorSpriteSheet(manifest, sheetId)),
    );
    const propSheetId = hasSpriteSheet(manifest, PREFERRED_PROP_SHEET_ID)
      ? PREFERRED_PROP_SHEET_ID
      : FALLBACK_PROP_SHEET_ID;
    const propSheet = selectSpriteSheet(manifest, propSheetId, "neutral");
    const propImage = await loadVerifiedPngImage(
      `/assets/sprites/${propSheet.imagePath}`,
      propSheet.imageSha256,
    );
    const itemSheet = hasSpriteSheet(manifest, ITEM_SHEET_ID)
      ? selectSpriteSheet(manifest, ITEM_SHEET_ID, "neutral")
      : null;
    const itemImage = itemSheet
      ? await loadVerifiedPngImage(`/assets/sprites/${itemSheet.imagePath}`, itemSheet.imageSha256)
      : null;
    const detailSheet = hasSpriteSheet(manifest, DETAIL_SHEET_ID)
      ? selectSpriteSheet(manifest, DETAIL_SHEET_ID, "neutral")
      : null;
    const detailImage = detailSheet
      ? await loadVerifiedPngImage(`/assets/sprites/${detailSheet.imagePath}`, detailSheet.imageSha256)
      : null;
    sprites.players = actorSheets;
    sprites.player = actorSheets[0] ?? null;
    sprites.props = {
      image: propImage,
      cellWidth: propSheet.cellWidth,
      cellHeight: propSheet.cellHeight,
      anchor: propSheet.anchor,
      render: propSheet.render,
      startFrame: propSheet.startFrame,
      frameCount: propSheet.frameCount,
    };
    sprites.items = itemSheet && itemImage
      ? {
          image: itemImage,
          cellWidth: itemSheet.cellWidth,
          cellHeight: itemSheet.cellHeight,
          columns: itemSheet.columns,
          anchor: itemSheet.anchor,
          render: itemSheet.render,
          startFrame: itemSheet.startFrame,
          frameCount: itemSheet.frameCount,
          dataUrls: itemIconDataUrls(itemImage, itemSheet),
        }
      : null;
    sprites.details = detailSheet && detailImage
      ? {
          image: detailImage,
          cellWidth: detailSheet.cellWidth,
          cellHeight: detailSheet.cellHeight,
          columns: detailSheet.columns,
          anchor: detailSheet.anchor,
          render: detailSheet.render,
          startFrame: detailSheet.startFrame,
          frameCount: detailSheet.frameCount,
        }
      : null;
  } catch (error) {
    console.warn("Sprite assets disabled", error);
    sprites.player = null;
    sprites.players = [];
    sprites.props = null;
    sprites.items = null;
    sprites.details = null;
  }
}

async function loadActorSpriteSheet(manifest, sheetId) {
  const sheet = selectSpriteSheet(manifest, sheetId, "south");
  const directions = Object.fromEntries(
    PLAYER_DIRECTION_NAMES.map((directionName) => {
      const directionSheet = selectSpriteSheet(manifest, sheetId, directionName);
      return [
        directionName,
        {
          startFrame: directionSheet.startFrame,
          frameCount: directionSheet.frameCount,
        },
      ];
    }),
  );
  const image = await loadVerifiedPngImage(`/assets/sprites/${sheet.imagePath}`, sheet.imageSha256);
  return {
    id: sheetId,
    image,
    cellWidth: sheet.cellWidth,
    cellHeight: sheet.cellHeight,
    columns: sheet.columns,
    anchor: sheet.anchor,
    render: sheet.render,
    startFrame: sheet.startFrame,
    frameCount: sheet.frameCount,
    directions,
  };
}

function itemIconDataUrls(image, sheet) {
  const urls = [];
  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = sheet.cellWidth;
  iconCanvas.height = sheet.cellHeight;
  const iconContext = iconCanvas.getContext("2d");
  if (!iconContext) return urls;

  for (let frame = 0; frame < sheet.frameCount; frame += 1) {
    iconContext.clearRect(0, 0, sheet.cellWidth, sheet.cellHeight);
    iconContext.imageSmoothingEnabled = false;
    iconContext.drawImage(
      image,
      (frame % sheet.columns) * sheet.cellWidth,
      Math.floor(frame / sheet.columns) * sheet.cellHeight,
      sheet.cellWidth,
      sheet.cellHeight,
      0,
      0,
      sheet.cellWidth,
      sheet.cellHeight,
    );
    urls.push(iconCanvas.toDataURL("image/png"));
  }
  return urls;
}

function hasSpriteSheet(manifest, sheetId) {
  return Array.isArray(manifest?.sheets) && manifest.sheets.some((sheet) => sheet?.id === sheetId);
}

async function loadTerrainAssets() {
  try {
    const response = await fetch("/assets/terrain/manifest.json", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    const manifest = await response.json();
    const atlas = normalizeTerrainAtlas(manifest);
    const image = await loadVerifiedPngImage(`/assets/terrain/${atlas.tileSheet.imagePath}`, atlas.tileSheet.sha256);
    terrainAssets.atlas = atlas;
    terrainAssets.image = image;
    terrainAssets.patternSources = terrainPatternFrames(image, atlas.tileSheet);
    terrainAssets.patternContexts = new WeakMap();
    terrainAssetVersion += 1;
  } catch {
    terrainAssets.atlas = null;
    terrainAssets.image = null;
    terrainAssets.patternSources = [];
    terrainAssets.patternContexts = new WeakMap();
    terrainAssetVersion += 1;
  }
}

function terrainPatternFrames(image, sheet) {
  const sources = [];
  for (let frame = 0; frame < sheet.frameCount; frame += 1) {
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = sheet.cellWidth;
    patternCanvas.height = sheet.cellHeight;
    const patternContext = patternCanvas.getContext("2d");
    if (!patternContext) continue;

    patternContext.imageSmoothingEnabled = false;
    patternContext.drawImage(
      image,
      (frame % sheet.columns) * sheet.cellWidth,
      Math.floor(frame / sheet.columns) * sheet.cellHeight,
      sheet.cellWidth,
      sheet.cellHeight,
      0,
      0,
      sheet.cellWidth,
      sheet.cellHeight,
    );
    sources[frame] = patternCanvas;
  }
  return sources;
}

async function loadVerifiedPngImage(src, expectedSha256) {
  const response = await fetch(src, {
    cache: "no-store",
    headers: { accept: "image/png" },
  });
  if (!response.ok) {
    throw new Error(`asset image request failed with ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/png")) {
    throw new Error(`asset image must be served as image/png, got ${contentType || "unknown"}`);
  }
  const bytes = await response.arrayBuffer();
  await verifySha256Bytes(bytes, expectedSha256);
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  try {
    return await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
    image.src = src;
  });
}

function stableIndex(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawOverlay(rect) {
  const overlayHeight = terrainDebugMode ? 104 : 80;
  ctx.fillStyle = "rgba(17, 20, 23, 0.72)";
  ctx.fillRect(14, 14, 278, overlayHeight);
  ctx.fillStyle = "#fffdf7";
  ctx.font = "14px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(`Tick: ${snapshot.tick}`, 28, 40);
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  ctx.fillText(`Players: ${players.length}`, 28, 64);
  ctx.fillText("Server owns position and deed claims", 28, 86);
  if (terrainDebugMode) {
    ctx.fillStyle = "#f2d98b";
    ctx.fillText(`Terrain debug: ${terrainDebugMode}`, 28, 110);
  }

  if (rect.width < 760) {
    ctx.fillStyle = "rgba(17, 20, 23, 0.65)";
    ctx.fillRect(14, rect.height - 48, 286, 34);
    ctx.fillStyle = "#fffdf7";
    ctx.fillText("Use keyboard controls on desktop.", 28, rect.height - 26);
  }
}

function updateHud() {
  if (!ui.hud) return;
  if (!snapshot) {
    ui.hud.textContent = `FPS ${Math.round(smoothedFps)} / connecting`;
    return;
  }
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  ui.hud.textContent = `FPS ${Math.round(smoothedFps)} / Players ${players.length} / Tick ${snapshot.tick}${
    terrainDebugMode ? ` / Terrain ${terrainDebugMode}` : ""
  }`;
}

function updatePanel() {
  if (!snapshot) return;
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  const me = players.find((player) => player.id === playerId);
  const settlement = snapshot.settlement;
  ui.chainMode.textContent = settlement.chainEnabled ? "chain enabled" : "dry-run";
  ui.pendingJobs.textContent = String(settlement.pendingJobs);
  ui.confirmedJobs.textContent = String(settlement.confirmedJobs);
  ui.latestReceipt.textContent = settlement.latestReceipt
    ? `${settlement.latestReceipt.assetId} (${settlement.latestReceipt.status})`
    : "-";

  renderDeedPanel(me?.demoDeeds ?? []);

  renderInventoryPanel(me?.inventory ?? null);
}

function renderDeedPanel(deeds) {
  const container = ui.deedStatus;
  if (!container) return;
  container.replaceChildren();

  if (!deeds.length) {
    const empty = document.createElement("div");
    empty.className = "inventory-empty";
    empty.textContent = "Walk to the Title Office and press E to claim a dry-run deed.";
    container.append(empty);
    return;
  }

  for (const deed of deeds) {
    const row = document.createElement("div");
    row.className = "deed-row";

    const icon = document.createElement("img");
    icon.className = "deed-icon";
    icon.alt = "";
    icon.decoding = "async";
    const iconUrl = itemIconUrl("deed");
    if (iconUrl) icon.src = iconUrl;

    const label = document.createElement("span");
    label.className = "deed-label";
    label.textContent = deed;

    row.append(icon, label);
    container.append(row);
  }
}

function renderInventoryPanel(inventory) {
  const container = ui.resourceStatus;
  if (!container) return;
  container.replaceChildren();

  if (!inventory) {
    const empty = document.createElement("div");
    empty.className = "inventory-empty";
    empty.textContent = "Gather wood and ore, then craft at the Field Forge.";
    container.append(empty);
    return;
  }

  if (!inventory.items.length) {
    const empty = document.createElement("div");
    empty.className = "inventory-empty";
    empty.textContent = `Empty (${inventory.capacitySlots} slots)`;
    container.append(empty);
    return;
  }

  for (const item of inventory.items) {
    const row = document.createElement("div");
    row.className = "inventory-stack";

    const icon = document.createElement("img");
    icon.className = "inventory-icon";
    icon.alt = "";
    icon.decoding = "async";
    const iconUrl = itemIconUrl(item.itemId);
    if (iconUrl) {
      icon.src = iconUrl;
    }

    const label = document.createElement("span");
    label.className = "inventory-label";
    label.textContent = item.label;

    const count = document.createElement("span");
    count.className = "inventory-count";
    count.textContent = String(item.quantity);

    row.append(icon, label, count);
    container.append(row);
  }

  const capacity = document.createElement("div");
  capacity.className = "inventory-capacity";
  capacity.textContent = `${inventory.items.length}/${inventory.capacitySlots} slots`;
  container.append(capacity);
}

function inventoryItemCount(inventory) {
  return inventory.items.reduce((total, item) => total + item.quantity, 0);
}

function itemIconUrl(itemId) {
  const frame = ITEM_ICON_FRAMES[itemId];
  if (frame == null) return null;
  return sprites.items?.dataUrls?.[frame] ?? null;
}

function setConnection(text, className) {
  ui.connection.textContent = text;
  ui.connection.className = `connection ${className}`;
}

function objectColors(kind) {
  switch (kind) {
    case "registrar":
      return { fill: "rgba(176, 77, 54, 0.2)", stroke: "#b04d36" };
    case "forge":
      return { fill: "rgba(217, 139, 69, 0.26)", stroke: "#9d5d32" };
    case "grove":
      return { fill: "rgba(79, 116, 79, 0.35)", stroke: "#4f744f" };
    case "ore":
      return { fill: "rgba(123, 105, 112, 0.35)", stroke: "#7b6970" };
    case "shrine":
      return { fill: "rgba(244, 240, 230, 0.5)", stroke: "#796c57" };
    case "saplingTree":
      return { fill: "rgba(109, 146, 84, 0.28)", stroke: "#6d9254" };
    case "deadwood":
      return { fill: "rgba(143, 107, 73, 0.26)", stroke: "#8f6b49" };
    case "myceliumPatch":
      return { fill: "rgba(195, 167, 214, 0.24)", stroke: "#8f82b8" };
    case "ruin":
      return { fill: "rgba(157, 150, 127, 0.22)", stroke: "#6f685a" };
    default:
      return { fill: "rgba(22, 26, 29, 0.2)", stroke: "#161a1d" };
  }
}
