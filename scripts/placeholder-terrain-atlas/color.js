export function shade(rgba, factor) {
  return [
    Math.max(0, Math.min(255, Math.round(rgba[0] * factor))),
    Math.max(0, Math.min(255, Math.round(rgba[1] * factor))),
    Math.max(0, Math.min(255, Math.round(rgba[2] * factor))),
    rgba[3],
  ];
}

export function mix(a, b, t) {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
    Math.round(a[3] * (1 - t) + b[3] * t),
  ];
}

export function hash(a, b) {
  let value = Math.imul(a + 101, 374761393) ^ Math.imul(b + 181, 668265263);
  value = (value ^ (value >>> 13)) >>> 0;
  return Math.imul(value, 1274126177) >>> 0;
}
