import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const startedAt = performance.now();

let result;

try {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const lockText = await readFile("Cargo.lock", "utf8");
  const metadata = JSON.parse(
    await run("cargo", ["metadata", "--locked", "--offline", "--format-version", "1", "--no-deps"]),
  );
  const cargoTree = await run("cargo", ["tree", "--locked", "--edges", "no-dev,no-build", "--prefix", "none"]);

  const packageJsonDependencySections = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ].filter((section) => packageJson[section] && Object.keys(packageJson[section]).length > 0);
  const lockPackages = parseCargoLock(lockText);
  const registryPackages = lockPackages.filter((pkg) =>
    pkg.source?.startsWith("registry+https://github.com/rust-lang/crates.io-index"),
  );
  const gitPackages = lockPackages.filter((pkg) => pkg.source?.startsWith("git+"));
  const missingChecksums = registryPackages.filter((pkg) => !pkg.checksum);
  const workspacePackages = metadata.packages.filter((pkg) => pkg.source == null);
  const nonMitWorkspacePackages = workspacePackages.filter((pkg) => pkg.license !== "MIT");
  const nonRegistryDirectDependencies = workspacePackages.flatMap((pkg) =>
    pkg.dependencies
      .filter((dep) => dep.source !== "registry+https://github.com/rust-lang/crates.io-index")
      .map((dep) => `${pkg.name}:${dep.name}:${dep.source ?? "workspace/path"}`),
  );
  const duplicateLocks = duplicatePackageVersions(lockPackages);
  const activeBuildPackages = parseCargoTreePackages(cargoTree);

  result = {
    ok:
      packageJsonDependencySections.length === 0 &&
      lockPackages.length > 0 &&
      registryPackages.length > 0 &&
      gitPackages.length === 0 &&
      missingChecksums.length === 0 &&
      nonMitWorkspacePackages.length === 0 &&
      nonRegistryDirectDependencies.length === 0 &&
      activeBuildPackages.length > 0 &&
      duplicateLocks.length === 0,
    packageJsonDependencySections,
    workspacePackages: workspacePackages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
    })),
    directDependencies: workspacePackages.flatMap((pkg) =>
      pkg.dependencies.map((dep) => ({
        package: pkg.name,
        name: dep.name,
        source: dep.source,
        requirement: dep.req,
      })),
    ),
    cargoLock: {
      packages: lockPackages.length,
      registryPackages: registryPackages.length,
      gitPackages: gitPackages.map((pkg) => `${pkg.name} ${pkg.version}`),
      missingChecksums: missingChecksums.map((pkg) => `${pkg.name} ${pkg.version}`),
      duplicatePackageVersions: duplicateLocks,
    },
    activeBuildPackages: {
      count: activeBuildPackages.length,
      sample: activeBuildPackages.slice(0, 20),
    },
    elapsedMs: round(performance.now() - startedAt),
  };
} catch (err) {
  result = {
    ok: false,
    elapsedMs: round(performance.now() - startedAt),
    error: err.message,
  };
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

async function run(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise((resolve) => child.once("close", resolve));
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${code}: ${stderr}`);
  }
  return stdout;
}

function parseCargoLock(text) {
  return text
    .split(/\n\[\[package\]\]\n/g)
    .slice(1)
    .map((block) => ({
      name: readLockField(block, "name"),
      version: readLockField(block, "version"),
      source: readLockField(block, "source"),
      checksum: readLockField(block, "checksum"),
    }))
    .filter((pkg) => pkg.name && pkg.version);
}

function readLockField(block, field) {
  const match = block.match(new RegExp(`^${field} = "([^"]+)"`, "m"));
  return match?.[1] ?? null;
}

function duplicatePackageVersions(packages) {
  const seen = new Set();
  const duplicates = new Set();
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }
  return [...duplicates].sort();
}

function parseCargoTreePackages(text) {
  const packages = new Set();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Za-z0-9_.-]+) v([0-9][^ ]*)/);
    if (match) {
      packages.add(`${match[1]}@${match[2]}`);
    }
  }
  return [...packages].sort();
}

function round(value) {
  return Math.round(value * 100) / 100;
}
