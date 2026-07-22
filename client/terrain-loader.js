import { loadVerifiedImage, loadVerifiedPngImage } from "./runtime-image-loader.js";
import { normalizeTerrainAtlas } from "./terrain-assets.js";
import { VISUAL_BIOMES } from "./terrain-visual-biomes.js";
import { loadApprovedRuntimeWorld } from "./runtime-world-registry.js";

const BIOME_PROOFS = {
  meadow: {
    id: "meadow",
    image: "candidates/biome-proof-meadow-v1.webp",
    sha256: "1ff4ac6df4f8503e1546dd2b5f293c498fc8ea2980151a6107c163b45ef345ef",
  },
  heath: {
    id: "heath",
    image: "candidates/biome-proof-heath-v1.webp",
    sha256: "4f3cd1e717521479397170c73cf351205cbf20ba837e905b92f23e0f054029d1",
  },
  fen: {
    id: "fen",
    image: "candidates/biome-proof-fen-v1.webp",
    sha256: "c8b8182529a596d60d2693a3855d530182246b7a193fc3202ed5e2495f9aa713",
  },
  loam: {
    id: "loam",
    image: "candidates/biome-proof-loam-grass-v1.webp",
    sha256: "ac981cd8749e6d2adc6a1bf3838188b1adfa90c2498736359fee3c8ff22db5a7",
  },
  "loam-slice": {
    id: "loam-slice",
    image: "candidates/finegrain-packed-dirt.png",
    sha256: "98cd299d2ce369eceefe690c531301f4754b30b0382a8529cfcbd930d0cf1482",
    width: 1024,
    height: 1024,
  },
};

export async function loadRuntimeTerrainAssets(onProgress = null) {
  const worldId = typeof globalThis.location === "undefined"
    ? null
    : new URLSearchParams(globalThis.location.search ?? "").get("world");
  const allowReviewWorld = typeof globalThis.location !== "undefined"
    && new URLSearchParams(globalThis.location.search ?? "").get("preview") === "1";
  const response = await fetch("/assets/terrain/manifest.json", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const manifest = await response.json();
  const atlas = normalizeTerrainAtlas(manifest);
  const approvedWorld = worldId && worldId !== "valley-v2"
    ? await loadApprovedRuntimeWorld(worldId, { allowReview: allowReviewWorld })
    : null;
  const biomeProof = selectedBiomeProof();
  let done = 0;
  const worldV2ProofCount = worldId === "valley-v2" ? 5 : 0;
  const total = 1 + atlas.groundPatches.length + (atlas.worldMap ? 1 : 0) + (biomeProof ? 1 : 0) + worldV2ProofCount;
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
  if (biomeProof) {
    const proofImage = await loadVerifiedImage(`/assets/terrain/${biomeProof.image}`, biomeProof.sha256);
    report();
    const expectedWidth = biomeProof.width ?? 2048;
    const expectedHeight = biomeProof.height ?? 2048;
    if (proofImage.naturalWidth !== expectedWidth || proofImage.naturalHeight !== expectedHeight) {
      throw new Error(`terrain biome proof dimensions must be ${expectedWidth}x${expectedHeight}`);
    }
    for (const biome of VISUAL_BIOMES) groundPatches.set(biome, proofImage);
    console.info(`Duskfell biome proof active: ${biomeProof.id} (${biomeProof.image})`);
  }
  if (worldId === "valley-v2") {
    const valleyPatches = [
      ["meadow", "meadow-ground-v1.png", "99d9385ca6196efa0495f124cb5bea0ace35fe462c14e17e4814cf376f6596a1"],
      ["heath", "loam-ground-v1.png", "cd4077087a272c4b8caa572165010bf85d1e9c04699be7d0e03f92ec9d0b66ac"],
    ];
    for (const [biome, file, sha256] of valleyPatches) {
      const image = await loadVerifiedPngImage(`/assets/terrain/worlds/valley-v2/${file}`, sha256);
      groundPatches.set(biome, image);
      report();
    }
    const worldPainting = await loadVerifiedPngImage(
      "/assets/terrain/worlds/valley-v2/illustrated-gameplay-v1.png",
      "36b6ea1c250d1d5db902cdce3e9107e89a5a3bdf173a7ca43358ef1fe34e95d0",
    );
    groundPatches.set("__world-painting__", worldPainting);
    report();
    const waterAuthority = await loadVerifiedPngImage(
      "/assets/terrain/worlds/valley-v2/water-authority-gameplay-v1.png",
      "2aedd9c9740210db7fa1a1b7296f9e775e57c7d5d7ae599b67d8a59c2d2715a2",
    );
    groundPatches.set("__world-water-mask__", waterAuthority);
    report();
  }
  if (approvedWorld?.gameplayImage) groundPatches.set("__world-painting__", approvedWorld.gameplayImage);

  let worldMap = null;
  if (atlas.worldMap) {
    const mapImage = await loadVerifiedImage(
      `/assets/terrain/${atlas.worldMap.imagePath}`,
      atlas.worldMap.sha256,
    );
    report();
    if (mapImage.naturalWidth !== atlas.worldMap.width || mapImage.naturalHeight !== atlas.worldMap.height) {
      throw new Error(
        `terrain world map dimensions ${mapImage.naturalWidth}x${mapImage.naturalHeight} do not match ${atlas.worldMap.width}x${atlas.worldMap.height}`,
      );
    }
    worldMap = { ...atlas.worldMap, image: mapImage };
  }
  if (worldId === "valley-v2") {
    const mapImage = await loadVerifiedPngImage(
      "/assets/terrain/worlds/valley-v2/illustrated-world-map-runtime-v2.png",
      "f21517860c27b2730c24c5e45782449ca82998eba987a3be1ff7aa9ab61648a9",
    );
    worldMap = {
      id: "valley-v2-illustrated-map",
      imagePath: "worlds/valley-v2/illustrated-world-map-runtime-v2.png",
      sha256: "f21517860c27b2730c24c5e45782449ca82998eba987a3be1ff7aa9ab61648a9",
      width: 1536,
      height: 1024,
      worldCols: 192,
      worldRows: 128,
      tilePixelWidth: 8,
      tilePixelHeight: 8,
      status: "runtime-review",
      image: mapImage,
    };
    report();
  }
  if (approvedWorld) {
    const raster = approvedWorld.manifest.rasters.worldMap;
    worldMap = {
      id: `${approvedWorld.manifest.world}-approved-map`,
      imagePath: `worlds/${approvedWorld.manifest.world}/${raster.path}`,
      sha256: raster.sha256,
      width: raster.width,
      height: raster.height,
      worldCols: approvedWorld.dimensions.cols,
      worldRows: approvedWorld.dimensions.rows,
      tilePixelWidth: raster.pixelsPerTile,
      tilePixelHeight: raster.pixelsPerTile,
      status: "approved",
      image: approvedWorld.worldMapImage,
    };
  }

  // optional generated-world bundle (terrain-diffusion bridge); absent on
  // formula worlds. TODO: SHA-pin once the wipe pipeline settles.
  let worldBundle = approvedWorld?.bundle ?? null;
  try {
    const bundleUrl = worldId === "valley-v2"
      ? "/assets/terrain/worlds/valley-v2/world-bundle-v2.json"
      : "/assets/terrain/world-bundle.json";
    if (!worldBundle) {
      const bundleResponse = await fetch(bundleUrl, { cache: "no-store" });
      if (bundleResponse.ok) {
        const parsed = await bundleResponse.json();
        if (parsed?.version === "duskfell-world-bundle-v1" || parsed?.schema === "duskfell-world-bundle-v2") worldBundle = parsed;
      }
    }
  } catch {
    worldBundle = null;
  }

  return {
    atlas,
    image,
    worldBundle,
    chunkStream: approvedWorld?.chunkStream ?? null,
    visualChunkStream: approvedWorld?.visualChunkStream ?? null,
    worldMap,
    groundPatches,
    patternSources: terrainPatternFrames(image, atlas.tileSheet),
    patternContexts: new WeakMap(),
  };
}

function selectedBiomeProof() {
  if (typeof globalThis.location === "undefined") return null;
  const params = new URLSearchParams(globalThis.location.search ?? "");
  if (params.get("verticalSlice") === "loam") return BIOME_PROOFS["loam-slice"];
  const id = params.get("biomeProof");
  return BIOME_PROOFS[id] ?? null;
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
