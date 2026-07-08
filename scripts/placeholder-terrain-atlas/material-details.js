import { hash, shade } from "./color.js";

export function drawMaterialDetails(raster, cx, cy, index, row, material) {
  if (material.name === "grass") {
    drawGrassDetails(raster, cx, cy, index, row, material);
  } else if (material.name === "field") {
    drawFieldDetails(raster, cx, cy);
  } else if (material.name === "dirt") {
    drawDirtDetails(raster, cx, cy, index, row, material);
  } else if (material.name === "stone") {
    drawStoneDetails(raster, cx, cy, index, row);
  } else if (material.name === "water") {
    drawWaterDetails(raster, cx, cy);
  } else if (material.name === "settlement") {
    drawSettlementDetails(raster, cx, cy);
  }
}

function drawGrassDetails(raster, cx, cy, index, row, material) {
  const { fillEllipse, insideDiamond } = raster;
  for (let n = 0; n < 14; n += 1) {
    const [x, y, seed] = seededPoint(cx, cy, index, row, n, 25);
    if (!insideDiamond(x, y, cx, cy, 28, 28)) continue;
    drawSprig(raster, x, y, seed % 4 === 0 ? material.accent : shade(material.dark, 1.1));
  }
  for (let n = 0; n < 5; n += 1) {
    const [x, y, seed] = seededPoint(cx, cy, index, row, n + 33, 22);
    fillEllipse(x, y, 3 + (seed % 3), 1.5, [34, 59, 41, 62]);
  }
}

function drawFieldDetails(raster, cx, cy) {
  const { line } = raster;
  for (let offset = -24; offset <= 24; offset += 8) {
    line(cx - 25, cy + offset - 8, cx + 25, cy + offset + 11, [105, 86, 58, 72]);
    line(cx - 23, cy + offset - 10, cx + 25, cy + offset + 9, [232, 213, 150, 58]);
  }
  line(cx - 27, cy + 12, cx + 26, cy - 8, [82, 67, 45, 88]);
}

function drawDirtDetails(raster, cx, cy, index, row, material) {
  const { fillEllipse, insideDiamond } = raster;
  drawCobbleField(raster, cx, cy, material, [68, 43, 33, 122], [166, 111, 76, 78]);
  for (let n = 0; n < 5; n += 1) {
    const [x, y, seed] = seededPoint(cx, cy, index, row, n, 22);
    if (!insideDiamond(x, y, cx, cy, 27, 27)) continue;
    fillEllipse(x, y, 1 + (seed % 3), 1, [45, 34, 30, 90]);
  }
}

function drawStoneDetails(raster, cx, cy, index, row) {
  const { fillEllipse, insideDiamond, line } = raster;
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
}

function drawWaterDetails(raster, cx, cy) {
  const { fillEllipse, line } = raster;
  for (let offset = -18; offset <= 18; offset += 9) {
    line(cx - 19, cy + offset, cx + 21, cy + offset - 7, [220, 246, 237, 62]);
    line(cx - 15, cy + offset + 4, cx + 17, cy + offset - 1, [23, 77, 109, 42]);
  }
  fillEllipse(cx - 8, cy + 16, 14, 2, [213, 235, 220, 64]);
}

function drawSettlementDetails(raster, cx, cy) {
  const { fillEllipse, line } = raster;
  drawPaverGrid(raster, cx, cy, [78, 66, 51, 116], [235, 220, 171, 68], 10);
  fillEllipse(cx, cy + 12, 18, 2, [65, 55, 45, 42]);
  line(cx - 23, cy - 3, cx + 20, cy + 18, [61, 53, 45, 86]);
  line(cx - 16, cy + 19, cx + 17, cy - 8, [236, 222, 178, 52]);
}

function drawPaverGrid(raster, cx, cy, dark, light, spacing) {
  const { lineClippedToDiamond } = raster;
  for (let offset = -32; offset <= 32; offset += spacing) {
    lineClippedToDiamond(cx - 31, cy + offset - 15, cx + 31, cy + offset + 16, cx, cy, dark);
    lineClippedToDiamond(cx - 31, cy + offset - 17, cx + 31, cy + offset + 14, cx, cy, light);
    lineClippedToDiamond(cx + offset - 15, cy - 31, cx + offset + 16, cy + 31, cx, cy, dark);
    lineClippedToDiamond(cx + offset - 17, cy - 31, cx + offset + 14, cy + 31, cx, cy, light);
  }
}

function drawCobbleField(raster, cx, cy, material, dark, light) {
  const { fillEllipse, insideDiamond, line } = raster;
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

function seededPoint(cx, cy, index, row, n, spread) {
  const seed = hash(index * 41 + row * 131, n + 313);
  return [
    cx + ((seed & 63) / 63 - 0.5) * spread * 2,
    cy + (((seed >>> 6) & 63) / 63 - 0.5) * spread * 2,
    seed,
  ];
}

function drawSprig(raster, x, y, rgba) {
  const { line } = raster;
  line(x, y + 3, x - 3, y - 2, rgba);
  line(x, y + 3, x + 3, y - 1, rgba);
}
