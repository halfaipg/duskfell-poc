# Architecture

## Current PoC

The PoC is intentionally small but shaped around the production constraints:

- `server/src/sim.rs` is the authoritative simulation. It uses `bevy_ecs` for entities and components, ticks at 20 Hz, and accepts client input rather than client positions.
- WebSocket clients receive interest-filtered snapshots around their own player; `/api/snapshot` remains a full debug/admin snapshot, is protected by `ADMIN_TOKEN` whenever one is configured, and has its own serialized response cap.
- `server/src/spatial.rs` provides the current grid spatial index used for nearby player/object snapshot queries.
- `/healthz` is a liveness check; `/readyz` reports deploy/load-balancer readiness from loaded content, settlement queue state/capacity, journal/outbox files and their parent directories, durable append failure counters, WebSocket capacity, and strict-session ticket capacity.
- `/admin/runtime` is a token-protected runtime report for the running build: Duskfell/Base `$DUSK` identity, server crate/version, optional build Git SHA, content manifest, sprite manifest pins, terrain manifest pins, and server-verified asset hash state.
- `server/src/metrics.rs` exposes lightweight WebSocket, payload-size, interest-filtered snapshot visibility, admission rejection, and tick-timing counters, and `/metrics` adds runtime gauges for sim tick/player count, tick budget/duration/overruns, settlement state, content object count, journal/outbox size, session ticket capacity, and admission config.
- `scripts/verify-ci.js` is the clean-checkout gate run by GitHub Actions. It keeps locked Rust builds, projection/asset manifest checks, runtime asset integrity, deployment preflight, readiness, and metrics smokes on every branch update.
- `scripts/verify-local.js` runs the broad local gate across unit tests and isolated runtime smokes.
- `Dockerfile` builds a release server image with bundled original client/assets/content, non-root runtime user, `/data` JSONL state, `/readyz` healthcheck, and an OCI revision label matching the compile-time `GIT_SHA`. `scripts/container-smoke.js` builds and runs that image with public-mode guardrails before treating it as deployable.
- `scripts/supply-chain-smoke.js` verifies local dependency posture from `package.json`, workspace Cargo metadata, `Cargo.lock`, and the locked active Rust build graph.
- `scripts/deployment-preflight.js` checks deployment environment profiles before boot. The default `shared-poc` profile must pass for hardened shared demos, while the `production` profile intentionally fails until account identity, durable state, signer/indexer, and cross-process admission/rate-limit services exist.
- `scripts/bad-config-smoke.js` verifies invalid environment config fails startup.
- `scripts/external-bind-guard-smoke.js` verifies non-loopback bind addresses require explicit public deployment mode.
- `scripts/content-schema-smoke.js` verifies unsupported world content schema fails startup.
- `scripts/content-size-smoke.js` verifies oversized world content fails startup before serving traffic.
- `scripts/durable-size-smoke.js` verifies oversized journal and settlement outbox files fail startup before serving traffic.
- `scripts/durable-corruption-smoke.js` verifies malformed journal JSONL, oversized durable JSONL lines, and malformed or semantically invalid settlement outbox JSONL fail startup before serving traffic.
- `scripts/durable-sync-smoke.js` verifies `DURABLE_SYNC_WRITES=true` is visible in admin/metrics and still preserves real journal plus settlement outbox appends during a deed claim.
- `scripts/ws-load-smoke.js` provides a repeatable WebSocket load smoke for client count, snapshot throughput, payload size, and join latency.
- `scripts/client-protocol-smoke.js` verifies a live server welcome/snapshot parses through the same browser-side protocol normalizer used by `client/app.js`, catching server/client contract drift before the page renders blank.
- `scripts/account-auth-smoke.js` verifies `REQUIRE_ACCOUNT=true` in temporary dev-token mode rejects missing or invalid bearer account tokens before `/api/session` parses request bodies or mints tickets.
- `scripts/account-jwt-auth-smoke.js` verifies `ACCOUNT_AUTH_MODE=jwt-hs256` rejects missing, wrongly signed, expired, wrong-audience, and empty-subject JWT bearer tokens before ticket issuance, then binds an accepted JWT subject into the issued session ticket.
- `scripts/account-session-rate-limit-smoke.js` verifies `ACCOUNT_SESSION_RATE_LIMIT_*` throttles authenticated JWT ticket issuance per account subject independently of the client-IP limiter.
- `scripts/account-settlement-smoke.js` verifies an accepted JWT subject reaches the player snapshot, ownership journal events, settlement receipt, and `/admin/ownership` after a deed claim.
- `scripts/admin-auth-smoke.js` verifies token-protected admin/debug endpoints in an isolated server process.
- `scripts/runtime-manifest-smoke.js` verifies `/admin/runtime` is protected and matches the checked sprite and terrain manifests.
- `scripts/runtime-asset-integrity-smoke.js` verifies corrupted asset bytes, over-budget asset images, and over-budget asset manifests fail server startup before the shard listens.
- `scripts/admin-events-limit-smoke.js` verifies admin event responses are capped and can be read through a bounded `after=<sequence>` cursor over the retained journal window.
- `scripts/admin-snapshot-size-smoke.js` verifies the full debug/admin snapshot response is capped and surfaced in metrics.
- `scripts/metrics-auth-smoke.js` verifies token-protected metrics scraping in an isolated server process.
- `scripts/metrics-smoke.js` verifies the Prometheus surface exposes parseable runtime state and reflects session ticket issuance.
- `scripts/movement-authority-smoke.js` verifies cardinal and diagonal client input travel at the same server-authoritative speed budget.
- `scripts/resource-gather-smoke.js` verifies session issuance, WebSocket movement, server-authoritative grove interaction, bounded inventory stack mutation, resource summary projection, and admin-journal visibility for resource gathering.
- `scripts/crafting-smoke.js` verifies session issuance, interest-filtered movement across multiple interaction targets, server-authoritative recipe consumption, crafted inventory output, and admin-journal visibility for crafting.
- `scripts/readiness-smoke.js` verifies `/readyz` returns ready on boot with durable file, parent-directory, and durable persistence health checks passing, then flips to unavailable when strict-session admission capacity is saturated.
- `scripts/public-deployment-smoke.js` verifies `PUBLIC_DEPLOYMENT=true` refuses unsafe local defaults and starts only when session, account-token, Origin, admin-token, and metrics-token guardrails are configured.
- `scripts/chain-public-guard-smoke.js` verifies public deployment refuses `CHAIN_ENABLED=true` until a real signer/indexer path exists.
- `scripts/chain-local-stub-smoke.js` verifies local `CHAIN_ENABLED=true` receipts remain explicit `needs-signer` stubs with no chain transaction hash.
- `scripts/session-capacity-smoke.js` verifies pending session ticket admission and visibility.
- `scripts/session-expiry-smoke.js` verifies expired unconsumed session tickets are cleaned before pending-ticket capacity decisions.
- `scripts/session-expired-ws-smoke.js` verifies an expired ticket is rejected before WebSocket upgrade and before player spawn.
- `scripts/session-rate-limit-smoke.js` verifies per-client-IP session issue throttling and visibility.
- `scripts/rename-validation-smoke.js` verifies ticket-bound spawn names and later player-submitted rename messages are bounded, normalized, pending/active-shard unique, and rejected without mutation when invalid.
- `scripts/snapshot-interval-smoke.js` verifies the per-client snapshot cadence can be tuned and observed.
- `scripts/journal-anomaly-smoke.js` verifies startup surfaces durable journal sequence anomalies without blocking replay.
- `scripts/journal-replay-smoke.js` verifies JSONL journal events are replayed into admin inspection after restart.
- `scripts/gameplay-journal-replay-smoke.js` verifies gameplay-affecting gather and craft events survive a JSONL journal restart and replay in sequence for the same server-issued player identity.
- `scripts/settlement-idempotency-smoke.js` verifies duplicated queued/confirmed outbox events do not double-count pending jobs, confirmed receipts, or ownership after replay.
- `scripts/ws-idle-timeout-smoke.js` verifies stale WebSocket connections are evicted and surfaced in metrics.
- `scripts/deed-claim-smoke.js` provides an end-to-end smoke for session issuance, WebSocket input, registrar interaction, settlement confirmation, and snapshot reconciliation.
- `scripts/restart-reconciliation-smoke.js` starts an isolated server, claims a deed, restarts from the same JSONL outbox, and verifies the admin ownership index is rebuilt.
- `scripts/shutdown-smoke.js` verifies the server responds to SIGTERM with graceful shutdown.
- `scripts/ws-binary-reject-smoke.js` verifies non-protocol binary WebSocket frames are rejected, journaled, and closed.
- `scripts/ws-payload-metrics-smoke.js` verifies observed WebSocket payload sizes match `/metrics` last/max message and snapshot byte gauges.
- `scripts/ws-reject-limit-smoke.js` verifies repeatedly rejected text messages close the WebSocket at the configured per-connection budget.
- `server/src/content.rs` validates versioned original world content loaded from `server/data/world.json` and produces an admin-visible content manifest.
- The server loads checked sprite and terrain manifest metadata at startup, caps manifest JSON with `MAX_RUNTIME_MANIFEST_BYTES`, verifies referenced PNG bytes against their SHA-256 pins before binding, caps each checked image with `MAX_RUNTIME_ASSET_BYTES`, and exposes schema, projection, image pins, verification state, byte caps, approval state, byte sizes, and manifest fingerprints through `/admin/runtime` for deploy audit.
- `server/src/journal.rs` records append-only gameplay and ownership-affecting events for inspection and later durable persistence.
- `server/src/persistence.rs` appends journal events to JSONL, can call `sync_data()` after flush when `DURABLE_SYNC_WRITES=true`, enforces configured durable-file and per-line byte ceilings before replay, and replays the retained recent window into the admin-visible journal on boot while preserving sequence continuity from the full durable file and surfacing non-increasing sequence anomalies.
- `server/src/settlement.rs` uses a JSONL settlement outbox so queued ownership jobs, including optional JWT account subjects, are recorded before entering the async worker and replayed on boot if still unconfirmed. Worker handoff is non-blocking after the durable append; full or closed in-process queues are counted and surfaced through readiness, metrics, and admin summary instead of stalling the sim tick. It shares the same optional synced-write mode and per-line replay cap as the journal. Confirmed receipts seed an in-memory ownership index for admin reconciliation.
- `server/src/protocol.rs` defines the wire protocol shared by the WebSocket server and browser client.
- `server/src/session.rs` issues short-lived, single-use capability tickets before WebSocket spawn and can carry an authenticated JWT account subject into the spawned player identity.
- A WebSocket admission semaphore enforces `MAX_ACTIVE_CONNECTIONS` before player entities are spawned.
- The WebSocket loop sends heartbeat pings and closes stale connections that stop sending client frames or pong responses within `WS_IDLE_TIMEOUT_SECONDS`.
- `server/src/settlement.rs` is an async settlement worker with an in-memory ledger. It models the Base settlement process without holding keys or blocking gameplay.
- `client/` is a static browser client. It renders snapshots and sends input only.
- `client/projection.js` and `client/camera.js` keep the browser view on a 64x64 1:1 military/plan-oblique tile contract with uniform camera scale, so viewport changes crop or zoom the scene without stretching it into 2:1 dimetric isometric art.
- `client/terrain.js` generates deterministic per-corner terrain heights and split triangle facets. The renderer shades those facets over the checked atlas frames, preserving the UO-inspired height-tile model while keeping server-side terrain authority separate from browser visuals.

## Ownership Flow

1. Player presses interact near the Title Office.
2. The sim validates position and current ownership.
3. The deed is added to the player's live game state immediately.
4. The sim emits a settlement job, including the authenticated account subject when the player came from JWT account mode.
5. The server appends the settlement job to the durable outbox.
6. The server records an ownership event in the append-only journal.
7. The settlement worker confirms a dry-run receipt asynchronously and appends the receipt to the outbox.
8. The settlement ledger indexes the latest confirmed receipt per asset ID, preserving the account subject for admin reconciliation.
9. Snapshots expose pending, confirmed, and owned-asset counts; `/admin/ownership` exposes the receipt-backed ownership index.

This models the intended invariant: chain settlement never blocks live movement, combat, inventory, NPCs, or world simulation.

The intended Base-chain brand direction is Duskfell with `$DUSK` reserved as the future ticker. This PoC does not mint `$DUSK`; token work should wait for durable account identity, signer isolation, indexer reconciliation, treasury controls, and legal review.

## Resource Flow

1. Player presses interact near an original grove or ore object.
2. The sim validates position against the server-owned object index.
3. The sim increments the player's bounded inventory stack; the client never submits resource or inventory deltas.
4. Snapshots expose both the inventory stack list and a derived wood/ore summary.
5. The server appends a `resourceGathered` event to the journal so gameplay-affecting gathers are audit-visible.

## Crafting Flow

1. Player presses interact near the Field Forge.
2. The sim validates position against the server-owned forge object.
3. The sim checks the server inventory for the Trail Kit recipe, currently `1 wood + 1 ore`.
4. If ingredients are present and the output stack can accept the item, the sim consumes the ingredients and adds the crafted stack.
5. Snapshots expose the resulting inventory list and the derived resource summary.
6. The server appends an `itemCrafted` event to the journal so gameplay-affecting item creation is audit-visible.

These loops are deliberately small, but they establish the production invariant for future economy and containers: inventory is server-authoritative gameplay state, not client-local UI state.

Settlement replay is idempotent by job ID. Duplicate `JobQueued` or `JobConfirmed` outbox records are tolerated during replay, late queued records for already-confirmed jobs are ignored, and the admin ownership index is rebuilt from all unique confirmed receipts while the recent confirmed receipt window remains bounded.

## Production Split

The first production split should extract `settlement.rs` into a separate process:

- Input: signed settlement jobs from a durable queue.
- Output: transaction status and indexed ownership receipts.
- Secrets: contract signer keys live only in the settlement service.
- Reads: gameplay services read indexed database state, not RPC endpoints.

The second split should introduce durable state:

- Postgres for accounts, characters, inventory, land, settlement jobs, and receipts.
- Redis for sessions, rate limits, presence, and hot spatial partitions.
- Append-only audit tables for ownership-affecting actions.

The current JSONL journal, settlement outbox, and in-memory ownership index are stepping stones, not the final data store. They already exercise append/replay behavior, optional flush-plus-`sync_data()` appends with `DURABLE_SYNC_WRITES`, gameplay-event replay evidence for gather/craft, bounded in-memory inspection, strict malformed-line and invalid-outbox startup rejection, startup byte ceilings with `MAX_JOURNAL_BYTES` and `MAX_SETTLEMENT_OUTBOX_BYTES`, and per-record replay ceilings with `MAX_DURABLE_LINE_BYTES`, but should migrate to Postgres append-only tables with unique event IDs, transactionally-created settlement jobs, indexed ownership state, and explicit replay tooling before any public test.

## Content Pipeline

Current world content is small JSON by design. Production content should keep the same principle:

- project-owned original data only
- schema validation before boot
- required gameplay content contracts before boot, including the `registrar` and `field-forge` objects and their object kinds
- map-bounds validation before boot, including safe-zone radius and object footprints
- configured object-count caps before boot
- explicit `schemaVersion` and admin-visible content hash for each running server
- no emulator data, copied maps, copied item tables, or compatibility constants
- deploy-time content checks in CI
- versioned migrations for durable world state

## Networking

This PoC uses WebSocket because it runs everywhere with minimal deployment friction. A production client can add WebTransport behind a transport interface once HTTP/3 infrastructure is ready. The server protocol should remain input/snapshot oriented either way.

The WebSocket protocol is JSON text only. Binary frames are treated as unsupported client traffic, recorded as rejected messages, and closed so non-protocol traffic cannot keep shard capacity alive.

Each WebSocket also tracks rejected text messages. `WS_MAX_TEXT_BYTES`, `WS_MESSAGE_BURST`, and `WS_MESSAGE_REFILL_PER_SECOND` control per-socket text-frame and message-rate limits; `CLIENT_REJECT_LIMIT` closes a connection after repeated malformed JSON, stale input sequence, oversized, rate-limited, or invalid rename messages so bad clients do not linger until idle timeout.

Movement is server-authoritative intent processing. Clients submit direction booleans, not positions; the sim computes velocity, clamps map bounds, checks the validated terrain profile for walkable material and maximum height step, and normalizes diagonal input so combined horizontal/vertical movement does not exceed the cardinal speed budget.

`SNAPSHOT_INTERVAL_MS` controls per-client snapshot cadence independently of the 20 Hz authoritative sim tick. Production can tune this per shard or client tier to control bandwidth and serialization cost without changing simulation correctness.

`INTEREST_RADIUS` controls the WebSocket snapshot radius around each player. The default is `520` world units. Lower values reduce payload size and object/player fanout; `/api/snapshot` remains full-world and admin/debug only. `/metrics` reports total outbound WebSocket bytes plus last/max serialized message and snapshot byte sizes so shard operators can see payload growth before it becomes a capacity issue.

`MAX_SNAPSHOT_BYTES` caps serialized welcome/snapshot payloads. If a crowded interest area or future content expansion exceeds the configured byte budget, the server increments `sundermere_ws_snapshot_payload_rejected_total` and closes that connection instead of sending a runaway payload.

`MAX_ADMIN_SNAPSHOT_BYTES` separately caps the full debug/admin `/api/snapshot` response. If future world growth makes the full snapshot too large, the server returns `413` and increments `sundermere_admin_snapshot_payload_rejected_total` instead of emitting an unbounded admin response.

The browser first requests `POST /api/session`, then connects to `/ws?session=...`. Ticketed WebSocket connections use the issued `sessionId` as the spawned `playerId`, which keeps welcome messages, journal events, and settlement jobs tied to one server-issued identity. `POST /api/session` can include a JSON `name`; the server trims and validates it with the same bounded ASCII player-name rule used for later renames, rejects pending ticket and active-shard name collisions case-insensitively, stores the accepted display name inside the one-use ticket, and applies it only when the ticket is consumed by the WebSocket spawn. The spawn path re-checks active-name uniqueness in case a ticket was delayed while another player claimed the same visible name. In local default mode the server still permits anonymous WebSocket spawn for iteration and benchmark compatibility; those anonymous dev spawns receive random player IDs. In shared environments, run with `REQUIRE_SESSION=true` so every WebSocket spawn consumes a valid ticket before a player entity is created.

`REQUIRE_ACCOUNT=true` adds an account-auth gate in front of session ticket issuance. `ACCOUNT_AUTH_MODE=dev-token` uses `Authorization: Bearer <DEV_ACCOUNT_TOKEN>` as a temporary shared-secret gate for demos and intentionally has no durable account subject. `ACCOUNT_AUTH_MODE=jwt-hs256` validates signed JWT bearer tokens with required `sub` and `exp` claims, optional issuer/audience checks, and binds the accepted bounded printable `sub` into the issued session ticket. Ticketed WebSocket spawn carries that subject into the player snapshot and any ownership-affecting settlement job, receipt, journal event, and ownership-index entry. This proves session issuance can fail closed behind account authentication and carry account identity forward before the project swaps in managed OAuth/JWKS or wallet auth and durable character ownership.

`SESSION_ISSUE_RATE_LIMIT_*` caps session issuance per client IP before auth and body parsing. `ACCOUNT_SESSION_RATE_LIMIT_*` adds a second in-process token bucket after JWT auth and before body parsing, keyed by authenticated account subject. The latter catches one account minting too many tickets even when requests arrive through shared IPs or varied network paths. Both surfaces are reported through `/admin/summary` and `/metrics`; production should back them with Redis, the account service, or the shard/router layer so limits apply across sim processes.

For hosted browser builds, `ALLOWED_ORIGINS` can be set to exact allowed HTTP(S) origins. When enabled, the server rejects session issuance and WebSocket upgrades before consuming ticket or connection capacity if the request has no matching `Origin` header.

`SESSION_ISSUE_RATE_LIMIT_PER_MINUTE` and `SESSION_ISSUE_RATE_LIMIT_BURST` cap `POST /api/session` issuance per client IP before ticket capacity is consumed. `SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS` caps the number of in-process client-IP buckets retained by that limiter so address churn cannot grow the map without bound. This is an in-process PoC guardrail; production should back the same boundary with Redis or the shard/router layer so limits apply across sim processes and authenticated accounts.

Expired unconsumed session tickets are cleaned before issue, validation, and pending-count reporting. This keeps a client from pinning `SESSION_TICKET_CAPACITY` forever by requesting tickets without opening WebSockets. An expired ticket presented to `/ws` is rejected before upgrade and before any player entity is spawned.

Admission and auth rejections are counted in `/metrics`: account-token failures, admin-token failures, metrics-token failures, Origin allowlist failures, missing/invalid/expired WebSocket tickets, pending-ticket capacity exhaustion, invalid display names, pending/active display-name conflicts, session issue rate limits, and WebSocket capacity exhaustion. These counters turn failed-closed behavior into something visible during shared tests.

`PUBLIC_DEPLOYMENT=true` is an explicit shared-environment guard. It fails startup unless `REQUIRE_SESSION=true`, `REQUIRE_ACCOUNT=true`, `ALLOWED_ORIGINS`, a strong account credential for the selected `ACCOUNT_AUTH_MODE`, and strong distinct `ADMIN_TOKEN` and `METRICS_TOKEN` values are configured, so local-dev defaults cannot accidentally become internet-facing defaults. Public JWT mode also requires issuer and audience validation. The mode is surfaced in `/admin/summary` and `/metrics`.

`npm run preflight:deployment` is a cheap deployment-env check that runs before booting a shared PoC environment. It does not replace the server's fail-closed startup checks; it gives deploy scripts and humans a faster explanation of missing public-mode variables, weak account/admin/metrics credentials, invalid Origins, chain-stub misuse, and bad numeric budgets. `-- --profile production` is deliberately stricter and currently fails until the repository has durable database/event-store, signer/indexer service, and cross-process rate-limit store paths. Its identity blocker clears only for configured JWT mode, not for `DEV_ACCOUNT_TOKEN`.

`BIND_ADDR` defaults to `127.0.0.1:4107`. Non-loopback bind addresses require `PUBLIC_DEPLOYMENT=true`, which forces the guardrails above before the process listens externally.

`CHAIN_ENABLED=true` currently exercises only a local settlement stub: receipts are marked `needs-signer` and no transaction is signed or indexed. The local chain-stub smoke claims a deed under that mode and verifies no receipt carries a chain transaction hash. Public deployment rejects this mode until signer and indexer configuration exist, so shared deployments cannot overstate chain settlement readiness.

Plain HTTP ingress is intentionally small. `HTTP_BODY_LIMIT_BYTES` defaults to `4096` and rejects oversized request bodies before handlers run. The server emits conservative browser hardening headers and separates cache policy between mutable app/API responses (`no-store`) and short-cache static assets.

`MAX_ACTIVE_CONNECTIONS` caps concurrent WebSocket upgrades using an in-process semaphore. `MAX_CONNECTIONS_PER_IP` adds a per-peer cap before player entities are spawned, so one source IP cannot consume the whole local shard budget. These are deliberately simple for the PoC; production should move admission and presence into the shard/router layer so capacity is enforced consistently across sim processes.

`WS_HEARTBEAT_SECONDS` controls server ping cadence and `WS_IDLE_TIMEOUT_SECONDS` controls stale-connection eviction. Healthy browser clients respond to ping frames automatically. Connections that stop sending client frames or pong responses are removed from the simulation and release their admission permit.

## Scaling Notes

- Partition the world by shard and region before trying to scale a single global tick.
- Keep per-client snapshots interest-filtered; broad full-world reads should stay admin/debug only.
- Keep snapshot cadence, interest radius, and serialized payload caps configurable; send rate, nearby fanout, and byte ceilings are scale levers, while the authoritative tick remains server-owned.
- Keep movement speed invariants enforced in the sim, including diagonal normalization, bounds clamping, terrain material checks, and terrain step-height checks; client rendering should never be authority.
- Keep hot tick paths keyed by explicit ECS queries, content-ID indexes, and small edge-trigger queues; avoid cloning whole player registries, scanning static object catalogs, or building snapshots to drive authoritative movement/interactions.
- The current grid spatial index is enough for the PoC. Production should split it by shard/region and back hot presence/session data with Redis or an equivalent low-latency store.
- Replace the in-memory ticket registry and in-process rate-limit buckets with shared authenticated account sessions before public testing; the current ticket gate and account-subject limiter are stepping stones for that boundary.
- Prefer signed JWT or managed account/wallet validation over the temporary `DEV_ACCOUNT_TOKEN` bearer gate before public testing; dev-token mode exists only to make account-gated ticket issuance testable in the PoC.
- Keep session-issue rate limits in front of ticket creation and replace the in-process IP/account buckets with Redis or account-service-backed limits once the account service exists.
- Keep explicit public-deployment startup checks for every future local-only escape hatch so public environments fail closed.
- Keep explicit admission limits per shard/region and reject excess WebSocket upgrades before creating ECS entities.
- Keep heartbeat and idle-timeout settings tuned per environment so stale sockets release shard capacity without disrupting healthy quiet clients.
- Keep the `scripts/ws-load-smoke.js` benchmark gate for per-client snapshot rate, average outbound message size, p95 join latency, and benchmark-window deltas for tick overruns, send errors, and snapshot-payload rejections as the renderer and world grow. Thresholds are intentionally configurable per environment so the local gate stays fast while larger soak tests can be stricter.
- Scrape `/metrics` in any shared environment so snapshot throughput, payload size, tick duration/overruns, active connections, rejection rate, auth/admission failures, send errors, admission pressure, settlement backlog, settlement queue pressure, content version shape, and retained audit/outbox size are visible before players report them.
- Alert on `sundermere_durable_journal_persist_failed_total` and `sundermere_durable_settlement_persist_failed_total`; a shard whose live state is mutating while durable append evidence fails should be treated as unhealthy even if the WebSocket loop is still responsive.
- Keep settlement idempotent with unique job IDs and asset IDs; duplicate queue/receipt observations must not change ownership counts or pending counts. Chain settlement should apply backpressure to operators through readiness and metrics, not to players through blocked movement, combat, inventory, or interaction ticks.
- Keep gathering, crafting, and inventory mutations server-authoritative, bounded, and journaled before they become economy inputs.
- Store every ownership-affecting transition as an append-only event before queueing settlement.
- Keep durable audit history separate from bounded admin inspection windows; the JSONL file is the PoC source of truth, while `/admin/events` is intentionally recent-only, cursorable by retained sequence, and capped per response with `ADMIN_EVENT_LIMIT_CAP`.
- Keep replay tests tied to gameplay-affecting events, not just connect/disconnect events, so future inventory and economy changes remain auditable after restart.
- Keep durable replay files under explicit startup byte budgets with `MAX_JOURNAL_BYTES`, `MAX_SETTLEMENT_OUTBOX_BYTES`, and `MAX_DURABLE_LINE_BYTES`; a production datastore should replace these JSONL files before public testing.
- Treat journal sequence anomalies as operational warnings that require audit review; the PoC surfaces them through admin summary and metrics instead of refusing to boot legacy logs.
- Treat chain finality as reconciliation, not as a gameplay lock.
