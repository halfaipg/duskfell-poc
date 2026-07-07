import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

import { updateTerrainAtlasHash } from "./lib/asset-hashes.js";

const outputPath = path.resolve("assets", "terrain", "terrain-placeholder.png");
const manifestPath = path.resolve("assets", "terrain", "manifest.json");
const cell = 64;
const edgeMasks = ["north", "east", "south", "west"];
const cornerMasks = ["northEast", "southEast", "southWest", "northWest"];
const materials = [
  {
    name: "grass",
    base: [65, 96, 55, 255],
    light: [119, 141, 78, 255],
    dark: [30, 55, 37, 255],
    accent: [147, 147, 82, 255],
  },
  {
    name: "field",
    base: [91, 108, 63, 255],
    light: [140, 150, 91, 255],
    dark: [50, 63, 43, 255],
    accent: [111, 126, 69, 255],
  },
  {
    name: "dirt",
    base: [101, 70, 52, 255],
    light: [150, 105, 72, 255],
    dark: [53, 39, 34, 255],
    accent: [151, 121, 80, 255],
  },
  {
    name: "stone",
    base: [91, 99, 96, 255],
    light: [135, 137, 128, 255],
    dark: [42, 50, 49, 255],
    accent: [75, 86, 84, 255],
  },
  {
    name: "water",
    base: [42, 91, 112, 255],
    light: [104, 165, 174, 255],
    dark: [21, 58, 78, 255],
    accent: [190, 224, 211, 255],
  },
  {
    name: "settlement",
    base: [167, 154, 122, 255],
    light: [207, 192, 150, 255],
    dark: [97, 88, 70, 255],
    accent: [67, 61, 55, 255],
  },
];
const width = cell * materials.length;
const rows = 11;
const height = cell * rows;
const pixels = Buffer.alloc(width * height * 4);

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

await writeFile(outputPath, encodePng(width, height, pixels));
await updateTerrainManifestShape();
const imageSha256 = await updateTerrainAtlasHash({
  manifestPath,
  imagePath: outputPath,
});
console.log(`wrote ${outputPath}`);
console.log(`updated ${manifestPath} tileSheet.sha256=${imageSha256}`);

async function updateTerrainManifestShape() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.tileSheet.rows = rows;
  manifest.tileSheet.frameCount = rows * materials.length;
  manifest.tiles = terrainTiles();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

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
  drawMaterialDetails(cx, cy, index, row, material, kind);
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

function drawSoftMottle(cx, cy, index, row, material, kind) {
  for (let n = 0; n < 120; n += 1) {
    const seed = hash(index * 97 + row * 193, n + 17);
    const x = cx + ((seed & 127) / 127 - 0.5) * 72;
    const y = cy + (((seed >>> 7) & 127) / 127 - 0.5) * 72;
    const tone = (seed >>> 14) & 3;
    const source = tone === 0 ? material.light : tone === 1 ? material.dark : material.accent;
    const alpha = kind === "slope-texture" ? 18 : 14;
    const rx = 1 + ((seed >>> 18) % 4);
    const ry = 1 + ((seed >>> 22) % 3);
    fillEllipse(x, y, rx, ry, [...source.slice(0, 3), alpha]);
  }

  for (let n = 0; n < 30; n += 1) {
    const seed = hash(index * 211 + row * 43, n + 401);
    const x = cx + ((seed & 63) / 63 - 0.5) * 56;
    const y = cy + (((seed >>> 6) & 63) / 63 - 0.5) * 48;
    if (!insideDiamond(x, y, cx, cy, 29, 29)) continue;
    const source = (seed & 1) === 0 ? material.dark : material.light;
    fillEllipse(x, y, 3 + ((seed >>> 12) % 6), 1 + ((seed >>> 16) % 3), [...source.slice(0, 3), 18]);
  }
}

function drawSoftMaterialDetails(cx, cy, index, row, material, kind) {
  if (material.name === "water") {
    for (let n = 0; n < 10; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n, 28);
      fillEllipse(x, y, 7 + (seed % 8), 1.3, [203, 233, 224, kind === "transition" ? 42 : 32]);
    }
    return;
  }

  if (material.name === "stone") {
    for (let n = 0; n < 14; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n, 27);
      const rock = (seed & 1) === 0 ? material.dark : material.light;
      fillEllipse(x, y, 2 + (seed % 5), 1 + ((seed >>> 4) % 3), [...rock.slice(0, 3), 38]);
    }
    return;
  }

  if (material.name === "dirt") {
    for (let n = 0; n < 18; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n, 30);
      const soil = (seed & 1) === 0 ? material.dark : material.light;
      fillEllipse(x, y, 2 + (seed % 4), 1 + ((seed >>> 4) % 2), [...soil.slice(0, 3), 28]);
    }
    return;
  }

  if (material.name === "settlement") {
    for (let n = 0; n < 16; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n, 29);
      const stone = (seed & 1) === 0 ? material.dark : material.light;
      fillEllipse(x, y, 4 + (seed % 5), 1 + ((seed >>> 5) % 2), [...stone.slice(0, 3), 30]);
    }
    return;
  }

  for (let n = 0; n < 22; n += 1) {
    const [x, y, seed] = seededPoint(cx, cy, index, row, n, 31);
    const leaf = (seed & 3) === 0 ? material.accent : material.dark;
    fillEllipse(x, y, 1 + (seed % 3), 1 + ((seed >>> 3) % 2), [...leaf.slice(0, 3), 32]);
  }
}

function drawSoftTransition(cx, cy, index, row, material) {
  const dust = material.name === "water" ? [188, 202, 178, 58] : [...material.light.slice(0, 3), 34];
  for (let n = 0; n < 18; n += 1) {
    const seed = hash(index * 53 + row * 97, n + 211);
    const x = cx + ((seed & 63) / 63 - 0.5) * 58;
    const y = cy + 10 + (((seed >>> 6) & 31) / 31) * 20;
    fillEllipse(x, y, 4 + (seed % 5), 1.5, dust);
  }
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

function transitionMaskWeight(x, y, mask) {
  const u = x / (cell - 1);
  const v = y / (cell - 1);
  const depth = 0.42;
  const feather = 0.12;
  if (mask.edge === "north") return falloff(v, depth, feather);
  if (mask.edge === "east") return falloff(1 - u, depth, feather);
  if (mask.edge === "south") return falloff(1 - v, depth, feather);
  if (mask.edge === "west") return falloff(u, depth, feather);
  if (mask.corner === "northEast") return Math.min(falloff(v, depth, feather), falloff(1 - u, depth, feather));
  if (mask.corner === "southEast") return Math.min(falloff(1 - v, depth, feather), falloff(1 - u, depth, feather));
  if (mask.corner === "southWest") return Math.min(falloff(1 - v, depth, feather), falloff(u, depth, feather));
  if (mask.corner === "northWest") return Math.min(falloff(v, depth, feather), falloff(u, depth, feather));
  return 0;
}

function falloff(distance, depth, feather) {
  if (distance <= depth - feather) return 0.42;
  if (distance >= depth) return 0;
  return ((depth - distance) / feather) * 0.42;
}

function transitionAccentPoint(cx, cy, mask, seed) {
  const jitter = (value, range) => ((value & 63) / 63 - 0.5) * range;
  if (mask.edge === "north") return [cx + jitter(seed, 48), cy - 21 + jitter(seed >>> 6, 9)];
  if (mask.edge === "east") return [cx + 21 + jitter(seed, 9), cy + jitter(seed >>> 6, 48)];
  if (mask.edge === "south") return [cx + jitter(seed, 48), cy + 21 + jitter(seed >>> 6, 9)];
  if (mask.edge === "west") return [cx - 21 + jitter(seed, 9), cy + jitter(seed >>> 6, 48)];
  if (mask.corner === "northEast") return [cx + 19 + jitter(seed, 15), cy - 19 + jitter(seed >>> 6, 15)];
  if (mask.corner === "southEast") return [cx + 19 + jitter(seed, 15), cy + 19 + jitter(seed >>> 6, 15)];
  if (mask.corner === "southWest") return [cx - 19 + jitter(seed, 15), cy + 19 + jitter(seed >>> 6, 15)];
  return [cx - 19 + jitter(seed, 15), cy - 19 + jitter(seed >>> 6, 15)];
}

function terrainTiles() {
  return [
    ...materials.map((material, index) => tileEntry(material.name, "flat-base", index, surfaceRole(material.name, "flat"))),
    ...materials.map((material, index) => tileEntry(material.name, "slope-texture", 6 + index, surfaceRole(material.name, "slope"))),
    ...materials.map((material, index) => tileEntry(material.name, "transition", 12 + index, surfaceRole(material.name, "transition"))),
    ...edgeMasks.flatMap((edge, edgeIndex) =>
      materials.map((material, materialIndex) =>
        tileEntry(
          material.name,
          "transition",
          18 + edgeIndex * materials.length + materialIndex,
          surfaceRole(material.name, "transition"),
          { type: "edge", edge },
        ),
      ),
    ),
    ...cornerMasks.flatMap((corner, cornerIndex) =>
      materials.map((material, materialIndex) =>
        tileEntry(
          material.name,
          "transition",
          42 + cornerIndex * materials.length + materialIndex,
          surfaceRole(material.name, "transition"),
          { type: "corner", corner },
        ),
      ),
    ),
  ];
}

function tileEntry(material, kind, frame, role, mask = null) {
  const entry = {
    id: `${material}-${tileIdPart(kind, mask)}`,
    material,
    kind,
    frame,
    surface: {
      walkable: material !== "water",
      role,
    },
  };
  if (mask) entry.mask = mask;
  return entry;
}

function tileIdPart(kind, mask) {
  if (!mask) {
    return {
      "flat-base": "flat-placeholder",
      "slope-texture": "slope-placeholder",
      transition: "transition-placeholder",
    }[kind];
  }
  return mask.type === "edge" ? `transition-${mask.edge}` : `transition-${mask.corner}`;
}

function surfaceRole(material, variant) {
  if (material === "water") {
    if (variant === "flat") return "liquid";
    if (variant === "slope") return "liquid-slope";
    return "shoreline";
  }
  if (material === "settlement") {
    if (variant === "flat") return "surface";
    if (variant === "slope") return "surface-slope";
    return "surface-edge";
  }
  if (variant === "slope") return "slope";
  if (variant === "transition") return "edge";
  return "ground";
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
    drawCobbleField(cx, cy, material, [68, 43, 33, 122], [166, 111, 76, 78]);
    for (let n = 0; n < 5; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n, 22);
      if (!insideDiamond(x, y, cx, cy, 27, 27)) continue;
      fillEllipse(x, y, 1 + (seed % 3), 1, [45, 34, 30, 90]);
    }
  } else if (material.name === "stone") {
    for (let n = 0; n < 15; n += 1) {
      const [x, y, seed] = seededPoint(cx, cy, index, row, n, 18);
      if (!insideDiamond(x, y, cx, cy, 26, 26)) continue;
      const length = 4 + (seed % 10);
      const angle = ((seed >>> 8) % 5 - 2) * 0.24;
      line(
        x - Math.cos(angle) * length,
        y - Math.sin(angle) * length * 0.5,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length * 0.5,
        [38, 44, 44, 84],
      );
      if ((seed & 3) === 0) fillEllipse(x + 1, y - 1, 2 + (seed % 3), 1, [177, 175, 158, 38]);
    }
    fillEllipse(cx - 9, cy + 8, 12, 4, [43, 49, 48, 44]);
    fillEllipse(cx + 12, cy - 7, 9, 3, [150, 150, 139, 34]);
  } else if (material.name === "water") {
    for (let offset = -18; offset <= 18; offset += 9) {
      line(cx - 19, cy + offset, cx + 21, cy + offset - 7, [220, 246, 237, 62]);
      line(cx - 15, cy + offset + 4, cx + 17, cy + offset - 1, [23, 77, 109, 42]);
    }
    fillEllipse(cx - 8, cy + 16, 14, 2, [213, 235, 220, 64]);
  } else if (material.name === "settlement") {
    drawPaverGrid(cx, cy, [78, 66, 51, 116], [235, 220, 171, 68], 10);
    fillEllipse(cx, cy + 12, 18, 2, [65, 55, 45, 42]);
    line(cx - 23, cy - 3, cx + 20, cy + 18, [61, 53, 45, 86]);
    line(cx - 16, cy + 19, cx + 17, cy - 8, [236, 222, 178, 52]);
  }
}

function drawPaverGrid(cx, cy, dark, light, spacing) {
  for (let offset = -32; offset <= 32; offset += spacing) {
    lineClippedToDiamond(cx - 31, cy + offset - 15, cx + 31, cy + offset + 16, cx, cy, dark);
    lineClippedToDiamond(cx - 31, cy + offset - 17, cx + 31, cy + offset + 14, cx, cy, light);
    lineClippedToDiamond(cx + offset - 15, cy - 31, cx + offset + 16, cy + 31, cx, cy, dark);
    lineClippedToDiamond(cx + offset - 17, cy - 31, cx + offset + 14, cy + 31, cx, cy, light);
  }
}

function drawCobbleField(cx, cy, material, dark, light) {
  for (let yy = -23; yy <= 24; yy += 8) {
    const stagger = Math.abs(Math.floor(yy / 8)) % 2 === 0 ? 0 : 5;
    for (let xx = -25; xx <= 25; xx += 10) {
      const x = cx + xx + stagger;
      const y = cy + yy + ((hash(xx + 99, yy + 17) & 3) - 1);
      if (!insideDiamond(x, y, cx, cy, 28, 28)) continue;
      fillEllipse(x, y, 4 + ((xx + yy) & 1), 2.4, shade(material.base, 1.05));
      fillEllipse(x - 1, y - 1, 2.4, 0.9, light);
      line(x - 5, y + 2, x + 4, y + 1, dark);
    }
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

function fillRect(x, y, rectWidth, rectHeight, rgba) {
  for (let py = y; py < y + rectHeight; py += 1) {
    for (let px = x; px < x + rectWidth; px += 1) {
      setPixel(px, py, rgba);
    }
  }
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

function lineClippedToDiamond(x0, y0, x1, y1, cx, cy, rgba) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    if (insideDiamond(x, y, cx, cy, 29, 29)) setPixel(x, y, rgba);
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
