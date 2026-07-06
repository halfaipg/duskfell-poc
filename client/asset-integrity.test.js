import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { sha256Hex, verifySha256Bytes } from "./asset-integrity.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

test("computes SHA-256 hex for ArrayBuffer and typed-array inputs", async () => {
  const bytes = new TextEncoder().encode("Duskfell asset pin");
  const expected = "6cfebeb012b4ee62a03e871ea93000e6a4108c350ca468b6c579bab8486d812f";

  assert.equal(await sha256Hex(bytes), expected);
  assert.equal(await sha256Hex(bytes.buffer), expected);
});

test("accepts matching SHA-256 asset pins", async () => {
  const bytes = new TextEncoder().encode("verified");
  const expected = await sha256Hex(bytes);

  assert.equal(await verifySha256Bytes(bytes, expected), expected);
});

test("rejects mismatched or malformed SHA-256 asset pins", async () => {
  const bytes = new TextEncoder().encode("verified");

  await assert.rejects(
    () => verifySha256Bytes(bytes, "0".repeat(64)),
    /asset SHA-256 mismatch/,
  );
  await assert.rejects(
    () => verifySha256Bytes(bytes, "ABC"),
    /lowercase SHA-256/,
  );
});
