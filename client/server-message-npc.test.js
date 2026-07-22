import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNpc } from "./server-message-npc.js";

test("normalizes an NPC into the shared actor rendering shape", () => {
  const npc = normalizeNpc(
    {
      id: "maren",
      name: "Maren",
      x: 10,
      y: 20,
      color: "#766451",
      speech: { text: "The ledger is open.", untilTick: 80 },
    },
    "npc",
  );
  assert.equal(npc.id, "npc:maren");
  assert.equal(npc.npc, true);
  assert.equal(npc.speech.text, "The ledger is open.");
  assert.deepEqual(npc.inventory.items, []);
});

test("rejects malformed NPC ids and coordinates", () => {
  assert.throws(
    () => normalizeNpc({ id: "../maren", name: "Maren", x: 0, y: 0, color: "#000000" }, "npc"),
    /kebab-case/,
  );
  assert.throws(
    () => normalizeNpc({ id: "maren", name: "Maren", x: Number.NaN, y: 0, color: "#000000" }, "npc"),
    /finite/,
  );
});
