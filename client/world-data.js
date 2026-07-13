import { visualBiomeWeightsAt, VISUAL_BIOMES } from "./terrain-visual-biomes.js";
import { continuousVertexHeight } from "./terrain-height.js";

// WorldData: the data layer every render path consumes instead of calling
// worldgen formulas directly. Every field here is derivable from baked grids
// (vertex heights, tile materials, biome weights) — TODAY they are computed
// from the current island's formulas at terrain build so output is
// unchanged; the wipe-era worldgen bridge swaps the source of this object
// for fetched per-world grids and nothing downstream changes.
//
// Channel fields (distance / flow / fords) are already computed purely from
// the TILE MATERIAL GRID — no formula dependency — which is exactly the
// shape a terrain-diffusion world provides.
export function buildWorldData(tiles, cols, rows, safeRadiusTiles, profile) {
  const heights = buildVertexGrid(cols, rows, (x, y) =>
    continuousVertexHeight(x, y, cols, rows, safeRadiusTiles, profile),
  );
  const heath = buildVertexGrid(cols, rows, (x, y) =>
    visualBiomeWeightsAt(x, y, cols, rows, profile.seed).heath,
  );
  const channel = buildChannelFields(tiles, cols, rows);

  const sampleVertexGrid = (grid, mapX, mapY) => {
    const x = clamp(mapX, 0, cols);
    const y = clamp(mapY, 0, rows);
    const x0 = Math.min(cols - 1, Math.floor(x));
    const y0 = Math.min(rows - 1, Math.floor(y));
    const fx = x - x0;
    const fy = y - y0;
    const w = cols + 1;
    const nw = grid[y0 * w + x0];
    const ne = grid[y0 * w + x0 + 1];
    const sw = grid[(y0 + 1) * w + x0];
    const se = grid[(y0 + 1) * w + x0 + 1];
    return (nw * (1 - fx) + ne * fx) * (1 - fy) + (sw * (1 - fx) + se * fx) * fy;
  };

  const sampleTileGrid = (grid, mapX, mapY) => {
    // tile-center lattice: value at (x+0.5, y+0.5)
    const x = clamp(mapX - 0.5, 0, cols - 1);
    const y = clamp(mapY - 0.5, 0, rows - 1);
    const x0 = Math.min(cols - 2, Math.floor(x));
    const y0 = Math.min(rows - 2, Math.floor(y));
    const fx = x - x0;
    const fy = y - y0;
    const nw = grid[y0 * cols + x0];
    const ne = grid[y0 * cols + x0 + 1];
    const sw = grid[(y0 + 1) * cols + x0];
    const se = grid[(y0 + 1) * cols + x0 + 1];
    return (nw * (1 - fx) + ne * fx) * (1 - fy) + (sw * (1 - fx) + se * fx) * fy;
  };

  return {
    cols,
    rows,
    heightAt: (mapX, mapY) => sampleVertexGrid(heights, mapX, mapY),
    heathWeightAt: (mapX, mapY) => sampleVertexGrid(heath, mapX, mapY),
    weightsAt(mapX, mapY) {
      const heathWeight = clamp(sampleVertexGrid(heath, mapX, mapY), 0, 1);
      const weights = Object.fromEntries(VISUAL_BIOMES.map((biome) => [biome, 0]));
      weights.heath = heathWeight;
      weights.meadow = 1 - heathWeight;
      return weights;
    },
    activeBiomesForPatch(superX, superY, patchTiles) {
      let min = 1;
      let max = 0;
      for (let sy = 0; sy <= 4; sy += 1) {
        for (let sx = 0; sx <= 4; sx += 1) {
          const value = clamp(
            sampleVertexGrid(heath, superX * patchTiles + (sx / 4) * patchTiles, superY * patchTiles + (sy / 4) * patchTiles),
            0,
            1,
          );
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
      const active = [];
      if (1 - min >= 0.018) active.push("meadow");
      if (max >= 0.018) active.push("heath");
      // dominant first, mirroring the old maxima sort
      if (active.length === 2 && max > 1 - min) active.reverse();
      return active;
    },
    channel: {
      distanceAt: (mapX, mapY) => sampleTileGrid(channel.distance, mapX, mapY),
      fordnessAt: (mapX, mapY) => sampleTileGrid(channel.fordness, mapX, mapY),
      flowAt(mapX, mapY) {
        const x = sampleTileGrid(channel.flowX, mapX, mapY);
        const y = sampleTileGrid(channel.flowY, mapX, mapY);
        const norm = Math.hypot(x, y);
        return norm > 0.001 ? { x: x / norm, y: y / norm } : { x: 0, y: 1 };
      },
      waterTiles: channel.waterTiles,
    },
  };
}

// distance / flow / fordness computed purely from tile materials
function buildChannelFields(tiles, cols, rows) {
  const distance = new Float32Array(cols * rows).fill(1e9);
  const fordSeeds = [];
  const waterTiles = [];
  const queue = [];
  for (const tile of tiles) {
    const index = tile.y * cols + tile.x;
    if (tile.material === "water") {
      distance[index] = 0;
      queue.push(index);
      waterTiles.push({ x: tile.x, y: tile.y });
    } else if (tile.material === "shore") {
      fordSeeds.push({ x: tile.x, y: tile.y });
    }
  }
  // chamfer-ish BFS distance transform (8-neighbour)
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++];
    const x = index % cols;
    const y = (index / cols) | 0;
    const base = distance[index];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const step = dx !== 0 && dy !== 0 ? 1.4142 : 1;
        const nIndex = ny * cols + nx;
        if (distance[nIndex] > base + step + 1e-6) {
          distance[nIndex] = base + step;
          queue.push(nIndex);
        }
      }
    }
  }

  // flow: principal axis of nearby water tiles, signed downstream by the
  // global course (first water tile in scan order is upstream). Non-water
  // tiles inherit via the same BFS wave, so banks animate consistently.
  const flowX = new Float32Array(cols * rows);
  const flowY = new Float32Array(cols * rows);
  if (waterTiles.length > 1) {
    const downstream = {
      x: waterTiles[waterTiles.length - 1].x - waterTiles[0].x,
      y: waterTiles[waterTiles.length - 1].y - waterTiles[0].y,
    };
    for (const tile of waterTiles) {
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      let count = 0;
      for (const other of waterTiles) {
        const dx = other.x - tile.x;
        const dy = other.y - tile.y;
        if (dx * dx + dy * dy > 16) continue;
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
        count += 1;
      }
      if (count < 2) continue;
      // dominant eigenvector of the 2x2 covariance
      const trace = sxx + syy;
      const det = sxx * syy - sxy * sxy;
      const lambda = trace / 2 + Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
      let ax = sxy;
      let ay = lambda - sxx;
      if (Math.abs(ax) + Math.abs(ay) < 1e-6) {
        ax = lambda - syy;
        ay = sxy;
      }
      const norm = Math.hypot(ax, ay) || 1;
      ax /= norm;
      ay /= norm;
      if (ax * downstream.x + ay * downstream.y < 0) {
        ax = -ax;
        ay = -ay;
      }
      const index = tile.y * cols + tile.x;
      flowX[index] = ax;
      flowY[index] = ay;
    }
    // spread flow outward to banks (nearest water tile's flow)
    for (let pass = 0; pass < 4; pass += 1) {
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const index = y * cols + x;
          if (flowX[index] !== 0 || flowY[index] !== 0) continue;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const nIndex = ny * cols + nx;
            if (flowX[nIndex] !== 0 || flowY[nIndex] !== 0) {
              flowX[index] = flowX[nIndex];
              flowY[index] = flowY[nIndex];
              break;
            }
          }
        }
      }
    }
  }

  // fordness: shore tiles inside the channel radiate a walkable-crossing
  // field; the painter turns it into gravel
  const fordness = new Float32Array(cols * rows);
  for (const seed of fordSeeds) {
    if (distance[seed.y * cols + seed.x] > 2.5) continue;
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const nx = seed.x + dx;
        const ny = seed.y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const falloff = Math.max(0, 1 - Math.hypot(dx, dy) / 3.2);
        const index = ny * cols + nx;
        fordness[index] = Math.max(fordness[index], falloff);
      }
    }
  }

  return { distance, flowX, flowY, fordness, waterTiles };
}

function buildVertexGrid(cols, rows, sample) {
  const grid = new Float32Array((cols + 1) * (rows + 1));
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= cols; x += 1) {
      grid[y * (cols + 1) + x] = sample(x, y);
    }
  }
  return grid;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
