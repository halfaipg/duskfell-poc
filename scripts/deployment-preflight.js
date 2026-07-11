import { checkAnimusProvider } from "./deployment-preflight/animus.js";
import { checkAccountAuth } from "./deployment-preflight/auth.js";
import { checkNumericBudgets } from "./deployment-preflight/budgets.js";
import {
  checkBind,
  checkChainMode,
  checkOrigins,
  checkProductionBlockers,
  checkProductionChainServices,
  hasValidRedisUrl,
} from "./deployment-preflight/network.js";
import { parseArgs } from "./deployment-preflight/parsing.js";
import {
  boolEnv,
  checkAdmissionBackend,
  checkBuildProvenance,
  checkDeploymentProfile,
  checkDrainMode,
  checkDurabilityMode,
  checkKnownProfile,
  checkPersistenceBackend,
  checkPublicMode,
} from "./deployment-preflight/runtime.js";

const args = parseArgs(process.argv.slice(2));
const profile = args.profile ?? "shared-poc";
const env = process.env;
const checks = [];

if (!["local", "shared-poc", "production"].includes(profile)) {
  throw new Error("--profile must be one of: local, shared-poc, production");
}

const context = {
  add,
  args,
  boolEnv,
  env,
  hasValidRedisUrl: () => hasValidRedisUrl(env),
  profile,
};

checkKnownProfile(context);
checkDeploymentProfile(context);
checkPersistenceBackend(context);
checkAdmissionBackend(context);
checkPublicMode(context);
checkBuildProvenance(context);
checkAccountAuth(env, profile, add);
checkOrigins(context);
checkBind(context);
checkChainMode(context);
checkProductionChainServices(context);
checkNumericBudgets(env, add);
checkAnimusProvider(env, profile, add);
checkDurabilityMode(context);
checkDrainMode(context);
checkProductionBlockers(context);

const errors = checks.filter((check) => check.level === "error" && !check.ok);
const warnings = checks.filter((check) => check.level === "warn" && !check.ok);
const result = {
  profile,
  ok: errors.length === 0,
  errors: errors.length,
  warnings: warnings.length,
  checks,
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

function add(name, ok, level, detail) {
  checks.push({ name, ok, level, detail });
}
