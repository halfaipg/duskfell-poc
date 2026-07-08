import { performance } from "node:perf_hooks";

import { createCraftingContext, round } from "./crafting-smoke/config.js";
import { hasCraftJournalEvent } from "./crafting-smoke/journal.js";
import { issueSession, loadDemoTargets, sessionWebSocketUrl } from "./crafting-smoke/session.js";
import { hasTrailKit, runCraftingScenario } from "./crafting-smoke/websocket.js";

const context = createCraftingContext(process.argv.slice(2));
const startedAt = performance.now();
const demoTargets = await loadDemoTargets(context.wsUrl);
const session = await issueSession(context.wsUrl);
const scenario = await runCraftingScenario({
  socketUrl: sessionWebSocketUrl(context.wsUrl, session.sessionToken),
  timeoutMs: context.timeoutMs,
  demoTargets,
});
const journaled = scenario.error
  ? false
  : await hasCraftJournalEvent(context.wsUrl, scenario.playerId, scenario.crafted?.objectId);

const result = {
  url: context.url,
  sessionId: session.sessionId,
  playerId: scenario.playerId,
  identityMatched: session.sessionId === scenario.playerId,
  crafted: scenario.crafted,
  journaled,
  lastState: scenario.lastState,
  elapsedMs: round(performance.now() - startedAt),
  closed: scenario.closed,
  error: scenario.error?.message ?? null,
};

console.log(JSON.stringify(result, null, 2));

if (
  scenario.error ||
  !result.identityMatched ||
  !scenario.crafted ||
  !hasTrailKit(scenario.crafted) ||
  scenario.crafted.wood !== 0 ||
  scenario.crafted.ore !== 0 ||
  !journaled
) {
  process.exitCode = 1;
}
