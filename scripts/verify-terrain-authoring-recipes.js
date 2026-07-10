import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.dirname needs Node >= 20.11; this repo still runs on Node 18
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recipePath = path.join(root, "assets", "terrain", "authoring-recipes.json");
const allowedStatuses = new Set(["reviewed-proof", "live-proof", "runtime-review", "approved"]);
const requiredMapFields = [
  "recipeId",
  "recipeVersion",
  "seed",
  "parameters",
  "inputAssetIds",
  "outputAssetIds",
];
const errors = [];

const raw = fs.readFileSync(recipePath, "utf8");
if (/grid_[A-Za-z0-9_-]{20,}/.test(raw)) errors.push("authoring recipes contain a credential-like Grid token");
const catalog = JSON.parse(raw);

if (catalog.schemaVersion !== "duskfell-terrain-authoring-v1") {
  errors.push("unexpected terrain authoring schemaVersion");
}
if (catalog.projection?.kind !== "military-plan-oblique") {
  errors.push("authoring projection must be military-plan-oblique");
}
for (const field of requiredMapFields) {
  if (!catalog.levelEditorContract?.mapStores?.includes(field)) {
    errors.push(`level editor mapStores is missing ${field}`);
  }
}

const ids = new Set();
for (const [index, recipe] of (catalog.recipes ?? []).entries()) {
  const label = recipe.id || `recipes[${index}]`;
  if (!recipe.id || ids.has(recipe.id)) errors.push(`${label} has a missing or duplicate id`);
  ids.add(recipe.id);
  if (!Number.isInteger(recipe.version) || recipe.version < 1) errors.push(`${label} has an invalid version`);
  if (!allowedStatuses.has(recipe.status)) errors.push(`${label} has an unsupported status`);
  if (typeof recipe.deterministic !== "boolean") errors.push(`${label} must declare deterministic`);
  if (!Array.isArray(recipe.editorKnobs) || recipe.editorKnobs.length === 0) {
    errors.push(`${label} must expose editorKnobs`);
  }
  if (!Array.isArray(recipe.outputs) || recipe.outputs.length === 0) errors.push(`${label} must declare outputs`);
  for (const file of recipe.files ?? []) {
    if (path.isAbsolute(file) || file.includes("..")) {
      errors.push(`${label} contains unsafe file path ${file}`);
    } else if (!fs.existsSync(path.join(root, file))) {
      errors.push(`${label} references missing file ${file}`);
    }
  }
}

const sampling = catalog.recipes?.find((recipe) => recipe.id === "terrain.runtime.world-aligned-sampling.v1");
for (const transform of ["mirror-x", "mirror-y", "free-rotation"]) {
  if (!sampling?.forbiddenTransforms?.includes(transform)) {
    errors.push(`asymmetric sampling must forbid ${transform}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets", "terrain", "manifest.json"), "utf8"));
// contract: every visual biome has a painting; overlay patches ride alongside
const REQUIRED_BIOME_PATCHES = ["meadow", "heath", "chalk", "frost", "fen", "moor", "ash", "blight"];
const ALLOWED_OVERLAY_PATCHES = new Set(["trail", "ecotone", "stream-water", "cliff", "scree"]);
const patchBiomes = new Set((manifest.groundPatches ?? []).map((patch) => patch.biome));
for (const biome of REQUIRED_BIOME_PATCHES) {
  if (!patchBiomes.has(biome)) errors.push(`terrain manifest is missing the ${biome} biome ground patch`);
}
for (const patch of manifest.groundPatches ?? []) {
  if (!REQUIRED_BIOME_PATCHES.includes(patch.biome) && !ALLOWED_OVERLAY_PATCHES.has(patch.biome)) {
    errors.push(`unexpected ground patch biome: ${patch.biome}`);
  }
}

const result = {
  ok: errors.length === 0,
  recipePath: path.relative(root, recipePath),
  recipeCount: catalog.recipes?.length ?? 0,
  recipeIds: [...ids],
  errors,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length > 0) process.exitCode = 1;
