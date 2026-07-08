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
      } catch {
        terrainAssets.atlas = null;
        terrainAssets.image = null;
        terrainAssets.patternSources = [];
        terrainAssets.patternContexts = new WeakMap();
        terrainAssetVersion += 1;
      }
    },
  };
}
