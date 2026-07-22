const REQUIRED_BIOMES = ["meadow", "loam", "rock", "snow", "wetland", "water"];

export function assembleWorldChunkWindow(index, loadedChunks) {
  const chunks = [...loadedChunks.values()].filter(Boolean);
  if (chunks.length === 0) throw new Error("world chunk window is empty");
  for (const chunk of chunks) {
    const expected = index.entries.get(`${chunk.coord?.x},${chunk.coord?.y}`);
    if (!expected || chunk.world !== index.world || chunk.id !== expected.id) throw new Error("world chunk window contains an unindexed chunk");
  }
  const minX = Math.min(...chunks.map((chunk) => chunk.sample.x));
  const minY = Math.min(...chunks.map((chunk) => chunk.sample.y));
  const maxX = Math.max(...chunks.map((chunk) => chunk.sample.x + chunk.sample.cols));
  const maxY = Math.max(...chunks.map((chunk) => chunk.sample.y + chunk.sample.rows));
  const cols = maxX - minX;
  const rows = maxY - minY;
  if (cols < 1 || rows < 1 || cols > index.dimensions.cols || rows > index.dimensions.rows) throw new Error("world chunk window bounds are invalid");

  const fieldNames = [...new Set(chunks.flatMap((chunk) => Object.keys(chunk.fields ?? {})))].sort();
  const biomeNames = [...new Set(chunks.flatMap((chunk) => Object.keys(chunk.biomeWeights ?? {})))].sort();
  const materialFamilies = [...new Set(chunks.flatMap((chunk) => chunk.materialWeights?.families ?? []))].sort();
  if (!REQUIRED_BIOMES.every((name) => biomeNames.includes(name))) throw new Error("world chunk window biome authority is incomplete");
  const fields = Object.fromEntries(fieldNames.map((name) => [name, matrix(rows, cols)]));
  const biomeWeights = Object.fromEntries(biomeNames.map((name) => [name, matrix(rows, cols)]));
  const materialWeights = Object.fromEntries(materialFamilies.map((name) => [name, matrix(rows, cols)]));
  const heights = matrix(rows + 1, cols + 1);
  const materials = matrix(rows, cols);
  const zones = matrix(rows, cols);
  const waterAuthority = assembleWaterAuthority(chunks, minX, minY, cols, rows);

  for (const chunk of chunks) {
    checkChunkShape(chunk, fieldNames, biomeNames);
    for (let localY = 0; localY < chunk.sample.rows; localY += 1) for (let localX = 0; localX < chunk.sample.cols; localX += 1) {
      const targetX = chunk.sample.x + localX - minX;
      const targetY = chunk.sample.y + localY - minY;
      mergeCell(materials, targetX, targetY, chunk.materialGrid[localY][localX], "material");
      mergeCell(zones, targetX, targetY, chunk.climateZoneRows[localY][localX], "climate zone");
      for (const name of fieldNames) mergeCell(fields[name], targetX, targetY, chunk.fields[name][localY][localX], `field ${name}`);
      for (const name of biomeNames) mergeCell(biomeWeights[name], targetX, targetY, chunk.biomeWeights[name][localY][localX], `biome ${name}`);
      for (const name of materialFamilies) mergeCell(materialWeights[name], targetX, targetY, chunk.materialWeights.weights[name][localY][localX], `material weight ${name}`);
    }
    for (let localY = 0; localY <= chunk.sample.rows; localY += 1) for (let localX = 0; localX <= chunk.sample.cols; localX += 1) {
      mergeCell(heights, chunk.sample.x + localX - minX, chunk.sample.y + localY - minY, chunk.heights[localY][localX], "height");
    }
  }
  assertComplete(heights, "height");
  assertComplete(materials, "material");
  assertComplete(zones, "climate zone");
  for (const [name, values] of Object.entries(fields)) assertComplete(values, `field ${name}`);
  for (const [name, values] of Object.entries(biomeWeights)) assertComplete(values, `biome ${name}`);
  for (const [name, values] of Object.entries(materialWeights)) assertComplete(values, `material weight ${name}`);

  const visualHeath = Array.from({ length: rows + 1 }, (_, y) => Array.from({ length: cols + 1 }, (_, x) => {
    const tileX = Math.min(cols - 1, x);
    const tileY = Math.min(rows - 1, y);
    return biomeWeights.loam[tileY][tileX];
  }));
  const features = mergeFeatures(chunks);
  return {
    schema: "duskfell-world-bundle-v2",
    version: "stream-window-v1",
    id: index.world,
    dimensions: { cols, rows, unitsPerTile: index.dimensions.unitsPerTile, width: cols * index.dimensions.unitsPerTile, height: rows * index.dimensions.unitsPerTile },
    worldDimensions: structuredClone(index.dimensions),
    sourceRegion: { offsetX: minX, offsetY: minY, cols, rows },
    streamingWindow: {
      schema: "duskfell-world-stream-window-v1",
      sourceBundleContentSha256: index.sourceBundleContentSha256,
      chunkIds: chunks.map((chunk) => chunk.id).sort(),
      coreBounds: {
        minX: Math.min(...chunks.map((chunk) => chunk.core.x)),
        minY: Math.min(...chunks.map((chunk) => chunk.core.y)),
        maxX: Math.max(...chunks.map((chunk) => chunk.core.x + chunk.core.cols)),
        maxY: Math.max(...chunks.map((chunk) => chunk.core.y + chunk.core.rows)),
      },
    },
    heights,
    fields,
    biomeWeights,
    materialWeights: materialFamilies.length ? {
      schema: "duskfell-material-weights-v1",
      algorithm: chunks[0].materialWeights.algorithm,
      normalization: "sum-to-one-per-tile",
      families: materialFamilies,
      weights: materialWeights,
    } : null,
    climate: { zones: { rows: zones.map((row) => row.join("")) } },
    waterAuthority,
    features,
    ecology: { landmarks: features.landmarks, resourceNodes: features.resourceNodes },
    legacy: {
      cols,
      rows,
      materialGrid: materials.map((row) => row.join("")),
      heights: heights.map((row) => row.map((value) => value * 2)),
      heathWeights: visualHeath,
      vegetation: fields.vegetation ?? matrix(rows, cols, 0),
    },
  };
}

function assembleWaterAuthority(chunks, minX, minY, cols, rows) {
  const first = chunks[0].waterAuthority;
  if (!first) return null;
  const samples = first.samplesPerTile;
  const fieldNames = ["wetMask", "surfaceHeight", "depth", "flowDirectionD8", "flowStrength"];
  const fields = Object.fromEntries(fieldNames.map((name) => [name, matrix(rows * samples, cols * samples)]));
  for (const chunk of chunks) {
    const authority = chunk.waterAuthority;
    if (!authority || authority.schema !== first.schema || authority.algorithm !== first.algorithm || authority.samplesPerTile !== samples || authority.heightScale !== first.heightScale) {
      throw new Error("world chunk water authority contract drifts across chunks");
    }
    const expectedSample = {
      x: chunk.sample.x * samples,
      y: chunk.sample.y * samples,
      cols: chunk.sample.cols * samples,
      rows: chunk.sample.rows * samples,
    };
    if (JSON.stringify(authority.sample) !== JSON.stringify(expectedSample)) throw new Error(`world chunk ${chunk.id} water sample bounds are invalid`);
    for (const name of fieldNames) {
      if (!gridShape(authority[name], expectedSample.rows, expectedSample.cols)) throw new Error(`world chunk ${chunk.id} water ${name} is invalid`);
    }
    for (let localY = 0; localY < expectedSample.rows; localY += 1) for (let localX = 0; localX < expectedSample.cols; localX += 1) {
      const targetX = expectedSample.x + localX - minX * samples;
      const targetY = expectedSample.y + localY - minY * samples;
      for (const name of fieldNames) mergeCell(fields[name], targetX, targetY, authority[name][localY][localX], `water ${name}`);
    }
  }
  for (const [name, values] of Object.entries(fields)) assertComplete(values, `water ${name}`);
  return {
    schema: first.schema,
    algorithm: first.algorithm,
    samplesPerTile: samples,
    unitsPerTile: first.unitsPerTile,
    heightEncoding: first.heightEncoding,
    heightScale: first.heightScale,
    cellCols: cols * samples,
    cellRows: rows * samples,
    ...fields,
  };
}

function checkChunkShape(chunk, fieldNames, biomeNames) {
  const { cols, rows } = chunk.sample;
  if (!gridShape(chunk.heights, rows + 1, cols + 1)) throw new Error(`world chunk ${chunk.id} heights are invalid`);
  if (!Array.isArray(chunk.materialGrid) || chunk.materialGrid.length !== rows || chunk.materialGrid.some((row) => typeof row !== "string" || row.length !== cols)) throw new Error(`world chunk ${chunk.id} materials are invalid`);
  if (!Array.isArray(chunk.climateZoneRows) || chunk.climateZoneRows.length !== rows || chunk.climateZoneRows.some((row) => typeof row !== "string" || row.length !== cols)) throw new Error(`world chunk ${chunk.id} climate zones are invalid`);
  for (const name of fieldNames) if (!gridShape(chunk.fields?.[name], rows, cols)) throw new Error(`world chunk ${chunk.id} field ${name} is invalid`);
  for (const name of biomeNames) if (!gridShape(chunk.biomeWeights?.[name], rows, cols)) throw new Error(`world chunk ${chunk.id} biome ${name} is invalid`);
  for (const name of chunk.materialWeights?.families ?? []) if (!gridShape(chunk.materialWeights?.weights?.[name], rows, cols)) throw new Error(`world chunk ${chunk.id} material weight ${name} is invalid`);
}

function mergeFeatures(chunks) {
  const unique = (name) => {
    const entries = new Map();
    for (const chunk of chunks) for (const entry of chunk.features?.[name] ?? []) {
      const encoded = JSON.stringify(entry);
      if (entries.has(entry.id) && entries.get(entry.id) !== encoded) throw new Error(`world chunk feature ${entry.id} drifts across chunks`);
      entries.set(entry.id, encoded);
    }
    return [...entries.values()].map((value) => JSON.parse(value)).sort((left, right) => left.id.localeCompare(right.id));
  };
  return {
    settlements: unique("settlements"),
    landmarks: unique("landmarks"),
    resourceNodes: unique("resourceNodes"),
    trailIds: [...new Set(chunks.flatMap((chunk) => chunk.features?.trailIds ?? []))].sort(),
  };
}

function mergeCell(target, x, y, value, label) {
  if (value === undefined || value === null) throw new Error(`world chunk ${label} contains a missing sample`);
  const current = target[y][x];
  if (current !== null && current !== value) throw new Error(`world chunk overlap ${label} drifts at ${x},${y}`);
  target[y][x] = value;
}

function assertComplete(values, label) {
  if (values.some((row) => row.some((value) => value === null))) throw new Error(`world chunk window ${label} coverage has a gap`);
}

function gridShape(values, rows, cols) {
  return Array.isArray(values) && values.length === rows && values.every((row) => Array.isArray(row) && row.length === cols && row.every(Number.isFinite));
}

function matrix(rows, cols, value = null) {
  return Array.from({ length: rows }, () => Array(cols).fill(value));
}
