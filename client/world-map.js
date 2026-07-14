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


export function toggleWorldMap() {
  visible = !visible;
  return visible;
}

export function isWorldMapVisible() {
  return visible;
}

// hand-drawn cartography, computed from the real world data so geography
// is always truthful: parchment grain, inked water, hachure strokes on the
// actual peaks, forest ticks where vegetation actually grows
function ensureMapCanvas(terrain) {
  const key = `${terrain.cols}x${terrain.rows}:${terrain.tiles.length}`;
  if (mapCanvas && mapKey === key) return mapCanvas;
  const scale = Math.max(3, Math.floor(640 / Math.max(terrain.cols, terrain.rows)) + 3);
  const canvas = document.createElement("canvas");
  canvas.width = terrain.cols * scale;
  canvas.height = terrain.rows * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const wd = terrain.worldData;
  const hash = (a, b) => {
    let v = (Math.imul(a + 37, 374761393) ^ Math.imul(b + 91, 668265263)) >>> 0;
    return ((Math.imul(v ^ (v >>> 13), 1274126177) >>> 0) % 1000) / 1000;
  };
  const tileAt = (x, y) =>
    x < 0 || y < 0 || x >= terrain.cols || y >= terrain.rows
      ? null
      : terrain.tiles[y * terrain.cols + x];

  // parchment wash + terrain tint per tile
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < terrain.rows; y += 1) {
    for (let x = 0; x < terrain.cols; x += 1) {
      const tile = tileAt(x, y);
      const hC = wd.heightAt(x + 0.5, y + 0.5);
      const hE = wd.heightAt(x + 1.5, y + 0.5);
      const hS = wd.heightAt(x + 0.5, y + 1.5);
      const shade = Math.max(0.8, Math.min(1.12, 1 + (hC - hE) * 0.09 + (hC - hS) * 0.09));
      let r = 226, g = 214, b = 184; // parchment
      if (tile.material === "water") {
        r = 118; g = 142; b = 148;
      } else {
        const veg = tile.biome?.vegetation ?? 0;
        const heath = Math.max(0, Math.min(1, wd.heathWeightAt(x + 0.5, y + 0.5)));
        r -= veg * 34 + heath * 26;
        g -= veg * 12 + heath * 26;
        b -= veg * 30 + heath * 6;
        const peak = Math.max(0, Math.min(1, (hC - 2.6) / 1.4));
        r = r * (1 - peak * 0.16) + 8 * peak;
        g = g * (1 - peak * 0.16) + 8 * peak;
        b = b * (1 - peak * 0.14) + 8 * peak;
      }
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const grain = (hash(x * scale + sx, y * scale + sy) - 0.5) * 12;
          const offset = ((y * scale + sy) * canvas.width + x * scale + sx) * 4;
          image.data[offset] = Math.max(0, Math.min(255, r * shade + grain));
          image.data[offset + 1] = Math.max(0, Math.min(255, g * shade + grain));
          image.data[offset + 2] = Math.max(0, Math.min(255, b * shade + grain));
          image.data[offset + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);

  // ink pass: coastlines, hachures on real peaks, forest ticks, fords
  ctx.lineCap = "round";
  for (let y = 0; y < terrain.rows; y += 1) {
    for (let x = 0; x < terrain.cols; x += 1) {
      const tile = tileAt(x, y);
      const px = x * scale;
      const py = y * scale;
      if (tile.material === "water") {
        // coast ink where water meets land
        ctx.strokeStyle = "rgba(46, 60, 66, 0.85)";
        ctx.lineWidth = 1.2;
        const east = tileAt(x + 1, y);
        const south = tileAt(x, y + 1);
        const west = tileAt(x - 1, y);
        const north = tileAt(x, y - 1);
        ctx.beginPath();
        if (east && east.material !== "water") { ctx.moveTo(px + scale, py); ctx.lineTo(px + scale, py + scale); }
        if (west && west.material !== "water") { ctx.moveTo(px, py); ctx.lineTo(px, py + scale); }
        if (south && south.material !== "water") { ctx.moveTo(px, py + scale); ctx.lineTo(px + scale, py + scale); }
        if (north && north.material !== "water") { ctx.moveTo(px, py); ctx.lineTo(px + scale, py); }
        ctx.stroke();
        continue;
      }
      const hC = wd.heightAt(x + 0.5, y + 0.5);
      if (hC > 3.1 && hash(x, y) > 0.45) {
        // hachure caret on genuine high ground
        const cx = px + scale * (0.3 + hash(x + 7, y) * 0.4);
        const cy = py + scale * (0.35 + hash(x, y + 7) * 0.35);
        const w = scale * (0.38 + hash(x + 3, y + 3) * 0.3);
        ctx.strokeStyle = "rgba(58, 50, 40, 0.85)";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(cx - w, cy + w * 0.62);
        ctx.lineTo(cx, cy - w * 0.66);
        ctx.lineTo(cx + w, cy + w * 0.62);
        ctx.stroke();
        ctx.strokeStyle = "rgba(58, 50, 40, 0.35)";
        ctx.beginPath();
        ctx.moveTo(cx, cy - w * 0.5);
        ctx.lineTo(cx + w * 0.55, cy + w * 0.5);
        ctx.stroke();
      } else if ((tile.biome?.vegetation ?? 0) > 0.55 && tile.material === "grass" && hash(x + 11, y + 5) > 0.6) {
        // forest tick
        const cx = px + scale * (0.3 + hash(x + 1, y + 9) * 0.4);
        const cy = py + scale * (0.4 + hash(x + 9, y + 1) * 0.3);
        ctx.strokeStyle = "rgba(52, 66, 44, 0.8)";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx, cy + scale * 0.26);
        ctx.lineTo(cx, cy - scale * 0.1);
        ctx.moveTo(cx - scale * 0.16, cy + scale * 0.06);
        ctx.lineTo(cx, cy - scale * 0.22);
        ctx.lineTo(cx + scale * 0.16, cy + scale * 0.06);
        ctx.stroke();
      } else if (tile.material === "shore") {
        ctx.fillStyle = "rgba(150, 128, 92, 0.9)";
        ctx.fillRect(px + scale * 0.25, py + scale * 0.4, scale * 0.5, scale * 0.2);
      } else if (tile.material === "settlement") {
        ctx.fillStyle = "rgba(96, 72, 48, 0.9)";
        ctx.fillRect(px + scale * 0.2, py + scale * 0.2, scale * 0.6, scale * 0.6);
      }
    }
  }
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
  ctx.drawImage(map, x0, y0, drawW, drawH);
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
