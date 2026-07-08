import assert from "node:assert/strict";
import test from "node:test";

import {
  terrainDetailDepthProfile,
  terrainDetailOcclusionAlpha,
  terrainDetailSortBias,
} from "./terrain-depth.js";
import { PROJECTION } from "./projection.js";

test("terrain detail depth profiles normalize vertical occlusion metadata", () => {
  const profile = terrainDetailDepthProfile({
    vertical: 1.4,
    footprint: { widthTiles: 1.1, heightTiles: 0.8 },
    occlusion: { heightTiles: 1.2, radiusTiles: 0.9, fadeAlpha: 0.44 },
  });

  assert.equal(profile.vertical, 1.4);
  assert.equal(profile.heightTiles, 1.2);
  assert.equal(profile.radiusTiles, 0.9);
  assert.equal(profile.fadeAlpha, 0.44);
});

test("terrain detail occlusion fades tall scenery only when the player is behind it", () => {
  const detail = {
    x: 320,
    y: 320,
    vertical: 1.35,
    footprint: { widthTiles: 1.2, heightTiles: 1 },
    occlusion: { heightTiles: 1.35, radiusTiles: 0.88, fadeAlpha: 0.46 },
  };

  const behind = terrainDetailOcclusionAlpha(detail, {
    x: detail.x + PROJECTION.unitsPerTile * 0.08,
    y: detail.y + PROJECTION.unitsPerTile * 0.42,
  });
  const inFront = terrainDetailOcclusionAlpha(detail, {
    x: detail.x,
    y: detail.y - PROJECTION.unitsPerTile * 0.55,
  });
  const farAside = terrainDetailOcclusionAlpha(detail, {
    x: detail.x + PROJECTION.unitsPerTile * 2,
    y: detail.y + PROJECTION.unitsPerTile * 0.3,
  });

  assert.ok(behind < 1, "expected tall detail to fade when the player is behind it");
  assert.ok(behind >= detail.occlusion.fadeAlpha);
  assert.equal(inFront, 1);
  assert.equal(farAside, 1);
});

test("terrain detail sort bias honors explicit values and derives vertical fallback", () => {
  assert.equal(terrainDetailSortBias({ sortBias: 15 }), 15);
  assert.ok(
    terrainDetailSortBias({
      vertical: 1.4,
      footprint: { heightTiles: 1.1 },
      occlusion: { heightTiles: 1.3, radiusTiles: 0.9, fadeAlpha: 0.5 },
    }) > terrainDetailSortBias({
      vertical: 0.2,
      footprint: { heightTiles: 0.3 },
      occlusion: { heightTiles: 0.2, radiusTiles: 0.3, fadeAlpha: 0.8 },
    }),
  );
});
