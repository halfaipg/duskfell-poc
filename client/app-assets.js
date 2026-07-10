import { loadRuntimeSpriteAssets } from "./sprite-loader.js";
import { loadRuntimeTerrainAssets } from "./terrain-loader.js";

export function createRuntimeAssets() {
  const sprites = {
    player: null,
    players: [],
    paperdolls: [],
    props: null,
    items: null,
    details: null,
  };
  const terrainAssets = {
    atlas: null,
    image: null,
    groundPatches: new Map(),
    patternSources: [],
    patternContexts: new WeakMap(),
  };
  let terrainAssetVersion = 0;

  return {
    sprites,
    terrainAssets,
    terrainAssetVersion: () => terrainAssetVersion,
    async loadSpriteAssets() {
      try {
        const response = await fetch("/assets/sprites/manifest.json", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;
        const manifest = await response.json();
        Object.assign(sprites, await loadRuntimeSpriteAssets(manifest));
      } catch (error) {
        console.warn("Sprite assets disabled", error);
        sprites.player = null;
        sprites.players = [];
        sprites.paperdolls = [];
        sprites.props = null;
        sprites.items = null;
        sprites.details = null;
      }
    },
    async loadTerrainAssets() {
      try {
        const loaded = await loadRuntimeTerrainAssets();
        if (!loaded) return;
        Object.assign(terrainAssets, loaded);
        terrainAssetVersion += 1;
        console.info(
          `Duskfell terrain assets loaded: atlas + ${terrainAssets.groundPatches.size} biome paintings`,
        );
      } catch (error) {
        // a silent fallback here looks like "the old terrain" with no clue
        // why — say exactly what failed (SHA mismatch, insecure context
        // breaking crypto.subtle over LAN IPs, 404s...)
        console.error("Duskfell terrain assets FAILED — falling back to flat tiles:", error);
        terrainAssets.atlas = null;
        terrainAssets.image = null;
        terrainAssets.groundPatches = new Map();
        terrainAssets.patternSources = [];
        terrainAssets.patternContexts = new WeakMap();
        terrainAssetVersion += 1;
      }
    },
  };
}
