#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stageWorldPackagePreview } from "./promotion.mjs";
import { worldServerEnvironment } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function parsePreviewArgs(argv) {
  const result = { port: 4112, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") { result.dryRun = true; continue; }
    const key = token?.startsWith("--") ? token.slice(2) : null;
    if (!key || !["package", "port"].includes(key)) throw new Error(`unknown world preview argument ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    result[key] = key === "port" ? Number(value) : value;
    index += 1;
  }
  if (!result.package) throw new Error("--package is required");
  if (!Number.isInteger(result.port) || result.port < 1024 || result.port > 65535) throw new Error("--port must be an integer from 1024 to 65535");
  return result;
}

export function run(argv = process.argv.slice(2)) {
  const args = parsePreviewArgs(argv);
  const world = stageWorldPackagePreview(path.resolve(args.package));
  const env = worldServerEnvironment(world, args.port, {
    ...process.env,
    ASSETS_DIR: world.assetsDir,
    CLIENT_DIR: path.join(ROOT, "client"),
    REVIEW_WORLDS_DIR: path.join(ROOT, "worlds/generated"),
  }, world.previewRoot);
  const result = {
    world: world.world,
    state: "isolated-review",
    bind: env.BIND_ADDR,
    package: path.relative(ROOT, world.packageRoot),
    staging: path.relative(ROOT, world.previewRoot),
    game: `http://127.0.0.1:${args.port}/game.html?world=${encodeURIComponent(world.world)}&preview=1`,
    liveAssetsModified: false,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (args.dryRun) return { world, env, result };
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], { cwd: ROOT, env, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  return { world, env, result, child };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`world preview: ${error.message}\n`);
    process.exitCode = 1;
  }
}
