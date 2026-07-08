import { performance } from "node:perf_hooks";

import { createResourceGatherContext, round } from "./resource-gather-smoke/config.js";
import { hasResourceJournalEvent } from "./resource-gather-smoke/journal.js";
import {
  issueSession,
  loadDemoTargets,
  sessionWebSocketUrl,
} from "./resource-gather-smoke/session.js";
import { hasWoodStack, runResourceGatherScenario } from "./resource-gather-smoke/websocket.js";

const context = createResourceGatherContext(process.argv.slice(2));
const startedAt = performance.now();
const demoTargets = await loadDemoTargets(context.wsUrl);
const session = await issueSession(context.wsUrl);
const scenario = await runResourceGatherScenario({
  socketUrl: sessionWebSocketUrl(context.wsUrl, session.sessionToken),
  timeoutMs: context.timeoutMs,
  demoTargets,
});
const journaled = scenario.error
  ? false
  : await hasResourceJournalEvent(context.wsUrl, scenario.playerId, scenario.gathered?.objectId);

const result = {
  url: context.url,
  sessionId: session.sessionId,
  playerId: scenario.playerId,
  identityMatched: session.sessionId === scenario.playerId,
  gathered: scenario.gathered,
  journaled,
  elapsedMs: round(performance.now() - startedAt),
  closed: scenario.closed,
  error: scenario.error?.message ?? null,
};

console.log(JSON.stringify(result, null, 2));

if (
  scenario.error ||
  !result.identityMatched ||
  !scenario.gathered ||
  !hasWoodStack(scenario.gathered) ||
  !journaled
) {
  process.exitCode = 1;
}
