import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseRect, parseRegionBatchArgs, runRegionBatch } from "./region-batch-cli.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("region batch parser bounds durable scheduling arguments", () => {
  assert.deepEqual(parseRect("4,7:3x2"), { x: 4, y: 7, cols: 3, rows: 2 });
  assert.deepEqual(parseRegionBatchArgs(["--atlas", "a", "--rect", "4,7:3x2", "--output", "b", "--resume", "on"]), {
    atlas: "a",
    rect: "4,7:3x2",
    output: "b",
    resume: "on",
  });
  assert.throws(() => parseRect("4,7,3x2"), /X,Y:COLSxROWS/);
  assert.throws(() => parseRegionBatchArgs(["--force", "yes"]), /unknown/);
});

test("durable region batch retries failures, pins outputs, and resumes without rerunning completed jobs", async () => {
  const root = path.join(ROOT, "var", `region-batch-test-${process.pid}`);
  const atlas = path.join(root, "atlas");
  const output = path.join(root, "batch");
  const template = path.join(root, "template.json");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(atlas, { recursive: true });
  fs.writeFileSync(path.join(atlas, "atlas.json"), `${JSON.stringify({ dimensions: { regionCols: 8, regionRows: 8 }, contentSha256: "a".repeat(64) })}\n`);
  fs.writeFileSync(path.join(atlas, "manifest.json"), "{}\n");
  fs.writeFileSync(template, "{}\n");
  const calls = new Map();
  const runRegionImpl = async (argv) => {
    const coord = argv[argv.indexOf("--coord") + 1];
    const target = argv[argv.indexOf("--output") + 1];
    calls.set(coord, (calls.get(coord) ?? 0) + 1);
    if (coord === "1,1" && calls.get(coord) === 1) throw new Error("transient provider failure");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "manifest.json"), `${JSON.stringify({ world: `region-${coord}` })}\n`);
  };
  const common = [
    "--atlas", atlas,
    "--rect", "1,1:2x2",
    "--template", template,
    "--output", output,
    "--concurrency", "2",
    "--max-attempts", "2",
  ];
  try {
    const result = await runRegionBatch(common, {
      silent: true,
      validateAtlasPackageImpl: () => ({ accepted: true }),
      validateWorldPackageImpl: () => ({ accepted: true }),
      runRegionImpl,
    });
    assert.deepEqual(result, { batch: path.relative(ROOT, output), state: "complete", total: 4, completed: 4, failed: 0 });
    const state = JSON.parse(fs.readFileSync(path.join(output, "batch.json"), "utf8"));
    assert.equal(state.jobs.find((job) => job.id === "1-1").attempts, 2);
    assert.ok(state.jobs.every((job) => /^[a-f0-9]{64}$/.test(job.manifestSha256)));
    const callsAfterFirstRun = [...calls.entries()];
    await runRegionBatch([...common, "--resume", "on"], {
      silent: true,
      validateAtlasPackageImpl: () => ({ accepted: true }),
      validateWorldPackageImpl: () => ({ accepted: true }),
      runRegionImpl: async () => { throw new Error("completed job was rerun"); },
    });
    assert.deepEqual([...calls.entries()], callsAfterFirstRun);

    fs.appendFileSync(path.join(output, "regions", "1-1", "manifest.json"), " ");
    await assert.rejects(() => runRegionBatch([...common, "--resume", "on"], {
      silent: true,
      validateAtlasPackageImpl: () => ({ accepted: true }),
      validateWorldPackageImpl: () => ({ accepted: true }),
      runRegionImpl,
    }), /manifest hash drift/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
