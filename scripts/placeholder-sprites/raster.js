export function createRaster({ width, height, pixels }) {
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

  return {
    fillDiamond,
    fillEllipse,
    fillRect,
    fillTriangle,
    line,
    setPixel,
    strokeDiamond,
    strokeEllipse,
    strokeRect,
    strokeTriangle,
  };
}

function pointInTriangle(x, y, points) {
  const [a, b, c] = points;
  const w1 =
    (a[0] * (c[1] - a[1]) + (y - a[1]) * (c[0] - a[0]) - x * (c[1] - a[1])) /
    ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]));
  const w2 = (y - a[1] - w1 * (b[1] - a[1])) / (c[1] - a[1]);
  return w1 >= 0 && w2 >= 0 && w1 + w2 <= 1;
}
