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
    worldBundle: null,
    groundPatches: new Map(),
    patternSources: [],
    patternContexts: new WeakMap(),
  };
  let terrainAssetVersion = 0;
  let terrainAssetError = null;
  // loading-screen state: the world never renders over fallback graphics —
  // the client shows a progress bar until every painting and sheet is in
  const progress = { done: 0, total: 1, spritesReady: false, terrainReady: false };

  return {
    sprites,
    terrainAssets,
    terrainAssetVersion: () => terrainAssetVersion,
    terrainAssetError: () => terrainAssetError,
    assetsReady: () => progress.spritesReady && progress.terrainReady,
    assetProgress: () => ({
      done: progress.done + (progress.spritesReady ? 1 : 0),
      total: progress.total + 1,
      error: terrainAssetError,
    }),
    async loadSpriteAssets() {
      try {
        const response = await fetch("/assets/sprites/manifest.json", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;
        const manifest = await response.json();
        Object.assign(sprites, await loadRuntimeSpriteAssets(manifest));
        progress.spritesReady = true;
      } catch (error) {
        console.warn("Sprite assets disabled", error);
        sprites.player = null;
        sprites.players = [];
        sprites.paperdolls = [];
        sprites.props = null;
        sprites.items = null;
        sprites.details = null;
        progress.spritesReady = true;
      }
    },
    async loadTerrainAssets() {
      try {
        const loaded = await loadRuntimeTerrainAssets((done, total) => {
          progress.done = done;
          progress.total = total;
        });
        if (!loaded) {
          progress.terrainReady = true;
          return;
        }
        Object.assign(terrainAssets, loaded);
        terrainAssetVersion += 1;
        progress.terrainReady = true;
        console.info(
          `Duskfell terrain assets loaded: atlas + ${terrainAssets.groundPatches.size} biome paintings`,
        );
      } catch (error) {
        // a silent fallback here looks like "the old terrain" with no clue
        // why — say exactly what failed (SHA mismatch, insecure context
        // breaking crypto.subtle over LAN IPs, 404s...)
        console.error("Duskfell terrain assets FAILED — falling back to flat tiles:", error);
        terrainAssetError = error instanceof Error ? error.message : String(error);
        terrainAssets.atlas = null;
        terrainAssets.image = null;
        terrainAssets.groundPatches = new Map();
        terrainAssets.patternSources = [];
        terrainAssets.patternContexts = new WeakMap();
        terrainAssetVersion += 1;
        progress.terrainReady = true;
      }
    },
  };
}
