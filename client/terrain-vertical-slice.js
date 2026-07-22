import { PROJECTION } from "./projection.js";
import { terrainHeightAtWorld } from "./terrain.js";
import { hash01 } from "./terrain-primitives.js";

const SLICE_RADIUS_TILES = 10;
// Generated vegetation candidates are being reviewed side by side. Keep the
// rejected procedural prototype out of the playable proof until a matted,
// manifest-backed sheet is approved.
const GENERATED_VEGETATION_ENABLED = false;
const detailCache = new WeakMap();
const grassChunkCache = new WeakMap();

export function loamVerticalSliceEnabled(search = undefined) {
  const source = search ?? (typeof globalThis.location === "undefined" ? null : globalThis.location.search ?? "");
  if (source == null) return false;
  return new URLSearchParams(source).get("verticalSlice") === "loam";
}

export function loamVerticalSliceDetails(terrain) {
  if (!GENERATED_VEGETATION_ENABLED || !loamVerticalSliceEnabled() || !terrain) return [];
  const cached = detailCache.get(terrain);
  if (cached) return cached;

  const centerX = Math.floor(terrain.cols / 2);
  const centerY = Math.floor(terrain.rows / 2);
  const specs = [
    [-4.8, -3.2, "mature", 0, 2.05],
    [4.8, -3.8, "young", 1, 1.25],
    [4.9, 2.8, "heath", 2, 1.58],
    [-4.7, 3.2, "dead", 3, 1.5],
    [1.6, 5.1, "dying", 4, 1.3],
    [-1.8, -5.3, "young", 5, 1.04],
  ];
  const rocks = [
    [-5.7, -4.1, "boulder", 1.12],
    [-4.3, -2.7, "rock", 0.68],
    [5.8, -2.4, "rock", 0.62],
    [-5.5, 4.8, "rock", 0.6],
    [4.6, 5.1, "boulder", 0.92],
  ];
  const details = [
    ...specs.map(([dx, dy, stage, variant, scale], index) =>
      sliceDetail(terrain, centerX + dx, centerY + dy, "scrub", index, {
        stage,
        variant,
        scale,
        renderStyle: "layered-bush",
        vertical: stage === "mature" ? 1.15 : stage === "dead" ? 0.82 : 0.74,
        footprint: {
          widthTiles: stage === "mature" ? 1.25 : 0.78,
          heightTiles: stage === "mature" ? 0.92 : 0.58,
          reserveRadiusTiles: 0,
          blocksMovement: false,
        },
        lifecycle: {
          stage,
          ageYears: stage === "mature" ? 24 : stage === "dead" ? 31 : 5 + index * 3,
          health: stage === "dead" ? 0 : stage === "dying" ? 0.32 : 0.82,
          decay: stage === "dead" ? 0.76 : stage === "dying" ? 0.42 : 0.04,
          growth: stage === "young" ? 0.36 : stage === "mature" ? 1 : 0.7,
        },
        resources: [{ kind: "fiber", amount: stage === "dead" ? 0 : 1 + (index % 3), maxAmount: 4 }],
      }),
    ),
    ...rocks.map(([dx, dy, kind, scale], index) =>
      sliceDetail(terrain, centerX + dx, centerY + dy, kind, 100 + index, {
        scale,
        footprint: {
          widthTiles: kind === "boulder" ? 0.86 : 0.58,
          heightTiles: kind === "boulder" ? 0.72 : 0.46,
          reserveRadiusTiles: 0,
          blocksMovement: false,
        },
      }),
    ),
  ];
  detailCache.set(terrain, details);
  return details;
}

export function grassVerticesForChunk(chunk, origin, terrain) {
  if (!GENERATED_VEGETATION_ENABLED || !loamVerticalSliceEnabled() || !terrain || !chunk?.tiles?.length) return null;
  const cached = grassChunkCache.get(chunk);
  if (cached?.terrain === terrain && cached.originX === origin.x && cached.originY === origin.y) {
    return cached.vertices;
  }
  const centerX = terrain.cols / 2;
  const centerY = terrain.rows / 2;
  const seed = terrain.profile?.seed ?? 7341;
  const vertices = [];

  for (const tileView of chunk.tiles) {
    const tile = tileView.tile;
    const dx = tile.x + 0.5 - centerX;
    const dy = tile.y + 0.5 - centerY;
    if (Math.abs(dx) > SLICE_RADIUS_TILES || Math.abs(dy) > SLICE_RADIUS_TILES) continue;
    if (tile.material === "water" || tile.material === "settlement") continue;

    const moisture = tile.biome?.moisture ?? 0.45;
    const rockiness = tile.biome?.rockiness ?? 0.35;
    const openSpace = tile.composition?.openSpace ?? 0;
    const pathPressure = tile.composition?.pathPressure ?? 0;
    const baseDensity = 0.56 + moisture * 0.24 - rockiness * 0.15 - openSpace * 0.09 - pathPressure * 0.42;
    const count = hash01(tile.x, tile.y, seed + 1703) < baseDensity ? 1 : 0;
    const second = hash01(tile.x, tile.y, seed + 1709) < Math.max(0, baseDensity - 0.54) * 0.72 ? 1 : 0;
    for (let cluster = 0; cluster < count + second; cluster += 1) {
      const u = 0.13 + hash01(tile.x, tile.y, seed + 1721 + cluster * 17) * 0.74;
      const v = 0.13 + hash01(tile.x, tile.y, seed + 1733 + cluster * 19) * 0.74;
      const point = bilerpPoint(tileView.corners, u, v);
      appendGrassCluster(vertices, point.x, point.y, tile.x, tile.y, cluster, seed, moisture);
    }
  }
  const result = vertices.length ? new Float32Array(vertices) : null;
  grassChunkCache.set(chunk, { terrain, originX: origin.x, originY: origin.y, vertices: result });
  return result;
}

function sliceDetail(terrain, tileX, tileY, kind, index, extra) {
  const x = tileX * PROJECTION.unitsPerTile;
  const y = tileY * PROJECTION.unitsPerTile;
  return {
    id: `loam-slice-${kind}-${index}`,
    kind,
    x,
    y,
    z: terrainHeightAtWorld(terrain, x, y),
    shade: hash01(index, 17, 911) * 2 - 1,
    zone: "loam-slice",
    objectBand: "open",
    sortBias: kind === "scrub" ? 6 : -1,
    ...extra,
  };
}

function bilerpPoint(corners, u, v) {
  const topX = corners.nw.x + (corners.ne.x - corners.nw.x) * u;
  const topY = corners.nw.y + (corners.ne.y - corners.nw.y) * u;
  const bottomX = corners.sw.x + (corners.se.x - corners.sw.x) * u;
  const bottomY = corners.sw.y + (corners.se.y - corners.sw.y) * u;
  return {
    x: topX + (bottomX - topX) * v,
    y: topY + (bottomY - topY) * v,
  };
}

// Interleaved vertex: x, y, tip, phase, premultiplied r, g, b, a.
function appendGrassCluster(out, x, y, tileX, tileY, cluster, seed, moisture) {
  const phase = hash01(tileX, tileY, seed + 1811 + cluster * 31) * Math.PI * 2;
  const shadowAlpha = 0.13;
  pushTriangle(out,
    [x - 4, y + 1, 0, phase, 0.004, 0.005, 0.003, shadowAlpha],
    [x + 16, y + 7, 0, phase, 0, 0, 0, 0],
    [x + 3, y + 5, 0, phase, 0.003, 0.004, 0.002, shadowAlpha * 0.72],
  );
  const blades = 7 + Math.floor(hash01(tileX, tileY, seed + 1847 + cluster) * 4);
  for (let blade = 0; blade < blades; blade += 1) {
    const roll = hash01(tileX * 7 + blade, tileY * 11 + cluster, seed + 1871);
    const height = 12 + roll * 14;
    const spread = (blade - (blades - 1) / 2) * 2.65;
    const lean = (hash01(tileX + blade, tileY - blade, seed + 1877 + cluster) - 0.5) * 12;
    const width = 1.05 + roll * 0.9;
    const olive = 0.29 + moisture * 0.075 + roll * 0.07;
    const alpha = 0.82 + roll * 0.15;
    const warmth = blade % 4 === 0 ? 0.035 : 0;
    const color = [(olive * 0.7 + warmth) * alpha, olive * alpha, (0.11 + warmth) * alpha, alpha];
    pushTriangle(out,
      [x + spread - width, y + 3, 0, phase + blade * 0.37, ...color],
      [x + spread + width, y + 3, 0, phase + blade * 0.37, ...color],
      [x + spread + lean, y - height, 1, phase + blade * 0.37, ...color],
    );
  }
}

function pushTriangle(out, ...vertices) {
  for (const vertex of vertices) out.push(...vertex);
}
