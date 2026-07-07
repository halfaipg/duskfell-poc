import { writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

import { updateTerrainAtlasHash } from "./lib/asset-hashes.js";

const outputPath = path.resolve("assets", "terrain", "terrain-placeholder.png");
const manifestPath = path.resolve("assets", "terrain", "manifest.json");
const cell = 64;
const materials = [
  {
    name: "grass",
    base: [78, 112, 70, 255],
    light: [132, 154, 92, 255],
    dark: [40, 70, 47, 255],
    accent: [161, 157, 91, 255],
  },
  {
    name: "field",
    base: [178, 151, 88, 255],
    light: [216, 190, 116, 255],
    dark: [112, 86, 55, 255],
    accent: [91, 118, 68, 255],
  },
  {
    name: "dirt",
    base: [119, 82, 60, 255],
    light: [159, 116, 82, 255],
    dark: [64, 48, 39, 255],
    accent: [168, 137, 92, 255],
  },
  {
    name: "stone",
    base: [106, 112, 108, 255],
    light: [151, 152, 142, 255],
    dark: [57, 65, 64, 255],
    accent: [92, 101, 100, 255],
  },
  {
    name: "water",
    base: [49, 121, 144, 255],
    light: [111, 179, 188, 255],
    dark: [26, 72, 96, 255],
    accent: [202, 232, 218, 255],
  },
  {
    name: "settlement",
    base: [186, 174, 144, 255],
    light: [223, 211, 177, 255],
    dark: [112, 103, 84, 255],
    accent: [78, 72, 65, 255],
  },
];
const width = cell * materials.length;
const rows = 3;
const height = cell * rows;
const pixels = Buffer.alloc(width * height * 4);

for (const [index, material] of materials.entries()) {
  drawTile(index, 0, material, "flat-base");
  drawTile(index, 1, material, "slope-texture");
  drawTile(index, 2, material, "transition");
}

await writeFile(outputPath, encodePng(width, height, pixels));
const imageSha256 = await updateTerrainAtlasHash({
  manifestPath,
  imagePath: outputPath,
});
console.log(`wrote ${outputPath}`);
console.log(`updated ${manifestPath} tileSheet.sha256=${imageSha256}`);

function drawTile(index, row, material, kind) {
  const ox = index * cell;
  const oy = row * cell;
  const cx = ox + cell / 2;
  const cy = oy + cell / 2;
  const base = kind === "slope-texture" ? shade(material.base, 0.93) : material.base;
  const light = kind === "transition" ? shade(material.light, 1.06) : material.light;
  const dark = kind === "transition" ? shade(material.dark, 0.78) : material.dark;
  const top = shade(light, material.name === "water" ? 1.04 : 1);
  const left = shade(base, material.name === "water" ? 0.92 : 0.86);
  const bottom = shade(dark, material.name === "water" ? 0.9 : 0.82);

  fillDiamond(cx, cy, 31, 31, bottom);
  fillDiamond(cx, cy - 1, 29, 29, mix(base, light, 0.15));
  fillTriangle(
    [
      [cx, cy - 30],
      [cx + 29, cy],
      [cx, cy + 29],
    ],
    top,
  );
  fillTriangle(
    [
      [cx, cy - 30],
      [cx, cy + 29],
      [cx - 29, cy],
    ],
    left,
  );
  fillTriangle(
    [
      [cx - 29, cy],
      [cx, cy + 29],
      [cx + 29, cy],
    ],
    shade(bottom, material.name === "water" ? 1.02 : 0.96),
  );

  drawBaseGrain(cx, cy, index, row, material, kind);
  drawMaterialDetails(cx, cy, index, row, material, kind);
  drawFacetWear(cx, cy, index, row, material, kind);

  if (kind === "slope-texture") {
    drawSlopeRunnels(cx, cy, index, row, material);
  } else if (kind === "transition") {
    drawTransitionEdge(cx, cy, index, row, material);
  }

  for (let n = 0; n < 22; n += 1) {
    const seed = hash(index + row * 11, n);
    const localX = cx + ((seed & 31) - 15);
    const localY = cy + (((seed >>> 5) & 31) - 15);
    if (!insideDiamond(localX, localY, cx, cy, 28, 28)) continue;
    if (material.name === "water") {
      fillEllipse(localX, localY, 4 + (seed % 5), 1, [218, 243, 239, 58]);
    } else if (material.name === "stone") {
      fillEllipse(localX, localY, 2 + (seed % 3), 1 + (seed % 2), [45, 50, 50, 86]);
    } else {
      drawSprig(localX, localY, seed % 3 === 0 ? material.accent : dark);
    }
  }

  clearOutsideDiamond(cx, cy, 31, 31);
  strokeDiamond(cx, cy, 31, 31, [31, 40, 38, 64]);
}

function drawBaseGrain(cx, cy, index, row, material, kind) {
  for (let n = 0; n < 36; n += 1) {
    const seed = hash(index * 17 + row * 97, n);
    const x = cx + ((seed & 63) - 31);
    const y = cy + (((seed >>> 6) & 63) - 31);
    if (!insideDiamond(x, y, cx, cy, 29, 29)) continue;
    const warm = ((seed >>> 12) & 1) === 0;
    const color = warm ? shade(material.light, 0.92) : shade(material.dark, 1.08);
    const alpha = kind === "slope-texture" ? 44 : 34;
    setPixel(Math.round(x), Math.round(y), [...color.slice(0, 3), alpha]);
    if ((seed & 7) === 0) setPixel(Math.round(x + 1), Math.round(y), [...color.slice(0, 3), alpha]);
  }
}

function drawMaterialDetails(cx, cy, index, row, material, kind) {
  if (material.name === "grass") {
    for (let n = 0; n < 14; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n, 25);
      if (!insideDiamond(x, y, cx, cy, 28, 28)) continue;
      drawSprig(x, y, seed % 4 === 0 ? material.accent : shade(material.dark, 1.1));
    }
    for (let n = 0; n < 5; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n + 33, 22);
      fillEllipse(x, y, 3 + (seed % 3), 1.5, [34, 59, 41, 62]);
    }
  } else if (material.name === "field") {
    for (let offset = -24; offset <= 24; offset += 8) {
      line(cx - 25, cy + offset - 8, cx + 25, cy + offset + 11, [105, 86, 58, 72]);
      line(cx - 23, cy + offset - 10, cx + 25, cy + offset + 9, [232, 213, 150, 58]);
    }
    line(cx - 27, cy + 12, cx + 26, cy - 8, [82, 67, 45, 88]);
  } else if (material.name === "dirt") {
    for (let n = 0; n < 9; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n, 21);
      if (!insideDiamond(x, y, cx, cy, 27, 27)) continue;
      fillEllipse(x, y, 1 + (seed % 3), 1, [64, 49, 42, 80]);
    }
    line(cx - 22, cy + 10, cx + 18, cy + 23, [44, 34, 30, 82]);
    line(cx - 21, cy + 6, cx + 17, cy + 19, [153, 118, 82, 48]);
  } else if (material.name === "stone") {
    for (let n = 0; n < 5; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n, 18);
      if (!insideDiamond(x, y, cx, cy, 26, 26)) continue;
      const length = 5 + (seed % 7);
      line(x - length / 2, y - 1, x + length / 2, y + 2, [40, 45, 45, 88]);
      line(x - length / 2, y - 2, x + length / 2, y + 1, [210, 205, 186, 42]);
    }
    line(cx - 24, cy - 7, cx + 24, cy + 17, [37, 43, 43, 70]);
    line(cx - 6, cy - 25, cx + 14, cy + 26, [37, 43, 43, 56]);
  } else if (material.name === "water") {
    for (let offset = -18; offset <= 18; offset += 9) {
      line(cx - 19, cy + offset, cx + 21, cy + offset - 7, [220, 246, 237, 62]);
      line(cx - 15, cy + offset + 4, cx + 17, cy + offset - 1, [23, 77, 109, 42]);
    }
    fillEllipse(cx - 8, cy + 16, 14, 2, [213, 235, 220, 64]);
  } else if (material.name === "settlement") {
    for (let offset = -24; offset <= 24; offset += 12) {
      line(cx - 27, cy + offset - 14, cx + 27, cy + offset + 13, [73, 66, 60, 64]);
      line(cx + offset - 14, cy - 27, cx + offset + 13, cy + 27, [73, 66, 60, 54]);
    }
    fillEllipse(cx, cy + 12, 18, 2, [70, 61, 54, 36]);
    line(cx - 23, cy - 3, cx + 20, cy + 18, [68, 62, 56, 70]);
    line(cx - 16, cy + 19, cx + 17, cy - 8, [238, 225, 189, 38]);
  }
}

function drawFacetWear(cx, cy, index, row, material, kind) {
  const shadow = shade(material.dark, kind === "transition" ? 0.74 : 0.86);
  const highlight = shade(material.light, kind === "slope-texture" ? 1.08 : 1.02);
  for (let n = 0; n < 12; n += 1) {
    const seed = hash(index * 89 + row * 193, n + 71);
    const x = cx + ((seed & 63) / 63 - 0.5) * 52;
    const y = cy + (((seed >>> 6) & 63) / 63 - 0.5) * 46;
    if (!insideDiamond(x, y, cx, cy, 28, 28)) continue;
    const length = 4 + ((seed >>> 12) % 9);
    const angle = ((seed >>> 16) & 1) === 0 ? -0.42 : 0.42;
    line(
      x - Math.cos(angle) * length * 0.5,
      y - Math.sin(angle) * length * 0.5,
      x + Math.cos(angle) * length * 0.5,
      y + Math.sin(angle) * length * 0.5,
      [...shadow.slice(0, 3), 38],
    );
    if ((seed & 3) === 0) {
      setPixel(Math.round(x), Math.round(y - 1), [...highlight.slice(0, 3), 34]);
    }
  }

  fillTriangle(
    [
      [cx - 28, cy + 1],
      [cx, cy + 29],
      [cx + 28, cy + 1],
    ],
    [...shadow.slice(0, 3), kind === "slope-texture" ? 26 : 18],
  );
}

function drawSlopeRunnels(cx, cy, index, row, material) {
  const dark = shade(material.dark, material.name === "water" ? 0.82 : 0.72);
  const light = shade(material.light, material.name === "water" ? 1.1 : 1.04);
  for (let offset = -28; offset <= 24; offset += 7) {
    const wobble = ((hash(index * 37 + row * 19, offset + 101) & 7) - 3) * 0.45;
    line(cx - 29, cy + offset + wobble, cx + 29, cy + offset + 18 + wobble, [...dark.slice(0, 3), 54]);
    line(
      cx - 28,
      cy + offset - 2 + wobble,
      cx + 27,
      cy + offset + 16 + wobble,
      [...light.slice(0, 3), 34],
    );
  }

  for (let n = 0; n < 8; n += 1) {
    const [x, y, seed] = seededPoint(cx, cy, index, row, n + 41, 24);
    if (!insideDiamond(x, y, cx, cy, 27, 27)) continue;
    fillEllipse(x, y + 2, 3 + (seed % 4), 1, [...dark.slice(0, 3), 50]);
  }
}

function drawTransitionEdge(cx, cy, index, row, material) {
  const edge = material.name === "water" ? [219, 218, 172, 138] : [238, 222, 176, 74];
  const dark = shade(material.dark, 0.74);
  fillTriangle(
    [
      [cx - 28, cy + 3],
      [cx + 28, cy + 3],
      [cx, cy + 29],
    ],
    edge,
  );
  for (let offset = -24; offset <= 24; offset += 5) {
    const seed = hash(index * 53 + row * 97, offset + 211);
    const y = cy + 19 - Math.abs(offset) * 0.16 + ((seed & 3) - 1);
    fillEllipse(cx + offset, y, 4 + (seed % 4), 1.5, [...dark.slice(0, 3), 72]);
    setPixel(Math.round(cx + offset), Math.round(y - 1), [242, 232, 194, 62]);
  }
}

function seededPoint(cx, cy, index, row, n, spread) {
  const seed = hash(index * 41 + row * 131, n + 313);
  return [
    cx + ((seed & 63) / 63 - 0.5) * spread * 2,
    cy + (((seed >>> 6) & 63) / 63 - 0.5) * spread * 2,
    seed,
  ];
}

function drawSprig(x, y, rgba) {
  line(x, y + 3, x - 3, y - 2, rgba);
  line(x, y + 3, x + 3, y - 1, rgba);
}

function fillTriangle(points, rgba) {
  const minX = Math.floor(Math.min(...points.map(([x]) => x)));
  const maxX = Math.ceil(Math.max(...points.map(([x]) => x)));
  const minY = Math.floor(Math.min(...points.map(([, y]) => y)));
  const maxY = Math.ceil(Math.max(...points.map(([, y]) => y)));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInTriangle(x + 0.5, y + 0.5, points)) {
        setPixel(x, y, rgba);
      }
    }
  }
}

function pointInTriangle(x, y, points) {
  const [a, b, c] = points;
  const w1 = (a[0] * (c[1] - a[1]) + (y - a[1]) * (c[0] - a[0]) - x * (c[1] - a[1])) /
    ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]));
  const w2 = (y - a[1] - w1 * (b[1] - a[1])) / (c[1] - a[1]);
  return w1 >= 0 && w2 >= 0 && w1 + w2 <= 1;
}

function fillDiamond(cx, cy, rx, ry, rgba) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
      if (insideDiamond(px, py, cx, cy, rx, ry)) setPixel(px, py, rgba);
    }
  }
}

function strokeDiamond(cx, cy, rx, ry, rgba) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
      const d = Math.abs(px - cx) / rx + Math.abs(py - cy) / ry;
      if (d > 0.94 && d <= 1.05) setPixel(px, py, rgba);
    }
  }
}

function insideDiamond(px, py, cx, cy, rx, ry) {
  return Math.abs(px - cx) / rx + Math.abs(py - cy) / ry <= 1;
}

function clearOutsideDiamond(cx, cy, rx, ry) {
  const minX = Math.floor(cx - cell / 2);
  const maxX = Math.ceil(cx + cell / 2) - 1;
  const minY = Math.floor(cy - cell / 2);
  const maxY = Math.ceil(cy + cell / 2) - 1;
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      if (insideDiamond(px, py, cx, cy, rx + 0.2, ry + 0.2)) continue;
      const offset = (py * width + px) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 0;
    }
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

function shade(rgba, factor) {
  return [
    Math.max(0, Math.min(255, Math.round(rgba[0] * factor))),
    Math.max(0, Math.min(255, Math.round(rgba[1] * factor))),
    Math.max(0, Math.min(255, Math.round(rgba[2] * factor))),
    rgba[3],
  ];
}

function mix(a, b, t) {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
    Math.round(a[3] * (1 - t) + b[3] * t),
  ];
}

function hash(a, b) {
  let value = Math.imul(a + 101, 374761393) ^ Math.imul(b + 181, 668265263);
  value = (value ^ (value >>> 13)) >>> 0;
  return Math.imul(value, 1274126177) >>> 0;
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
