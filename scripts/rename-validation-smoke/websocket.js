export async function runRenameFlow(context, sessionToken, expectedPlayerId) {
  const url = new URL(context.wsUrl);
  url.searchParams.set("session", sessionToken);
  const socket = new WebSocket(url);
  let playerId = null;
  let spawnNameObserved = false;
  let validRenameObserved = false;
  let invalidRenameSent = false;
  let invalidRenamePreservedName = false;
  let snapshotsAfterInvalid = 0;

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("rename validation smoke timed out"));
      }, context.timeoutMs);

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "rename", name: context.validName }));
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === "welcome") {
          playerId = message.playerId;
          const me = message.snapshot.players.find((player) => player.id === playerId);
          spawnNameObserved = me?.name === context.spawnName;
          return;
        }
        if (message.type !== "snapshot" || !playerId) return;

        const me = message.players.find((player) => player.id === playerId);
        if (!me) return;

        if (!validRenameObserved && me.name === context.validName) {
          validRenameObserved = true;
          socket.send(JSON.stringify({ type: "rename", name: context.invalidName }));
          invalidRenameSent = true;
          return;
        }

        if (invalidRenameSent) {
          snapshotsAfterInvalid += 1;
          if (me.name === context.validName) {
            invalidRenamePreservedName = true;
          }
          if (snapshotsAfterInvalid >= 2) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });

      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("websocket error"));
      });
      socket.addEventListener("close", () => {
        clearTimeout(timeout);
        reject(new Error("websocket closed before rename validation completed"));
      });
    });
  } catch (err) {
    closeSocket(socket);
    throw err;
  }

  return {
    sessionId: expectedPlayerId,
    playerId,
    identityMatched: playerId === expectedPlayerId,
    spawnNameObserved,
    validRenameObserved,
    invalidRenamePreservedName,
    close() {
      closeSocket(socket);
    },
  };
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(1000, "rename-validation-smoke-complete");
  }
}
