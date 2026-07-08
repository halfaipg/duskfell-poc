import { round } from "./config.js";
import { createSteeringState, inputTowardTarget } from "../lib/ws-smoke-steering.js";

export async function runCraftingScenario({ socketUrl, timeoutMs, demoTargets }) {
  const state = {
    playerId: null,
    latestSnapshot: null,
    crafted: null,
    closed: false,
    error: null,
    lastState: null,
  };
  const steering = createSteeringState();
  const socket = new WebSocket(socketUrl);
  let seq = 0;

  const sendInput = (input) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    seq += 1;
    socket.send(
      JSON.stringify({
        type: "input",
        seq,
        up: Boolean(input.up),
        down: Boolean(input.down),
        left: Boolean(input.left),
        right: Boolean(input.right),
        interact: Boolean(input.interact),
      }),
    );
  };

  try {
    await runSocketSmoke({ socket, state, timeoutMs, demoTargets, steering, sendInput });
  } catch (err) {
    state.error = err;
  } finally {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "crafting-smoke-complete");
    }
  }

  return state;
}

export function hasTrailKit(inventory) {
  return Boolean(
    inventory?.items?.some(
      (item) => item.itemId === "trail-kit" && item.label === "Trail Kit" && item.quantity >= 1,
    ),
  );
}

async function runSocketSmoke({ socket, state, timeoutMs, demoTargets, steering, sendInput }) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("crafting smoke timed out"));
    }, timeoutMs);

    socket.addEventListener("open", () => {
      sendInput({});
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        state.playerId = message.playerId;
        state.latestSnapshot = message.snapshot;
      } else if (message.type === "snapshot") {
        state.latestSnapshot = message;
      }

      if (!state.latestSnapshot || !state.playerId) return;
      const me = state.latestSnapshot.players.find((player) => player.id === state.playerId);
      if (!me) return;

      const targets = targetsFromSnapshot(state.latestSnapshot, demoTargets);
      if (hasTrailKit(me.inventory)) {
        state.crafted = craftedSummary(me, targets.forge);
        sendInput({});
        clearTimeout(timeout);
        resolve();
      } else if ((me.resources?.wood ?? 0) < 1) {
        moveToward(state, me, targets.wood, "gather-wood", steering, sendInput);
      } else if ((me.resources?.ore ?? 0) < 1) {
        moveToward(state, me, targets.ore, "gather-ore", steering, sendInput);
      } else {
        moveToward(state, me, targets.forge, "craft-trail-kit", steering, sendInput);
      }
    });

    socket.addEventListener("close", () => {
      state.closed = true;
    });

    socket.addEventListener("error", () => {
      reject(new Error("websocket error"));
    });
  });
}

function targetsFromSnapshot(snapshot, demoTargets) {
  return {
    wood: targetFromSnapshot(snapshot, demoTargets, "ancient-ironleaf-tree"),
    ore: targetFromSnapshot(snapshot, demoTargets, "east-ore"),
    forge: targetFromSnapshot(snapshot, demoTargets, "field-forge"),
  };
}

function targetFromSnapshot(snapshot, demoTargets, id) {
  return snapshot.objects.find((object) => object.id === id) ?? demoTargets[id];
}

function moveToward(state, me, target, action, steering, sendInput) {
  state.lastState = stateFor(me, target, action);
  sendInput(inputTowardTarget(steering, me, target));
}

function craftedSummary(me, forge) {
  return {
    objectId: forge.id,
    wood: me.resources?.wood,
    ore: me.resources?.ore,
    capacitySlots: me.inventory?.capacitySlots,
    items: me.inventory?.items ?? [],
  };
}

function stateFor(me, target, action) {
  return {
    action,
    player: {
      x: round(me.x),
      y: round(me.y),
      wood: me.resources?.wood ?? 0,
      ore: me.resources?.ore ?? 0,
      items: me.inventory?.items ?? [],
    },
    target: {
      id: target.id,
      x: round(target.x),
      y: round(target.y),
      distance: round(Math.hypot(target.x - me.x, target.y - me.y)),
    },
  };
}
