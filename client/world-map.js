import { PROJECTION } from "./projection.js";

// M-key world map: rendered from the client's own loaded terrain (materials,
// WorldData heights), so it is always truthful to what the renderer sees.
// Hillshaded, peak-whitened, with live player markers.
const MATERIAL_COLORS = {
  grass: [106, 124, 78],
  field: [116, 128, 82],
  dirt: [126, 104, 72],
  stone: [120, 118, 116],
  rock: [122, 120, 118],
  water: [52, 78, 92],
  shore: [180, 164, 130],
  settlement: [200, 186, 150],
  cobble: [150, 142, 128],
  ruin: [138, 130, 118],
};

let mapCanvas = null;
let mapKey = null;
let visible = false;
// hand-inked art version baked per world by the img2img pipeline; the data
// render below remains the always-correct fallback
const mapArt = new Image();
mapArt.src = "/assets/terrain/world-map-art.png";

export function toggleWorldMap() {
  visible = !visible;
  return visible;
}

export function isWorldMapVisible() {
  return visible;
}

function ensureMapCanvas(terrain) {
  const key = `${terrain.cols}x${terrain.rows}:${terrain.tiles.length}`;
  if (mapCanvas && mapKey === key) return mapCanvas;
  const scale = Math.max(2, Math.floor(512 / Math.max(terrain.cols, terrain.rows)) + 2);
  const canvas = document.createElement("canvas");
  canvas.width = terrain.cols * scale;
  canvas.height = terrain.rows * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(canvas.width, canvas.height);
  const wd = terrain.worldData;
  for (let y = 0; y < terrain.rows; y += 1) {
    for (let x = 0; x < terrain.cols; x += 1) {
      const tile = terrain.tiles[y * terrain.cols + x];
      let [r, g, b] = MATERIAL_COLORS[tile.material] ?? [110, 110, 110];
      const hC = wd.heightAt(x + 0.5, y + 0.5);
      // hillshade from height gradient
      const hE = wd.heightAt(x + 1.5, y + 0.5);
      const hS = wd.heightAt(x + 0.5, y + 1.5);
      const shade = Math.max(0.45, Math.min(1.25, 1 + (hC - hE) * 0.22 + (hC - hS) * 0.22));
      // high country whitens toward impassable peaks
      const peak = Math.max(0, Math.min(1, (hC - 2.8) / 1.2));
      r = (r * (1 - peak) + 226 * peak) * shade;
      g = (g * (1 - peak) + 223 * peak) * shade;
      b = (b * (1 - peak) + 219 * peak) * shade;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const offset = ((y * scale + sy) * canvas.width + x * scale + sx) * 4;
          image.data[offset] = Math.min(255, r);
          image.data[offset + 1] = Math.min(255, g);
          image.data[offset + 2] = Math.min(255, b);
          image.data[offset + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  mapCanvas = canvas;
  mapKey = key;
  return mapCanvas;
}

export function drawWorldMap(ctx, rect, terrain, players, localPlayerId) {
  if (!visible || !terrain?.worldData) return;
  const map = ensureMapCanvas(terrain);
  if (!map) return;

  const margin = Math.min(rect.width, rect.height) * 0.06;
  const availW = rect.width - margin * 2;
  const availH = rect.height - margin * 2;
  const scale = Math.min(availW / map.width, availH / map.height);
  const drawW = map.width * scale;
  const drawH = map.height * scale;
  const x0 = (rect.width - drawW) / 2;
  const y0 = (rect.height - drawH) / 2;

  ctx.save();
  // dimmed world behind, parchment-framed chart in front
  ctx.fillStyle = "rgba(12, 14, 12, 0.72)";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#241f17";
  ctx.fillRect(x0 - 14, y0 - 14, drawW + 28, drawH + 28);
  ctx.strokeStyle = "#8a6f45";
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 9, y0 - 9, drawW + 18, drawH + 18);
  ctx.imageSmoothingEnabled = true;
  if (mapArt.complete && mapArt.naturalWidth > 0) {
    ctx.drawImage(mapArt, x0, y0, drawW, drawH);
  } else {
    ctx.drawImage(map, x0, y0, drawW, drawH);
  }
  // soft vignette
  const grad = ctx.createRadialGradient(
    x0 + drawW / 2, y0 + drawH / 2, Math.min(drawW, drawH) * 0.42,
    x0 + drawW / 2, y0 + drawH / 2, Math.max(drawW, drawH) * 0.72,
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(20,16,10,0.42)");
  ctx.fillStyle = grad;
  ctx.fillRect(x0, y0, drawW, drawH);

  // players
  const units = PROJECTION.unitsPerTile;
  for (const player of players) {
    const px = x0 + (player.x / units / terrain.cols) * drawW;
    const py = y0 + (player.y / units / terrain.rows) * drawH;
    const isMe = player.id === localPlayerId;
    ctx.beginPath();
    ctx.arc(px, py, isMe ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? "#f2d98b" : "#d8e4dc";
    ctx.fill();
    ctx.strokeStyle = "#1c1a14";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (isMe) {
      ctx.font = "700 13px Georgia, serif";
      ctx.fillStyle = "#f2d98b";
      ctx.textAlign = "center";
      ctx.fillText("You", px, py - 11);
    }
  }

  ctx.font = "700 20px Georgia, serif";
  ctx.fillStyle = "#e6d9b8";
  ctx.textAlign = "center";
  ctx.fillText("Duskfell", rect.width / 2, y0 - 22);
  ctx.font = "12px system-ui";
  ctx.fillStyle = "#9b917c";
  ctx.fillText("press M to close", rect.width / 2, y0 + drawH + 26);
  ctx.restore();
}
