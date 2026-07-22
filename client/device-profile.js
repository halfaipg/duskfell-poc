export const GRAPHICS_BUDGETS = Object.freeze({
  low: Object.freeze({
    name: "low",
    dprCap: 1.25,
    terrainOverscanPx: 96,
    terrainPreloadOverscanPx: 192,
    glTexturePoolEntries: 48,
    visualChunkCacheEntries: 8,
    dynamicTerrainShadows: false,
    waterAnimation: "static",
    gpuGrass: false,
    animatedVegetation: false,
    atmosphereMotion: "static",
    maxAtmospherePatches: 0,
    atmosphereBlurPx: 0,
    maxFootstepParticles: 3,
  }),
  balanced: Object.freeze({
    name: "balanced",
    dprCap: 2,
    terrainOverscanPx: 144,
    terrainPreloadOverscanPx: 384,
    glTexturePoolEntries: 80,
    visualChunkCacheEntries: 16,
    dynamicTerrainShadows: true,
    waterAnimation: "full",
    gpuGrass: false,
    animatedVegetation: true,
    atmosphereMotion: "drift",
    maxAtmospherePatches: 36,
    atmosphereBlurPx: 2.5,
    maxFootstepParticles: 6,
  }),
  high: Object.freeze({
    name: "high",
    dprCap: 3,
    terrainOverscanPx: 192,
    terrainPreloadOverscanPx: 512,
    glTexturePoolEntries: 120,
    visualChunkCacheEntries: 24,
    dynamicTerrainShadows: true,
    waterAnimation: "full",
    gpuGrass: true,
    animatedVegetation: true,
    atmosphereMotion: "drift",
    maxAtmospherePatches: 72,
    atmosphereBlurPx: 4,
    maxFootstepParticles: 10,
  }),
});

export function selectGraphicsQuality({ search = "", deviceMemory = null, hardwareConcurrency = null, userAgent = "" } = {}) {
  const requested = new URLSearchParams(search).get("quality");
  if (requested && GRAPHICS_BUDGETS[requested]) return requested;
  const constrained = (deviceMemory != null && deviceMemory <= 4)
    || (hardwareConcurrency != null && hardwareConcurrency <= 4)
    || /iPhone|iPad|iPod|Android/i.test(userAgent);
  return constrained ? "low" : "balanced";
}

const runtimeNavigator = typeof navigator === "undefined" ? {} : navigator;
const runtimeSearch = typeof globalThis.location === "undefined" ? "" : globalThis.location.search;

export const GRAPHICS_QUALITY = selectGraphicsQuality({
  search: runtimeSearch,
  deviceMemory: runtimeNavigator.deviceMemory,
  hardwareConcurrency: runtimeNavigator.hardwareConcurrency,
  userAgent: runtimeNavigator.userAgent,
});
export const GRAPHICS_BUDGET = GRAPHICS_BUDGETS[GRAPHICS_QUALITY];
export const CONSTRAINED_DEVICE = GRAPHICS_QUALITY === "low";
export const RENDER_DPR_CAP = GRAPHICS_BUDGET.dprCap;
