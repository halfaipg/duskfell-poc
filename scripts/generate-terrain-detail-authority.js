import { writeFile } from "node:fs/promises";

import {
  TERRAIN_DETAIL_AUTHORITY_PATH,
  buildTerrainDetailAuthorityFromWorld,
  canonicalJson,
} from "./terrain-detail-authority.js";

const outputPath = process.argv[2] ?? TERRAIN_DETAIL_AUTHORITY_PATH;
const authority = await buildTerrainDetailAuthorityFromWorld();
await writeFile(outputPath, canonicalJson(authority));
console.log(
  `wrote ${outputPath} blockers=${authority.counts.blockers} resourceNodes=${authority.counts.resourceNodes} decayConsumers=${authority.counts.decayConsumers}`,
);
