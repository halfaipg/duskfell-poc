import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createReplayContext, round } from "./gameplay-journal-replay-smoke/config.js";
import { fetchJson, runCraftingSmoke, waitForGameplayEvents } from "./gameplay-journal-replay-smoke/http.js";
import {
  eventSequences,
  eventsAreOrdered,
  findGameplayEvents,
  hasAllGameplayEvents,
} from "./gameplay-journal-replay-smoke/journal.js";
import { resourceNodesMatch, resourceNodeSummary } from "./gameplay-journal-replay-smoke/resources.js";
import { startServer, stopServer } from "./gameplay-journal-replay-smoke/server.js";

const context = createReplayContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer(context);
  const crafting = await runCraftingSmoke(context);
  const beforeRestart = await waitForGameplayEvents(context, crafting.playerId);
  const beforeRestartNodes = resourceNodeSummary(await fetchJson(context, "/api/snapshot"));
  await stopServer(server);
  server = null;

  server = await startServer(context);
  const [afterRestartSummary, replayedEvents, afterRestartSnapshot] = await Promise.all([
    fetchJson(context, "/admin/summary"),
    fetchJson(context, "/admin/events?limit=50"),
    fetchJson(context, "/api/snapshot"),
  ]);
  const afterRestart = findGameplayEvents(replayedEvents, crafting.playerId);
  const afterRestartNodes = resourceNodeSummary(afterRestartSnapshot);

  result = {
    port: context.port,
    journalPath: context.journalPath,
    playerId: crafting.playerId,
    crafted: crafting.crafted,
    beforeRestartSequences: eventSequences(beforeRestart),
    afterRestartJournalEvents: afterRestartSummary.journalEvents,
    afterRestartJournalReplayedTotalEvents: afterRestartSummary.journalReplayedTotalEvents,
    afterRestartJournalLastSequence: afterRestartSummary.journalLastSequence,
    afterRestartSequences: eventSequences(afterRestart),
    beforeRestartNodes,
    afterRestartNodes,
    elapsedMs: round(performance.now() - startedAt),
    ok: Boolean(
      crafting.identityMatched &&
        crafting.journaled &&
        hasAllGameplayEvents(beforeRestart) &&
        hasAllGameplayEvents(afterRestart) &&
        eventsAreOrdered(afterRestart) &&
        resourceNodesMatch(beforeRestartNodes, afterRestartNodes) &&
        afterRestartSummary.journalReplayedTotalEvents >= 5 &&
        afterRestartSummary.journalLastSequence >= afterRestart.craft.sequence,
    ),
  };
} finally {
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}
