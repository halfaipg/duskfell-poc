import { writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

import { updateSpriteImageHash } from "./lib/asset-hashes.js";

const manifestPath = path.resolve("assets", "sprites", "manifest.json");
const cell = 128;
let width = cell * 3;
let height = cell;
let pixels = Buffer.alloc(width * height * 4);

const playerOutputPath = path.resolve("assets", "sprites", "player-placeholder.png");
const propsOutputPath = path.resolve("assets", "sprites", "props-placeholder.png");

for (let frame = 0; frame < 3; frame += 1) {
  drawPlayerFrame(frame);
}

await writeFile(playerOutputPath, encodePng(width, height, pixels));
const playerSha256 = await updateSpriteImageHash({
  manifestPath,
  sheetId: "player-placeholder",
  imagePath: playerOutputPath,
});
console.log(`wrote ${playerOutputPath}`);
console.log(`updated ${manifestPath} player-placeholder imageSha256=${playerSha256}`);

width = cell * 5;
height = cell;
pixels = Buffer.alloc(width * height * 4);
["registrar", "forge", "grove", "ore", "shrine"].forEach((kind, frame) => {
  drawPropFrame(frame, kind);
});

await writeFile(propsOutputPath, encodePng(width, height, pixels));
const propsSha256 = await updateSpriteImageHash({
  manifestPath,
  sheetId: "props-placeholder",
  imagePath: propsOutputPath,
});
console.log(`wrote ${propsOutputPath}`);
console.log(`updated ${manifestPath} props-placeholder imageSha256=${propsSha256}`);

function drawPlayerFrame(frame) {
  const ox = frame * cell;
  const step = frame === 1 ? -4 : frame === 2 ? 4 : 0;
  const anchorX = ox + 64;
  const anchorY = 112;

  fillEllipse(anchorX, anchorY - 2, 29, 10, [18, 22, 24, 64]);
  fillDiamond(anchorX, anchorY - 4, 22, 10, [43, 82, 78, 168]);
  strokeDiamond(anchorX, anchorY - 4, 22, 10, [16, 24, 24, 190]);

  fillRect(ox + 54 + step, 76, 7, 28, [37, 49, 58, 255]);
  fillRect(ox + 67 - step, 76, 7, 28, [37, 49, 58, 255]);
  fillRect(ox + 50 + step, 102, 13, 8, [29, 36, 39, 255]);
  fillRect(ox + 66 - step, 102, 13, 8, [29, 36, 39, 255]);

  fillEllipse(anchorX, 64, 24, 30, [72, 116, 111, 255]);
  fillEllipse(anchorX - 2, 54, 17, 22, [94, 145, 137, 255]);
  fillEllipse(anchorX - 7, 45, 4, 4, [234, 226, 195, 255]);
  fillEllipse(anchorX + 6, 45, 4, 4, [234, 226, 195, 255]);
  fillRect(anchorX - 14, 29, 28, 11, [38, 45, 51, 255]);
  fillRect(anchorX - 18, 38, 36, 5, [28, 34, 38, 255]);
  line(anchorX - 11, 57, anchorX + 12, 61, [35, 81, 78, 170]);
  line(anchorX - 8, 69, anchorX + 10, 73, [42, 71, 70, 150]);

  fillRect(ox + 37 - step, 60, 15, 7, [48, 95, 88, 255]);
  fillRect(ox + 76 + step, 60, 15, 7, [48, 95, 88, 255]);
  fillRect(ox + 31 - step, 64, 10, 8, [82, 52, 47, 255]);
  fillRect(ox + 87 + step, 64, 10, 8, [82, 52, 47, 255]);

  strokeEllipse(anchorX, 58, 25, 35, [18, 24, 26, 210]);
  strokeRect(ox + 32, 24, 64, 88, [18, 24, 26, 78]);
}

function drawPropFrame(frame, kind) {
  const ox = frame * cell;
  const anchorX = ox + 64;
  const anchorY = 104;
  fillEllipse(anchorX, anchorY + 10, 33, 11, [18, 22, 24, 54]);

  if (kind === "registrar") {
    fillDiamond(anchorX, anchorY + 2, 36, 15, [158, 143, 110, 170]);
    fillRect(ox + 38, 58, 52, 39, [221, 213, 190, 255]);
    fillRect(ox + 33, 47, 62, 13, [132, 62, 52, 255]);
    fillTriangle([[ox + 31, 47], [anchorX, 28], [ox + 97, 47]], [177, 82, 62, 255]);
    fillRect(ox + 57, 73, 14, 24, [49, 105, 93, 255]);
    fillRect(ox + 43, 64, 10, 10, [82, 125, 134, 255]);
    fillRect(ox + 77, 64, 10, 10, [82, 125, 134, 255]);
    strokeRect(ox + 38, 58, 52, 39, [54, 48, 42, 150]);
    strokeTriangle([[ox + 31, 47], [anchorX, 28], [ox + 97, 47]], [54, 38, 35, 145]);
  } else if (kind === "forge") {
    fillDiamond(anchorX, anchorY + 4, 32, 13, [73, 68, 60, 190]);
    fillRect(ox + 38, 69, 52, 25, [71, 75, 78, 255]);
    fillRect(ox + 43, 61, 42, 13, [48, 52, 55, 255]);
    fillRect(ox + 50, 72, 28, 10, [217, 130, 66, 255]);
    fillRect(ox + 55, 73, 18, 7, [245, 188, 91, 230]);
    strokeRect(ox + 38, 69, 52, 25, [24, 28, 30, 200]);
    line(ox + 37, 61, ox + 91, 61, [191, 191, 176, 120]);
  } else if (kind === "grove") {
    fillRect(anchorX - 6, 69, 12, 33, [93, 64, 42, 255]);
    fillEllipse(anchorX - 17, 57, 21, 24, [64, 111, 63, 255]);
    fillEllipse(anchorX + 14, 55, 24, 27, [78, 130, 72, 255]);
    fillEllipse(anchorX, 39, 28, 25, [96, 145, 83, 255]);
    fillEllipse(anchorX - 12, 42, 12, 11, [139, 166, 103, 170]);
    strokeEllipse(anchorX, 52, 36, 32, [30, 55, 37, 150]);
  } else if (kind === "ore") {
    fillDiamond(anchorX, 93, 34, 18, [76, 80, 82, 220]);
    fillTriangle([[ox + 36, 92], [ox + 53, 61], [ox + 65, 97]], [96, 100, 103, 255]);
    fillTriangle([[ox + 56, 95], [ox + 73, 53], [ox + 92, 93]], [128, 130, 126, 255]);
    fillTriangle([[ox + 69, 94], [ox + 91, 66], [ox + 98, 101]], [86, 91, 93, 255]);
    line(ox + 57, 72, ox + 67, 91, [190, 178, 126, 170]);
    line(ox + 76, 64, ox + 84, 88, [205, 194, 142, 160]);
    strokeDiamond(anchorX, 89, 38, 26, [39, 43, 43, 145]);
  } else if (kind === "shrine") {
    fillEllipse(anchorX, 91, 30, 13, [78, 78, 73, 160]);
    fillRect(ox + 46, 63, 36, 32, [180, 180, 169, 255]);
    fillRect(ox + 50, 56, 28, 9, [132, 134, 130, 255]);
    fillEllipse(anchorX, 69, 12, 15, [218, 220, 208, 255]);
    fillEllipse(anchorX, 69, 7, 9, [96, 101, 98, 230]);
    fillRect(anchorX - 3, 79, 6, 14, [125, 127, 121, 255]);
    strokeEllipse(anchorX, 69, 14, 17, [59, 63, 63, 150]);
    strokeRect(ox + 46, 63, 36, 32, [65, 66, 61, 125]);
  }
}

function fillRect(x, y, w, h, rgba) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      setPixel(px, py, rgba);
    }
  }
}

function strokeRect(x, y, w, h, rgba) {
  for (let px = x; px < x + w; px += 1) {
    setPixel(px, y, rgba);
    setPixel(px, y + h - 1, rgba);
  }
  for (let py = y; py < y + h; py += 1) {
    setPixel(x, py, rgba);
    setPixel(x + w - 1, py, rgba);
  }
}

function fillEllipse(cx, cy, rx, ry, rgba) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
      const nx = (px - cx) / rx;
      const ny = (py - cy) / ry;
      if (nx * nx + ny * ny <= 1) setPixel(px, py, rgba);
    }
  }
}

function strokeEllipse(cx, cy, rx, ry, rgba) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
      const nx = (px - cx) / rx;
      const ny = (py - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 0.9 && d <= 1.08) setPixel(px, py, rgba);
    }
  }
}

function fillDiamond(cx, cy, rx, ry, rgba) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
      if (Math.abs(px - cx) / rx + Math.abs(py - cy) / ry <= 1) setPixel(px, py, rgba);
    }
  }
}

function strokeDiamond(cx, cy, rx, ry, rgba) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
      const d = Math.abs(px - cx) / rx + Math.abs(py - cy) / ry;
      if (d > 0.86 && d <= 1.08) setPixel(px, py, rgba);
    }
  }
}

function fillTriangle(points, rgba) {
  const minX = Math.floor(Math.min(...points.map(([x]) => x)));
  const maxX = Math.ceil(Math.max(...points.map(([x]) => x)));
  const minY = Math.floor(Math.min(...points.map(([, y]) => y)));
  const maxY = Math.ceil(Math.max(...points.map(([, y]) => y)));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInTriangle(x + 0.5, y + 0.5, points)) setPixel(x, y, rgba);
    }
  }
}

function strokeTriangle(points, rgba) {
  line(points[0][0], points[0][1], points[1][0], points[1][1], rgba);
  line(points[1][0], points[1][1], points[2][0], points[2][1], rgba);
  line(points[2][0], points[2][1], points[0][0], points[0][1], rgba);
}

function pointInTriangle(x, y, points) {
  const [a, b, c] = points;
  const w1 =
    (a[0] * (c[1] - a[1]) + (y - a[1]) * (c[0] - a[0]) - x * (c[1] - a[1])) /
    ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]));
  const w2 = (y - a[1] - w1 * (b[1] - a[1])) / (c[1] - a[1]);
  return w1 >= 0 && w2 >= 0 && w1 + w2 <= 1;
}

function line(x0, y0, x1, y1, rgba) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    setPixel(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), rgba);
  }
}

function setPixel(x, y, rgba) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  const alpha = rgba[3] / 255;
  const inverse = 1 - alpha;
  pixels[offset] = Math.round(rgba[0] * alpha + pixels[offset] * inverse);
  pixels[offset + 1] = Math.round(rgba[1] * alpha + pixels[offset + 1] * inverse);
  pixels[offset + 2] = Math.round(rgba[2] * alpha + pixels[offset + 2] * inverse);
  pixels[offset + 3] = Math.min(255, Math.round(rgba[3] + pixels[offset + 3] * inverse));
}

function encodePng(pngWidth, pngHeight, rgba) {
  const scanlines = Buffer.alloc((pngWidth * 4 + 1) * pngHeight);
  for (let y = 0; y < pngHeight; y += 1) {
    const rowStart = y * (pngWidth * 4 + 1);
    scanlines[rowStart] = 0;
    rgba.copy(scanlines, rowStart + 1, y * pngWidth * 4, (y + 1) * pngWidth * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr(pngWidth, pngHeight)),
    chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(pngWidth, pngHeight) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(pngWidth, 0);
  data.writeUInt32BE(pngHeight, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
