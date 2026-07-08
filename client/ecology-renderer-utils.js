import { projectWorld } from "./projection.js";
import { terrainHeightAtWorld } from "./terrain.js";

export function ecologyObjectGroundPoint(object, origin, terrain) {
  const z = terrainHeightAtWorld(terrain, object.x, object.y);
  return projectWorld(object.x, object.y, z, origin);
}

export function quadraticPoint(a, b, c, t) {
  const inv = 1 - t;
  return {
    x: inv * inv * a.x + 2 * inv * t * b.x + t * t * c.x,
    y: inv * inv * a.y + 2 * inv * t * b.y + t * t * c.y,
  };
}

export function stableStringHash(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}
