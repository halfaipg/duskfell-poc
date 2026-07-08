export function createRaster({ width, height, pixels, cell }) {
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

  return {
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
  };
}

function pointInTriangle(x, y, points) {
  const [a, b, c] = points;
  const w1 = (a[0] * (c[1] - a[1]) + (y - a[1]) * (c[0] - a[0]) - x * (c[1] - a[1])) /
    ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]));
  const w2 = (y - a[1] - w1 * (b[1] - a[1])) / (c[1] - a[1]);
  return w1 >= 0 && w2 >= 0 && w1 + w2 <= 1;
}
