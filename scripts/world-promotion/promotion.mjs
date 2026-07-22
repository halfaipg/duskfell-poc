import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateWorldPackage } from "../worldgen/package-validator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORLD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MATERIALS = ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"];
const APPROVAL_STATEMENT = "I reviewed this package in the Duskfell world workshop at gameplay scale.";

export function createVisualApprovalTemplate(packageDir, outputPath) {
  const root = path.resolve(packageDir);
  validateWorldPackage(root, { writeReport: false });
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath, "package manifest");
  const template = {
    schema: "duskfell-world-visual-approval-v1",
    world: manifest.world,
    decision: "pending",
    scope: manifest.illustration?.state === "accepted" ? "illustrated-runtime" : "structural-review",
    packageManifestSha256: sha256(manifestPath),
    reviewSheetSha256: manifest.reviewSheet.sha256,
    gameplaySha256: manifest.rasters.gameplay.sha256,
    approver: "",
    reviewedAt: "",
    cameraContractAccepted: false,
    artDirectionAccepted: false,
    authorityAlignmentAccepted: false,
    statement: APPROVAL_STATEMENT,
    notes: "",
  };
  const target = path.resolve(outputPath);
  if (fs.existsSync(target)) throw new Error(`approval template already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeJson(target, template);
  return { output: target, template };
}

export function promoteWorldPackage(packageDir, approvalPath, options = {}) {
  const packageRoot = path.resolve(packageDir);
  const report = validateWorldPackage(packageRoot, { writeReport: false });
  const manifestPath = path.join(packageRoot, "manifest.json");
  const manifest = readJson(manifestPath, "package manifest");
  const recipe = readJson(path.join(packageRoot, "recipe.json"), "world recipe");
  const bundle = readJson(path.join(packageRoot, "world-bundle-v2.json"), "world bundle");
  const serverPatch = readJson(path.join(packageRoot, "server-authority-patch.json"), "server authority patch");
  const detailPatch = readJson(path.join(packageRoot, "terrain-detail-authority-patch.json"), "terrain detail authority patch");
  const requireIllustrated = options.requireIllustrated ?? true;
  if (requireIllustrated && manifest.illustration?.state !== "accepted") {
    throw new Error("promotion requires a package with an accepted illustrated master");
  }

  const approval = readJson(path.resolve(approvalPath), "visual approval");
  validateApproval(approval, manifest, manifestPath, { requireIllustrated });
  return installRuntimeWorld({
    packageRoot,
    report,
    manifest,
    manifestPath,
    recipe,
    bundle,
    serverPatch,
    detailPatch,
    runtimeWorldsDir: path.resolve(options.runtimeWorldsDir ?? path.join(ROOT, "assets/terrain/worlds")),
    serverWorldsDir: path.resolve(options.serverWorldsDir ?? path.join(ROOT, "server/data/worlds")),
    registryPath: path.resolve(options.registryPath ?? path.join(options.runtimeWorldsDir ?? path.join(ROOT, "assets/terrain/worlds"), "registry.json")),
    state: "approved",
    reviewRecord: approval,
    reviewRecordName: "visual-approval.json",
  });
}

export function stageWorldPackagePreview(packageDir, options = {}) {
  const packageRoot = path.resolve(packageDir);
  const report = validateWorldPackage(packageRoot, { writeReport: false });
  const manifestPath = path.join(packageRoot, "manifest.json");
  const manifest = readJson(manifestPath, "package manifest");
  const recipe = readJson(path.join(packageRoot, "recipe.json"), "world recipe");
  const bundle = readJson(path.join(packageRoot, "world-bundle-v2.json"), "world bundle");
  const serverPatch = readJson(path.join(packageRoot, "server-authority-patch.json"), "server authority patch");
  const detailPatch = readJson(path.join(packageRoot, "terrain-detail-authority-patch.json"), "terrain detail authority patch");
  const packageManifestSha256 = sha256(manifestPath);
  const previewRoot = path.resolve(options.previewRoot ?? path.join(ROOT, "var/world-previews", `${manifest.world}-${packageManifestSha256.slice(0, 12)}`));
  resetOwnedPreviewRoot(previewRoot, manifest.world, packageManifestSha256);
  const assetsDir = path.join(previewRoot, "assets");
  mirrorBaseAssets(assetsDir);
  const runtimeWorldsDir = path.join(assetsDir, "terrain/worlds");
  const serverWorldsDir = path.join(previewRoot, "server-worlds");
  const registryPath = path.join(runtimeWorldsDir, "registry.json");
  const reviewRecord = {
    schema: "duskfell-world-preview-staging-v1",
    world: manifest.world,
    state: "review",
    packageManifestSha256,
    generatedAt: new Date().toISOString(),
    humanApproval: false,
    warning: "Local review staging only. This record is not visual approval and cannot be promoted.",
  };
  writeJson(path.join(previewRoot, "preview-root.json"), reviewRecord);
  const installed = installRuntimeWorld({
    packageRoot,
    report,
    manifest,
    manifestPath,
    recipe,
    bundle,
    serverPatch,
    detailPatch,
    runtimeWorldsDir,
    serverWorldsDir,
    registryPath,
    state: "review",
    reviewRecord,
    reviewRecordName: "review-staging.json",
  });
  return { ...installed, previewRoot, assetsDir, packageRoot };
}

function installRuntimeWorld({
  packageRoot,
  report,
  manifest,
  manifestPath,
  recipe,
  bundle,
  serverPatch,
  detailPatch,
  runtimeWorldsDir,
  serverWorldsDir,
  registryPath,
  state,
  reviewRecord,
  reviewRecordName,
}) {
  const worldId = manifest.world;
  if (!WORLD_ID.test(worldId)) throw new Error(`world id ${worldId} is not lowercase kebab-case`);
  const runtimeDir = path.join(runtimeWorldsDir, worldId);
  const serverWorldPath = path.join(serverWorldsDir, `${worldId}.json`);
  if (fs.existsSync(runtimeDir)) throw new Error(`runtime world already exists: ${runtimeDir}`);
  if (fs.existsSync(serverWorldPath)) throw new Error(`server world already exists: ${serverWorldPath}`);

  const stageDir = `${runtimeDir}.building-${process.pid}`;
  const stageServerPath = `${serverWorldPath}.building-${process.pid}`;
  fs.mkdirSync(runtimeWorldsDir, { recursive: true });
  fs.mkdirSync(serverWorldsDir, { recursive: true });
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.rmSync(stageServerPath, { force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  let runtimeInstalled = false;
  let serverInstalled = false;
  try {
    for (const name of packageFiles(manifest)) {
      const source = packageFile(packageRoot, name);
      fs.copyFileSync(source, path.join(stageDir, path.basename(name)));
    }
    const runtimeChunks = installRuntimeChunks(packageRoot, stageDir, manifest.chunkIndex);
    const runtimeChunkVisuals = installRuntimeChunkVisuals(
      packageRoot,
      stageDir,
      manifest.chunkVisuals,
    );
    const runtimeChunkIllustration = installRuntimeChunkIllustration(
      packageRoot,
      stageDir,
      manifest.illustration?.chunkJobs,
    );
    const runtimeAuthority = standaloneTerrainDetailAuthority(detailPatch, serverPatch, bundle, state);
    const runtimeAuthorityPath = path.join(stageDir, "terrain-detail-authority.json");
    writeJson(runtimeAuthorityPath, runtimeAuthority);
    const serverWorld = standaloneServerWorld(recipe, bundle, serverPatch, runtimeChunks);
    writeJson(stageServerPath, serverWorld);
    const installedReviewPath = path.join(stageDir, reviewRecordName);
    writeJson(installedReviewPath, reviewRecord);

    const runtimeManifest = runtimeWorldManifest({
      state,
      manifest,
      manifestPath,
      reviewRecord,
      reviewRecordName,
      installedReviewPath,
      runtimeAuthorityPath,
      serverWorld,
      serverWorldPath,
      report,
      runtimeChunks,
      runtimeChunkVisuals,
      runtimeChunkIllustration,
    });
    const runtimeManifestPath = path.join(stageDir, "runtime-manifest.json");
    writeJson(runtimeManifestPath, runtimeManifest);
    const runtimeManifestSha256 = sha256(runtimeManifestPath);
    const registry = nextRegistry(registryPath, runtimeManifest, runtimeManifestSha256);

    fs.renameSync(stageDir, runtimeDir);
    runtimeInstalled = true;
    fs.renameSync(stageServerPath, serverWorldPath);
    serverInstalled = true;
    writeJsonAtomic(registryPath, registry);

    return {
      world: worldId,
      state: "approved",
      runtimeDir,
      runtimeManifestSha256,
      serverWorldPath,
      terrainDetailAuthorityPath: path.join(runtimeDir, "terrain-detail-authority.json"),
      registryPath,
      manifest: runtimeManifest,
      gameplayUrl: `/game.html?world=${encodeURIComponent(worldId)}${state === "review" ? "&preview=1" : ""}`,
    };
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.rmSync(stageServerPath, { force: true });
    if (serverInstalled) fs.rmSync(serverWorldPath, { force: true });
    if (runtimeInstalled) fs.rmSync(runtimeDir, { recursive: true, force: true });
    throw error;
  }
}

export function resolvePromotedWorld(worldId, options = {}) {
  if (!WORLD_ID.test(worldId ?? "")) throw new Error("promoted world id must be lowercase kebab-case");
  const runtimeWorldsDir = path.resolve(options.runtimeWorldsDir ?? path.join(ROOT, "assets/terrain/worlds"));
  const serverWorldsDir = path.resolve(options.serverWorldsDir ?? path.join(ROOT, "server/data/worlds"));
  const registryPath = path.resolve(options.registryPath ?? path.join(runtimeWorldsDir, "registry.json"));
  const registry = readJson(registryPath, "runtime world registry");
  if (registry.schemaVersion !== "duskfell-runtime-world-registry-v1" || registry.projection !== "military-plan-oblique" || !Array.isArray(registry.worlds)) {
    throw new Error("runtime world registry contract is invalid");
  }
  const entry = registry.worlds.find((candidate) => candidate.id === worldId);
  if (!entry || entry.directory !== worldId || entry.manifest !== "runtime-manifest.json" || !SHA256.test(entry.manifestSha256 ?? "")) {
    throw new Error(`promoted world ${worldId} is not registered safely`);
  }
  if ((entry.state ?? "approved") !== "approved") throw new Error(`promoted world ${worldId} is not approved`);
  const runtimeDir = path.join(runtimeWorldsDir, worldId);
  const runtimeManifestPath = path.join(runtimeDir, entry.manifest);
  if (sha256(runtimeManifestPath) !== entry.manifestSha256) throw new Error("promoted world runtime manifest hash does not match registry");
  const manifest = readJson(runtimeManifestPath, "runtime world manifest");
  if (manifest.schemaVersion !== "duskfell-runtime-world-v1" || manifest.state !== "approved" || manifest.world !== worldId || manifest.projection !== "military-plan-oblique") {
    throw new Error("promoted world runtime manifest contract is invalid");
  }
  const serverWorldPath = path.join(serverWorldsDir, `${worldId}.json`);
  if (manifest.serverContent?.path !== `${worldId}.json` || !SHA256.test(manifest.serverContent?.sha256 ?? "") || sha256(serverWorldPath) !== manifest.serverContent.sha256) {
    throw new Error("promoted world server content hash does not match runtime manifest");
  }
  const authorityName = manifest.terrainDetailAuthority?.path;
  if (authorityName !== path.basename(authorityName ?? "") || !SHA256.test(manifest.terrainDetailAuthority?.sha256 ?? "")) {
    throw new Error("promoted world terrain authority reference is invalid");
  }
  const terrainDetailAuthorityPath = path.join(runtimeDir, authorityName);
  if (sha256(terrainDetailAuthorityPath) !== manifest.terrainDetailAuthority.sha256) {
    throw new Error("promoted world terrain authority hash does not match runtime manifest");
  }
  if (manifest.chunks) validateInstalledRuntimeChunks(runtimeDir, manifest.chunks, worldId);
  if (manifest.chunkVisuals) validateInstalledRuntimeChunkVisuals(runtimeDir, manifest.chunkVisuals, worldId);
  if (manifest.chunkIllustration) validateInstalledRuntimeChunkIllustration(runtimeDir, manifest.chunkIllustration, worldId);
  return { world: worldId, runtimeDir, runtimeManifestPath, serverWorldPath, terrainDetailAuthorityPath, manifest };
}

function validateApproval(approval, manifest, manifestPath, { requireIllustrated }) {
  const failures = [];
  check(approval?.schema === "duskfell-world-visual-approval-v1", "approval schema is invalid", failures);
  check(approval?.world === manifest.world, "approval world does not match package", failures);
  check(approval?.decision === "approved", "approval decision must be approved", failures);
  check(approval?.scope === (requireIllustrated ? "illustrated-runtime" : approval?.scope), "approval scope must be illustrated-runtime", failures);
  check(approval?.packageManifestSha256 === sha256(manifestPath), "approval package manifest hash does not match", failures);
  check(approval?.reviewSheetSha256 === manifest.reviewSheet?.sha256, "approval review sheet hash does not match", failures);
  check(approval?.gameplaySha256 === manifest.rasters?.gameplay?.sha256, "approval gameplay hash does not match", failures);
  check(typeof approval?.approver === "string" && approval.approver.trim().length >= 2 && approval.approver.length <= 80, "approval approver must contain 2-80 characters", failures);
  check(typeof approval?.reviewedAt === "string" && Number.isFinite(Date.parse(approval.reviewedAt)), "approval reviewedAt must be an ISO timestamp", failures);
  check(approval?.cameraContractAccepted === true, "approval must accept the camera contract", failures);
  check(approval?.artDirectionAccepted === true, "approval must accept the art direction", failures);
  check(approval?.authorityAlignmentAccepted === true, "approval must accept authority alignment", failures);
  check(approval?.statement === APPROVAL_STATEMENT, "approval statement is missing or altered", failures);
  check(typeof approval?.notes === "string" && approval.notes.length <= 2000, "approval notes must be at most 2000 characters", failures);
  if (failures.length) throw new Error(`visual approval rejected:\n- ${failures.join("\n- ")}`);
}

function packageFiles(manifest) {
  const references = new Set([
    manifest.recipe,
    manifest.bundle,
    manifest.serverPatch,
    manifest.terrainDetailPatch?.path,
    manifest.reviewSheet?.path,
    manifest.ecologyReview?.path,
    "validation-report.json",
  ]);
  for (const visual of Object.values(manifest.chunkVisuals ?? {})) {
    references.add(visual?.review?.path);
  }
  for (const raster of Object.values(manifest.rasters ?? {})) references.add(raster?.path);
  if (manifest.sourceArtifact) {
    references.add(manifest.sourceArtifact.path);
    references.add(manifest.sourceArtifact.metadata);
  }
  const illustration = manifest.illustration;
  if (illustration) {
    for (const reference of [illustration.control, illustration.candidate, illustration.master, illustration.rawAlignment, illustration.restoredAlignment]) {
      references.add(reference?.path);
      references.add(reference?.metadata);
    }
    references.add(illustration.request);
    for (const mask of Object.values(illustration.masks ?? {})) references.add(mask?.path);
  }
  references.add("manifest.json");
  return [...references].filter(Boolean).map((name) => path.basename(name)).sort();
}

function packageFile(root, name) {
  if (name !== path.basename(name)) throw new Error(`package reference must be local: ${name}`);
  const target = path.join(root, name);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`package file is missing: ${name}`);
  return target;
}

function installRuntimeChunks(packageRoot, stageDir, reference) {
  if (!reference) return null;
  if (reference.path !== "chunks/index.json" || !SHA256.test(reference.sha256 ?? "")) throw new Error("package chunk-index reference is invalid");
  const sourceIndexPath = path.join(packageRoot, reference.path);
  if (!fs.existsSync(sourceIndexPath) || sha256(sourceIndexPath) !== reference.sha256) throw new Error("package chunk index hash is invalid");
  const index = readJson(sourceIndexPath, "package chunk index");
  if (index.schema !== "duskfell-world-chunk-index-v1" || index.chunks?.length !== reference.count) throw new Error("package chunk index contract is invalid");
  const targetDir = path.join(stageDir, "chunks");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourceIndexPath, path.join(targetDir, "index.json"));
  for (const entry of index.chunks) {
    if (!/^chunks\/chunk-[0-9]+-[0-9]+\.json$/.test(entry?.path ?? "") || !SHA256.test(entry.sha256 ?? "")) throw new Error("package chunk entry is unsafe");
    const source = path.join(packageRoot, entry.path);
    if (!fs.existsSync(source) || fs.statSync(source).size !== entry.bytes || sha256(source) !== entry.sha256) throw new Error(`package chunk ${entry.id ?? "unknown"} integrity is invalid`);
    fs.copyFileSync(source, path.join(targetDir, path.basename(entry.path)));
  }
  return {
    index: { path: "chunks/index.json", sha256: reference.sha256 },
    count: reference.count,
    chunkTiles: reference.chunkTiles,
    apronTiles: reference.apronTiles,
    vertexHeightPrecision: reference.vertexHeightPrecision,
    totalBytes: reference.totalBytes,
  };
}

function installRuntimeChunkVisuals(packageRoot, stageDir, references) {
  if (!references) return null;
  const installed = {};
  for (const role of ["control", "illustrated"]) {
    if (references[role]) installed[role] = installRuntimeChunkVisualSet(packageRoot, stageDir, role, references[role]);
  }
  return Object.keys(installed).length > 0 ? installed : null;
}

function installRuntimeChunkVisualSet(packageRoot, stageDir, role, reference) {
  const directory = role === "control" ? "chunks/visual-controls" : "chunks/visual-illustrated";
  const schema = role === "control"
    ? "duskfell-chunk-visual-control-index-v1"
    : "duskfell-chunk-visual-illustrated-index-v1";
  if (reference.index?.path !== `${directory}/index.json` || !SHA256.test(reference.index?.sha256 ?? "")) {
    throw new Error(`package chunk visual ${role} index reference is invalid`);
  }
  const sourceIndexPath = path.join(packageRoot, reference.index.path);
  if (!fs.existsSync(sourceIndexPath) || sha256(sourceIndexPath) !== reference.index.sha256) {
    throw new Error("package chunk visual control index hash is invalid");
  }
  const index = readJson(sourceIndexPath, `package chunk visual ${role} index`);
  if (index.schema !== schema || index.role !== role
    || index.world !== readJson(path.join(packageRoot, "manifest.json"), "package manifest").world
    || index.entries?.length !== reference.count) {
    throw new Error(`package chunk visual ${role} index contract is invalid`);
  }
  const targetDir = path.join(stageDir, ...directory.split("/"));
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourceIndexPath, path.join(targetDir, "index.json"));
  for (const entry of index.entries) {
    const escapedDirectory = directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^${escapedDirectory}/chunk-[0-9]+-[0-9]+\\.png$`).test(entry.image?.path ?? "")
      || !SHA256.test(entry.image?.sha256 ?? "")) {
      throw new Error(`package chunk visual ${role} entry is unsafe`);
    }
    const source = path.join(packageRoot, entry.image.path);
    if (!fs.existsSync(source)
      || fs.statSync(source).size !== entry.image.bytes
      || sha256(source) !== entry.image.sha256) {
      throw new Error(`package chunk visual ${entry.id ?? "unknown"} integrity is invalid`);
    }
    fs.copyFileSync(source, path.join(targetDir, path.basename(entry.image.path)));
  }
  return {
    index: structuredClone(reference.index),
    count: reference.count,
    seamCount: reference.seamCount,
    pixelsPerTile: reference.pixelsPerTile,
    totalBytes: reference.totalBytes,
  };
}

function validateInstalledRuntimeChunks(runtimeDir, reference, worldId) {
  if (reference.index?.path !== "chunks/index.json" || !SHA256.test(reference.index?.sha256 ?? "")) throw new Error("runtime chunk index reference is invalid");
  const indexPath = path.join(runtimeDir, reference.index.path);
  if (!fs.existsSync(indexPath) || sha256(indexPath) !== reference.index.sha256) throw new Error("runtime chunk index hash is invalid");
  const index = readJson(indexPath, "runtime chunk index");
  if (index.world !== worldId || index.chunks?.length !== reference.count) throw new Error("runtime chunk index identity is invalid");
  for (const entry of index.chunks) {
    const chunkPath = path.join(runtimeDir, entry.path);
    if (!fs.existsSync(chunkPath) || fs.statSync(chunkPath).size !== entry.bytes || sha256(chunkPath) !== entry.sha256) throw new Error(`runtime chunk ${entry.id ?? "unknown"} integrity is invalid`);
  }
}

function validateInstalledRuntimeChunkVisuals(runtimeDir, references, worldId) {
  for (const role of ["control", "illustrated"]) {
    const reference = references[role];
    if (reference) validateInstalledRuntimeChunkVisualSet(runtimeDir, role, reference, worldId);
  }
}

function validateInstalledRuntimeChunkVisualSet(runtimeDir, role, reference, worldId) {
  const directory = role === "control" ? "chunks/visual-controls" : "chunks/visual-illustrated";
  if (reference?.index?.path !== `${directory}/index.json`
    || !SHA256.test(reference.index?.sha256 ?? "")) {
    throw new Error(`runtime chunk visual ${role} index reference is invalid`);
  }
  const indexPath = path.join(runtimeDir, reference.index.path);
  if (!fs.existsSync(indexPath) || sha256(indexPath) !== reference.index.sha256) {
    throw new Error("runtime chunk visual control index hash is invalid");
  }
  const index = readJson(indexPath, `runtime chunk visual ${role} index`);
  if (index.world !== worldId || index.entries?.length !== reference.count) {
    throw new Error(`runtime chunk visual ${role} index identity is invalid`);
  }
  for (const entry of index.entries) {
    const imagePath = path.join(runtimeDir, entry.image.path);
    if (!fs.existsSync(imagePath)
      || fs.statSync(imagePath).size !== entry.image.bytes
      || sha256(imagePath) !== entry.image.sha256) {
      throw new Error(`runtime chunk visual ${entry.id ?? "unknown"} integrity is invalid`);
    }
  }
}

function installRuntimeChunkIllustration(packageRoot, stageDir, reference) {
  if (!reference) return null;
  if (reference.path !== "chunk-illustration/index.json" || !SHA256.test(reference.sha256 ?? "")) {
    throw new Error("package chunk illustration index reference is invalid");
  }
  const sourceIndexPath = path.join(packageRoot, "chunk-illustration", "index.json");
  if (!fs.existsSync(sourceIndexPath) || sha256(sourceIndexPath) !== reference.sha256) {
    throw new Error("package chunk illustration index hash is invalid");
  }
  const index = readJson(sourceIndexPath, "package chunk illustration index");
  if (index.schema !== "duskfell-chunk-illustration-index-v1"
    || index.execution !== "chunked-v1"
    || !Array.isArray(index.jobs)
    || index.jobs.length < 1
    || index.jobs.length > 65_536) {
    throw new Error("package chunk illustration index contract is invalid");
  }
  const targetRoot = path.join(stageDir, "chunk-illustration");
  fs.mkdirSync(path.join(targetRoot, "jobs"), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, "candidates"), { recursive: true });
  fs.copyFileSync(sourceIndexPath, path.join(targetRoot, "index.json"));
  let totalBytes = fs.statSync(sourceIndexPath).size;
  if (index.review?.path !== "chunk-illustration/review.png" || !SHA256.test(index.review?.sha256 ?? "")) {
    throw new Error("package chunk illustration review reference is invalid");
  }
  const sourceReviewPath = path.join(packageRoot, "chunk-illustration", "review.png");
  if (!fs.existsSync(sourceReviewPath) || sha256(sourceReviewPath) !== index.review.sha256) {
    throw new Error("package chunk illustration review integrity is invalid");
  }
  fs.copyFileSync(sourceReviewPath, path.join(targetRoot, "review.png"));
  totalBytes += fs.statSync(sourceReviewPath).size;
  for (const jobReference of index.jobs) {
    const id = jobReference?.id;
    if (!/^\d+-\d+$/.test(id ?? "")
      || jobReference.path !== `chunk-illustration/jobs/chunk-${id}.json`
      || !SHA256.test(jobReference.sha256 ?? "")) {
      throw new Error(`package chunk illustration job ${id ?? "unknown"} reference is unsafe`);
    }
    const sourceJobPath = path.join(packageRoot, "chunk-illustration", "jobs", `chunk-${id}.json`);
    if (!fs.existsSync(sourceJobPath) || sha256(sourceJobPath) !== jobReference.sha256) {
      throw new Error(`package chunk illustration job ${id} integrity is invalid`);
    }
    const job = readJson(sourceJobPath, `package chunk illustration job ${id}`);
    const output = job.output;
    if (output?.path !== `chunk-illustration/candidates/chunk-${id}.png`
      || !SHA256.test(output.sha256 ?? "")
      || !Number.isInteger(output.bytes)
      || output.bytes < 64) {
      throw new Error(`package chunk illustration candidate ${id} reference is unsafe`);
    }
    const sourceOutputPath = path.join(packageRoot, "chunk-illustration", "candidates", `chunk-${id}.png`);
    if (!fs.existsSync(sourceOutputPath)
      || fs.statSync(sourceOutputPath).size !== output.bytes
      || sha256(sourceOutputPath) !== output.sha256) {
      throw new Error(`package chunk illustration candidate ${id} integrity is invalid`);
    }
    fs.copyFileSync(sourceJobPath, path.join(targetRoot, "jobs", `chunk-${id}.json`));
    fs.copyFileSync(sourceOutputPath, path.join(targetRoot, "candidates", `chunk-${id}.png`));
    totalBytes += fs.statSync(sourceJobPath).size + output.bytes;
  }
  return {
    index: { path: reference.path, sha256: reference.sha256 },
    jobCount: index.jobs.length,
    totalBytes,
  };
}

function validateInstalledRuntimeChunkIllustration(runtimeDir, reference, worldId) {
  if (reference.index?.path !== "chunk-illustration/index.json"
    || !SHA256.test(reference.index?.sha256 ?? "")) {
    throw new Error("runtime chunk illustration index reference is invalid");
  }
  const indexPath = path.join(runtimeDir, "chunk-illustration", "index.json");
  if (!fs.existsSync(indexPath) || sha256(indexPath) !== reference.index.sha256) {
    throw new Error("runtime chunk illustration index hash is invalid");
  }
  const index = readJson(indexPath, "runtime chunk illustration index");
  if (index.world !== worldId || index.jobs?.length !== reference.jobCount) {
    throw new Error("runtime chunk illustration index identity is invalid");
  }
  let totalBytes = fs.statSync(indexPath).size;
  const reviewPath = path.join(runtimeDir, "chunk-illustration", "review.png");
  if (index.review?.path !== "chunk-illustration/review.png"
    || !fs.existsSync(reviewPath)
    || sha256(reviewPath) !== index.review?.sha256) {
    throw new Error("runtime chunk illustration review integrity is invalid");
  }
  totalBytes += fs.statSync(reviewPath).size;
  for (const jobReference of index.jobs) {
    const id = jobReference.id;
    const jobPath = path.join(runtimeDir, "chunk-illustration", "jobs", `chunk-${id}.json`);
    if (!fs.existsSync(jobPath) || sha256(jobPath) !== jobReference.sha256) {
      throw new Error(`runtime chunk illustration job ${id} integrity is invalid`);
    }
    const job = readJson(jobPath, `runtime chunk illustration job ${id}`);
    const outputPath = path.join(runtimeDir, "chunk-illustration", "candidates", `chunk-${id}.png`);
    if (!fs.existsSync(outputPath)
      || fs.statSync(outputPath).size !== job.output?.bytes
      || sha256(outputPath) !== job.output?.sha256) {
      throw new Error(`runtime chunk illustration candidate ${id} integrity is invalid`);
    }
    totalBytes += fs.statSync(jobPath).size + job.output.bytes;
  }
  if (totalBytes !== reference.totalBytes) throw new Error("runtime chunk illustration byte count is invalid");
}

function standaloneTerrainDetailAuthority(source, serverPatch, bundle, state = "approved") {
  const authority = structuredClone(source);
  const units = bundle.dimensions.unitsPerTile;
  const offsetX = serverPatch.region.offsetX * units;
  const offsetY = serverPatch.region.offsetY * units;
  for (const collection of [authority.blockers ?? [], authority.resourceNodes ?? [], authority.decayConsumers ?? []]) {
    for (const item of collection) {
      item.x = round(item.x - offsetX, 3);
      item.y = round(item.y - offsetY, 3);
      if (item.x < 0 || item.y < 0 || item.x > bundle.dimensions.width || item.y > bundle.dimensions.height) {
        throw new Error(`terrain detail ${item.id ?? "unknown"} falls outside standalone world bounds`);
      }
    }
  }
  authority.sourceWorld = {
    ...authority.sourceWorld,
    width: bundle.dimensions.width,
    height: bundle.dimensions.height,
  };
  authority.activation = state === "review" ? "isolated-review-runtime" : "approved-runtime";
  return authority;
}

function standaloneServerWorld(recipe, bundle, patch, runtimeChunks) {
  const { cols, rows, unitsPerTile } = bundle.dimensions;
  const settlement = bundle.features.settlements[0];
  if (!settlement) throw new Error("standalone world requires at least one settlement");
  const spawn = { x: round(settlement.x * unitsPerTile, 3), y: round(settlement.y * unitsPerTile, 3) };
  const vertexHeightPrecision = patch.authority.vertexHeightPrecision ?? 1;
  const serviceTiles = nearbyServiceTiles(
    patch.authority.materialGrid,
    patch.authority.vertexHeights,
    settlement,
    patch.authority.maxWalkableStep,
    vertexHeightPrecision,
  );
  const toWorld = (tile) => ({ x: round((tile.x + 0.5) * unitsPerTile, 3), y: round((tile.y + 0.5) * unitsPerTile, 3) });
  const registrar = toWorld(serviceTiles[0]);
  const forge = toWorld(serviceTiles[1]);
  const heights = patch.authority.vertexHeights.flat();
  return {
    schemaVersion: "sundermere-world-v1",
    map: {
      width: cols * unitsPerTile,
      height: rows * unitsPerTile,
      safeZoneRadius: Math.min(480, Math.floor(Math.min(cols, rows) * unitsPerTile / 4)),
      region: serverRegionRouting(bundle),
      terrain: {
        profile: "duskfell-terrain-v1",
        seed: recipe.seed,
        detailAuthorityEnabled: true,
        unitsPerTile,
        tileWidth: 64,
        tileHeight: 64,
        heightScale: 20,
        minElevation: Math.min(-1, Math.floor(Math.min(...heights) / vertexHeightPrecision)),
        maxElevation: Math.max(2, Math.ceil(Math.max(...heights) / vertexHeightPrecision)),
        waterLevel: -1,
        maxWalkableStep: patch.authority.maxWalkableStep,
        vertexHeightPrecision,
        materials: MATERIALS,
        materialGrid: runtimeChunks ? [] : patch.authority.materialGrid,
        vertexHeights: runtimeChunks ? [] : patch.authority.vertexHeights,
        chunkAuthority: runtimeChunks ? {
          schemaVersion: "duskfell-world-chunk-index-v1",
          indexSha256: runtimeChunks.index.sha256,
          chunkCount: runtimeChunks.count,
          chunkTiles: runtimeChunks.chunkTiles,
          apronTiles: runtimeChunks.apronTiles,
          vertexHeightPrecision: runtimeChunks.vertexHeightPrecision,
          totalBytes: runtimeChunks.totalBytes,
        } : null,
        trails: bundle.features.trails.map((trail, index) => ({
          id: trail.id,
          label: `Frontier trail ${index + 1}`,
          kind: "trail",
          widthTiles: trail.width,
          points: trail.points,
        })),
      },
    },
    spawn,
    npcs: [],
    objects: [
      { id: "registrar", kind: "registrar", label: "Wayfarer Bank", ...registrar, radius: 24 },
      { id: "field-forge", kind: "forge", label: "Field Forge", ...forge, radius: 24 },
    ],
  };
}

export function serverRegionRouting(bundle) {
  const source = bundle.generation?.source;
  if (!source?.atlas) return null;
  if (!source.region || !source.tileOrigin || !source.neighbors) throw new Error("atlas region bundle is missing routing provenance");
  return {
    schemaVersion: "duskfell-region-routing-v1",
    atlasId: source.atlas.id,
    atlasContentSha256: source.atlas.contentSha256,
    regionId: bundle.id,
    coord: structuredClone(source.region),
    tileOrigin: structuredClone(source.tileOrigin),
    neighbors: structuredClone(source.neighbors),
  };
}

function nearbyServiceTiles(materialRows, heights, settlement, maxStep, vertexHeightPrecision) {
  const cols = materialRows[0].length;
  const rows = materialRows.length;
  const origin = { x: Math.floor(settlement.x), y: Math.floor(settlement.y) };
  const candidates = [];
  for (let radius = 1; radius <= 8 && candidates.length < 2; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const x = origin.x + dx;
      const y = origin.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows || materialRows[y][x] === "4") continue;
      const corners = [heights[y][x], heights[y][x + 1], heights[y + 1][x], heights[y + 1][x + 1]];
      if (Math.max(...corners) - Math.min(...corners) > maxStep * vertexHeightPrecision) continue;
      if (candidates.every((candidate) => Math.hypot(candidate.x - x, candidate.y - y) >= 2)) candidates.push({ x, y });
      if (candidates.length === 2) return candidates;
    }
  }
  throw new Error("unable to place required settlement services on walkable terrain");
}

function runtimeWorldManifest({ state, manifest, manifestPath, reviewRecord, reviewRecordName, installedReviewPath, runtimeAuthorityPath, serverWorld, serverWorldPath, report, runtimeChunks, runtimeChunkVisuals, runtimeChunkIllustration }) {
  const refs = Object.fromEntries(Object.entries(manifest.rasters).map(([name, raster]) => [name, { ...raster, path: path.basename(raster.path) }]));
  return {
    schemaVersion: "duskfell-runtime-world-v1",
    state,
    world: manifest.world,
    projection: "military-plan-oblique",
    sourcePackage: { manifest: "manifest.json", sha256: sha256(manifestPath) },
    ...(state === "approved" ? {
      approval: {
        path: reviewRecordName,
        sha256: sha256(installedReviewPath),
        approver: reviewRecord.approver,
        reviewedAt: reviewRecord.reviewedAt,
      },
    } : {
      review: {
        path: reviewRecordName,
        sha256: sha256(installedReviewPath),
        humanApproval: false,
      },
    }),
    bundle: { path: path.basename(manifest.bundle), sha256: manifest.bundleSha256 },
    terrainDetailAuthority: { path: "terrain-detail-authority.json", sha256: sha256(runtimeAuthorityPath) },
    serverContent: { path: path.basename(serverWorldPath), sha256: hashJsonFileValue(serverWorld), mode: "standalone-wipe" },
    rasters: refs,
    chunks: runtimeChunks,
    chunkVisuals: runtimeChunkVisuals,
    chunkIllustration: runtimeChunkIllustration,
    region: serverWorld.map.region,
    validation: { schema: report.schema, metrics: report.metrics },
  };
}

function nextRegistry(registryPath, runtimeManifest, runtimeManifestSha256) {
  const registry = fs.existsSync(registryPath)
    ? readJson(registryPath, "runtime world registry")
    : { schemaVersion: "duskfell-runtime-world-registry-v1", projection: "military-plan-oblique", worlds: [] };
  if (registry.schemaVersion !== "duskfell-runtime-world-registry-v1" || registry.projection !== "military-plan-oblique" || !Array.isArray(registry.worlds)) {
    throw new Error("runtime world registry contract is invalid");
  }
  if (registry.worlds.some((entry) => entry.id === runtimeManifest.world)) throw new Error(`runtime registry already contains ${runtimeManifest.world}`);
  registry.worlds.push({
    id: runtimeManifest.world,
    directory: runtimeManifest.world,
    manifest: "runtime-manifest.json",
    manifestSha256: runtimeManifestSha256,
    state: runtimeManifest.state,
  });
  registry.worlds.sort((left, right) => left.id.localeCompare(right.id));
  return registry;
}

function resetOwnedPreviewRoot(previewRoot, world, packageManifestSha256) {
  if (!fs.existsSync(previewRoot)) {
    fs.mkdirSync(previewRoot, { recursive: true });
    return;
  }
  const markerPath = path.join(previewRoot, "preview-root.json");
  const marker = readJson(markerPath, "world preview marker");
  if (marker.schema !== "duskfell-world-preview-staging-v1"
    || marker.world !== world
    || marker.packageManifestSha256 !== packageManifestSha256
    || marker.humanApproval !== false) {
    throw new Error(`refusing to replace unowned or mismatched preview directory ${previewRoot}`);
  }
  fs.rmSync(previewRoot, { recursive: true, force: true });
  fs.mkdirSync(previewRoot, { recursive: true });
}

function mirrorBaseAssets(targetAssetsDir) {
  const sourceAssetsDir = path.join(ROOT, "assets");
  fs.mkdirSync(targetAssetsDir, { recursive: true });
  mirrorEntries(sourceAssetsDir, targetAssetsDir, new Set(["terrain"]));
  const targetTerrainDir = path.join(targetAssetsDir, "terrain");
  fs.mkdirSync(targetTerrainDir, { recursive: true });
  mirrorEntries(path.join(sourceAssetsDir, "terrain"), targetTerrainDir, new Set(["worlds"]));
}

function mirrorEntries(sourceDir, targetDir, excluded) {
  for (const name of fs.readdirSync(sourceDir).sort()) {
    if (excluded.has(name)) continue;
    const source = path.join(sourceDir, name);
    const target = path.join(targetDir, name);
    fs.symlinkSync(path.relative(path.dirname(target), source), target, fs.statSync(source).isDirectory() ? "dir" : "file");
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or malformed: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.writing-${process.pid}`;
  writeJson(temporary, value);
  fs.renameSync(temporary, filePath);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashJsonFileValue(value) {
  return crypto.createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex");
}

function check(condition, message, failures) {
  if (!condition) failures.push(message);
}

function round(value, digits = 5) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const visualApprovalStatement = APPROVAL_STATEMENT;
export const runtimeWorldIdPattern = WORLD_ID;
export const runtimeSha256Pattern = SHA256;
