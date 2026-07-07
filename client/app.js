import {
  PROJECTION,
  defaultOrigin,
  projectWorld,
} from "./projection.js";
import { computeCamera } from "./camera.js";
import { verifySha256Bytes } from "./asset-integrity.js";
import { parseServerMessage } from "./server-messages.js";
import { selectSpriteSheet } from "./sprite-assets.js";
import { normalizeTerrainAtlas } from "./terrain-assets.js";
import {
  TERRAIN_MATERIALS,
  buildTerrain,
  projectTerrainTile,
  terrainFacets,
  terrainHeightAtWorld,
} from "./terrain.js";

const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d");

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
  props: null,
};
const terrainAssets = {
  atlas: null,
  image: null,
};
let terrain = null;
let terrainCacheKey = "";
let canvasPixelWidth = 0;
let canvasPixelHeight = 0;
let lastFrameTime = 0;
let smoothedFps = 60;

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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw(now = 0) {
  try {
    updateFrameRate(now);
    fitCanvas();
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!snapshot) {
      drawLoading(rect);
      updateHud();
      requestAnimationFrame(draw);
      return;
    }

    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const me = players.find((player) => player.id === playerId) || players[0];
    const origin = defaultOrigin(snapshot.map);
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
    drawMap(snapshot, origin, now);
    drawObjects(Array.isArray(snapshot.objects) ? snapshot.objects : [], origin);
    drawPlayers(players, origin, now);
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

function drawMap(state, origin, now) {
  const worldTerrain = terrainForMap(state.map);
  for (const tile of worldTerrain.tiles) {
    drawTerrainTile(tile, origin, state.tick, now);
  }
}

function drawTerrainTile(tile, origin, tick, now) {
  const corners = projectTerrainTile(tile, origin);
  const palette = TERRAIN_MATERIALS[tile.material];

  ctx.beginPath();
  ctx.moveTo(corners.nw.x, corners.nw.y);
  ctx.lineTo(corners.ne.x, corners.ne.y);
  ctx.lineTo(corners.se.x, corners.se.y);
  ctx.lineTo(corners.sw.x, corners.sw.y);
  ctx.closePath();
  ctx.fillStyle = palette.fill;
  ctx.fill();
  drawTerrainAtlasTile(tile, corners);
  drawTerrainFacets(tile, corners, palette);

  drawTerrainTransitions(tile, corners);
  drawTerrainDecals(tile, corners, tick, now);

  ctx.strokeStyle = palette.stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(corners.nw.x, corners.nw.y);
  ctx.lineTo(corners.ne.x, corners.ne.y);
  ctx.lineTo(corners.se.x, corners.se.y);
  ctx.lineTo(corners.sw.x, corners.sw.y);
  ctx.closePath();
  ctx.stroke();
}

function drawTerrainFacets(tile, corners, palette) {
  const facets = terrainFacets(tile);
  for (const facet of facets) {
    const points = facet.corners.map((corner) => corners[corner]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fillStyle = shadeHex(palette.fill, facet.shade);
    ctx.globalAlpha = facet.alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (facets.length > 0) {
    ctx.beginPath();
    ctx.moveTo(corners.nw.x, corners.nw.y);
    ctx.lineTo(corners.se.x, corners.se.y);
    ctx.strokeStyle = "rgba(24, 31, 30, 0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawTerrainAtlasTile(tile, corners) {
  const atlasTile =
    tile.sloped
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
  drawAtlasFrame(atlasTile.frame, corners, tile.sloped ? 0.84 : 0.96);
  ctx.restore();
  return true;
}

function drawTerrainTransitions(tile, corners) {
  for (const transition of tile.transitions) {
    const drewAtlasTransition = drawTerrainTransitionAtlas(transition, corners);
    const [from, to] = edgePoints(corners, transition.edge);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = transition.color;
    ctx.lineWidth = drewAtlasTransition ? 2 : transition.to === "water" ? 5 : 3;
    ctx.globalAlpha = drewAtlasTransition ? 0.36 : transition.to === "water" ? 0.74 : 0.52;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawTerrainTransitionAtlas(transition, corners) {
  const atlasTile = terrainAssets.atlas?.transitionByMaterial?.get(transition.to);
  const image = terrainAssets.image;
  if (!atlasTile || !image?.complete || image.naturalWidth === 0) return false;

  const band = edgeBandPoints(corners, transition.edge);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(band[0].x, band[0].y);
  for (const point of band.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.clip();
  drawAtlasFrame(atlasTile.frame, corners, transition.to === "water" ? 0.8 : 0.64);
  ctx.restore();
  return true;
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

  ctx.globalAlpha = alpha;
  ctx.drawImage(
    image,
    sx,
    sy,
    sheet.cellWidth,
    sheet.cellHeight,
    minX,
    minY,
    maxX - minX,
    maxY - minY,
  );
  ctx.globalAlpha = 1;
}

function drawTerrainDecals(tile, corners, tick, now) {
  if (tile.material === "water") {
    const shimmer = ((tile.x * 11 + tile.y * 7 + tick + now / 42) % 48) / 48;
    if (shimmer < 0.5) {
      const point = pointInTile(corners, 0.28 + shimmer * 0.5, 0.42);
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, 9, 2.2, -0.25, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(219, 242, 238, 0.28)";
      ctx.fill();
    }
    return;
  }

  for (const decal of tile.decals) {
    const point = pointInTile(corners, decal.u, decal.v);
    if (decal.kind === "pebble") {
      ctx.beginPath();
      ctx.arc(point.x, point.y, decal.size, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(34, 39, 38, 0.24)";
      ctx.fill();
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(point.x, point.y + decal.size);
    ctx.lineTo(point.x - decal.size * 0.7, point.y);
    ctx.moveTo(point.x, point.y + decal.size);
    ctx.lineTo(point.x + decal.size * 0.55, point.y - decal.size * 0.45);
    ctx.strokeStyle = "rgba(38, 74, 45, 0.42)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
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

function edgeBandPoints(corners, edge) {
  switch (edge) {
    case "north":
      return [corners.nw, corners.ne, pointInTile(corners, 0.72, 0.24), pointInTile(corners, 0.28, 0.24)];
    case "east":
      return [corners.ne, corners.se, pointInTile(corners, 0.76, 0.72), pointInTile(corners, 0.76, 0.28)];
    case "south":
      return [corners.se, corners.sw, pointInTile(corners, 0.28, 0.76), pointInTile(corners, 0.72, 0.76)];
    case "west":
      return [corners.sw, corners.nw, pointInTile(corners, 0.24, 0.28), pointInTile(corners, 0.24, 0.72)];
    default:
      return [corners.nw, corners.ne, pointInTile(corners, 0.72, 0.24), pointInTile(corners, 0.28, 0.24)];
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

function shadeHex(hex, amount) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = match[1];
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  const shaded = channels.map((channel) => {
    const target = amount >= 0 ? 255 : 0;
    return Math.round(channel + (target - channel) * Math.abs(amount));
  });
  return `rgb(${shaded[0]}, ${shaded[1]}, ${shaded[2]})`;
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

function drawObjects(objects, origin) {
  for (const object of objects) {
    const objectZ = terrainHeightAtWorld(terrain, object.x, object.y);
    const point = projectWorld(object.x, object.y, objectZ, origin);
    const colors = objectColors(object.kind);
    const footprint = Math.max(0.65, object.radius / PROJECTION.unitsPerTile);
    drawFootprint(point, footprint, colors.fill, colors.stroke);

    ctx.fillStyle = "#161a1d";
    ctx.font = "700 18px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(object.label, point.x, point.y + PROJECTION.tileH * footprint + 28);

    if (drawObjectSprite(object, point)) {
      continue;
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
  }
}

function drawObjectSprite(object, point) {
  const sprite = sprites.props;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;
  const frameOffset = objectSpriteFrame(object.kind);
  if (frameOffset == null || frameOffset >= sprite.frameCount) return false;

  const sx = (sprite.startFrame + frameOffset) * sprite.cellWidth;
  const dx = Math.round(point.x - sprite.anchor.x);
  const dy = Math.round(point.y - sprite.anchor.y);
  ctx.drawImage(
    sprite.image,
    sx,
    0,
    sprite.cellWidth,
    sprite.cellHeight,
    dx,
    dy,
    sprite.cellWidth,
    sprite.cellHeight,
  );
  return true;
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
    const isMe = player.id === playerId;
    const playerZ = terrainHeightAtWorld(terrain, player.x, player.y);
    const point = projectWorld(player.x, player.y, playerZ, origin);
    drawPlayerShadow(point, isMe, sprites.player);

    if (drawPlayerSprite(player, point, isMe, now)) {
      drawPlayerLabels(player, point);
      continue;
    }

    drawFallbackPlayer(point, player.color, isMe, now, player.id);

    drawPlayerLabels(player, point);
  }
}

function drawFallbackPlayer(point, color, isMe, now, playerKey) {
  const phase = now / 180 + stableIndex(playerKey) * 0.27;
  const stride = Math.sin(phase);
  const counterStride = Math.sin(phase + Math.PI);
  const bob = Math.sin(phase * 2) * 1.6;
  const cloakSway = Math.sin(phase * 0.7) * 2.2;
  const x = point.x;
  const y = point.y + bob;

  ctx.beginPath();
  ctx.ellipse(x, point.y + 29, 22, 7, 0, 0, Math.PI * 2);
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

  ctx.strokeStyle = isMe ? "#fffdf7" : "#141a1d";
  ctx.lineWidth = isMe ? 3 : 2;
  ctx.strokeRect(x - 37, y - 50, 84, 102);
}

function shadePlayerColor(color, factor) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const hex = match[1];
  const channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${channels.map((channel) => Math.round(channel * factor)).join(", ")})`;
}

function drawPlayerSprite(player, point, isMe, now) {
  const sprite = sprites.player;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;

  const frameIndex = Math.floor((now / 120 + stableIndex(player.id)) % sprite.frameCount);
  const sx = (sprite.startFrame + frameIndex) * sprite.cellWidth;
  const sy = 0;
  const dx = Math.round(point.x - sprite.anchor.x);
  const dy = Math.round(point.y - sprite.anchor.y);

  ctx.drawImage(sprite.image, sx, sy, sprite.cellWidth, sprite.cellHeight, dx, dy, sprite.cellWidth, sprite.cellHeight);
  if (isMe) {
    ctx.strokeStyle = "#fffdf7";
    ctx.lineWidth = 3;
    ctx.strokeRect(dx + 31, dy + 23, 66, 90);
  }
  return true;
}

function drawPlayerShadow(point, isMe, sprite) {
  const shadow = sprite?.render?.shadow;
  if (shadow?.kind === "none") return;
  if (shadow?.kind === "ellipse") {
    const anchor = sprite.anchor;
    ctx.beginPath();
    ctx.ellipse(
      point.x + shadow.x - anchor.x,
      point.y + shadow.y - anchor.y,
      shadow.width / 2,
      shadow.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = isMe
      ? `rgba(255, 253, 247, ${Math.min(0.48, shadow.opacity + 0.14)})`
      : `rgba(17, 20, 23, ${shadow.opacity})`;
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.ellipse(point.x, point.y - 2, isMe ? 27 : 23, isMe ? 12 : 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = isMe ? "rgba(255, 253, 247, 0.3)" : "rgba(17, 20, 23, 0.22)";
  ctx.fill();
}

function playerRenderSortKey(player, origin) {
  const sprite = sprites.player;
  const sortMode = sprite?.render?.sort ?? "footprint-y";
  const zBias = sprite?.render?.zBias ?? 0;
  if (sortMode === "fixed") return zBias;
  return projectWorld(player.x, player.y, terrainHeightAtWorld(terrain, player.x, player.y), origin).y + zBias;
}

function drawPlayerLabels(player, point) {
  ctx.fillStyle = "#111417";
  ctx.font = "700 16px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(player.name, point.x, point.y - 18);

  if (player.demoDeeds.length > 0) {
    ctx.fillStyle = "#f2d98b";
    ctx.fillRect(point.x - 13, point.y + 40, 26, 16);
    ctx.strokeStyle = "#7a5c25";
    ctx.lineWidth = 2;
    ctx.strokeRect(point.x - 13, point.y + 40, 26, 16);
  }

  const gathered = inventoryItemCount(player.inventory);
  if (gathered > 0) {
    ctx.fillStyle = "#fffdf7";
    ctx.strokeStyle = "#2a302f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x + 24, point.y + 44, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#2f7565";
    ctx.font = "700 12px system-ui";
    ctx.fillText(String(Math.min(gathered, 99)), point.x + 24, point.y + 48);
  }
}

async function loadSpriteAssets() {
  try {
    const response = await fetch("/assets/sprites/manifest.json", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    const manifest = await response.json();
    const sheet = selectSpriteSheet(manifest, "player-placeholder", "south");
    const propSheet = selectSpriteSheet(manifest, "props-placeholder", "neutral");
    const image = await loadVerifiedPngImage(`/assets/sprites/${sheet.imagePath}`, sheet.imageSha256);
    const propImage = await loadVerifiedPngImage(
      `/assets/sprites/${propSheet.imagePath}`,
      propSheet.imageSha256,
    );
    sprites.player = {
      image,
      cellWidth: sheet.cellWidth,
      cellHeight: sheet.cellHeight,
      anchor: sheet.anchor,
      render: sheet.render,
      startFrame: sheet.startFrame,
      frameCount: sheet.frameCount,
    };
    sprites.props = {
      image: propImage,
      cellWidth: propSheet.cellWidth,
      cellHeight: propSheet.cellHeight,
      anchor: propSheet.anchor,
      render: propSheet.render,
      startFrame: propSheet.startFrame,
      frameCount: propSheet.frameCount,
    };
  } catch (error) {
    console.warn("Sprite assets disabled", error);
    sprites.player = null;
    sprites.props = null;
  }
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
  } catch {
    terrainAssets.atlas = null;
    terrainAssets.image = null;
  }
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

function drawOverlay(rect) {
  ctx.fillStyle = "rgba(17, 20, 23, 0.72)";
  ctx.fillRect(14, 14, 278, 80);
  ctx.fillStyle = "#fffdf7";
  ctx.font = "14px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(`Tick: ${snapshot.tick}`, 28, 40);
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  ctx.fillText(`Players: ${players.length}`, 28, 64);
  ctx.fillText("Server owns position and deed claims", 28, 86);

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
  ui.hud.textContent = `FPS ${Math.round(smoothedFps)} / Players ${players.length} / Tick ${snapshot.tick}`;
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

  if (me?.demoDeeds.length) {
    ui.deedStatus.textContent = `Claimed: ${me.demoDeeds.join(", ")}`;
  } else {
    ui.deedStatus.textContent = "Walk to the Title Office and press E to claim a dry-run deed.";
  }

  ui.resourceStatus.textContent = me
    ? inventorySummary(me.inventory)
    : "Gather wood and ore, then craft at the Field Forge.";
}

function inventorySummary(inventory) {
  if (!inventory.items.length) {
    return `Empty (${inventory.capacitySlots} slots)`;
  }
  const stacks = inventory.items.map((item) => `${item.label}: ${item.quantity}`).join(" / ");
  return `${stacks} (${inventory.items.length}/${inventory.capacitySlots} slots)`;
}

function inventoryItemCount(inventory) {
  return inventory.items.reduce((total, item) => total + item.quantity, 0);
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
    default:
      return { fill: "rgba(22, 26, 29, 0.2)", stroke: "#161a1d" };
  }
}
