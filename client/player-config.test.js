import assert from "node:assert/strict";
import test from "node:test";

import { PLAYER_CARD_PORTRAITS } from "./player-config.js";

test("human Kimodo review actors use a front-facing full-body player card", () => {
  const wretchPortrait = PLAYER_CARD_PORTRAITS["duskfell-wretch"];

  assert.equal(PLAYER_CARD_PORTRAITS["kimodo-generated-human-locomotion-review"], wretchPortrait);
  assert.equal(PLAYER_CARD_PORTRAITS["kimodo-human-locomotion-review"], wretchPortrait);
});
