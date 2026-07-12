import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { parseServerMessage } from "../client/server-messages.js";
import { createSteeringState, inputTowardTarget } from "./lib/ws-smoke-steering.js";

const args = parseArgs(process.argv.slice(2));
// mode no-workers: empty model list, the probe degrades immediately.
// mode chat-broken: models answer but completions 500 — the provider must
// demote itself after repeated chat failures (observed AI Power Grid mode).
const mode = args.mode ?? "no-workers";
if (!["no-workers", "chat-broken"].includes(mode)) {
  throw new Error("--mode must be no-workers or chat-broken");
}
const port = Number(args.port ?? (mode === "chat-broken" ? 4139 : 4137));
const stubPort = Number(args.stubPort ?? (mode === "chat-broken" ? 4140 : 4138));
const timeoutMs = Number(args.timeoutMs ?? 45000);
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const runtimeDir = path.resolve("var", "cognition-fallback-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Deliberately conspicuous: must never appear on any ops surface.
const SENTINEL_KEY = "smoke-sentinel-animus-key-do-not-leak";
const RELOCATED_BRAM = { x: 2980, y: 2120 };

await mkdir(runtimeDir, { recursive: true });

// Provider stub: a grid with no workers (empty model list) whose chat
// endpoint 503s — the design's "provider down" posture.
let chatRequests = 0;
const stub = createServer((request, response) => {
  if (request.url?.startsWith("/v1/models")) {
    response.writeHead(200, { "content-type": "application/json" });
    const models = mode === "chat-broken" ? [{ id: "stub-model" }] : [];
    response.end(JSON.stringify({ data: models }));
    return;
  }
  chatRequests += 1;
  const status = mode === "chat-broken" ? 500 : 503;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "stub failure" }));
});
await new Promise((resolve) => stub.listen(stubPort, "127.0.0.1", resolve));

let server = null;
let socket = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const readyz = await fetchJsonWithStatus("/readyz");
  const cognitionCheck = readyz.body.checks?.find((check) => check.name === "npcCognition");
  const session = await issueSession();
  const flow = await runFallbackFlow(session.sessionToken);
  const metricsText = await fetchText("/metrics");
  const metrics = parseMetrics(metricsText, [
    "animus_fallbacks_total",
    "animus_provider_degraded",
  ]);
  const events = await fetchJson("/admin/events?limit=100");
  const adminRuntime = await fetchText("/admin/runtime");
  const declineJournaled = events.some((event) => event.kind?.type === "npcPartyDeclined");
  const degradedStatusJournaled = events.some(
    (event) =>
      event.kind?.type === "npcCognitionStatusChanged" &&
      event.kind.status?.includes("degraded"),
  );
  const chatDemotionJournaled =
    mode !== "chat-broken" ||
    events.some(
      (event) =>
        event.kind?.type === "npcCognitionStatusChanged" &&
        event.kind.status?.includes("chat completions failing"),
    );
  const keyLeaked =
    JSON.stringify(readyz.body).includes(SENTINEL_KEY) ||
    metricsText.includes(SENTINEL_KEY) ||
    adminRuntime.includes(SENTINEL_KEY) ||
    JSON.stringify(events).includes(SENTINEL_KEY);

  result = {
    mode,
    port,
    readyzStatus: readyz.status,
    ready: readyz.body.ready,
    npcCognitionOk: cognitionCheck?.ok ?? false,
    npcCognitionDetail: cognitionCheck?.detail ?? null,
    ...flow,
    declineJournaled,
    degradedStatusJournaled,
    chatDemotionJournaled,
    stubChatRequests: chatRequests,
    metrics,
    keyLeaked,
    elapsedMs: round(performance.now() - startedAt),
  };
  // In chat-broken mode the boot-time readiness is legitimately "live"
  // (models answer); the truth arrives via the demotion after chat fails.
  const readinessDetailOk =
    mode === "chat-broken" || String(cognitionCheck?.detail).includes("degraded");
  result.ok =
    readyz.status === 200 &&
    readyz.body.ready === true &&
    cognitionCheck?.ok === true &&
    readinessDetailOk &&
    flow.cannedReply.length > 0 &&
    flow.cannedReplySource === "canned" &&
    flow.inviteDeclined &&
    flow.bramRelocated &&
    declineJournaled &&
    degradedStatusJournaled &&
    chatDemotionJournaled &&
    (mode !== "chat-broken" || chatRequests >= 3) &&
    metrics.animus_fallbacks_total >= 1 &&
    metrics.animus_provider_degraded === 1 &&
    !keyLeaked;
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
    socket.close(1000, "cognition-fallback-smoke-complete");
  }
  if (server) {
    await stopServer(server);
  }
  stub.close();
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

async function runFallbackFlow(sessionToken) {
  const target = new URL(wsUrl);
  target.searchParams.set("session", sessionToken);
  socket = new WebSocket(target);
  socket.binaryType = "arraybuffer";

  const flow = {
    playerId: null,
    cannedReply: "",
    cannedReplySource: null,
    inviteDeclined: false,
    bramRelocated: false,
  };

  let phase = "approach";
  let seq = 0;
  const steering = createSteeringState();
  const utterances = new Map();
  let completedReplies = 0;
  let marenPartyObserved = false;

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
      reject(new Error(`cognition fallback smoke timed out in phase '${phase}'`));
    }, timeoutMs);
    let finishing = false;
    const maybeFinish = () => {
      const enoughReplies = mode !== "chat-broken" || completedReplies >= 3;
      if (flow.cannedReply && flow.inviteDeclined && flow.bramRelocated && enoughReplies) {
        if (finishing) return;
        finishing = true;
        // Give the demotion StatusChanged a beat to reach the journal.
        setTimeout(() => {
          clearTimeout(timeout);
          resolve();
        }, 1500);
      }
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
        let entry = utterances.get(message.sayId);
        if (!entry) {
          entry = { npcId: message.npcId, text: "", source: message.source };
          utterances.set(message.sayId, entry);
        }
        entry.text += message.text;
        if (message.done) {
          completedReplies += 1;
          if (completedReplies === 1) {
            // Degraded provider: the reply must be the canned fallback.
            flow.cannedReply = entry.text;
            flow.cannedReplySource = entry.source;
            socket.send(JSON.stringify({ type: "partyInvite", npcId: "maren" }));
            phase = "awaitDecline";
          } else if (completedReplies === 2 && mode === "chat-broken") {
            // Third cognition decision pushes past the demotion threshold.
            socket.send(JSON.stringify({ type: "say", npcId: "maren", text: "still there?" }));
          }
          maybeFinish();
        }
        return;
      }

      const snapshot = message.type === "welcome" ? message.snapshot : message;
      if (message.type === "welcome") {
        flow.playerId = message.playerId;
        return;
      }

      const bram = snapshot.npcs.find((npc) => npc.id === "bram");
      if (bram && Math.hypot(bram.x - RELOCATED_BRAM.x, bram.y - RELOCATED_BRAM.y) < 1) {
        flow.bramRelocated = true;
        maybeFinish();
      }
      const maren = snapshot.npcs.find((npc) => npc.id === "maren");
      if (phase === "awaitDecline" && maren) {
        if (maren.partyPlayerId != null) {
          marenPartyObserved = true;
        } else if (!marenPartyObserved && completedReplies >= 1) {
          // Invite never becomes a party: the degraded engine declines.
          // Give it a few snapshots before declaring the decline observed.
          flow.declineChecks = (flow.declineChecks ?? 0) + 1;
          if (flow.declineChecks >= 20) {
            flow.inviteDeclined = true;
            maybeFinish();
          }
        }
      }

      if (phase !== "approach") return;
      const me = snapshot.players.find((player) => player.id === flow.playerId);
      if (!me || !maren) return;
      const gap = Math.hypot(maren.x - me.x, maren.y - me.y);
      if (gap <= 70) {
        sendInput({});
        socket.send(JSON.stringify({ type: "say", npcId: "maren", text: "anyone home?" }));
        phase = "awaitCanned";
        return;
      }
      const input = inputTowardTarget(steering, me, maren);
      sendInput({ ...input, interact: false });
    });
  });

  delete flow.declineChecks;
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
      WORLD_DAY_SECONDS: "5",
      ANIMUS_API_KEY: SENTINEL_KEY,
      ANIMUS_BASE_URL: `http://127.0.0.1:${stubPort}`,
      RUST_LOG: "sundermere_server=warn,animus=warn,tower_http=warn",
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

async function fetchJsonWithStatus(pathname) {
  const response = await fetch(`${httpUrl}${pathname}`, {
    headers: { accept: "application/json" },
  });
  return { status: response.status, body: await response.json() };
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
