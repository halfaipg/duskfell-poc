#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePromotedWorld } from "./promotion.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function parseServeArgs(argv) {
  const result = { port: 4112, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") { result.dryRun = true; continue; }
    const key = token?.startsWith("--") ? token.slice(2) : null;
    if (!key || !["world", "port"].includes(key)) throw new Error(`unknown world serve argument ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    result[key] = key === "port" ? Number(value) : value;
    index += 1;
  }
  if (!result.world) throw new Error("--world is required");
  if (!Number.isInteger(result.port) || result.port < 1024 || result.port > 65535) throw new Error("--port must be an integer from 1024 to 65535");
  return result;
}

export function worldServerEnvironment(world, port, baseEnv = process.env, root = ROOT) {
  const durableDir = path.join(root, "var/worlds", world.world);
  fs.mkdirSync(durableDir, { recursive: true });
  return {
    ...baseEnv,
    BIND_ADDR: `127.0.0.1:${port}`,
    CONTENT_PATH: world.serverWorldPath,
    TERRAIN_DETAIL_AUTHORITY_PATH: world.terrainDetailAuthorityPath,
    ...(world.manifest?.chunks ? { TERRAIN_CHUNK_INDEX_PATH: path.join(world.runtimeDir, world.manifest.chunks.index.path) } : {}),
    JOURNAL_PATH: path.join(durableDir, "journal.jsonl"),
    SETTLEMENT_OUTBOX_PATH: path.join(durableDir, "settlement-outbox.jsonl"),
  };
}

export function run(argv = process.argv.slice(2)) {
  const args = parseServeArgs(argv);
  const world = resolvePromotedWorld(args.world);
  const env = worldServerEnvironment(world, args.port);
  const result = {
    world: world.world,
    bind: env.BIND_ADDR,
    content: path.relative(ROOT, env.CONTENT_PATH),
    terrainAuthority: path.relative(ROOT, env.TERRAIN_DETAIL_AUTHORITY_PATH),
    game: `http://127.0.0.1:${args.port}/game.html?world=${encodeURIComponent(world.world)}`,
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
    process.stderr.write(`world serve: ${error.message}\n`);
    process.exitCode = 1;
  }
}
