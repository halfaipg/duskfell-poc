export function noise2d(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  return bilerp(
    hashUnit(x0, y0, seed + 3),
    hashUnit(x0 + 1, y0, seed + 3),
    hashUnit(x0, y0 + 1, seed + 3),
    hashUnit(x0 + 1, y0 + 1, seed + 3),
    fx,
    fy,
  );
}

export function hashUnit(x, y, seed) {
  let value = Math.imul(x + 101, 374761393) ^ Math.imul(y + 181, 668265263) ^ Math.imul(seed + 31, 2147483647);
  value = (value ^ (value >>> 13)) >>> 0;
  value = Math.imul(value, 1274126177) >>> 0;
  return (((value ^ (value >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}

export function hash01(x, y, seed) {
  return (hashUnit(x, y, seed) + 1) / 2;
}

export function bilerp(nw, ne, sw, se, fx, fy) {
  const north = nw * (1 - fx) + ne * fx;
  const south = sw * (1 - fx) + se * fx;
  return north * (1 - fy) + south * fy;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}
