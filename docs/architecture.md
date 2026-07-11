# Architecture

## Current PoC

The PoC is intentionally small but shaped around the production constraints:

- `server/src/sim.rs` is the authoritative simulation. It uses `bevy_ecs` for entities and components, ticks at 20 Hz, and accepts client input rather than client positions.
- WebSocket clients receive interest-filtered snapshots around their own player; `/api/snapshot` remains a full debug/admin snapshot, is protected by `ADMIN_TOKEN` whenever one is configured, and has its own serialized response cap.
- `server/src/spatial.rs` provides the current grid spatial index used for nearby player/object snapshot queries.
- `/healthz` is a liveness check; `/readyz` reports deploy/load-balancer readiness from loaded content, settlement queue state/capacity, journal/outbox files and their parent directories, durable append failure counters, WebSocket capacity, strict-session ticket capacity, and drain mode without exposing absolute durable paths.
- `DRAINING=true` is the current rollout/rollback drain switch: liveness stays up, readiness returns unavailable, and new session admissions are rejected while operators can still scrape metrics and admin state.
- `/admin/runtime` is a token-protected runtime report for the running build: Duskfell/Base `$DUSK` identity, server crate/version, optional build Git SHA, content manifest, sprite manifest pins, terrain manifest pins, and server-verified asset hash state.
- `server/src/metrics.rs` exposes lightweight WebSocket, payload-size, interest-filtered snapshot visibility, admission rejection, and tick-timing counters, and `/metrics` adds runtime gauges for sim tick/player count, tick budget/duration/overruns, settlement state, content object count, journal/outbox size, session ticket capacity, and admission config.
- `scripts/verify-ci.js` is the clean-checkout gate run by GitHub Actions. It keeps locked Rust builds, projection/asset manifest checks, runtime asset integrity, deployment preflight, fail-closed public startup guards, Origin allowlisting, readiness, and metrics smokes on every branch update.
- `scripts/verify-local.js` runs the broad local gate across unit tests and isolated runtime smokes.
- `Dockerfile` builds a release server image with bundled original client/assets/content, non-root runtime user, `/data` JSONL state, `/readyz` healthcheck, and an OCI revision label matching the compile-time `GIT_SHA`. `scripts/container-smoke.js` builds and runs that image with public-mode guardrails before treating it as deployable.
- `scripts/supply-chain-smoke.js` verifies local dependency posture from `package.json`, workspace Cargo metadata, `Cargo.lock`, and the locked active Rust build graph.
- `scripts/deployment-preflight.js` checks deployment environment profiles before boot. The default `shared-poc` profile must pass for hardened shared demos, including explicit persistence and admission backends, bounded Git revision provenance, and non-draining admission posture unless `--allowDraining` is explicit, while the `production` profile checks account identity, durable state, bounded signer/indexer service URLs, and cross-process admission/rate-limit services.
- `scripts/deploy-audit.js` checks a running shared shard after deploy: readiness, token-protected admin/runtime and metrics, required runtime Git SHA match, content/runtime consistency, asset verification, public-mode guardrails, Origin allowlist posture, non-draining admission posture, WebSocket and session-ticket admission headroom, durable failure counters, and settlement queue capacity.
- `scripts/drain-mode-smoke.js` verifies planned drain behavior for rollbacks and shard removal.
- `scripts/ops-snapshot.js` exports a bounded redacted operations snapshot for incident response: runtime/content/asset identity, readiness, public/admission posture, selected metrics, journal/outbox counters, recent event type counts, and ownership counts without full world state, raw events, account subjects, player IDs, tokens, or absolute durable paths.
- `scripts/bad-config-smoke.js` verifies invalid environment config fails startup.
- `scripts/external-bind-guard-smoke.js` verifies non-loopback bind addresses require explicit public deployment mode.
- `scripts/content-schema-smoke.js` verifies unsupported world content schema fails startup.
- `scripts/content-size-smoke.js` verifies oversized world content fails startup before serving traffic.
- `scripts/durable-size-smoke.js` verifies oversized journal and settlement outbox files fail startup before serving traffic.
- `scripts/durable-corruption-smoke.js` verifies malformed journal JSONL, oversized durable JSONL lines, and malformed or semantically invalid settlement outbox JSONL fail startup before serving traffic.
- `scripts/durable-sync-smoke.js` verifies `DURABLE_SYNC_WRITES=true` is visible in admin/metrics and still preserves real journal plus settlement outbox appends during a deed claim.
- `scripts/ws-load-smoke.js` provides a repeatable WebSocket load smoke for client count, snapshot throughput, payload size, and join latency.
- `scripts/client-protocol-smoke.js` verifies a live server welcome/snapshot parses through the same browser-side protocol normalizer used by `client/app.js`, catching server/client contract drift before the page renders blank.
- `scripts/account-auth-smoke.js` verifies `REQUIRE_ACCOUNT=true` in temporary dev-token mode rejects missing, invalid, or oversized bearer account tokens before `/api/session` parses request bodies or mints tickets.
- `scripts/account-jwt-auth-smoke.js` verifies `ACCOUNT_AUTH_MODE=jwt-hs256` rejects missing, wrongly signed, expired, wrong-audience, empty-subject, and oversized JWT bearer tokens before ticket issuance, then binds an accepted JWT subject into the issued session ticket.
- `scripts/account-session-rate-limit-smoke.js` verifies `ACCOUNT_SESSION_RATE_LIMIT_*` throttles authenticated JWT ticket issuance per account subject independently of the client-IP limiter.
- `scripts/account-settlement-smoke.js` verifies an accepted JWT subject reaches the player snapshot, ownership journal events, settlement receipt, and `/admin/ownership` after a deed claim.
- `scripts/admin-auth-smoke.js` verifies token-protected admin/debug endpoints in an isolated server process.
- `scripts/runtime-manifest-smoke.js` verifies `/admin/runtime` is protected and matches the checked sprite, terrain, and terrain-detail authority manifests.
- `scripts/runtime-asset-integrity-smoke.js` verifies corrupted asset bytes, over-budget asset images, and over-budget asset manifests fail server startup before the shard listens.
- `scripts/admin-events-limit-smoke.js` verifies admin event responses are capped and can be read through a bounded `after=<sequence>` cursor over the retained journal window.
- `scripts/admin-snapshot-size-smoke.js` verifies the full debug/admin snapshot response is capped and surfaced in metrics.
- `scripts/metrics-auth-smoke.js` verifies token-protected metrics scraping in an isolated server process.
- `scripts/metrics-smoke.js` verifies the Prometheus surface exposes parseable runtime state and reflects session ticket issuance.
- `scripts/movement-authority-smoke.js` verifies cardinal and diagonal client input travel at the same server-authoritative speed budget.
- `scripts/resource-gather-smoke.js` verifies session issuance, WebSocket movement, server-authoritative grove interaction, bounded inventory stack mutation, resource summary projection, and admin-journal visibility for resource gathering.
- `scripts/crafting-smoke.js` verifies session issuance, interest-filtered movement across multiple interaction targets, server-authoritative recipe consumption, crafted inventory output, and admin-journal visibility for crafting.
- `scripts/readiness-smoke.js` verifies `/readyz` returns ready on boot with durable file, parent-directory, and durable persistence health checks passing, then flips to unavailable when strict-session admission capacity is saturated.
- `scripts/public-deployment-smoke.js` verifies `PUBLIC_DEPLOYMENT=true` refuses unsafe local defaults and starts only when session, account-token, Origin, synced durable-write, admin-token, and metrics-token guardrails are configured.
- `scripts/chain-public-guard-smoke.js` verifies public deployment refuses `CHAIN_ENABLED=true` until a real signer/indexer path exists.
- `scripts/chain-local-stub-smoke.js` verifies local `CHAIN_ENABLED=true` receipts remain explicit `needs-signer` stubs with no chain transaction hash.
- `scripts/session-capacity-smoke.js` verifies pending session ticket admission and visibility.
- `scripts/session-expiry-smoke.js` verifies expired unconsumed session tickets are cleaned before pending-ticket capacity decisions.
- `scripts/session-expired-ws-smoke.js` verifies an expired ticket is rejected before WebSocket upgrade and before player spawn.
- `scripts/session-token-hardening-smoke.js` verifies oversized fake tickets are rejected before upgrade without consuming a valid pending ticket.
- `scripts/session-rate-limit-smoke.js` verifies per-client-IP session issue throttling and visibility.
- `scripts/ws-account-capacity-smoke.js` verifies authenticated account connection caps reject before upgrade without consuming a valid pending ticket.
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
- The server loads checked sprite, terrain, and generated terrain-detail authority manifest metadata at startup, caps manifest JSON with `MAX_RUNTIME_MANIFEST_BYTES`, verifies referenced PNG and WebP bytes against their SHA-256 pins before binding, caps each checked image with `MAX_RUNTIME_ASSET_BYTES`, and exposes schema, projection, image pins, verification state, byte caps, approval state, byte sizes, terrain authority blocker/resource/decay counts, and manifest fingerprints through `/admin/runtime` for deploy audit. The simulation consumes the checked terrain-authority blocker entries as AABB movement blockers, promotes checked primary terrain-detail resource nodes into server-owned gatherable objects, and applies checked terrain-detail `decayConsumers` recipes when passive deadwood tries to feed authored mycelium. Multi-resource yields remain metadata until a later terrain-authority promotion pass.
- `server/src/journal.rs` records append-only gameplay and ownership-affecting events for inspection and later durable persistence.
- `server/src/persistence.rs` appends journal events to JSONL, can call `sync_data()` after flush when `DURABLE_SYNC_WRITES=true`, enforces configured durable-file and per-line byte ceilings before replay, and replays the retained recent window into the admin-visible journal on boot while preserving sequence continuity from the full durable file and surfacing non-increasing sequence anomalies.
- `server/src/settlement.rs` uses a JSONL settlement outbox so queued ownership jobs, including optional JWT account subjects, are recorded before entering the async worker and replayed on boot if still unconfirmed. Worker handoff is non-blocking after the durable append; full or closed in-process queues are counted and surfaced through readiness, metrics, and admin summary instead of stalling the sim tick. It shares the same optional synced-write mode and per-line replay cap as the journal. Confirmed receipts seed an in-memory ownership index for admin reconciliation.
- `server/src/protocol.rs` defines the wire protocol shared by the WebSocket server and browser client.
- `server/src/session.rs` issues short-lived, single-use capability tickets before WebSocket spawn and can carry an authenticated JWT account subject into the spawned player identity.
- A WebSocket admission semaphore enforces `MAX_ACTIVE_CONNECTIONS` before player entities are spawned.
- The WebSocket loop sends heartbeat pings and closes stale connections that stop sending client frames or pong responses within `WS_IDLE_TIMEOUT_SECONDS`.
- `server/src/settlement.rs` is an async settlement worker with an in-memory ledger. It models the Base settlement process without holding keys or blocking gameplay.
- `client/` is a static browser client. It renders snapshots and sends input only.
- Actor sprite sheets can include manifest-checked animation metadata with an
  idle frame and authored walk-frame sequence, letting generated character
  sheets skip planted poses during walking without hardcoding per-sheet quirks
  in the renderer.
- `client/projection.js` and `client/camera.js` keep the browser view on a 64x64 1:1 military/plan-oblique tile contract with uniform camera scale, so viewport changes crop or zoom the scene without stretching it into 2:1 dimetric isometric art.
- `client/terrain.js` generates deterministic per-corner terrain heights and split triangle facets. The renderer shades those facets over the checked atlas frames, preserving the UO-inspired height-tile model while keeping server-side terrain authority separate from browser visuals.
- `client/terrain-depth.js` centralizes local depth sorting and controlled-player occlusion for tall terrain details. Tree canopies, walls, stairs, foundations, and ruins now use the same vertical profile shape instead of one-off renderer fades.

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
3. The sim checks the target object's finite resource node, decrements its remaining amount, and restores the node if the player's bounded inventory cannot accept the item. The first generated ecology-detail objects now form a small lifecycle vignette: sapling, mature tree, ancient tree, fresh log, decaying and hollow stumps, mycelium blooms, ancient stone ruins, and crude field coils all use this same path as authored landmarks.
4. Snapshots expose the resulting inventory stack list, derived player resource summary, and object resource/lifecycle state, including lifecycle family, stage, species, age, health, growth, and decay where applicable. Inventory stacks also expose server-derived lifecycle state with age, health, decay, and compostability, so carried items can visibly weather before they become ecological inputs.
5. Harvesting living tree wood can create nearby deadwood fallout by incrementing a non-full deadwood node, so tree cutting starts feeding the decay loop instead of only filling player inventory.
6. Players carrying organic resources can feed nearby non-full mycelium nodes. The server currently accepts deadwood, fiber, seeds, or spores, consumes the chosen stack, grows the mycelium node, emits `resourceFed`, and then emits the resulting `resourceNodeChanged` state. Compostable crafted items can feed the same ecology through a distinct `itemFed` event; the first item in that path is the Trail Kit, whose inventory lifecycle ages and decays on authoritative ticks. More decayed compostable items now feed more mycelium growth, capped by the target node's remaining capacity. Composting crafted items can also passively shed spores on a bounded server interval, emitting `itemDecayed`; when the player is near hungry mycelium, that passive shed feeds the bloom directly before falling back to inventory spores.
7. Nearby deadwood can also decay into a hungry mycelium node on the authoritative tick, emitting the same `resourceNodeChanged` state for both the consumed deadwood and grown bloom. Promoted terrain-detail mycelium can carry checked `decayConsumers` recipes, so authored mushrooms can restrict which organic resource kind and amount they accept from passive decay.
8. Charged field coils can discharge into nearby hungry mycelium on the authoritative tick, spending finite charge and emitting `resourceNodeChanged` state for the coil and the bloom.
9. Mineral nodes can also expose geologic lifecycle state. Ancient ruins use the same resource snapshot path as trees and mycelium, but with stone, extreme age, low health, and high decay so structures can exist as ruins of prior civilizations without becoming decorative-only props.
10. Resource nodes regenerate slowly on the authoritative tick, so grove, ore, mycelium, and charge nodes can move through depleted/regrowing/fruiting/sparking-style states without client-local invention. Lifecycle age also advances on that authoritative tick, and health/decay values derive from family-specific age pressure so trees, deadwood, minerals, mycelium, and field machines can weather on different time scales.
11. The server appends `resourceGathered`, `resourceFed`, `itemFed`, `itemDecayed`, and `resourceNodeChanged` events to the journal. On restart, it streams the full journal under the durable line cap and restores the latest resource-node amount for each known node before ticking.

## Crafting Flow

1. Player presses interact near the Field Forge.
2. The sim validates position against the server-owned forge object.
3. The sim checks the server inventory for the Trail Kit recipe, currently `1 wood + 1 ore`.
4. If ingredients are present and the output stack can accept the item, the sim consumes the ingredients and adds the crafted stack.
5. Snapshots expose the resulting inventory list, item lifecycle state, and the derived resource summary.
6. The server appends an `itemCrafted` event to the journal so gameplay-affecting item creation is audit-visible. A crafted Trail Kit can also be composted into hungry mycelium, consuming the item and recording `itemFed` plus the resulting node change.

These loops are deliberately small, but they establish the production invariant for future economy and containers: inventory and gatherable world resources are server-authoritative gameplay state, not client-local UI state.

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

Each WebSocket also tracks rejected text messages. `WS_MAX_TEXT_BYTES`, `WS_MESSAGE_BURST`, `WS_MESSAGE_REFILL_PER_SECOND`, and `WS_MAX_INPUT_SEQUENCE_STEP` control per-socket text-frame, message-rate, and input-sequence limits; `CLIENT_REJECT_LIMIT` closes a connection after repeated malformed JSON, stale or jumping input sequence, oversized, rate-limited, or invalid rename messages so bad clients do not linger until idle timeout.

Movement is server-authoritative intent processing. Clients submit direction booleans, not positions; the sim computes velocity, clamps map bounds, checks the validated terrain profile for walkable material and maximum height step, checks server-owned object and terrain-detail authority blockers, and normalizes diagonal input so combined horizontal/vertical movement does not exceed the cardinal speed budget.

`SNAPSHOT_INTERVAL_MS` controls per-client snapshot cadence independently of the 20 Hz authoritative sim tick. Production can tune this per shard or client tier to control bandwidth and serialization cost without changing simulation correctness.

`INTEREST_RADIUS` controls the WebSocket snapshot radius around each player. The default is `520` world units. Lower values reduce payload size and object/player fanout; `/api/snapshot` remains full-world and admin/debug only. `/metrics` reports total outbound WebSocket bytes plus last/max serialized message and snapshot byte sizes so shard operators can see payload growth before it becomes a capacity issue.

`MAX_SNAPSHOT_BYTES` caps serialized welcome/snapshot payloads. If a crowded interest area or future content expansion exceeds the configured byte budget, the server increments `sundermere_ws_snapshot_payload_rejected_total` and closes that connection instead of sending a runaway payload.

`MAX_ADMIN_SNAPSHOT_BYTES` separately caps the full debug/admin `/api/snapshot` response. If future world growth makes the full snapshot too large, the server returns `413` and increments `sundermere_admin_snapshot_payload_rejected_total` instead of emitting an unbounded admin response.

The browser first requests `POST /api/session`, then connects to `/ws?session=...`. Ticketed WebSocket connections use the issued `sessionId` as the spawned `playerId`, which keeps welcome messages, journal events, and settlement jobs tied to one server-issued identity. `POST /api/session` can include a JSON `name`; the server trims and validates it with the same bounded ASCII player-name rule used for later renames, rejects pending ticket and active-shard name collisions case-insensitively, stores the accepted display name inside the one-use ticket, and applies it only when the ticket is consumed by the WebSocket spawn. The spawn path re-checks active-name uniqueness in case a ticket was delayed while another player claimed the same visible name. In local default mode the server still permits anonymous WebSocket spawn for iteration and benchmark compatibility; those anonymous dev spawns receive random player IDs. In shared environments, run with `REQUIRE_SESSION=true` so every WebSocket spawn consumes a valid ticket before a player entity is created.

`REQUIRE_ACCOUNT=true` adds an account-auth gate in front of session ticket issuance. `ACCOUNT_AUTH_MODE=dev-token` uses `Authorization: Bearer <DEV_ACCOUNT_TOKEN>` as a temporary shared-secret gate for demos and intentionally has no durable account subject. `ACCOUNT_AUTH_MODE=jwt-hs256` validates signed JWT bearer tokens with required `sub` and `exp` claims, optional issuer/audience checks, and binds the accepted bounded printable `sub` into the issued session ticket. Bearer values over 4096 bytes are rejected before shared-secret comparison or JWT decode. Ticketed WebSocket spawn carries that subject into the player snapshot and any ownership-affecting settlement job, receipt, journal event, and ownership-index entry. This proves session issuance can fail closed behind account authentication and carry account identity forward before the project swaps in managed OAuth/JWKS or wallet auth and durable character ownership.

`SESSION_ISSUE_RATE_LIMIT_*` caps session issuance per client IP before auth and body parsing. `ACCOUNT_SESSION_RATE_LIMIT_*` adds a second in-process token bucket after JWT auth and before body parsing, keyed by authenticated account subject. The latter catches one account minting too many tickets even when requests arrive through shared IPs or varied network paths. Both surfaces are reported through `/admin/summary` and `/metrics`; production should back them with Redis, the account service, or the shard/router layer so limits apply across sim processes.

For hosted browser builds, `ALLOWED_ORIGINS` can be set to exact allowed HTTP(S) origins. The startup parser caps the list at 16 origins, caps each origin at 512 bytes, and rejects path/query/fragment components so the runtime allowlist is small and unambiguous. When enabled, the server rejects session issuance and WebSocket upgrades before consuming ticket or connection capacity if the request has no matching `Origin` header.

`SESSION_ISSUE_RATE_LIMIT_PER_MINUTE` and `SESSION_ISSUE_RATE_LIMIT_BURST` cap `POST /api/session` issuance per client IP before ticket capacity is consumed. `SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS` caps the number of in-process client-IP buckets retained by that limiter so address churn cannot grow the map without bound. This is an in-process PoC guardrail; production should back the same boundary with Redis or the shard/router layer so limits apply across sim processes and authenticated accounts.

Expired unconsumed session tickets are cleaned before issue, validation, and pending-count reporting. Pending tickets are keyed by SHA-256 token hashes in memory, and oversized ticket inputs are rejected before lookup. This keeps a client from pinning `SESSION_TICKET_CAPACITY` forever by requesting tickets without opening WebSockets, and keeps invalid ticket probes from consuming valid pending tickets. An expired ticket presented to `/ws` is rejected before upgrade and before any player entity is spawned.

Admission and auth rejections are counted in `/metrics`: account-token failures, admin-token failures, metrics-token failures, Origin allowlist failures, missing/invalid/expired WebSocket tickets, pending-ticket capacity exhaustion, invalid display names, pending/active display-name conflicts, session issue rate limits, and WebSocket capacity exhaustion. These counters turn failed-closed behavior into something visible during shared tests.

`PUBLIC_DEPLOYMENT=true` is an explicit shared-environment guard. It fails startup unless `DEPLOYMENT_PROFILE=shared-poc` or `production`, `PERSISTENCE_BACKEND=jsonl`, `ADMISSION_BACKEND=in-memory`, `REQUIRE_SESSION=true`, `REQUIRE_ACCOUNT=true`, `DURABLE_SYNC_WRITES=true`, bounded exact `ALLOWED_ORIGINS`, a strong bounded non-placeholder account credential for the selected `ACCOUNT_AUTH_MODE`, and strong distinct bounded non-placeholder `ADMIN_TOKEN` and `METRICS_TOKEN` values are configured, so local-dev defaults cannot accidentally become internet-facing defaults. Public JWT mode also requires bounded issuer/audience config: the issuer must be a non-local HTTPS issuer URL without query, fragment, userinfo, whitespace, or control characters, and the audience must be printable, bounded, and non-placeholder. The mode is surfaced in `/admin/summary` and `/metrics`.

`DEPLOYMENT_PROFILE=local|shared-poc|production` records the intended runtime posture. The default is `local`, and `PUBLIC_DEPLOYMENT=true` rejects that default so shared demos cannot boot with local posture metadata. `PERSISTENCE_BACKEND=jsonl` records the current PoC durable store; `postgres` is reserved for the production database/event-store and currently fails startup. `ADMISSION_BACKEND=in-memory` records the current single-process session/admission/rate-limit state; `redis` is reserved for shared production admission state and currently fails startup. `shared-poc` requires the public deployment guardrails; `production` currently fails startup until durable database/event-store, signer/indexer isolation, and cross-process admission/rate-limit state are implemented. The active profile, persistence backend, and admission backend are visible through `/admin/summary` and gauges in `/metrics`.

`DRAINING=true` intentionally removes the shard from ready service without making it look dead. Load balancers should stop routing new traffic because `/readyz` returns `503`, while `/healthz`, `/admin/summary`, and `/metrics` remain available for rollback triage. New `/api/session` calls return `503` before consuming rate-limit or account-auth budget, new `/ws` upgrades return `503` before session-ticket or capacity work, and `sundermere_session_draining_rejected_total` records the admission pressure that arrived during the drain.

`npm run preflight:deployment` is a cheap deployment-env check that runs before booting a shared PoC environment. It does not replace the server's fail-closed startup checks; it gives deploy scripts and humans a faster explanation of missing or mismatched `DEPLOYMENT_PROFILE`, missing or wrong `PERSISTENCE_BACKEND`, missing or wrong `ADMISSION_BACKEND`, missing public-mode variables, unsynced JSONL durability, weak account/admin/metrics credentials, invalid JWT identity config, invalid Origins, malformed bind socket addresses, missing or malformed Git revision provenance, chain-stub misuse, missing or unsafe signer/indexer service URLs, accidental drain mode, non-integer or oversized numeric budgets, and inconsistent admission/rate-limit settings. The server enforces the same runtime budget envelope at startup, including bounded capacity/payload knobs, `MAX_CONNECTIONS_PER_IP <= MAX_ACTIVE_CONNECTIONS`, `MAX_CONNECTIONS_PER_ACCOUNT <= MAX_ACTIVE_CONNECTIONS`, and rate-limit bursts no larger than their per-minute budgets. The local JSONL durable store is also single-writer: startup locks the journal and settlement outbox paths and refuses shared paths or a second live process using the same files. `-- --profile production` is deliberately stricter: its identity blocker clears only for configured JWT mode with valid issuer/audience config, not for `DEV_ACCOUNT_TOKEN`; its database blocker clears in preflight only with `PERSISTENCE_BACKEND=postgres` and a bounded Postgres `DATABASE_URL`; its signer/indexer blocker clears only with bounded public HTTPS `SIGNER_SERVICE_URL` and `INDEXER_SERVICE_URL` values; and its cross-process admission blocker clears only with `ADMISSION_BACKEND=redis` and a bounded Redis `REDIS_URL`, while the runtime still rejects the production profile and reserved backends/services until implemented. If a rollback or shard-removal rollout intentionally boots with `DRAINING=true`, the deploy command must also pass `--allowDraining`.

`BIND_ADDR` defaults to `127.0.0.1:4107` and must be an IP socket address, for example `127.0.0.1:4107`, `0.0.0.0:4107`, or `[::1]:4107`. Non-loopback bind addresses require `PUBLIC_DEPLOYMENT=true`, which forces the guardrails above before the process listens externally.

`CHAIN_ENABLED=true` currently exercises only a local settlement stub: receipts are marked `needs-signer` and no transaction is signed or indexed. The local chain-stub smoke claims a deed under that mode and verifies no receipt carries a chain transaction hash. Public deployment rejects this mode until signer and indexer configuration exist, so shared deployments cannot overstate chain settlement readiness.

Plain HTTP ingress is intentionally small. `HTTP_BODY_LIMIT_BYTES` defaults to `4096` and rejects oversized request bodies before handlers run. The server emits conservative browser hardening headers and separates cache policy between mutable app/API responses (`no-store`) and short-cache static assets.

Static client and asset serving rejects hidden path segments before filesystem lookup, including percent-encoded dot prefixes, so accidental dotfiles in deploy artifacts are not reachable through `/` or `/assets`.

Every HTTP response carries `x-request-id`. A safe bounded upstream value is echoed so reverse proxies can correlate edge logs with shard responses; missing or unsafe values are replaced with generated UUIDs to avoid reflecting arbitrary header text.

`MAX_ACTIVE_CONNECTIONS` caps concurrent WebSocket upgrades using an in-process semaphore. `MAX_CONNECTIONS_PER_IP` adds a per-peer cap before one-use session tickets are consumed or player entities are spawned, so one source IP cannot consume the whole local shard budget. `MAX_CONNECTIONS_PER_ACCOUNT` adds the same pre-consume cap for authenticated account subjects, so one account cannot fan out across many tickets or network paths inside one shard process. These are deliberately simple for the PoC; production should move admission and presence into the shard/router layer so capacity is enforced consistently across sim processes.

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
- Keep durable replay files under explicit startup byte budgets with `MAX_JOURNAL_BYTES`, `MAX_SETTLEMENT_OUTBOX_BYTES`, and `MAX_DURABLE_LINE_BYTES`; a production datastore should replace these JSONL files before public testing, using the reserved `PERSISTENCE_BACKEND=postgres` contract once implemented.
- Treat journal sequence anomalies as operational warnings that require audit review; the PoC surfaces them through admin summary and metrics instead of refusing to boot legacy logs.
- Treat chain finality as reconciliation, not as a gameplay lock.
