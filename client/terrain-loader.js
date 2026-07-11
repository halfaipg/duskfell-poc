import { loadVerifiedImage, loadVerifiedPngImage } from "./runtime-image-loader.js";
import { normalizeTerrainAtlas } from "./terrain-assets.js";

export async function loadRuntimeTerrainAssets(onProgress = null) {
  const response = await fetch("/assets/terrain/manifest.json", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const manifest = await response.json();
  const atlas = normalizeTerrainAtlas(manifest);
  let done = 0;
  const total = 1 + atlas.groundPatches.length;
  const report = () => onProgress?.(++done, total);
  const image = await loadVerifiedPngImage(`/assets/terrain/${atlas.tileSheet.imagePath}`, atlas.tileSheet.sha256);
  report();
  const groundPatches = new Map();
  await Promise.all(
    atlas.groundPatches.map(async (patch) => {
      const patchImage = await loadVerifiedImage(`/assets/terrain/${patch.imagePath}`, patch.sha256);
      report();
      if (patchImage.naturalWidth !== patch.width || patchImage.naturalHeight !== patch.height) {
        throw new Error(
          `terrain ground patch ${patch.id} dimensions ${patchImage.naturalWidth}x${patchImage.naturalHeight} do not match ${patch.width}x${patch.height}`,
        );
      }
      groundPatches.set(patch.biome, patchImage);
    }),
  );

  return {
    atlas,
    image,
    groundPatches,
    patternSources: terrainPatternFrames(image, atlas.tileSheet),
    patternContexts: new WeakMap(),
  };
}

function terrainPatternFrames(image, sheet) {
  const sources = [];
  for (let frame = 0; frame < sheet.frameCount; frame += 1) {
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = sheet.cellWidth;
    patternCanvas.height = sheet.cellHeight;
    const patternContext = patternCanvas.getContext("2d");
    if (!patternContext) continue;

    patternContext.imageSmoothingEnabled = false;
    patternContext.drawImage(
      image,
      (frame % sheet.columns) * sheet.cellWidth,
      Math.floor(frame / sheet.columns) * sheet.cellHeight,
      sheet.cellWidth,
      sheet.cellHeight,
      0,
      0,
      sheet.cellWidth,
      sheet.cellHeight,
    );
    sources[frame] = patternCanvas;
  }
  return sources;
}
