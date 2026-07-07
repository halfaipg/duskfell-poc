import { writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

import { updateSpriteImageHash } from "./lib/asset-hashes.js";

const manifestPath = path.resolve("assets", "sprites", "manifest.json");
const cell = 128;
let width = cell * 4;
let height = cell * 4;
let pixels = Buffer.alloc(width * height * 4);

const playerOutputPath = path.resolve("assets", "sprites", "player-placeholder.png");
const propsOutputPath = path.resolve("assets", "sprites", "props-placeholder.png");

["south", "east", "north", "west"].forEach((direction, row) => {
  for (let frame = 0; frame < 4; frame += 1) {
    drawPlayerFrame(direction, row, frame);
  }
});

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

function drawPlayerFrame(direction, row, frame) {
  const ox = frame * cell;
  const oy = row * cell;
  const step = frame === 1 ? -5 : frame === 3 ? 5 : 0;
  const bob = frame === 0 ? 0 : frame === 2 ? -2 : 1;
  const anchorX = ox + 64;
  const anchorY = oy + 112;
  const isEast = direction === "east";
  const isWest = direction === "west";
  const isNorth = direction === "north";
  const side = isWest ? -1 : 1;

  fillEllipse(anchorX, anchorY - 1, 30, 10, [9, 13, 15, 92]);
  fillDiamond(anchorX, anchorY - 6, 22, 10, [31, 56, 53, 205]);
  strokeDiamond(anchorX, anchorY - 6, 22, 10, [8, 14, 15, 230]);

  if (isEast || isWest) {
    fillRect(anchorX - 8 + step * 0.4, oy + 81, 8, 27, [30, 37, 43, 255]);
    fillRect(anchorX + 5 - step * 0.4, oy + 81, 8, 27, [24, 30, 35, 255]);
    fillRect(anchorX - 13 + step, oy + 105, 17, 7, [18, 24, 28, 255]);
    fillRect(anchorX + 1 - step, oy + 105, 17, 7, [18, 24, 28, 255]);
    fillTriangle(
      [
        [anchorX - 18 * side, oy + 49 + bob],
        [anchorX - 15 * side, oy + 106],
        [anchorX + 7 * side, oy + 91],
      ],
      [22, 34, 39, 235],
    );
    fillTriangle(
      [
        [anchorX + 22 * side, oy + 50 + bob],
        [anchorX + 18 * side, oy + 104],
        [anchorX - 2 * side, oy + 91],
      ],
      [18, 29, 35, 230],
    );
    fillEllipse(anchorX + 1 * side, oy + 65 + bob, 17, 30, [70, 72, 66, 255]);
    fillRect(anchorX - 10, oy + 52 + bob, 22, 34, [88, 92, 82, 255]);
  } else {
    fillRect(anchorX - 17 + step, oy + 81, 9, 27, [30, 37, 43, 255]);
    fillRect(anchorX + 8 - step, oy + 81, 9, 27, [30, 37, 43, 255]);
    fillRect(anchorX - 21 + step, oy + 105, 17, 7, [18, 24, 28, 255]);
    fillRect(anchorX + 4 - step, oy + 105, 17, 7, [18, 24, 28, 255]);
    fillTriangle([[anchorX - 25, oy + 49 + bob], [anchorX - 20, oy + 106], [anchorX + 2, oy + 91]], [22, 34, 39, 235]);
    fillTriangle([[anchorX + 25, oy + 49 + bob], [anchorX + 20, oy + 106], [anchorX - 2, oy + 91]], [18, 29, 35, 230]);
    fillEllipse(anchorX, oy + 65 + bob, 22, 30, [70, 72, 66, 255]);
    fillRect(anchorX - 15, oy + 52 + bob, 30, 34, [88, 92, 82, 255]);
  }

  for (let chain = -9; chain <= 9; chain += 6) {
    fillRect(anchorX + chain, oy + 56 + bob, 2, 25, [185, 183, 157, 150]);
  }
  fillTriangle([[anchorX - 17, oy + 82 + bob], [anchorX, oy + 108], [anchorX + 17, oy + 82 + bob]], [42, 52, 50, 255]);
  fillRect(anchorX - 12, oy + 70 + bob, 24, 8, [54, 59, 54, 210]);
  fillRect(anchorX - 4, oy + 73 + bob, 8, 25, [132, 84, 55, 255]);
  fillRect(anchorX - 8, oy + 73 + bob, 16, 4, [204, 153, 83, 255]);

  if (isNorth) {
    fillEllipse(anchorX, oy + 39 + bob, 14, 16, [77, 74, 65, 255]);
    fillRect(anchorX - 13, oy + 28 + bob, 26, 8, [101, 110, 106, 255]);
    fillRect(anchorX - 18, oy + 35 + bob, 36, 5, [64, 72, 72, 255]);
    fillTriangle([[anchorX - 17, oy + 36 + bob], [anchorX, oy + 18 + bob], [anchorX + 17, oy + 36 + bob]], [104, 112, 108, 255]);
    line(anchorX - 8, oy + 47 + bob, anchorX + 8, oy + 47 + bob, [31, 41, 42, 180]);
  } else if (isEast || isWest) {
    fillEllipse(anchorX + 2 * side, oy + 39 + bob, 12, 16, [174, 134, 94, 255]);
    fillRect(anchorX - 11, oy + 28 + bob, 23, 8, [101, 110, 106, 255]);
    fillRect(anchorX - 15, oy + 35 + bob, 31, 5, [64, 72, 72, 255]);
    fillTriangle([[anchorX - 14, oy + 36 + bob], [anchorX, oy + 18 + bob], [anchorX + 14, oy + 36 + bob]], [104, 112, 108, 255]);
    line(anchorX + 4 * side, oy + 30 + bob, anchorX + 8 * side, oy + 50 + bob, [223, 206, 143, 235]);
    fillEllipse(anchorX + 7 * side, oy + 38 + bob, 3, 3, [239, 230, 190, 255]);
    line(anchorX + 4 * side, oy + 50 + bob, anchorX + 12 * side, oy + 50 + bob, [21, 61, 63, 195]);
  } else {
    fillEllipse(anchorX - 1, oy + 39 + bob, 14, 16, [174, 134, 94, 255]);
    fillRect(anchorX - 12, oy + 28 + bob, 24, 8, [101, 110, 106, 255]);
    fillRect(anchorX - 17, oy + 35 + bob, 34, 5, [64, 72, 72, 255]);
    fillTriangle([[anchorX - 17, oy + 36 + bob], [anchorX, oy + 18 + bob], [anchorX + 17, oy + 36 + bob]], [104, 112, 108, 255]);
    line(anchorX, oy + 30 + bob, anchorX, oy + 50 + bob, [223, 206, 143, 235]);
    fillEllipse(anchorX - 6, oy + 38 + bob, 3, 3, [239, 230, 190, 255]);
    fillEllipse(anchorX + 6, oy + 38 + bob, 3, 3, [239, 230, 190, 255]);
    line(anchorX - 7, oy + 49 + bob, anchorX + 8, oy + 52 + bob, [21, 61, 63, 195]);
  }

  if (isEast || isWest) {
    fillRect(anchorX - 32 * side - step * side, oy + 58 + bob, 28 * side, 7, [45, 95, 87, 255]);
    fillRect(anchorX + 13 * side + step * side, oy + 58 + bob, 26 * side, 7, [45, 95, 87, 255]);
    fillEllipse(anchorX - 24 * side - step * side, oy + 74 + bob, 11, 17, [47, 58, 64, 255]);
    strokeEllipse(anchorX - 24 * side - step * side, oy + 74 + bob, 11, 17, [193, 163, 94, 220]);
    line(anchorX + 30 * side + step * side, oy + 60 + bob, anchorX + 48 * side + step * side, oy + 31 + bob, [151, 143, 116, 245]);
    line(anchorX + 48 * side + step * side, oy + 31 + bob, anchorX + 54 * side + step * side, oy + 44 + bob, [219, 205, 155, 225]);
  } else {
    const shieldSide = isNorth ? 1 : -1;
    const spearSide = -shieldSide;
    fillRect(anchorX - 35 * shieldSide - step * shieldSide, oy + 58 + bob, 19 * shieldSide, 7, [45, 95, 87, 255]);
    fillRect(anchorX + 16 * spearSide + step * spearSide, oy + 58 + bob, 19 * spearSide, 7, [45, 95, 87, 255]);
    fillRect(anchorX - 42 * shieldSide - step * shieldSide, oy + 62 + bob, 11 * shieldSide, 9, [92, 57, 50, 255]);
    fillRect(anchorX + 31 * spearSide + step * spearSide, oy + 62 + bob, 11 * spearSide, 9, [92, 57, 50, 255]);
    fillEllipse(anchorX - 35 * shieldSide - step * shieldSide, oy + 74 + bob, 12, 17, [47, 58, 64, 255]);
    strokeEllipse(anchorX - 35 * shieldSide - step * shieldSide, oy + 74 + bob, 12, 17, [193, 163, 94, 220]);
    line(anchorX + 34 * spearSide + step * spearSide, oy + 58 + bob, anchorX + 49 * spearSide + step * spearSide, oy + 31 + bob, [151, 143, 116, 245]);
    line(anchorX + 49 * spearSide + step * spearSide, oy + 31 + bob, anchorX + 54 * spearSide + step * spearSide, oy + 44 + bob, [219, 205, 155, 225]);
  }

  strokeEllipse(anchorX, oy + 59 + bob, isEast || isWest ? 19 : 25, 39, [9, 15, 17, 230]);
  strokeRect(ox + 24, oy + 17, 80, 96, [11, 16, 18, 58]);
}

function drawPropFrame(frame, kind) {
  const ox = frame * cell;
  const anchorX = ox + 64;
  const anchorY = 104;
  fillEllipse(anchorX, anchorY + 10, 33, 11, [18, 22, 24, 54]);

  if (kind === "registrar") {
    fillDiamond(anchorX, anchorY + 2, 41, 17, [118, 104, 82, 190]);
    fillRect(ox + 35, 57, 58, 41, [218, 208, 181, 255]);
    fillRect(ox + 33, 51, 62, 9, [73, 90, 84, 255]);
    fillRect(ox + 30, 45, 68, 10, [112, 45, 40, 255]);
    fillTriangle([[ox + 28, 45], [anchorX, 24], [ox + 100, 45]], [157, 66, 50, 255]);
    fillTriangle([[ox + 35, 45], [anchorX, 31], [ox + 93, 45]], [193, 91, 62, 255]);
    fillRect(ox + 56, 71, 16, 27, [41, 93, 81, 255]);
    fillRect(ox + 42, 64, 10, 11, [74, 118, 126, 255]);
    fillRect(ox + 78, 64, 10, 11, [74, 118, 126, 255]);
    fillRect(ox + 45, 85, 38, 4, [133, 84, 54, 255]);
    strokeRect(ox + 35, 57, 58, 41, [48, 43, 37, 170]);
    strokeTriangle([[ox + 28, 45], [anchorX, 24], [ox + 100, 45]], [43, 30, 29, 170]);
  } else if (kind === "forge") {
    fillDiamond(anchorX, anchorY + 5, 39, 15, [50, 48, 42, 220]);
    fillRect(ox + 35, 68, 58, 27, [62, 67, 68, 255]);
    fillRect(ox + 40, 59, 48, 13, [37, 41, 43, 255]);
    fillRect(ox + 47, 71, 35, 12, [188, 91, 54, 255]);
    fillRect(ox + 54, 72, 22, 8, [247, 178, 79, 240]);
    fillRect(ox + 78, 38, 10, 25, [49, 51, 51, 255]);
    fillRect(ox + 75, 34, 16, 6, [33, 36, 37, 255]);
    fillEllipse(ox + 83, 29, 9, 5, [35, 40, 43, 86]);
    fillEllipse(ox + 86, 23, 7, 4, [35, 40, 43, 56]);
    strokeRect(ox + 35, 68, 58, 27, [18, 22, 23, 220]);
    line(ox + 35, 59, ox + 94, 59, [187, 181, 157, 130]);
  } else if (kind === "grove") {
    fillRect(anchorX - 7, 66, 14, 36, [84, 55, 37, 255]);
    fillRect(anchorX - 13, 77, 26, 5, [63, 42, 32, 220]);
    fillEllipse(anchorX - 21, 55, 23, 25, [44, 86, 58, 255]);
    fillEllipse(anchorX + 17, 55, 26, 28, [55, 105, 65, 255]);
    fillEllipse(anchorX, 36, 31, 27, [83, 133, 78, 255]);
    fillEllipse(anchorX - 13, 40, 14, 12, [142, 166, 100, 180]);
    fillEllipse(anchorX + 10, 31, 10, 9, [122, 154, 88, 160]);
    strokeEllipse(anchorX, 50, 39, 34, [22, 45, 33, 170]);
  } else if (kind === "ore") {
    fillDiamond(anchorX, 93, 38, 19, [57, 61, 63, 230]);
    fillTriangle([[ox + 32, 93], [ox + 51, 58], [ox + 66, 99]], [82, 87, 91, 255]);
    fillTriangle([[ox + 54, 96], [ox + 73, 49], [ox + 94, 94]], [121, 124, 119, 255]);
    fillTriangle([[ox + 68, 95], [ox + 94, 63], [ox + 101, 102]], [74, 80, 82, 255]);
    fillTriangle([[ox + 44, 98], [ox + 60, 75], [ox + 78, 102]], [59, 64, 67, 255]);
    line(ox + 56, 70, ox + 68, 92, [211, 185, 103, 190]);
    line(ox + 75, 61, ox + 85, 89, [222, 202, 130, 170]);
    line(ox + 88, 72, ox + 94, 92, [184, 151, 88, 160]);
    strokeDiamond(anchorX, 89, 40, 27, [30, 34, 35, 170]);
  } else if (kind === "shrine") {
    fillEllipse(anchorX, 91, 33, 14, [66, 66, 61, 180]);
    fillRect(ox + 43, 64, 42, 32, [166, 167, 154, 255]);
    fillRect(ox + 48, 56, 32, 10, [115, 119, 115, 255]);
    fillEllipse(anchorX, 68, 14, 17, [217, 218, 201, 255]);
    fillEllipse(anchorX, 68, 8, 10, [82, 88, 86, 240]);
    fillRect(anchorX - 4, 79, 8, 16, [111, 114, 107, 255]);
    fillRect(ox + 40, 94, 48, 5, [99, 101, 94, 255]);
    line(anchorX - 19, 58, anchorX + 19, 98, [237, 232, 197, 70]);
    strokeEllipse(anchorX, 68, 16, 19, [48, 53, 53, 170]);
    strokeRect(ox + 43, 64, 42, 32, [55, 56, 52, 145]);
  }
}

function fillRect(x, y, w, h, rgba) {
  const x0 = Math.round(w < 0 ? x + w : x);
  const y0 = Math.round(h < 0 ? y + h : y);
  const x1 = Math.round(w < 0 ? x : x + w);
  const y1 = Math.round(h < 0 ? y : y + h);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
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
