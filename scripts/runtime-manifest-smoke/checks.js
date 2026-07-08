export function buildRuntimeManifestChecks({
  expected,
  expectedGitSha,
  missingStatus,
  runtime,
  summary,
  wrongStatus,
}) {
  return {
    protected: missingStatus === 401 && wrongStatus === 401,
    app:
      runtime.app?.game === "Duskfell" &&
      runtime.app?.chain === "Base" &&
      runtime.app?.ticker === "$DUSK" &&
      runtime.app?.serverCrate === "sundermere-server",
    buildProvenance:
      expectedGitSha == null
        ? runtime.app?.buildGitSha == null || isNonEmptyString(runtime.app.buildGitSha)
        : runtime.app?.buildGitSha === expectedGitSha,
    content:
      runtime.content?.schemaVersion === summary.content?.schemaVersion &&
      runtime.content?.contentHash === summary.content?.contentHash &&
      runtime.content?.objectCount === summary.content?.objectCount,
    spriteManifest:
      runtime.assets?.sprites?.schemaVersion === expected.sprites.schemaVersion &&
      runtime.assets?.sprites?.entryCount === expected.sprites.entryCount &&
      runtime.assets?.sprites?.maxManifestBytes === expected.maxManifestBytes &&
      runtime.assets?.sprites?.maxImageBytes === expected.maxImageBytes &&
      runtime.assets?.sprites?.images?.length === expected.sprites.images.length &&
      projectionMatches(runtime.assets?.sprites?.projection),
    terrainManifest:
      runtime.assets?.terrain?.schemaVersion === expected.terrain.schemaVersion &&
      runtime.assets?.terrain?.entryCount === expected.terrain.entryCount &&
      runtime.assets?.terrain?.maxManifestBytes === expected.maxManifestBytes &&
      runtime.assets?.terrain?.maxImageBytes === expected.maxImageBytes &&
      runtime.assets?.terrain?.images?.length === expected.terrain.images.length &&
      projectionMatches(runtime.assets?.terrain?.projection),
    terrainAuthority:
      runtime.assets?.terrainAuthority?.schemaVersion === expected.terrainAuthority.schemaVersion &&
      runtime.assets?.terrainAuthority?.kind === "terrain-authority" &&
      runtime.assets?.terrainAuthority?.projection === "military-plan-oblique" &&
      runtime.assets?.terrainAuthority?.profile === expected.terrainAuthority.profile &&
      runtime.assets?.terrainAuthority?.seed === expected.terrainAuthority.seed &&
      runtime.assets?.terrainAuthority?.unitsPerTile === expected.terrainAuthority.unitsPerTile &&
      runtime.assets?.terrainAuthority?.blockerCount === expected.terrainAuthority.blockerCount &&
      runtime.assets?.terrainAuthority?.resourceNodeCount ===
        expected.terrainAuthority.resourceNodeCount &&
      runtime.assets?.terrainAuthority?.decayConsumerCount ===
        expected.terrainAuthority.decayConsumerCount &&
      runtime.assets?.terrainAuthority?.maxManifestBytes === expected.maxManifestBytes,
    imagePins:
      imagePinsMatch(runtime.assets?.sprites?.images, expected.sprites.images) &&
      imagePinsMatch(runtime.assets?.terrain?.images, expected.terrain.images),
    manifestFingerprints:
      fingerprintLooksValid(runtime.assets?.sprites?.manifestFingerprint) &&
      fingerprintLooksValid(runtime.assets?.terrain?.manifestFingerprint) &&
      fingerprintLooksValid(runtime.assets?.terrainAuthority?.manifestFingerprint) &&
      runtime.assets?.sprites?.manifestBytes > 0 &&
      runtime.assets?.terrain?.manifestBytes > 0 &&
      runtime.assets?.terrainAuthority?.manifestBytes > 0,
  };
}

function projectionMatches(projection) {
  return (
    projection?.kind === "military-plan-oblique" &&
    projection?.tileWidth === 64 &&
    projection?.tileHeight === 64 &&
    projection?.tileAspectRatio === 1 &&
    projection?.axisAngleDegrees === 45 &&
    projection?.heightAxis === "screen-y"
  );
}

function imagePinsMatch(actualImages, expectedImages) {
  if (!Array.isArray(actualImages) || actualImages.length !== expectedImages.length) return false;
  return expectedImages.every((expected) =>
    actualImages.some(
      (actual) =>
        actual.id === expected.id &&
        actual.image === expected.image &&
        actual.sha256 === expected.sha256 &&
        actual.sha256Verified === true &&
        actual.bytes === expected.bytes &&
        actual.approvalState === expected.approvalState,
    ),
  );
}

function fingerprintLooksValid(value) {
  return /^fnv1a64:[0-9a-f]{16}$/.test(value ?? "");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
