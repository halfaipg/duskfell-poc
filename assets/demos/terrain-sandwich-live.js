const canvas = document.querySelector("#world");
const context = canvas.getContext("2d", { alpha: false });
const status = document.querySelector("#status");
const query = new URLSearchParams(window.location.search);
const visualTest = query.get("visualTest") === "1";

const MAP_SIZE = 1024;
const PLAYER_SPEED = 158;
const WALK_FRAMES = [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2];
const DIRECTION_ROWS = { south: 0, east: 1, north: 2, west: 3 };
const terrainSources = {
  snow: {
    regional: "/assets/terrain/candidates/border-band-snowfringe.png",
    local: "/assets/terrain/candidates/lod1-snowfringe-grid-fantasy.png",
  },
  hdSnow: {
    regional: "/assets/terrain/candidates/border-band-snowfringe.png",
    local: "/assets/terrain/candidates/proof-style-uo-hd-snow.png",
  },
  fantasy: {
    regional: "/assets/terrain/candidates/proof-structure-grid-input.png",
    local: "/assets/terrain/candidates/proof-strength-060-darkage.png",
  },
  oil: {
    regional: "/assets/terrain/candidates/proof-structure-grid-input.png",
    local: "/assets/terrain/candidates/proof-structure-grid-oil.png",
  },
  native: {
    regional: "/assets/terrain/candidates/proof-structure-grid-input.png",
    local: "/assets/terrain/candidates/proof-structure-native-enriched.png",
  },
};

const terrainImages = new Map();
const [playerImage, authorityImage] = await Promise.all([
  loadImage("/assets/sprites/duskfell-wretch.png"),
  loadImage("/assets/terrain/candidates/proof-structure-grid-input.png"),
]);
const authorityCanvas = document.createElement("canvas");
authorityCanvas.width = MAP_SIZE;
authorityCanvas.height = MAP_SIZE;
const authorityContext = authorityCanvas.getContext("2d", { willReadFrequently: true });
authorityContext.drawImage(authorityImage, 0, 0, MAP_SIZE, MAP_SIZE);

const state = {
  mode: "snow",
  zoom: initialZoom(query.get("zoom")),
  player: { x: 560, y: 420 },
  target: null,
  direction: "south",
  walkDistance: 0,
  keys: new Set(),
  lastFrame: performance.now(),
  fps: 60,
};

await Promise.all(Object.entries(terrainSources).map(loadTerrain));
resizeCanvas();
status.textContent = "Snow fringe • local • 60 fps";
requestAnimationFrame(frame);

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.code)) {
    state.keys.add(event.code);
    state.target = null;
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => state.keys.delete(event.code));
canvas.addEventListener("pointerdown", (event) => {
  const world = screenToWorld(event.clientX, event.clientY);
  state.target = clampWorld(world);
});
canvas.addEventListener(
  "wheel",
  (event) => {
    setZoom(state.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
    event.preventDefault();
  },
  { passive: false },
);

for (const button of document.querySelectorAll(".mode")) {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    for (const peer of document.querySelectorAll(".mode")) {
      peer.classList.toggle("active", peer === button);
    }
  });
}
document.querySelector("#zoom-in").addEventListener("click", () => setZoom(state.zoom * 1.12));
document.querySelector("#zoom-out").addEventListener("click", () => setZoom(state.zoom * 0.88));

function frame(now) {
  const elapsed = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
  state.lastFrame = now;
  state.fps += ((1 / Math.max(elapsed, 0.001)) - state.fps) * 0.06;
  const moved = updatePlayer(elapsed);
  drawWorld(now, moved);
  const viewLabel = state.zoom < 0.98 ? "regional" : "local";
  status.textContent = `${modeLabel(state.mode)} • ${viewLabel} • ${Math.round(state.fps)} fps`;
  if (!visualTest) requestAnimationFrame(frame);
}

function updatePlayer(elapsed) {
  let dx = 0;
  let dy = 0;
  if (state.keys.has("KeyW") || state.keys.has("ArrowUp")) dy -= 1;
  if (state.keys.has("KeyS") || state.keys.has("ArrowDown")) dy += 1;
  if (state.keys.has("KeyA") || state.keys.has("ArrowLeft")) dx -= 1;
  if (state.keys.has("KeyD") || state.keys.has("ArrowRight")) dx += 1;

  if (dx === 0 && dy === 0 && state.target) {
    dx = state.target.x - state.player.x;
    dy = state.target.y - state.player.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 4) {
      state.target = null;
      return false;
    }
    dx /= distance;
    dy /= distance;
  }
  const length = Math.hypot(dx, dy);
  if (length === 0) return false;
  dx /= length;
  dy /= length;

  const next = clampWorld({
    x: state.player.x + dx * PLAYER_SPEED * elapsed,
    y: state.player.y + dy * PLAYER_SPEED * elapsed,
  });
  if (walkableAt(next.x, next.y)) {
    state.player = next;
  } else if (walkableAt(next.x, state.player.y)) {
    state.player.x = next.x;
  } else if (walkableAt(state.player.x, next.y)) {
    state.player.y = next.y;
  } else {
    state.target = null;
  }
  state.direction = directionForMovement(dx, dy);
  state.walkDistance += PLAYER_SPEED * elapsed;
  return true;
}

function drawWorld(now, moving) {
  const width = canvas.width / devicePixelRatio;
  const height = canvas.height / devicePixelRatio;
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.fillStyle = "#0d1010";
  context.fillRect(0, 0, width, height);

  const terrain = terrainImages.get(state.mode);
  const centerX = width * 0.5;
  const centerY = height * 0.53;
  const zoom = state.zoom;
  const localAlpha = smoothstep(0.78, 1.08, zoom);
  drawTerrainLayer(terrain.regional, zoom, 1 - localAlpha, centerX, centerY);
  drawTerrainLayer(terrain.local, zoom, localAlpha, centerX, centerY);

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  if (localAlpha > 0.35) {
    if (state.target) drawTarget(state.target, centerX, centerY);
    drawPlayer(now, moving, centerX, centerY, localAlpha);
  } else {
    drawRegionalMarker(centerX, centerY);
  }
}

function drawTerrainLayer(image, zoom, alpha, centerX, centerY) {
  if (!image || alpha <= 0) return;
  const e = centerX - (state.player.x - state.player.y) * 0.5 * zoom;
  const f = centerY - (state.player.x + state.player.y) * 0.5 * zoom;
  context.save();
  context.globalAlpha = alpha;
  context.imageSmoothingEnabled = true;
  context.setTransform(
    0.5 * zoom * devicePixelRatio,
    0.5 * zoom * devicePixelRatio,
    -0.5 * zoom * devicePixelRatio,
    0.5 * zoom * devicePixelRatio,
    e * devicePixelRatio,
    f * devicePixelRatio,
  );
  context.drawImage(image, 0, 0, MAP_SIZE, MAP_SIZE);
  context.restore();
}

function drawRegionalMarker(x, y) {
  context.save();
  context.fillStyle = "rgba(243, 219, 151, 0.94)";
  context.strokeStyle = "rgba(29, 24, 16, 0.9)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y, 5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawTarget(target, centerX, centerY) {
  const projected = worldToScreen(target.x, target.y, centerX, centerY);
  context.save();
  context.strokeStyle = "rgba(239, 223, 175, 0.7)";
  context.lineWidth = 1;
  context.beginPath();
  context.ellipse(projected.x, projected.y, 10, 5, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawPlayer(now, moving, x, y, alpha) {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = "rgba(0, 0, 0, 0.34)";
  context.beginPath();
  context.ellipse(x, y + 4, 19, 6, 0, 0, Math.PI * 2);
  context.fill();

  const row = DIRECTION_ROWS[state.direction];
  const walkIndex = Math.floor(state.walkDistance / 15) % WALK_FRAMES.length;
  const column = moving ? WALK_FRAMES[walkIndex] : 0;
  const drawSize = 108;
  context.imageSmoothingEnabled = false;
  context.drawImage(
    playerImage,
    column * 128,
    row * 128,
    128,
    128,
    Math.round(x - drawSize / 2),
    Math.round(y - drawSize * (116 / 128)),
    drawSize,
    drawSize,
  );
  context.restore();
}

function walkableAt(x, y) {
  if (state.mode === "snow" || state.mode === "hdSnow") return true;
  const pixel = authorityContext.getImageData(
    Math.max(0, Math.min(MAP_SIZE - 1, Math.round(x))),
    Math.max(0, Math.min(MAP_SIZE - 1, Math.round(y))),
    1,
    1,
  ).data;
  const water = pixel[2] > pixel[0] * 1.45 && pixel[1] > pixel[0] * 1.6;
  return !water;
}

function directionForMovement(dx, dy) {
  const screenX = dx - dy;
  const screenY = dx + dy;
  if (Math.abs(screenX) > Math.abs(screenY)) return screenX > 0 ? "east" : "west";
  return screenY > 0 ? "south" : "north";
}

function screenToWorld(screenX, screenY) {
  const width = canvas.width / devicePixelRatio;
  const height = canvas.height / devicePixelRatio;
  const deltaX = (screenX - width * 0.5) / state.zoom;
  const deltaY = (screenY - height * 0.53) / state.zoom;
  return {
    x: state.player.x + deltaX + deltaY,
    y: state.player.y - deltaX + deltaY,
  };
}

function worldToScreen(x, y, centerX, centerY) {
  return {
    x: centerX + ((x - y) - (state.player.x - state.player.y)) * 0.5 * state.zoom,
    y: centerY + ((x + y) - (state.player.x + state.player.y)) * 0.5 * state.zoom,
  };
}

function clampWorld(point) {
  return {
    x: Math.max(26, Math.min(MAP_SIZE - 26, point.x)),
    y: Math.max(26, Math.min(MAP_SIZE - 26, point.y)),
  };
}

function resizeCanvas() {
  canvas.width = Math.round(window.innerWidth * devicePixelRatio);
  canvas.height = Math.round(window.innerHeight * devicePixelRatio);
}

function setZoom(value) {
  state.zoom = Math.max(0.55, Math.min(2.4, value));
}

function initialZoom(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0.55, Math.min(2.4, parsed)) : 1.34;
}

async function loadTerrain([mode, sources]) {
  const [regional, local] = await Promise.all([
    loadImage(sources.regional),
    loadImage(sources.local),
  ]);
  terrainImages.set(mode, { regional, local });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${source}`));
    image.src = source;
  });
}

function modeLabel(mode) {
  if (mode === "snow") return "Snow fringe";
  if (mode === "hdSnow") return "HD snow proof";
  if (mode === "fantasy") return "HD river • 8 steps / 0.60";
  if (mode === "oil") return "Grid oil";
  return "OpenAI native";
}

function smoothstep(edge0, edge1, value) {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}
