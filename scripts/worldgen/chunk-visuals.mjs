import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const VISUAL_SETS = {
  control: {
    directory: "chunks/visual-controls",
    schema: "duskfell-chunk-visual-control-index-v1",
    review: "chunk-visual-controls-review.png",
    runtimeIntent: "img2img each apron-bearing control independently; publish only validated core crops",
  },
  illustrated: {
    directory: "chunks/visual-illustrated",
    schema: "duskfell-chunk-visual-illustrated-index-v1",
    review: "chunk-visual-illustrated-review.png",
    runtimeIntent: "stream validated core crops; retain aprons for seam audit and future regeneration",
  },
};

export function writeChunkVisualControls(packageDir, bundle, recipe, chunkIndexReference, sourceRaster) {
  return writeChunkVisualSet("control", packageDir, bundle, recipe, chunkIndexReference, sourceRaster);
}

export function writeIllustratedChunkVisuals(packageDir, bundle, recipe, chunkIndexReference, sourceRaster) {
  return writeChunkVisualSet("illustrated", packageDir, bundle, recipe, chunkIndexReference, sourceRaster);
}

function writeChunkVisualSet(kind, packageDir, bundle, recipe, chunkIndexReference, sourceRaster) {
  const config = VISUAL_SETS[kind];
  if (!config) throw new Error(`unsupported chunk visual set ${kind}`);
  const root = path.resolve(packageDir);
  const indexPath = path.join(root, chunkIndexReference.path);
  const chunkIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const pixelsPerTile = sourceRaster.pixelsPerTile;
  const sourcePath = path.join(root, sourceRaster.path);
  const expectedWidth = bundle.dimensions.cols * pixelsPerTile;
  const expectedHeight = bundle.dimensions.rows * pixelsPerTile;
  const dimensions = pngDimensions(sourcePath);
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    throw new Error("chunk visual source raster dimensions drift from world authority");
  }

  const sourceRgb = readRgb(sourcePath, expectedWidth, expectedHeight);
  const outputDir = path.join(root, config.directory);
  fs.mkdirSync(outputDir, { recursive: true });
  const entries = [];
  const ppmPaths = [];
  for (const chunk of chunkIndex.chunks) {
    const width = chunk.sample.cols * pixelsPerTile;
    const height = chunk.sample.rows * pixelsPerTile;
    const sourceX = chunk.sample.x * pixelsPerTile;
    const sourceY = chunk.sample.y * pixelsPerTile;
    const basename = `chunk-${chunk.id}.png`;
    const outputPath = path.join(outputDir, basename);
    const ppmPath = outputPath.replace(/\.png$/, ".ppm");
    const rgb = cropRgb(sourceRgb, expectedWidth, sourceX, sourceY, width, height);
    fs.writeFileSync(ppmPath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]));
    ppmPaths.push(ppmPath);
    entries.push({
      id: chunk.id,
      coord: chunk.coord,
      core: chunk.core,
      sample: chunk.sample,
      image: {
        path: `${config.directory}/${basename}`,
        width,
        height,
        pixelsPerTile,
      },
      coreCrop: {
        x: (chunk.core.x - chunk.sample.x) * pixelsPerTile,
        y: (chunk.core.y - chunk.sample.y) * pixelsPerTile,
        width: chunk.core.cols * pixelsPerTile,
        height: chunk.core.rows * pixelsPerTile,
      },
    });
  }

  try {
    execFileSync("magick", [
      "mogrify",
      "-format", "png",
      "-strip",
      "-define", "png:exclude-chunks=date,time",
      "-define", "png:compression-level=9",
      ...ppmPaths,
    ], { maxBuffer: 20_000_000 });
  } finally {
    for (const ppmPath of ppmPaths) fs.rmSync(ppmPath, { force: true });
  }

  for (const entry of entries) {
    const imagePath = path.join(root, entry.image.path);
    entry.image.sha256 = sha256(imagePath);
    entry.image.bytes = fs.statSync(imagePath).size;
  }
  const seams = chunkVisualSeams(entries, sourceRgb, expectedWidth, pixelsPerTile);
  const visualIndex = {
    schema: config.schema,
    role: kind,
    world: bundle.id,
    sourceBundleContentSha256: bundle.contentSha256,
    sourceChunkIndexSha256: chunkIndexReference.sha256,
    sourceRaster: {
      path: sourceRaster.path,
      sha256: sourceRaster.sha256,
      width: sourceRaster.width,
      height: sourceRaster.height,
      pixelsPerTile,
    },
    chunkTiles: chunkIndex.chunkTiles,
    apronTiles: chunkIndex.apronTiles,
    grid: chunkIndex.grid,
    entries,
    seams,
    runtimeIntent: config.runtimeIntent,
  };
  const visualIndexPath = path.join(outputDir, "index.json");
  fs.writeFileSync(visualIndexPath, `${JSON.stringify(visualIndex, null, 2)}\n`);

  const reviewPath = path.join(root, config.review);
  execFileSync("magick", [
    "montage",
    ...entries.map((entry) => path.join(root, entry.image.path)),
    "-thumbnail", "240x240",
    "-tile", `${Math.min(6, chunkIndex.grid.cols)}x`,
    "-geometry", "+8+8",
    "-background", "#111111",
    reviewPath,
  ], { maxBuffer: 20_000_000 });

  return {
    index: {
      path: `${config.directory}/index.json`,
      sha256: sha256(visualIndexPath),
    },
    review: {
      path: path.basename(reviewPath),
      sha256: sha256(reviewPath),
    },
    count: entries.length,
    seamCount: seams.length,
    pixelsPerTile,
    totalBytes: entries.reduce((sum, entry) => sum + entry.image.bytes, 0),
  };
}

function chunkVisualSeams(entries, sourceRgb, sourceWidth, pixelsPerTile) {
  const byCoord = new Map(entries.map((entry) => [`${entry.coord.x},${entry.coord.y}`, entry]));
  const seams = [];
  for (const entry of entries) {
    for (const [direction, dx, dy] of [["east", 1, 0], ["south", 0, 1]]) {
      const neighbor = byCoord.get(`${entry.coord.x + dx},${entry.coord.y + dy}`);
      if (!neighbor) continue;
      const intersection = intersect(entry.sample, neighbor.sample);
      if (!intersection) throw new Error(`chunk visual ${entry.id}/${neighbor.id} has no shared apron`);
      const pixelRect = {
        x: intersection.x * pixelsPerTile,
        y: intersection.y * pixelsPerTile,
        width: intersection.cols * pixelsPerTile,
        height: intersection.rows * pixelsPerTile,
      };
      const rgb = cropRgb(sourceRgb, sourceWidth, pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height);
      seams.push({
        a: entry.id,
        b: neighbor.id,
        direction,
        intersection,
        aCrop: localCrop(entry, intersection, pixelsPerTile),
        bCrop: localCrop(neighbor, intersection, pixelsPerTile),
        rgbSha256: hashBytes(rgb),
      });
    }
  }
  return seams;
}

function localCrop(entry, intersection, pixelsPerTile) {
  return {
    x: (intersection.x - entry.sample.x) * pixelsPerTile,
    y: (intersection.y - entry.sample.y) * pixelsPerTile,
    width: intersection.cols * pixelsPerTile,
    height: intersection.rows * pixelsPerTile,
  };
}

function intersect(left, right) {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.cols, right.x + right.cols);
  const y2 = Math.min(left.y + left.rows, right.y + right.rows);
  return x2 > x && y2 > y ? { x, y, cols: x2 - x, rows: y2 - y } : null;
}

export function readRgbImages(entries, root) {
  const paths = entries.map((entry) => path.join(root, entry.image.path));
  const output = execFileSync("magick", [
    ...paths,
    "-depth", "8",
    "rgb:-",
  ], { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 });
  const images = new Map();
  let offset = 0;
  for (const entry of entries) {
    const bytes = entry.image.width * entry.image.height * 3;
    images.set(entry.id, output.subarray(offset, offset + bytes));
    offset += bytes;
  }
  if (offset !== output.length) throw new Error("chunk visual RGB decode length is invalid");
  return images;
}

export function cropRgb(source, sourceWidth, x, y, width, height) {
  const output = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * sourceWidth + x) * 3;
    source.copy(output, row * width * 3, sourceStart, sourceStart + width * 3);
  }
  return output;
}

function readRgb(filePath, width, height) {
  const bytes = execFileSync("magick", [filePath, "-depth", "8", "rgb:-"], {
    encoding: "buffer",
    maxBuffer: Math.max(20_000_000, width * height * 3 + 1024),
  });
  if (bytes.length !== width * height * 3) throw new Error("chunk visual source RGB length is invalid");
  return bytes;
}

function pngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  if (header.length < 24 || header.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error(`${filePath} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function sha256(filePath) {
  return hashBytes(fs.readFileSync(filePath));
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
