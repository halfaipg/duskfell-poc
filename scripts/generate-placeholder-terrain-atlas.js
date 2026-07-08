import { writeFile } from "node:fs/promises";
import path from "node:path";

import { updateTerrainAtlasHash } from "./lib/asset-hashes.js";
import { shade, mix, hash } from "./placeholder-terrain-atlas/color.js";
import {
  CELL as cell,
  CORNER_MASKS as cornerMasks,
  EDGE_MASKS as edgeMasks,
  MATERIALS as materials,
  PAIR_TRANSITIONS as pairTransitions,
  ROWS as rows,
  terrainTiles,
} from "./placeholder-terrain-atlas/catalog.js";
import { updateTerrainManifestShape } from "./placeholder-terrain-atlas/manifest.js";
import { drawMaterialDetails } from "./placeholder-terrain-atlas/material-details.js";
import { encodePng } from "./placeholder-terrain-atlas/png.js";
import { createRaster } from "./placeholder-terrain-atlas/raster.js";
import { transitionAccentPoint, transitionMaskWeight } from "./placeholder-terrain-atlas/transition-masks.js";

const outputPath = path.resolve("assets", "terrain", "terrain-placeholder.png");
const manifestPath = path.resolve("assets", "terrain", "manifest.json");
const width = cell * materials.length;
const height = cell * rows;
const pixels = Buffer.alloc(width * height * 4);
const materialByName = new Map(materials.map((material) => [material.name, material]));
const raster = createRaster({ width, height, pixels, cell });
const {
  clearOutsideDiamond,
  fillDiamond,
  fillEllipse,
  fillRect,
  fillTriangle,
  insideDiamond,
  line,
  lineClippedToDiamond,
  setPixel,
  strokeDiamond,
} = raster;

for (const [index, material] of materials.entries()) {
  drawTile(index, 0, material, "flat-base");
  drawTile(index, 1, material, "slope-texture");
  drawTile(index, 2, material, "transition");
  for (const [edgeIndex, edge] of edgeMasks.entries()) {
    drawTile(index, 3 + edgeIndex, material, "transition");
    drawDirectionalTransition(index, 3 + edgeIndex, material, { type: "edge", edge });
  }
  for (const [cornerIndex, corner] of cornerMasks.entries()) {
    drawTile(index, 7 + cornerIndex, material, "transition");
    drawDirectionalTransition(index, 7 + cornerIndex, material, { type: "corner", corner });
  }
}
for (const [pairIndex, [fromMaterialName, toMaterialName]] of pairTransitions.entries()) {
  const toMaterial = materialByName.get(toMaterialName);
  drawTile(pairIndex, 11, toMaterial, "transition");
  drawPairTransition(pairIndex, 11, materialByName.get(fromMaterialName), toMaterial);
}

await writeFile(outputPath, encodePng(width, height, pixels));
await updateTerrainManifestShape({ manifestPath, rows, materials, terrainTiles });
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

  fillRect(ox, oy, cell, cell, [0, 0, 0, 0]);
  fillDiamond(cx, cy, 31, 31, base);
  if (kind === "slope-texture") {
    drawSlopeFacetBase(cx, cy, material);
  } else if (kind === "transition") {
    fillTriangle(
      [
        [cx - 31, cy + 4],
        [cx, cy + 31],
        [cx + 31, cy + 4],
      ],
      [...mix(base, light, 0.22).slice(0, 3), 38],
    );
  }

  drawBaseGrain(cx, cy, index, row, material, kind);
  drawMaterialDetails(raster, cx, cy, index, row, material, kind);
  drawFacetWear(cx, cy, index, row, material, kind);
  if (kind === "slope-texture") drawSlopeRunnels(cx, cy, index, row, material);
  if (kind === "transition") drawTransitionEdge(cx, cy, index, row, material);
  drawCornerVariation(ox, oy, material, index, row);
  clearOutsideDiamond(cx, cy, 31, 31);
  strokeDiamond(cx, cy, 30, 30, [...shade(dark, 0.72).slice(0, 3), 38]);
}

function drawSlopeFacetBase(cx, cy, material) {
  const top = shade(material.light, material.name === "water" ? 1.08 : 1.04);
  const left = shade(material.base, material.name === "water" ? 0.94 : 0.9);
  const bottom = shade(material.dark, material.name === "water" ? 0.86 : 0.78);
  fillTriangle(
    [
      [cx, cy - 30],
      [cx + 29, cy],
      [cx, cy + 29],
    ],
    [...top.slice(0, 3), 36],
  );
  fillTriangle(
    [
      [cx, cy - 30],
      [cx, cy + 29],
      [cx - 29, cy],
    ],
    [...left.slice(0, 3), 24],
  );
  fillTriangle(
    [
      [cx - 29, cy],
      [cx, cy + 29],
      [cx + 29, cy],
    ],
    [...bottom.slice(0, 3), 44],
  );
}

function drawDirectionalTransition(index, row, material, mask) {
  const ox = index * cell;
  const oy = row * cell;
  const accent =
    material.name === "water"
      ? [213, 220, 177, 118]
      : [...shade(material.light, 1.1).slice(0, 3), 82];
  const shadow = [...shade(material.dark, 0.58).slice(0, 3), 92];
  const useShadow =
    mask.edge === "south" ||
    mask.edge === "west" ||
    mask.corner === "southEast" ||
    mask.corner === "southWest";
  const color = useShadow ? shadow : accent;

  for (let localY = 0; localY < cell; localY += 1) {
    for (let localX = 0; localX < cell; localX += 1) {
      const alpha = transitionMaskWeight(localX, localY, mask);
      if (alpha <= 0) continue;
      setPixel(ox + localX, oy + localY, [...color.slice(0, 3), Math.round(color[3] * alpha)]);
    }
  }

  const cx = ox + cell / 2;
  const cy = oy + cell / 2;
  for (let n = 0; n < 12; n += 1) {
    const seed = hash(index * 157 + row * 71, n + 911);
    const [x, y] = transitionAccentPoint(cx, cy, mask, seed);
    fillEllipse(x, y, 3 + (seed % 5), 1.3, [...color.slice(0, 3), 70]);
  }
  clearOutsideDiamond(cx, cy, 31, 31);
  strokeDiamond(cx, cy, 30, 30, [...shade(material.dark, 0.56).slice(0, 3), 42]);
}

function drawPairTransition(index, row, fromMaterial, toMaterial) {
  const ox = index * cell;
  const oy = row * cell;
  const cx = ox + cell / 2;
  const cy = oy + cell / 2;
  const from = shade(fromMaterial.base, 1.02);
  const to = shade(toMaterial.light, 0.96);

  for (let offset = -26; offset <= 26; offset += 7) {
    const seed = hash(index * 193 + row * 71, offset + 401);
    const y = cy + offset * 0.46 + ((seed & 7) - 3);
    line(cx - 26, y - 6, cx + 26, y + 9, [...from.slice(0, 3), 46 + (seed % 28)]);
    if ((seed & 3) === 0) {
      fillEllipse(cx + ((seed >>> 5) & 31) - 15, y, 3 + (seed % 4), 1.2, [...to.slice(0, 3), 72]);
    }
  }

  for (let n = 0; n < 18; n += 1) {
    const [x, y, seed] = seededPoint(cx, cy, index, row, n + 809, 25);
    if (!insideDiamond(x, y, cx, cy, 28, 28)) continue;
    fillEllipse(x, y, 2 + (seed % 4), 1.1, [...fromMaterial.accent.slice(0, 3), 66]);
  }
  clearOutsideDiamond(cx, cy, 31, 31);
  strokeDiamond(cx, cy, 30, 30, [...shade(toMaterial.dark, 0.56).slice(0, 3), 42]);
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

function drawCornerVariation(ox, oy, material, index, row) {
  for (let n = 0; n < 26; n += 1) {
    const seed = hash(index * 149 + row * 211, n + 509);
    const corner = (seed >>> 17) & 3;
    const px = ox + (corner & 1 ? 44 : 5) + ((seed & 7) - 3);
    const py = oy + (corner & 2 ? 44 : 5) + (((seed >>> 4) & 7) - 3);
    const color = ((seed >>> 9) & 1) === 0 ? shade(material.dark, 1.04) : shade(material.light, 0.94);
    setPixel(px, py, [...color.slice(0, 3), 28]);
    if ((seed & 3) === 0) setPixel(px + 1, py, [...color.slice(0, 3), 20]);
  }
}
