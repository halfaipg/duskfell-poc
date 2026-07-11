import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { parseServerMessage } from "../client/server-messages.js";
import { createSteeringState, inputTowardTarget } from "./lib/ws-smoke-steering.js";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4131);
const timeoutMs = Number(args.timeoutMs ?? 45000);
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const runtimeDir = path.resolve("var", "npc-render-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Short world day so bram's scheduled relocation fires within the smoke.
const WORLD_DAY_SECONDS = "5";
const RELOCATED_BRAM = { x: 1560, y: 1160 };

await mkdir(runtimeDir, { recursive: true });

let server = null;
let socket = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const session = await issueSession();
  const flow = await runNpcFlow(session.sessionToken, session.sessionId);
  const events = await fetchJson("/admin/events?limit=100");
  const eventTypes = new Set(events.map((event) => event.kind?.type));

  result = {
    port,
    ...flow,
    partyInviteJournaled: eventTypes.has("npcPartyInvited"),
    partyJoinJournaled: eventTypes.has("npcPartyJoined"),
    partyLeaveJournaled: eventTypes.has("npcPartyLeft"),
    relocationJournaled: eventTypes.has("npcRelocated"),
    elapsedMs: round(performance.now() - startedAt),
  };
  result.ok =
    flow.welcomeNpcIds.includes("maren") &&
    flow.welcomeNpcIds.includes("bram") &&
    flow.partyJoined &&
    flow.marenFollowed &&
    flow.maxFollowSeparation <= 220 &&
    flow.partyLeft &&
    flow.marenStoppedAfterLeave &&
    flow.bramRelocated &&
    result.partyInviteJournaled &&
    result.partyJoinJournaled &&
    result.partyLeaveJournaled &&
    result.relocationJournaled;
} catch (err) {
  result = {
    port,
    ok: false,
    error: err.message,
    serverExitCode: server?.exitCode ?? null,
    elapsedMs: round(performance.now() - startedAt),
  };
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(1000, "npc-render-smoke-complete");
  }
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

async function runNpcFlow(sessionToken, sessionId) {
  const target = new URL(wsUrl);
  target.searchParams.set("session", sessionToken);
  socket = new WebSocket(target);

  const flow = {
    playerId: null,
    identityMatched: false,
    welcomeNpcIds: [],
    partyJoined: false,
    marenFollowed: false,
    maxFollowSeparation: 0,
    partyLeft: false,
    marenStoppedAfterLeave: false,
    bramRelocated: false,
  };

  let phase = "approach";
  let seq = 0;
  let marenHome = null;
  let followSnapshots = 0;
  let stillSnapshots = 0;
  let lastMaren = null;
  const steering = createSteeringState();

  const sendInput = (input) => {
    seq += 1;
    socket.send(
      JSON.stringify({
        type: "input",
        seq,
        up: false,
        down: false,
        left: false,
        right: false,
        interact: false,
        ...input,
      }),
    );
  };

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`npc smoke timed out in phase '${phase}'`));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket error"));
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = parseServerMessage(event.data);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
        return;
      }
      if (message.type === "notice") return;

      const snapshot = message.type === "welcome" ? message.snapshot : message;
      if (message.type === "welcome") {
        flow.playerId = message.playerId;
        flow.identityMatched = message.playerId === sessionId;
        flow.welcomeNpcIds = snapshot.npcs.map((npc) => npc.id).sort();
        marenHome = snapshot.npcs.find((npc) => npc.id === "maren") ?? null;
        if (!marenHome) {
          clearTimeout(timeout);
          reject(new Error("maren missing from welcome snapshot"));
          return;
        }
        return;
      }

      const me = snapshot.players.find((player) => player.id === flow.playerId);
      const maren = snapshot.npcs.find((npc) => npc.id === "maren") ?? null;
      const bram = snapshot.npcs.find((npc) => npc.id === "bram") ?? null;
      if (args.debug && snapshot.tick % 20 === 0) {
        console.error(
          `phase=${phase} tick=${snapshot.tick} bram=${bram ? `(${bram.x},${bram.y})` : "missing"} relocated=${flow.bramRelocated}`,
        );
      }
      if (
        bram &&
        Math.hypot(bram.x - RELOCATED_BRAM.x, bram.y - RELOCATED_BRAM.y) < 1
      ) {
        flow.bramRelocated = true;
      }
      if (!me) return;

      if (phase === "approach") {
        if (!maren) return;
        const gap = Math.hypot(maren.x - me.x, maren.y - me.y);
        if (gap <= 70) {
          sendInput({});
          socket.send(JSON.stringify({ type: "partyInvite", npcId: "maren" }));
          phase = "awaitJoin";
          return;
        }
        sendInput(steerToward(steering, me, maren));
      } else if (phase === "awaitJoin") {
        if (maren?.partyPlayerId === flow.playerId) {
          flow.partyJoined = true;
          phase = "walkAway";
        }
      } else if (phase === "walkAway") {
        if (!maren) return;
        const separation = Math.hypot(maren.x - me.x, maren.y - me.y);
        if (args.debug && snapshot.tick % 20 === 0) {
          console.error(
            `walkAway tick=${snapshot.tick} me=(${me.x.toFixed(0)},${me.y.toFixed(0)}) maren=(${maren.x.toFixed(0)},${maren.y.toFixed(0)}) sep=${separation.toFixed(0)} follow=${followSnapshots}`,
          );
        }
        flow.maxFollowSeparation = round(
          Math.max(flow.maxFollowSeparation, separation),
        );
        const waypoint = { x: 1380, y: 1240 };
        const remaining = Math.hypot(waypoint.x - me.x, waypoint.y - me.y);
        if (remaining <= 60) {
          sendInput({});
        } else {
          sendInput(steerToward(steering, me, { id: "waypoint", ...waypoint }));
        }
        // Success = maren left home and is trailing the player, sustained
        // over several snapshots. Reaching the exact waypoint is not required.
        const marenMoved =
          marenHome && Math.hypot(maren.x - marenHome.x, maren.y - marenHome.y) > 60;
        if (marenMoved && separation <= 220) {
          followSnapshots += 1;
        } else {
          followSnapshots = 0;
        }
        if (followSnapshots >= 5) {
          flow.marenFollowed = true;
          // Stop walking before leaving the party: velocity persists server-side
          // until the next input, and the player must stay near bram's
          // relocation target to observe it.
          sendInput({});
          socket.send(JSON.stringify({ type: "partyLeave", npcId: "maren" }));
          phase = "afterLeave";
          lastMaren = null;
          stillSnapshots = 0;
        }
      } else if (phase === "afterLeave") {
        if (!maren) return;
        if (maren.partyPlayerId == null) {
          flow.partyLeft = true;
        }
        if (
          flow.partyLeft &&
          lastMaren &&
          Math.hypot(maren.x - lastMaren.x, maren.y - lastMaren.y) < 0.01
        ) {
          stillSnapshots += 1;
        } else if (flow.partyLeft) {
          stillSnapshots = 0;
        }
        lastMaren = { x: maren.x, y: maren.y };
        if (stillSnapshots >= 5) {
          flow.marenStoppedAfterLeave = true;
          phase = "awaitRelocation";
        }
      } else if (phase === "awaitRelocation") {
        if (flow.bramRelocated) {
          finish();
        }
      }
    });
  });

  return flow;
}

function steerToward(steering, me, target) {
  // Reuse the shared stall-nudging steering, but never trigger interact —
  // this smoke must not claim deeds or gather while walking.
  const input = inputTowardTarget(steering, me, target);
  return { ...input, interact: false };
}

async function startServer() {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      REQUIRE_SESSION: "true",
      WORLD_DAY_SECONDS,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth(child);
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000).then(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

async function waitForHealth(child) {
  const deadline = performance.now() + 60000;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${httpUrl}/healthz`);
      if (response.ok && (await response.text()) === "ok") {
        return;
      }
    } catch {
      // Retry until the startup deadline.
    }
    await sleep(120);
  }
  throw new Error(`server did not become healthy on ${httpUrl}`);
}

async function issueSession() {
  const response = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`session issue failed: ${response.status}`);
  }
  return response.json();
}

async function fetchJson(pathname) {
  const response = await fetch(`${httpUrl}${pathname}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed: ${response.status}`);
  }
  return response.json();
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? rawArgs[index + 1];
    if (inlineValue == null) index += 1;
  }
  return parsed;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
