# Security and Clean-Room Notes

## Clean-Room Boundary

Do not import or copy from UO emulator repositories, EA/Broadsword files, original game assets, data formats, names, maps, spell names, item names, city names, or packet structures.

Allowed research output:

- subsystem inventories
- architectural lessons
- generic MMO design requirements
- license risk summaries
- original implementation recommendations

Disallowed implementation input:

- source code
- assets
- data tables
- protocol constants
- content names
- copied formulas
- map layouts

## Current Threat Model

The client is untrusted. The server accepts input intent only and owns:

- position
- movement speed and map bounds
- collision/map bounds
- deed eligibility
- settlement job creation
- settlement status shown to players

The current PoC has replaceable account-auth gates for session issuance, including temporary dev-token mode and signed JWT mode. JWT subjects are bounded and carried into player snapshots, ownership journal events, settlement receipts, and the admin ownership index. It still has no durable account persistence, cross-process session store, or anti-cheat. Those are explicit next steps before any external test.

Admin inspection endpoints are read-only. Set `ADMIN_TOKEN` before exposing the server outside localhost; this also protects the full debug `/api/snapshot`. In public deployment mode, admin and metrics tokens must be distinct, have no surrounding whitespace, avoid placeholder text, and be at least 24 bytes long. Header token checks use exact byte matching through a constant-time comparison helper. `MAX_ADMIN_SNAPSHOT_BYTES` caps that full debug response so admin access does not become an unbounded serialization path. `/admin/runtime` exposes the running Duskfell/Base `$DUSK` build identity, loaded content fingerprint, sprite manifest pins, and terrain manifest pins for deployment audit. Mutating admin endpoints should not be added until authentication, role checks, and audit persistence exist.

Durable JSONL replay is bounded and strict at startup. `MAX_JOURNAL_BYTES` and `MAX_SETTLEMENT_OUTBOX_BYTES` cap the journal and settlement outbox files before they are scanned, and `MAX_DURABLE_LINE_BYTES` caps each JSONL line before parsing; oversized, malformed, or semantically invalid durable files fail startup before the server listens. `DURABLE_SYNC_WRITES=true` makes journal and settlement outbox appends call `sync_data()` after flush for stronger local crash semantics, with the expected write-latency cost. This keeps local durable replay from becoming an accidental memory, boot-time denial-of-service, or silent data-loss path while the PoC is still using JSONL instead of a production database.

Settlement jobs are appended to the durable outbox before the in-process worker handoff. The worker handoff uses a non-blocking bounded queue; if the queue is full or closed, the job remains in the durable outbox, the ledger shows it as pending, and metrics/readiness/admin summary expose the pressure. This keeps settlement-side degradation from becoming a hidden denial-of-service against movement, inventory, or interaction ticks.

`scripts/admin-auth-smoke.js` starts an isolated token-protected server and verifies `/admin/summary`, `/admin/events`, `/admin/ownership`, `/admin/runtime`, and `/api/snapshot` reject missing or wrong tokens while accepting the configured token.

Metrics expose operational state. Set `METRICS_TOKEN` before exposing `/metrics` outside localhost. `scripts/metrics-auth-smoke.js` starts an isolated token-protected server and verifies `/metrics` rejects missing or wrong tokens while accepting `x-metrics-token`.

Set `ALLOWED_ORIGINS` before exposing the browser client from a known host. When configured, both `POST /api/session` and `/ws` upgrades require an exact matching `Origin` header. This is a browser-facing guardrail against cross-site session/socket abuse; it is not a replacement for account authentication or CSRF protections on future mutating HTTP APIs. `scripts/origin-allowlist-smoke.js` verifies missing and wrong origins are rejected while the configured origin is accepted.

Set `PUBLIC_DEPLOYMENT=true` for any shared environment. In that mode the server fails startup unless `REQUIRE_SESSION=true`, `REQUIRE_ACCOUNT=true`, a strong non-placeholder account credential for the selected `ACCOUNT_AUTH_MODE`, strong distinct non-placeholder `ADMIN_TOKEN` and `METRICS_TOKEN` values, and `ALLOWED_ORIGINS` are all configured. Public JWT mode also requires issuer and audience validation. `scripts/public-deployment-smoke.js` verifies the fail-closed startup path and the hardened live behavior.

Run `npm run preflight:deployment` before booting shared PoC deployments. The preflight checks the intended public-mode environment without starting the server and fails on missing strict sessions, account auth, weak, placeholder, or reused credentials, invalid Origins, chain-stub exposure, invalid capacity/payload budgets, and accidental drain mode. Its `production` profile intentionally fails until durable persistence, signer/indexer isolation, and cross-process admission/rate-limit state are implemented; the identity blocker clears only for configured JWT mode, not the temporary dev-token mode. Intentional rollback or shard-removal boots with `DRAINING=true` must pass `--allowDraining` so the maintenance posture is explicit in deploy automation.

Run `scripts/deploy-audit.js --profile shared-poc` against a running shared shard after deploy. It verifies health/readiness, admin and metrics token protection, runtime build provenance, asset hash verification, public deployment guardrails, Origin allowlist posture, WebSocket and session-ticket admission headroom, durable persistence failure counters, and settlement queue capacity from the live endpoints. `scripts/deploy-audit-smoke.js` starts a hardened isolated server and verifies the audit path itself.

Run `scripts/ops-snapshot.js` during incident response or rollback triage to export a bounded redacted operations snapshot. The snapshot summarizes runtime identity, content and asset fingerprints, readiness, public/admission posture, selected metrics, journal/outbox counters, recent event type counts, and ownership counts, but deliberately omits full world snapshots, raw journal event payloads, account subjects, player IDs, secret tokens, and absolute durable file paths. `scripts/ops-snapshot-smoke.js` verifies those redaction boundaries against a hardened isolated server.

Non-loopback `BIND_ADDR` values require `PUBLIC_DEPLOYMENT=true`, so binding to `0.0.0.0` cannot silently expose local-dev defaults. `scripts/external-bind-guard-smoke.js` verifies this fail-closed startup path.

`CHAIN_ENABLED=true` is currently a local-only settlement stub that produces `needs-signer` receipts instead of signed transactions. `scripts/chain-local-stub-smoke.js` verifies a deed claim in local chain mode still returns `needs-signer` with no `chainTx`. Public deployment refuses startup with chain mode enabled until signer and indexer configuration are implemented. `scripts/chain-public-guard-smoke.js` verifies this fail-closed startup path.

Plain HTTP request bodies are capped by `HTTP_BODY_LIMIT_BYTES`, defaulting to `4096`. Responses include conservative browser hardening headers: content sniffing is disabled, referrers are suppressed, permissions for camera/microphone/geolocation are denied, same-origin resource policy is set, and a self-only CSP is emitted. Non-asset responses use `Cache-Control: no-store`; `/assets/*` uses short public caching. Every response includes `x-request-id`: safe bounded upstream IDs are echoed for proxy correlation, while missing or unsafe IDs are replaced with a generated UUID. `scripts/http-hardening-smoke.js` verifies the headers, request-ID behavior, and oversized-body rejection.

Runtime art manifests pin their loaded PNG bytes with SHA-256 digests. The server caps sprite and terrain manifest JSON files with `MAX_RUNTIME_MANIFEST_BYTES`, verifies referenced PNG bytes against those pins at startup before binding a listener, and caps each checked image with `MAX_RUNTIME_ASSET_BYTES` before it is read. `npm run assets:verify` checks the on-disk bytes against those manifest hashes, `scripts/assets-smoke.js` repeats the comparison against bytes served by HTTP, and the browser client verifies the fetched PNG bytes with Web Crypto before creating sprite or terrain images. This catches accidental asset drift and keeps generated/commissioned art review tied to exact files, not just filenames.

The server also loads sprite and terrain manifest metadata at startup and exposes it at `/admin/runtime`: schema version, projection, manifest fingerprint, manifest byte cap, image SHA-256 pins, hash verification status, per-image byte cap, approval state, and image byte sizes. When built with `GIT_SHA`, the same endpoint exposes the compile-time source revision so operators can match a running shard to an image label and Git commit. `scripts/runtime-manifest-smoke.js` verifies the endpoint is admin-token protected, matches the checked manifests, and can report expected build provenance. `scripts/runtime-asset-integrity-smoke.js` corrupts a copied terrain PNG and verifies startup fails before health when asset bytes do not match the manifest pin, asset images exceed the configured byte cap, or manifest JSON files exceed their configured byte cap.

Implemented ingress protections:

- WebSocket player spawn can be gated by short-lived, single-use session tickets. Set `REQUIRE_SESSION=true` outside local-only development.
- `POST /api/session` JSON rejects unknown fields, so session issuance only accepts the explicit display-name request shape.
- Optional display names submitted to `POST /api/session` are trimmed, bounded, character-validated, checked case-insensitively against pending ticket names and active shard names, bound to the one-use ticket, and applied only when that ticket is consumed by the WebSocket spawn.
- Plain HTTP request bodies are capped by `HTTP_BODY_LIMIT_BYTES` before handlers run.
- HTTP responses include browser hardening headers and explicit cache policy.
- Sprite and terrain asset manifests pin exact served PNG bytes with SHA-256 hashes. Server startup, local verifiers, HTTP asset checks, and browser runtime loading reject mismatches. Server startup also rejects runtime manifest JSON files above `MAX_RUNTIME_MANIFEST_BYTES` and individual runtime asset images above `MAX_RUNTIME_ASSET_BYTES`.
- `/admin/runtime` exposes the running game/build identity plus content, sprite, and terrain manifest pins so operators can audit which exact Duskfell assets and world data a shard booted with.
- `PUBLIC_DEPLOYMENT=true` refuses startup when session tickets, account auth, admin auth, metrics auth, token quality, token placeholders, or Origin allowlisting are left in local-dev mode.
- Non-loopback listener binds refuse startup unless public deployment mode is enabled.
- `PUBLIC_DEPLOYMENT=true` refuses startup when `CHAIN_ENABLED=true`, because this PoC has no production signer/indexer path yet.
- Local `CHAIN_ENABLED=true` deed receipts are explicitly marked `needs-signer` and contain no chain transaction hash.
- Ticketed WebSocket spawns use the issued `sessionId` as `playerId`, giving ownership-affecting events a stable server-issued identity for that connection.
- Session ticket issuance and WebSocket upgrades can be restricted to exact allowed browser origins with `ALLOWED_ORIGINS`.
- Session ticket issuance is rate-limited per client IP with `SESSION_ISSUE_RATE_LIMIT_PER_MINUTE` and `SESSION_ISSUE_RATE_LIMIT_BURST` before request-body display-name validation runs, so malformed or invalid-name issue attempts consume the same abuse budget as valid ticket requests; `SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS` caps the in-process client-IP bucket map. Rejected requests are visible in `/metrics`.
- Pending session ticket capacity is enforced before WebSocket spawn, expired pending tickets are cleaned before capacity checks, expired tickets are rejected before WebSocket upgrade/player spawn, and pending ticket state is visible through admin summary and `/metrics`.
- WebSocket admission is capped by `MAX_ACTIVE_CONNECTIONS` before player entities are created.
- WebSocket admission is also capped per peer IP with `MAX_CONNECTIONS_PER_IP`, and peer-capacity rejections are visible in `/metrics`.
- WebSocket heartbeat pings and idle timeouts evict stale connections and release their player entity/admission permit.
- WebSocket text frames are capped with `WS_MAX_TEXT_BYTES`, defaulting to `4096`.
- Unsupported binary WebSocket frames are rejected, recorded in the journal, and the socket is closed.
- Each socket has a configurable token bucket for incoming messages with `WS_MESSAGE_BURST` and `WS_MESSAGE_REFILL_PER_SECOND`.
- Client WebSocket JSON messages reject unknown fields, so protocol drift or privilege-looking extras are recorded as bad client messages instead of being silently ignored.
- Input messages must use strictly increasing sequence numbers.
- Movement is computed from client intent on the server, with map bounds clamping, diagonal speed normalization, terrain material checks, and terrain step-height checks. Water and excessive terrain-height deltas are rejected in the sim; the browser's terrain renderer is visual only.
- Player-submitted rename messages are trimmed, capped at 20 characters, restricted to ASCII letters, digits, `-`, and `_`, and rejected without mutation when invalid.
- Pending and active player display names are unique case-insensitively within the running shard; active names are tracked by authoritative simulation state instead of render-snapshot scans. This prevents same-shard impersonation and duplicate pending tickets but is not a substitute for durable account or character-name reservations.
- `REQUIRE_ACCOUNT=true` requires valid `Authorization: Bearer ...` account authentication before `/api/session` mints a WebSocket ticket. `ACCOUNT_AUTH_MODE=dev-token` is the temporary shared-secret mode and does not provide a durable account subject. `ACCOUNT_AUTH_MODE=jwt-hs256` validates signed JWTs with required `sub` and `exp`, optional issuer/audience checks, and binds the accepted bounded printable subject into the issued ticket as `accountSubject`. Ticketed spawns carry that subject into player snapshots, ownership journal events, settlement receipts, and `/admin/ownership`. This is still a PoC boundary, but it proves session issuance can fail closed behind account authentication and carry account identity forward. Rejections are exposed through `sundermere_account_auth_rejected_total`, and `scripts/account-settlement-smoke.js` verifies the end-to-end account-to-ownership path.
- JWT-authenticated session issuance is rate-limited by account subject after auth and before request-body parsing, using `ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE`, `ACCOUNT_SESSION_RATE_LIMIT_BURST`, and `ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS`. Rejections are visible through `sundermere_session_account_rate_limited_total`, with account-limiter gauges in `/metrics` and `/admin/summary`. This is still in-process PoC state; shared deployments with multiple sim processes should move the same budget to Redis, the account service, or the shard/router layer.
- Rejected client messages are recorded in the event journal.
- WebSocket connections close after `CLIENT_REJECT_LIMIT` rejected client messages on that socket, preventing persistent malformed traffic from occupying shard capacity.
- The browser client defensively decodes server WebSocket frames before mutating local render state, so malformed JSON, unknown message types, impossible snapshot values, oversized player/object lists, and unsupported object kinds are ignored instead of driving UI state. `scripts/client-protocol-smoke.js` exercises the live server through that same parser so server/client contract drift, such as an unsupported color format, fails the local gate instead of leaving the page blank.
- Journal events are appended to a durable JSONL audit file, configurable with `JOURNAL_PATH`, and a bounded recent window is replayed into admin inspection on boot via `JOURNAL_RETAINED_EVENTS`.
- `MAX_DURABLE_LINE_BYTES` caps each journal/outbox JSONL replay line before UTF-8 decoding and JSON parsing; the cap is visible as `maxDurableLineBytes` plus `sundermere_max_durable_line_bytes`.
- `DURABLE_SYNC_WRITES=true` forces journal and settlement outbox appends through an OS sync-data call after flush and is visible as `durableSyncWrites` plus `sundermere_durable_sync_writes`.
- Journal and settlement outbox append failures after startup increment `sundermere_durable_journal_persist_failed_total` and `sundermere_durable_settlement_persist_failed_total`; `/admin/summary` exposes the same counts for operator dashboards.
- `/admin/events` clamps each response with `ADMIN_EVENT_LIMIT_CAP`, supports a retained-window `after=<sequence>` cursor for bounded audit inspection, and exposes the configured cap through `/admin/summary` plus `/metrics`.
- Non-increasing durable journal sequence observations are exposed as `journalSequenceAnomalies` and `sundermere_journal_sequence_anomalies` for audit review.
- Gameplay-affecting resource gather and starter craft journal events are covered by a restart/replay smoke so inventory mutations cannot silently become live-only evidence.
- Settlement jobs are appended to a durable JSONL outbox before queueing, configurable with `SETTLEMENT_OUTBOX_PATH`.
- Settlement replay is idempotent by settlement job ID, so duplicate queued/confirmed outbox records do not double-count pending jobs, receipts, or ownership.
- Confirmed settlement receipts seed an admin-visible ownership index at `/admin/ownership`, including the authenticated JWT account subject when one was present on the original job.
- The full-world debug snapshot at `/api/snapshot` is admin-token protected whenever `ADMIN_TOKEN` is configured, capped with `MAX_ADMIN_SNAPSHOT_BYTES`, and rejected with `413` if it exceeds the cap.
- `/readyz` exposes deploy/load-balancer readiness without requiring admin access and returns unavailable when durable journal/outbox files, their parent directories, durable append health, strict-session admission capacity, or drain mode are not ready.
- `DRAINING=true` gives deploy and rollback tooling a fail-closed admission switch: `/readyz` returns `503`, `/api/session` refuses new tickets, and admin/metrics keep exposing state for operators. Deployment preflight rejects drained shared/production boots unless `--allowDraining` is passed for intentional maintenance.
- `/metrics` exposes runtime counters/gauges for active WebSocket connections, accepted/rejected client messages, WebSocket ingress limits, account/admin/metrics auth failures, Origin rejects, session ticket rejects, pending-ticket capacity rejects, drain-mode session rejects, invalid session request bodies, display-name validation/conflict rejects, IP and account session issue rate-limit config and bucket pressure, WebSocket capacity rejects, outbound bytes, last/max outbound message and snapshot sizes, interest-filtered snapshot player/object counts, admin snapshot cap/rejections, snapshots, send errors, tick duration/overruns, session ticket pressure, account gate config, admission capacity, settlement backlog, content object count, journal retention, durable replay line cap, durable sync-write mode, durable append failures, admin event query cap, and settlement outbox size.
- `/metrics` and `/admin/summary` expose the configured HTTP body limit so deployed shards can be audited.
- Snapshot cadence is configurable with `SNAPSHOT_INTERVAL_MS` so shared environments can reduce bandwidth/serialization pressure without changing server authority.
- Snapshot interest radius is configurable with `INTEREST_RADIUS`, and visible in `/metrics` plus `/admin/summary`, so shard operators can tune per-client payload size without widening full-world debug access. Last/max message bytes, snapshot bytes, and snapshot player/object gauges make payload growth and visibility fanout visible during load tests.
- Serialized welcome/snapshot payloads are capped with `MAX_SNAPSHOT_BYTES`, surfaced through `/metrics` and `/admin/summary`, and rejected before send if they exceed the cap.
- The server handles Ctrl-C/SIGTERM with graceful shutdown so deploys and local verification can stop it without abruptly dropping the listener.
- Invalid boolean or numeric environment values fail startup instead of silently falling back to defaults.
- World content must match the supported schema version before boot, include the required `registrar` and `field-forge` objects with their expected kinds, declare the validated `duskfell-terrain-v1` terrain profile, keep safe-zone and object footprints inside map bounds, stay within `MAX_CONTENT_OBJECTS`, and expose a stable content fingerprint plus object count in admin summary. The same terrain profile drives server-side walkability and the browser terrain projection.
- `scripts/content-schema-smoke.js` verifies unsupported world content schema fails startup before serving clients.
- `scripts/content-contract-smoke.js` verifies missing or mis-typed required registrar content fails startup before serving clients.
- `scripts/content-size-smoke.js` verifies oversized world content fails startup before serving clients.
- `scripts/account-auth-smoke.js` verifies missing/wrong account bearer tokens reject session issuance and do not fall through to body parsing or ticket minting.
- `scripts/account-session-rate-limit-smoke.js` verifies authenticated JWT session issuance is throttled by account subject independently of the client-IP limiter.
- `scripts/account-settlement-smoke.js` verifies a JWT-authenticated player can claim a deed and the same `accountSubject` reaches the snapshot, receipt, ownership endpoint, and journal.
- `scripts/durable-corruption-smoke.js` verifies malformed journal JSONL, oversized durable JSONL lines, and malformed or semantically invalid settlement outbox JSONL fails startup before serving clients.
- `scripts/durable-sync-smoke.js` verifies synced durable appends work through a real deed claim and are visible in admin summary plus metrics.

## Production Requirements

- Replace local session tickets with authenticated account sessions before spawning players.
- Store sessions in Redis or another shared low-latency store when more than one sim process is running.
- Enforce admission limits at the shard/router boundary in addition to per-process limits.
- Move in-process IP and account session-issue rate-limit buckets to Redis or the account/router layer so limits apply across sim processes.
- Move JSONL audit persistence to Postgres append-only tables before public testing.
- Move JSONL settlement outbox persistence to Postgres with unique constraints and transactional job creation.
- Move the in-memory ownership index to a durable indexed table fed by confirmed settlement receipts or chain events.
- Persist ownership-affecting actions before settlement queue publish.
- Keep settlement jobs idempotent and uniquely constrained across both replay and live queue paths.
- Keep private keys out of the sim server.
- Use least-privilege RPC credentials for the settlement service.
- Verify contract events with an indexer before marking final settlement.
- Add admin audit logs for grants, revokes, teleports, and repairs.
- Run `npm run verify:supply-chain` locally to catch Node dependency drift, non-crates.io direct Rust dependencies, missing lockfile checksums, git lock sources, and locked build-graph resolution failures.
- Add a deeper CI dependency audit with advisory and full transitive license tooling once the Cargo toolchain can parse all locked target-specific packages.
- Keep public-deployment startup checks current as new local-only debug surfaces are added.
