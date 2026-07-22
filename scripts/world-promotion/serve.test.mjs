import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseServeArgs, worldServerEnvironment } from "./serve.mjs";
import { parsePreviewArgs } from "./preview.mjs";

test("promoted world server arguments are bounded and durable paths are isolated by world", () => {
  assert.deepEqual(parseServeArgs(["--world", "ash-valley", "--port", "4222", "--dry-run"]), {
    world: "ash-valley",
    port: 4222,
    dryRun: true,
  });
  assert.throws(() => parseServeArgs(["--world", "ash-valley", "--port", "80"]), /1024/);
  assert.throws(() => parseServeArgs(["--port", "4222"]), /world is required/);
  const env = worldServerEnvironment({
    world: "ash-valley",
    serverWorldPath: "/tmp/ash-valley.json",
    terrainDetailAuthorityPath: "/tmp/ash-valley-authority.json",
  }, 4222, {}, os.tmpdir());
  assert.equal(env.BIND_ADDR, "127.0.0.1:4222");
  assert.equal(env.CONTENT_PATH, "/tmp/ash-valley.json");
  assert.equal(env.TERRAIN_DETAIL_AUTHORITY_PATH, "/tmp/ash-valley-authority.json");
  assert.equal(env.JOURNAL_PATH, path.join(os.tmpdir(), "var/worlds/ash-valley/journal.jsonl"));
  assert.equal(env.SETTLEMENT_OUTBOX_PATH, path.join(os.tmpdir(), "var/worlds/ash-valley/settlement-outbox.jsonl"));

  const chunked = worldServerEnvironment({
    world: "ash-valley",
    runtimeDir: "/tmp/runtime/ash-valley",
    serverWorldPath: "/tmp/ash-valley.json",
    terrainDetailAuthorityPath: "/tmp/ash-valley-authority.json",
    manifest: { chunks: { index: { path: "chunks/index.json" } } },
  }, 4222, {}, os.tmpdir());
  assert.equal(chunked.TERRAIN_CHUNK_INDEX_PATH, "/tmp/runtime/ash-valley/chunks/index.json");
});

test("world preview arguments require a bounded port and package", () => {
  assert.deepEqual(parsePreviewArgs(["--package", "worlds/generated/ash-valley", "--port", "4223", "--dry-run"]), {
    package: "worlds/generated/ash-valley",
    port: 4223,
    dryRun: true,
  });
  assert.throws(() => parsePreviewArgs(["--port", "4223"]), /package is required/);
  assert.throws(() => parsePreviewArgs(["--package", "ash-valley", "--port", "80"]), /1024/);
});
