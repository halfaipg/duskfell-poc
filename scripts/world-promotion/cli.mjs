#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createVisualApprovalTemplate, promoteWorldPackage } from "./promotion.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const command = argv[0];
  if (command === "--help" || command === "-h" || !command) return { help: true };
  if (!['template', 'promote'].includes(command)) throw new Error(`unknown world promotion command ${command}`);
  const values = { command };
  for (let index = 1; index < argv.length; index += 2) {
    const token = argv[index];
    const key = token?.startsWith("--") ? token.slice(2) : null;
    if (!key || !["package", "approval", "output"].includes(key)) throw new Error(`unknown world promotion argument ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    values[key] = value;
  }
  return values;
}

export function help() {
  return `Duskfell world promotion\n\nGenerate a hash-bound human approval template:\n  npm run worldgen:approval -- --package worlds/generated/WORLD --output worlds/approvals/WORLD.json\n\nPromote an approved illustrated package:\n  npm run worldgen:promote -- --package worlds/generated/WORLD --approval worlds/approvals/WORLD.json\n`;
}

export function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(help());
    return null;
  }
  if (!args.package) throw new Error("--package is required");
  const packageDir = path.resolve(ROOT, args.package);
  if (args.command === "template") {
    if (!args.output) throw new Error("template requires --output");
    const result = createVisualApprovalTemplate(packageDir, path.resolve(ROOT, args.output));
    process.stdout.write(`${JSON.stringify({ state: "pending-human-review", output: path.relative(ROOT, result.output) }, null, 2)}\n`);
    return result;
  }
  if (!args.approval) throw new Error("promote requires --approval");
  const result = promoteWorldPackage(packageDir, path.resolve(ROOT, args.approval));
  process.stdout.write(`${JSON.stringify({
    world: result.world,
    state: result.state,
    runtimeDir: path.relative(ROOT, result.runtimeDir),
    serverWorld: path.relative(ROOT, result.serverWorldPath),
    gameplayUrl: result.gameplayUrl,
  }, null, 2)}\n`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`world promotion: ${error.message}\n`);
    process.exitCode = 1;
  }
}
