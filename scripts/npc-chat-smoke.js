import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { parseServerMessage } from "../client/server-messages.js";
import { createSteeringState, inputTowardTarget } from "./lib/ws-smoke-steering.js";

const args = parseArgs(process.argv.slice(2));
// mode canned: default zero-config path (no engine, canned responder).
// mode mock: cognition engine with the deterministic MockProvider (zero network).
const mode = args.mode ?? "canned";
if (!["canned", "mock"].includes(mode)) {
  throw new Error("--mode must be canned or mock");
}
const port = Number(args.port ?? (mode === "mock" ? 4136 : 4132));
const timeoutMs = Number(args.timeoutMs ?? 45000);
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const runtimeDir = path.resolve("var", "npc-chat-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

await mkdir(runtimeDir, { recursive: true });

let server = null;
let socket = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const session = await issueSession();
  const flow = await runChatFlow(session.sessionToken);
  const metrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_npc_say_frames_total",
    "sundermere_ws_messages_rejected_total",
  ]);
  const events = await fetchJson("/admin/events?limit=100");
  const spokeJournaled = events.some((event) => event.kind?.type === "playerSpokeToNpc");
  const saidJournaled = events.some(
    (event) => event.kind?.type === "npcSaid" && event.kind.source === "canned",
  );
  const outOfRangeJournaled = events.some(
    (event) =>
      event.kind?.type === "clientMessageRejected" &&
      event.kind.reason === "say_out_of_range",
  );
  const oversizedJournaled = events.some(
    (event) =>
      event.kind?.type === "clientMessageRejected" &&
      event.kind.reason?.startsWith("say-text-too-long"),
  );

  const expectedSource = mode === "mock" ? "live" : "canned";
  const saidWithSource = events.some(
    (event) => event.kind?.type === "npcSaid" && event.kind.source === expectedSource,
  );
  const mockStatusJournaled =
    mode !== "mock" ||
    events.some(
      (event) =>
        event.kind?.type === "npcCognitionStatusChanged" &&
        event.kind.status === "mock-only",
    );
  const mockDeclineJournaled =
    mode !== "mock" ||
    events.some((event) => event.kind?.type === "npcPartyDeclined");

  result = {
    mode,
    port,
    ...flow,
    spokeJournaled,
    saidJournaled: saidWithSource,
    outOfRangeJournaled,
    oversizedJournaled,
    mockStatusJournaled,
    mockDeclineJournaled,
    metrics,
    elapsedMs: round(performance.now() - startedAt),
  };
  result.ok =
    flow.firstReply.length > 0 &&
    flow.firstReplySource === expectedSource &&
    flow.secondReply.length > 0 &&
    flow.repliesFromMaren &&
    flow.noReplyFromBram &&
    flow.snapshotTickAdvanced &&
    (mode !== "mock" ||
      (flow.firstReply.includes("mock cognition") &&
        flow.secondReply.includes("turn 3") &&
        flow.marenDeclinedInvite)) &&
    spokeJournaled &&
    saidWithSource &&
    outOfRangeJournaled &&
    oversizedJournaled &&
    mockStatusJournaled &&
    mockDeclineJournaled &&
    metrics.sundermere_npc_say_frames_total >= 1;
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
    socket.close(1000, "npc-chat-smoke-complete");
  }
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

async function runChatFlow(sessionToken) {
  const target = new URL(wsUrl);
  target.searchParams.set("session", sessionToken);
  socket = new WebSocket(target);

  const flow = {
    playerId: null,
    firstReply: "",
    firstReplySource: null,
    secondReply: "",
    repliesFromMaren: true,
    noReplyFromBram: true,
    snapshotTickAdvanced: false,
    marenDeclinedInvite: false,
  };

  let phase = "approach";
  let seq = 0;
  let firstTickSeen = null;
  const steering = createSteeringState();
  const utterances = new Map(); // sayId -> { npcId, text, source }
  let completedReplies = 0;
  let awaitTimer = null;

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
      reject(new Error(`npc chat smoke timed out in phase '${phase}'`));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      if (awaitTimer) clearTimeout(awaitTimer);
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

      if (message.type === "npcSay") {
        if (message.npcId !== "maren") {
          flow.noReplyFromBram = false;
        }
        let entry = utterances.get(message.sayId);
        if (!entry) {
          entry = { npcId: message.npcId, text: "", source: message.source };
          utterances.set(message.sayId, entry);
        }
        entry.text += message.text;
        if (message.done) {
          completedReplies += 1;
          if (completedReplies === 1) {
            flow.firstReply = entry.text;
            flow.firstReplySource = entry.source;
            // Prove multi-turn: speak again after the first reply completes.
            socket.send(
              JSON.stringify({ type: "say", npcId: "maren", text: "And the north field?" }),
            );
            phase = "secondReply";
          } else if (completedReplies === 2) {
            flow.secondReply = entry.text;
            phase = "negativeCases";
            // Out-of-range target: bram is across the plaza.
            socket.send(
              JSON.stringify({ type: "say", npcId: "bram", text: "too far away" }),
            );
            // Oversized text: server-side cap is 240 chars.
            socket.send(
              JSON.stringify({ type: "say", npcId: "maren", text: "x".repeat(300) }),
            );
            // Neither should produce a reply; wait a beat, then finish
            // (canned) or test the engine's party decision (mock).
            awaitTimer = setTimeout(() => {
              flow.snapshotTickAdvanced = true;
              if (mode === "mock") {
                // Maren's persona is party-reluctant: the mock engine
                // declines and streams a decline line.
                socket.send(JSON.stringify({ type: "partyInvite", npcId: "maren" }));
                phase = "awaitDecline";
              } else {
                finish();
              }
            }, 2500);
          } else if (completedReplies === 3 && mode === "mock") {
            flow.marenDeclinedInvite = entry.npcId === "maren" && entry.text.length > 0;
            finish();
          }
        }
        return;
      }

      const snapshot = message.type === "welcome" ? message.snapshot : message;
      if (message.type === "welcome") {
        flow.playerId = message.playerId;
        firstTickSeen = snapshot.tick;
        return;
      }
      if (firstTickSeen != null && snapshot.tick <= firstTickSeen) {
        return;
      }

      if (phase !== "approach") return;
      const me = snapshot.players.find((player) => player.id === flow.playerId);
      const maren = snapshot.npcs.find((npc) => npc.id === "maren");
      if (!me || !maren) return;
      const gap = Math.hypot(maren.x - me.x, maren.y - me.y);
      if (gap <= 70) {
        sendInput({});
        socket.send(JSON.stringify({ type: "say", npcId: "maren", text: "  hello there  " }));
        phase = "firstReply";
        return;
      }
      const input = inputTowardTarget(steering, me, maren);
      sendInput({ ...input, interact: false });
    });
  });

  return flow;
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
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
      ...(mode === "mock" ? { ANIMUS_PROVIDER: "mock" } : {}),
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

async function fetchText(pathname) {
  const response = await fetch(`${httpUrl}${pathname}`);
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed: ${response.status}`);
  }
  return response.text();
}

function parseMetrics(body, names) {
  const metrics = {};
  for (const name of names) {
    const match = body.match(new RegExp(`^${name} (\\d+)$`, "m"));
    metrics[name] = match ? Number(match[1]) : null;
  }
  return metrics;
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
