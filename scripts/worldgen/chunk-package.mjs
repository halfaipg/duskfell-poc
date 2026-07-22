import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function writeWorldChunks(bundle, recipe, outputDir) {
  const chunkTiles = recipe.macro.tiles;
  const apronTiles = recipe.macro.apronTiles;
  const vertexHeightPrecision = 1000;
  const chunkDir = path.join(outputDir, "chunks");
  fs.mkdirSync(chunkDir, { recursive: true });
  const chunks = [];
  const chunkCols = Math.ceil(bundle.dimensions.cols / chunkTiles);
  const chunkRows = Math.ceil(bundle.dimensions.rows / chunkTiles);

  for (let chunkY = 0; chunkY < chunkRows; chunkY += 1) for (let chunkX = 0; chunkX < chunkCols; chunkX += 1) {
    const core = {
      x: chunkX * chunkTiles,
      y: chunkY * chunkTiles,
      cols: Math.min(chunkTiles, bundle.dimensions.cols - chunkX * chunkTiles),
      rows: Math.min(chunkTiles, bundle.dimensions.rows - chunkY * chunkTiles),
    };
    const sample = {
      x: Math.max(0, core.x - apronTiles),
      y: Math.max(0, core.y - apronTiles),
      cols: 0,
      rows: 0,
    };
    sample.cols = Math.min(bundle.dimensions.cols, core.x + core.cols + apronTiles) - sample.x;
    sample.rows = Math.min(bundle.dimensions.rows, core.y + core.rows + apronTiles) - sample.y;
    const id = `${chunkX}-${chunkY}`;
    const chunk = {
      schema: "duskfell-world-chunk-v1",
      world: bundle.id,
      id,
      coord: { x: chunkX, y: chunkY },
      core,
      sample,
      unitsPerTile: bundle.dimensions.unitsPerTile,
      heights: sliceGrid(bundle.heights, sample.x, sample.y, sample.cols + 1, sample.rows + 1),
      vertexHeightPrecision,
      vertexHeights: sliceGrid(bundle.legacy.heights, sample.x, sample.y, sample.cols + 1, sample.rows + 1)
        .map((row) => row.map((height) => Math.round(height * vertexHeightPrecision))),
      fields: Object.fromEntries(Object.entries(bundle.fields).map(([name, values]) => [name, sliceGrid(values, sample.x, sample.y, sample.cols, sample.rows)])),
      biomeWeights: Object.fromEntries(Object.entries(bundle.biomeWeights).map(([name, values]) => [name, sliceGrid(values, sample.x, sample.y, sample.cols, sample.rows)])),
      materialWeights: {
        schema: bundle.materialWeights.schema,
        algorithm: bundle.materialWeights.algorithm,
        normalization: bundle.materialWeights.normalization,
        families: bundle.materialWeights.families,
        weights: Object.fromEntries(Object.entries(bundle.materialWeights.weights).map(([name, values]) => [name, sliceGrid(values, sample.x, sample.y, sample.cols, sample.rows)])),
      },
      waterAuthority: sliceWaterAuthority(bundle.waterAuthority, sample),
      materialGrid: bundle.legacy.materialGrid.slice(sample.y, sample.y + sample.rows).map((row) => row.slice(sample.x, sample.x + sample.cols)),
      climateZoneRows: bundle.climate.zones.rows.slice(sample.y, sample.y + sample.rows).map((row) => row.slice(sample.x, sample.x + sample.cols)),
      features: chunkFeatures(bundle, core),
    };
    const filename = `chunk-${id}.json`;
    const filePath = path.join(chunkDir, filename);
    fs.writeFileSync(filePath, `${JSON.stringify(chunk)}\n`);
    chunks.push({
      id,
      coord: chunk.coord,
      core,
      sample,
      path: `chunks/${filename}`,
      sha256: sha256(filePath),
      bytes: fs.statSync(filePath).size,
    });
  }

  const index = {
    schema: "duskfell-world-chunk-index-v1",
    world: bundle.id,
    sourceBundleContentSha256: bundle.contentSha256,
    dimensions: bundle.dimensions,
    chunkTiles,
    apronTiles,
    vertexHeightPrecision,
    grid: { cols: chunkCols, rows: chunkRows },
    fields: Object.keys(bundle.fields),
    biomeWeights: Object.keys(bundle.biomeWeights),
    materialWeights: {
      schema: bundle.materialWeights.schema,
      algorithm: bundle.materialWeights.algorithm,
      normalization: bundle.materialWeights.normalization,
      families: bundle.materialWeights.families,
    },
    waterAuthority: {
      schema: bundle.waterAuthority.schema,
      samplesPerTile: bundle.waterAuthority.samplesPerTile,
      fields: ["wetMask", "surfaceHeight", "depth", "flowDirectionD8", "flowStrength"],
    },
    chunks,
    runtimeIntent: "stream core tiles; use apron samples for seam-safe generation and rendering",
  };
  const indexPath = path.join(chunkDir, "index.json");
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return {
    path: "chunks/index.json",
    sha256: sha256(indexPath),
    count: chunks.length,
    chunkTiles,
    apronTiles,
    vertexHeightPrecision,
    totalBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
  };
}

function sliceWaterAuthority(authority, tileSample) {
  if (!authority || authority.schema !== "duskfell-water-authority-v1") throw new Error("world bundle is missing canonical water authority");
  const samples = authority.samplesPerTile;
  const sample = {
    x: tileSample.x * samples,
    y: tileSample.y * samples,
    cols: tileSample.cols * samples,
    rows: tileSample.rows * samples,
  };
  return {
    schema: authority.schema,
    algorithm: authority.algorithm,
    samplesPerTile: samples,
    unitsPerTile: authority.unitsPerTile,
    heightEncoding: authority.heightEncoding,
    heightScale: authority.heightScale,
    sample,
    wetMask: sliceGrid(authority.wetMask, sample.x, sample.y, sample.cols, sample.rows),
    surfaceHeight: sliceGrid(authority.surfaceHeight, sample.x, sample.y, sample.cols, sample.rows),
    depth: sliceGrid(authority.depth, sample.x, sample.y, sample.cols, sample.rows),
    flowDirectionD8: sliceGrid(authority.flowDirectionD8, sample.x, sample.y, sample.cols, sample.rows),
    flowStrength: sliceGrid(authority.flowStrength, sample.x, sample.y, sample.cols, sample.rows),
  };
}

function chunkFeatures(bundle, core) {
  const contains = (point) => point.x >= core.x && point.y >= core.y && point.x < core.x + core.cols && point.y < core.y + core.rows;
  return {
    settlements: (bundle.features?.settlements ?? []).filter(contains),
    landmarks: (bundle.ecology?.landmarks ?? []).filter(contains),
    resourceNodes: (bundle.ecology?.resourceNodes ?? []).filter(contains),
    trailIds: (bundle.features?.trails ?? []).filter((trail) => trail.points.some(contains)).map((trail) => trail.id),
  };
}

function sliceGrid(values, x, y, cols, rows) {
  return values.slice(y, y + rows).map((row) => row.slice(x, x + cols));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
