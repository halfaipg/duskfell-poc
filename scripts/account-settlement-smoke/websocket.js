export async function claimDeed(context, sessionToken) {
  const url = new URL(context.wsUrl);
  url.searchParams.set("session", sessionToken);
  const socket = new WebSocket(url);
  let seq = 0;
  let playerId = null;
  let snapshotAccountSubject = null;
  let claimedDeed = null;
  let confirmedReceipt = null;

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("account settlement smoke timed out")),
        8000,
      );

      socket.addEventListener("open", () => sendInput({}));
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        const snapshot = message.type === "welcome" ? message.snapshot : message;
        if (message.type === "welcome") {
          playerId = message.playerId;
        }
        if (!snapshot?.players || !playerId) return;

        const me = snapshot.players.find((player) => player.id === playerId);
        const registrar = snapshot.objects.find((object) => object.id === "registrar");
        if (!me || !registrar) return;
        snapshotAccountSubject = me.accountSubject ?? null;

        const deed = me.demoDeeds.find((assetId) => assetId.startsWith("dryrun-deed-"));
        if (deed) {
          claimedDeed = deed;
          sendInput({});
        } else {
          steerToward(me, registrar, sendInput);
        }

        const receipt = snapshot.settlement.latestReceipt;
        if (claimedDeed && receipt?.assetId === claimedDeed) {
          confirmedReceipt = receipt;
          clearTimeout(timeout);
          resolve();
        }
      });
      socket.addEventListener("close", () => {
        if (!confirmedReceipt) {
          clearTimeout(timeout);
          reject(new Error("websocket closed before account-bound receipt"));
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("websocket error"));
      });
    });
  } catch (err) {
    closeSocket(socket);
    throw err;
  }

  return {
    playerId,
    snapshotAccountSubject,
    claimedDeed,
    confirmedReceipt,
    close() {
      closeSocket(socket);
    },
  };

  function sendInput(input) {
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
  }
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(1000, "account-settlement-smoke-complete");
  }
}

function steerToward(me, target, sendInput) {
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const distance = Math.hypot(dx, dy);
  const interact = distance <= 58;
  sendInput({
    up: dy < -8 && !interact,
    down: dy > 8 && !interact,
    left: dx < -8 && !interact,
    right: dx > 8 && !interact,
    interact,
  });
}
