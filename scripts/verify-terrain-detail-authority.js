import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TERRAIN_DETAIL_AUTHORITY_PATH,
  buildTerrainDetailAuthorityFromWorld,
  canonicalJson,
  validateTerrainDetailAuthority,
} from "./terrain-detail-authority.js";

const authorityPath = process.argv[2] ?? TERRAIN_DETAIL_AUTHORITY_PATH;

let result;
try {
  const actual = JSON.parse(await readFile(authorityPath, "utf8"));
  const normalizedActual = validateTerrainDetailAuthority(actual);
  const expected = await buildTerrainDetailAuthorityFromWorld();
  assert.deepEqual(normalizedActual, expected);
  assert.equal(canonicalJson(normalizedActual), canonicalJson(expected));
  result = {
    ok: true,
    authorityPath,
    counts: normalizedActual.counts,
    profile: normalizedActual.profile,
    seed: normalizedActual.seed,
  };
} catch (err) {
  result = {
    ok: false,
    authorityPath,
    error: err.message,
  };
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
