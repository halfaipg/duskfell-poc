export function summarizeAssetManifest(manifest) {
  return {
    schemaVersion: manifest?.schemaVersion,
    manifestFingerprint: manifest?.manifestFingerprint,
    manifestBytes: manifest?.manifestBytes,
    maxManifestBytes: manifest?.maxManifestBytes,
    maxImageBytes: manifest?.maxImageBytes,
    projection: manifest?.projection,
    entryCount: manifest?.entryCount,
    images: manifest?.images,
  };
}

export function summarizeTerrainAuthority(manifest) {
  return {
    schemaVersion: manifest?.schemaVersion,
    manifestFingerprint: manifest?.manifestFingerprint,
    manifestBytes: manifest?.manifestBytes,
    maxManifestBytes: manifest?.maxManifestBytes,
    projection: manifest?.projection,
    profile: manifest?.profile,
    seed: manifest?.seed,
    unitsPerTile: manifest?.unitsPerTile,
    blockerCount: manifest?.blockerCount,
    resourceNodeCount: manifest?.resourceNodeCount,
    decayConsumerCount: manifest?.decayConsumerCount,
  };
}
