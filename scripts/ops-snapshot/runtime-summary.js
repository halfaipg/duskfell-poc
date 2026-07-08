export function summarizeReady(body) {
  const checks = Array.isArray(body?.checks) ? body.checks : [];
  return {
    ready: body?.ready === true,
    checkCount: checks.length,
    failedChecks: checks.filter((check) => check?.ok !== true).map((check) => check.name),
    content: body?.content ?? null,
  };
}

export function summarizeRuntime(body) {
  return {
    app: body?.app ?? null,
    content: body?.content ?? null,
    assets: {
      sprites: summarizeAssetManifest(body?.assets?.sprites),
      terrain: summarizeAssetManifest(body?.assets?.terrain),
      terrainAuthority: summarizeTerrainAuthority(body?.assets?.terrainAuthority),
    },
  };
}

function summarizeAssetManifest(manifest) {
  if (!manifest) return null;
  return {
    schemaVersion: manifest.schemaVersion,
    manifestFingerprint: manifest.manifestFingerprint,
    manifestBytes: manifest.manifestBytes,
    maxManifestBytes: manifest.maxManifestBytes,
    maxImageBytes: manifest.maxImageBytes,
    projection: manifest.projection,
    entryCount: manifest.entryCount,
    images: Array.isArray(manifest.images)
      ? manifest.images.map((image) => ({
          id: image.id,
          image: image.image,
          sha256: image.sha256,
          sha256Verified: image.sha256Verified,
          bytes: image.bytes,
          approvalState: image.approvalState,
        }))
      : [],
  };
}

function summarizeTerrainAuthority(manifest) {
  if (!manifest) return null;
  return {
    schemaVersion: manifest.schemaVersion,
    manifestFingerprint: manifest.manifestFingerprint,
    manifestBytes: manifest.manifestBytes,
    maxManifestBytes: manifest.maxManifestBytes,
    projection: manifest.projection,
    profile: manifest.profile,
    seed: manifest.seed,
    unitsPerTile: manifest.unitsPerTile,
    blockerCount: manifest.blockerCount,
    resourceNodeCount: manifest.resourceNodeCount,
    decayConsumerCount: manifest.decayConsumerCount,
  };
}
