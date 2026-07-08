import { createSteeringState, inputTowardTarget } from "../lib/ws-smoke-steering.js";

export async function runResourceGatherScenario({ socketUrl, timeoutMs, demoTargets }) {
  const state = {
    playerId: null,
    latestSnapshot: null,
    gathered: null,
    closed: false,
    error: null,
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
      socket.close(1000, "resource-gather-smoke-complete");
    }
  }

  return state;
}

export function hasWoodStack(gathered) {
  return (
    gathered.capacitySlots >= 1 &&
    gathered.items.some(
      (item) => item.itemId === "wood" && item.label === "Wood" && item.quantity >= 1,
    )
  );
}

async function runSocketSmoke({ socket, state, timeoutMs, demoTargets, steering, sendInput }) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("resource gather smoke timed out"));
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
      const target = targetFromSnapshot(state.latestSnapshot, demoTargets, "ancient-ironleaf-tree");
      if (!me || !target) return;

      if (me.resources?.wood > 0) {
        state.gathered = gatheredSummary(me, target);
        sendInput({});
        clearTimeout(timeout);
        resolve();
      } else {
        sendInput(inputTowardTarget(steering, me, target));
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

function targetFromSnapshot(snapshot, demoTargets, id) {
  return snapshot.objects.find((object) => object.id === id) ?? demoTargets[id];
}

function gatheredSummary(me, target) {
  return {
    objectId: target.id,
    wood: me.resources.wood,
    ore: me.resources.ore,
    capacitySlots: me.inventory?.capacitySlots,
    items: me.inventory?.items ?? [],
  };
}
