# Duskfell PoC

Open-world sandbox MMO with an async blockchain settlement boundary.

The PoC currently proves the first production-shaped loop:

- Rust authoritative simulation server with `bevy_ecs`.
- Browser canvas client connected by WebSocket.
- Versioned original world content loaded from `server/data/world.json`.
- Machine-checked clean-room sprite manifest contract for 45-degree plan-oblique assets.
- Browser-side SHA-256 verification of fetched sprite and terrain PNG bytes before rendering.
- Server startup byte-budget and SHA-256 verification of sprite/terrain manifests and PNG bytes before the shard listens.
- Server-owned movement and interaction, including normalized diagonal movement so combined inputs do not exceed the speed budget.
- Short-lived session tickets before WebSocket spawn, with optional strict mode and per-client-IP issue rate limits for shared environments.
- Public deployment startup guardrails that refuse unsafe local defaults when explicitly enabled.
- Configurable max-active WebSocket admission control before player entities are created.
- Configurable WebSocket heartbeat and stale-connection timeout.
- Interest-filtered WebSocket snapshots so clients receive nearby shard state instead of the full world.
- Server-authoritative resource gathering from original grove/ore nodes into bounded per-player inventory stacks, with resource summaries and journaled gather events.
- Server-authoritative starter crafting at the Field Forge, consuming `wood + ore` into a crafted inventory item with a journaled craft event.
- A dry-run "Title Office" deed claim that updates gameplay instantly.
- Async settlement worker that confirms the ownership job after the sim has moved on.
- JWT account subjects propagated from session issuance into player snapshots, ownership journal events, settlement receipts, and the admin-visible ownership ledger.
- Admin runtime report for Duskfell/Base `$DUSK` build identity, world content fingerprint, and checked sprite/terrain asset pins.
- Append-only in-memory event journal with local admin inspection endpoints.
- Durable JSONL audit trail for journal events at `var/journal.jsonl`, replayed into admin inspection on boot.
- Durable JSONL settlement outbox at `var/settlement-outbox.jsonl`, replayed on boot.
- Idempotent settlement replay so duplicate queued/confirmed outbox events do not double-count pending jobs, receipts, or ownership.
- Prometheus-style runtime counters and gauges at `/metrics` for WebSocket flow, payload sizes, admission, admission rejections, simulation, settlement, content, journal, and outbox state.
- Explicit docs for security, clean-room boundaries, and the later Base/Foundry `$DUSK` path.

## Run

```sh
cargo run -p sundermere-server
```

Then open [http://127.0.0.1:4107](http://127.0.0.1:4107).

Use WASD or arrow keys to move. Press `E` near groves or ore veins to gather inventory resources, near the Field Forge to craft a Trail Kit from `wood + ore`, or near the Title Office to claim a dry-run deed. The deed appears immediately in the game state, while the settlement worker confirms the queued job asynchronously. Settlement jobs are durably appended before worker handoff, and a full settlement queue is surfaced through readiness and metrics instead of blocking the simulation tick.

## Container

Build and smoke-test the deployment image:

```sh
npm run smoke:container
```

The smoke builds `duskfell-poc:smoke`, starts it with hardened public-mode
environment variables, verifies `/healthz`, `/readyz`, token-protected
`/admin/runtime`, token-protected `/metrics`, the non-root image user, and the
container healthcheck, then removes the container. It requires a running Docker
daemon and network access to the configured base images.

For a shared demo, run the image with explicit public deployment guardrails:

```sh
docker build --build-arg GIT_SHA="$(git rev-parse HEAD)" -t duskfell-poc:local .
docker run --rm -p 127.0.0.1:4107:4107 \
  -e PUBLIC_DEPLOYMENT=true \
  -e REQUIRE_SESSION=true \
  -e REQUIRE_ACCOUNT=true \
  -e ACCOUNT_AUTH_MODE=dev-token \
  -e DEV_ACCOUNT_TOKEN=replace-with-strong-account-token \
  -e ADMIN_TOKEN=replace-with-strong-admin-token \
  -e METRICS_TOKEN=replace-with-strong-metrics-token \
  -e ALLOWED_ORIGINS=http://127.0.0.1:4107 \
  -v duskfell-data:/data \
  duskfell-poc:local
```

The image listens on `0.0.0.0:4107` inside the container, runs as
`duskfell:duskfell`, serves bundled `client/`, `assets/`, and
`server/data/world.json`, writes JSONL journal/outbox state under `/data`, and
uses `/readyz` for its Docker healthcheck. Pass `GIT_SHA` at build time so
`/admin/runtime` and the OCI `org.opencontainers.image.revision` label identify
the exact source revision. Real public deployments should use JWT account mode,
distinct high-entropy secrets, exact HTTPS origins, and a persistent volume or
managed durable store.

## Development Commands

```sh
npm run doctor:server
npm run verify:ci
npm run verify:local
```

Or run the individual checks:

```sh
cargo fmt --all
cargo check --workspace
cargo test --workspace
npm run test:client
npm run test:sprites
npm run assets:verify
npm run doctor:server
npm run smoke:deployment-preflight
npm run smoke:account-auth
npm run smoke:account-jwt-auth
npm run smoke:account-session-rate-limit
npm run smoke:account-settlement
npm run smoke:assets
npm run smoke:admin-auth
npm run smoke:bad-config
npm run smoke:client-protocol
npm run smoke:container
npm run smoke:content-schema
npm run smoke:deploy-audit
npm run smoke:deed
npm run smoke:drain-mode
npm run smoke:ops-snapshot
npm run smoke:external-bind-guard
npm run smoke:gameplay-journal-replay
npm run smoke:crafting
npm run smoke:http-hardening
npm run smoke:journal-anomaly
npm run smoke:journal-replay
npm run smoke:metrics-auth
npm run smoke:metrics
npm run smoke:movement-authority
npm run smoke:origin-allowlist
npm run smoke:public-deployment
npm run smoke:readiness
npm run smoke:resource-gather
npm run smoke:restart-reconcile
npm run smoke:runtime-asset-integrity
npm run smoke:runtime-manifest
npm run smoke:settlement-idempotency
npm run smoke:trace-redaction
npm run smoke:shutdown
npm run smoke:session-capacity
npm run smoke:ws-admission-preflight
npm run smoke:ws-idle-timeout
npm run bench:ws -- --clients 20 --durationMs 5000 --inputHz 10
```

## Project Shape

```text
client/      Static browser client for the PoC
assets/      Clean-room sprite manifest and future generated/approved sheets
server/      Rust authoritative sim, content loading, WebSocket API, settlement queue stub
contracts/   Foundry contract notes and future ERC-721/ERC-1155 boundary
docs/        Architecture, security, clean-room process
```

Important current docs:

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Rendering](docs/rendering.md)
- [Art Pipeline](docs/art-pipeline.md)
- [Reference Research](docs/reference-research.md)

## Local Inspection

These endpoints are intended for local development and early operations work:

Run `npm run doctor:server` against a running local server when the browser page
looks wrong or unreachable. It checks the listener on `127.0.0.1:4107`, `/`,
`/healthz`, `/readyz`, `/admin/summary`, `/metrics`, and a live WebSocket session.
Use `npm run doctor:server -- --url http://127.0.0.1:<port>` for a non-default
local port.

- `GET /api/snapshot` returns the full debug/admin world snapshot. When `ADMIN_TOKEN` is set, it requires `x-admin-token`, and `MAX_ADMIN_SNAPSHOT_BYTES` caps the serialized response.
- `GET /healthz` returns a lightweight liveness response.
- `GET /readyz` returns readiness JSON and uses `503` when runtime dependencies, settlement queue health/capacity, durable file parent directories, durable append health, admission capacity, or drain mode are not ready.
- `POST /api/session` issues a short-lived, single-use WebSocket session ticket. It may accept JSON like `{"name":"Wayfarer"}`; the server validates the display name, rejects names already pending or active on the shard, and binds the accepted name to the one-use ticket before player spawn. When `REQUIRE_ACCOUNT=true`, the request must include a valid `Authorization: Bearer ...` account token before a ticket can be minted.
- `GET /metrics` returns Prometheus-style runtime counters and gauges, including WebSocket flow, outbound payload sizes, interest-filtered snapshot player/object counts, admin snapshot cap state, tick/player counts, tick timing/overruns, settlement counts, settlement queue pressure/capacity, content object count, admission limits, admission rejection counters, account-auth rejections, Origin allowlist state, session issue rate limits, invalid session request bodies, display-name rejections, durable persistence failures, and pending session tickets.
- `GET /admin/summary` returns tick/player/journal/settlement/admission counters plus the loaded content manifest.
- `GET /admin/summary` includes active JSONL journal and settlement outbox paths.
- `GET /admin/runtime` returns the running Duskfell/Base `$DUSK` identity, server crate/version, loaded content manifest, sprite manifest pins, terrain manifest pins, and server-verified asset hash status.
- `GET /admin/events?limit=50` returns the recent retained journal window, clamped by `ADMIN_EVENT_LIMIT_CAP`. Add `after=<sequence>` to return retained events newer than a known journal sequence for bounded audit cursors.
- `GET /admin/ownership` returns the current receipt-backed asset ownership index.

Set `ADMIN_TOKEN` to require an `x-admin-token` header on admin endpoints and the full debug `/api/snapshot`. Without `ADMIN_TOKEN`, these local inspection endpoints are open on the local dev server only; do not expose that mode publicly.
Set `METRICS_TOKEN` to require an `x-metrics-token` header on `/metrics`. Without `METRICS_TOKEN`, metrics are open for local development only; do not expose that mode publicly.
When `PUBLIC_DEPLOYMENT=true`, the selected account credential, `ADMIN_TOKEN`, and `METRICS_TOKEN` must be distinct, have no surrounding whitespace, avoid placeholder text, and be at least 24 bytes long.

Set `REQUIRE_SESSION=true` to reject `/ws` connections unless they include a valid `?session=...` ticket issued by `POST /api/session`. Tickets are short-lived and single-use. Ticketed WebSocket connections use the issued `sessionId` as the spawned `playerId`, so session issuance, welcome messages, journal events, and settlement jobs share the same identity. If session issuance includes a `name`, the same bounded player-name validator used by rename messages trims and checks it before a ticket is minted, rejects case-insensitive collisions with pending ticket names or active player names, then applies it exactly once at spawn. The spawn path re-checks active-name uniqueness when the ticket is consumed so delayed connects cannot race into duplicate visible identities. The default remains anonymous-dev compatible so local iteration and older scripts do not break.
Set `SESSION_TICKET_TTL_SECONDS` and `SESSION_TICKET_CAPACITY` to tune pending ticket lifetime and capacity.
Set `REQUIRE_ACCOUNT=true` to require account authentication before `/api/session` issues a WebSocket ticket. `ACCOUNT_AUTH_MODE=dev-token` uses a temporary `DEV_ACCOUNT_TOKEN` bearer token for quick hardened demos and does not provide durable account identity. `ACCOUNT_AUTH_MODE=jwt-hs256` validates a signed HS256 JWT bearer token with required `sub` and `exp` claims, plus optional `ACCOUNT_JWT_ISSUER` and `ACCOUNT_JWT_AUDIENCE` checks. Accepted JWT subjects are bounded, printable ASCII, and bound into the issued session ticket as `accountSubject`; ticketed spawns carry that subject into player snapshots, ownership journal events, settlement receipts, and `/admin/ownership`. This is still a PoC account boundary; production should move to managed account/OAuth/JWKS or wallet-auth with durable account and character records.
Set `SESSION_ISSUE_RATE_LIMIT_PER_MINUTE`, `SESSION_ISSUE_RATE_LIMIT_BURST`, and `SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS` to tune the per-client-IP token bucket on `POST /api/session`. The limiter runs before request-body display-name validation, so malformed or invalid-name issue attempts consume the same abuse budget as valid ticket requests. Defaults are `120` per minute, burst `30`, and `4096` tracked client-IP buckets.
Set `ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE`, `ACCOUNT_SESSION_RATE_LIMIT_BURST`, and `ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS` to tune the per-account-subject token bucket on authenticated JWT session issuance. The limiter runs after account authentication but before request-body display-name validation, so malformed authenticated issue attempts consume the same account budget as valid ticket requests. Defaults are `60` per minute, burst `10`, and `4096` tracked account-subject buckets.
Set `ALLOWED_ORIGINS` to a comma-separated list of exact HTTP(S) origins to require matching `Origin` headers on `POST /api/session` and `/ws` upgrades. Leave it unset or empty for local dev. Example: `ALLOWED_ORIGINS=https://play.example.com,http://localhost:4107`.
Set `PUBLIC_DEPLOYMENT=true` for any shared or internet-reachable environment. In that mode the server refuses to boot unless `REQUIRE_SESSION=true`, `REQUIRE_ACCOUNT=true`, a strong non-placeholder account credential for the selected `ACCOUNT_AUTH_MODE`, strong distinct non-placeholder `ADMIN_TOKEN` and `METRICS_TOKEN` values, and `ALLOWED_ORIGINS` are all configured, preventing the local-dev open endpoints from being exposed by accident. Public JWT mode also requires `ACCOUNT_JWT_ISSUER` and `ACCOUNT_JWT_AUDIENCE`.
Set `DRAINING=true` before planned rollback or shard removal to keep `/healthz` alive while `/readyz` returns `503` and new `/api/session` admissions return `503`. The state is visible in `/admin/summary` and `/metrics` as `sundermere_draining`, and rejected admissions increment `sundermere_session_draining_rejected_total`. Deployment preflight rejects drained shared/production boots unless `--allowDraining` is passed for an intentional maintenance rollout.
Set `BIND_ADDR` to choose the listener address. The default is `127.0.0.1:4107`. Non-loopback binds such as `0.0.0.0:4107` require `PUBLIC_DEPLOYMENT=true` and the public deployment guardrails above.
`CHAIN_ENABLED=true` is still a local-only settlement stub. Public deployments refuse to start with chain mode enabled until signer and indexer configuration are implemented.

Run the deployment preflight before starting any shared environment:

```sh
npm run preflight:deployment
```

After a shared PoC deployment is running, audit the live shard:

```sh
node scripts/deploy-audit.js \
  --url https://play.example.com \
  --profile shared-poc \
  --adminToken "$ADMIN_TOKEN" \
  --metricsToken "$METRICS_TOKEN" \
  --expectedGitSha "$GIT_SHA"
```

The audit checks health/readiness, token protection on `/admin/runtime` and
`/metrics`, Duskfell/Base `$DUSK` runtime identity, build Git SHA when provided,
content/runtime consistency, verified sprite and terrain asset pins, public-mode
guardrails, Origin allowlist posture, non-draining admission posture, WebSocket
and session-ticket admission headroom, durable persistence failure counters, and
settlement queue capacity.

For incident notes or rollback triage, capture a bounded redacted operations
snapshot:

```sh
node scripts/ops-snapshot.js \
  --url https://play.example.com \
  --adminToken "$ADMIN_TOKEN" \
  --metricsToken "$METRICS_TOKEN" \
  --out "var/ops-snapshot-$(date +%Y%m%d%H%M%S).json"
```

The snapshot includes runtime identity, content and asset fingerprints,
readiness, public/admission posture, selected metrics, journal/outbox counters,
recent event type counts, and ownership counts. It intentionally excludes full
`/api/snapshot`, raw event payloads, account subjects, player IDs, token values,
and absolute durable file paths.

The default `shared-poc` profile checks the public-mode environment without starting the server. It expects hardened PoC deployment variables such as `PUBLIC_DEPLOYMENT=true`, strict sessions, account auth, strong distinct non-placeholder credentials, exact allowed Origins, sane positive capacity and payload budgets, non-draining admission posture, and chain mode disabled. Use `npm run preflight:deployment -- --profile production` to see the fail-closed list of missing production systems; today that profile intentionally fails until durable datastore, signer/indexer, and cross-process admission/rate-limit services exist. The identity blocker clears only when `ACCOUNT_AUTH_MODE=jwt-hs256` includes a strong secret, issuer, and audience. For an intentional rollback or shard-removal rollout, pass `--allowDraining` so `DRAINING=true` remains explicit in the deploy command.
Set `HTTP_BODY_LIMIT_BYTES` to cap plain HTTP request bodies. The default is `4096`, which is enough for current session/admin traffic and prevents oversized POST bodies from occupying shard work.
Every HTTP response includes `x-request-id`. If an upstream proxy sends a safe bounded `x-request-id`, the server echoes it; otherwise the server generates a UUID. Unsafe request IDs with spaces, separators, control characters, or more than 64 bytes are replaced rather than reflected.
Set `ADMIN_EVENT_LIMIT_CAP` to cap a single `/admin/events` response. The default is `200`; the endpoint default query limit is `50`.
Set `MAX_CONTENT_OBJECTS` to cap world content objects accepted at startup. The default is `10000`; oversized content files fail before the server listens.
Set `MAX_JOURNAL_BYTES` to cap the durable JSONL journal accepted at startup. The default is `16777216`; oversized journal files fail before the server listens.
Set `MAX_SETTLEMENT_OUTBOX_BYTES` to cap the durable settlement outbox accepted at startup. The default is `16777216`; oversized outbox files fail before replay or serving clients.
Set `MAX_DURABLE_LINE_BYTES` to cap each JSONL line accepted during journal and settlement outbox replay. The default is `262144`; oversized lines fail before JSON parsing so one record cannot allocate the whole durable-file budget.
Set `DURABLE_SYNC_WRITES=true` to make journal and settlement outbox appends call `sync_data()` after flushing. The default is `false` for local iteration speed; shared PoC environments can enable it for stronger crash semantics while the project is still on JSONL.
Set `MAX_RUNTIME_MANIFEST_BYTES` to cap each sprite or terrain manifest JSON checked by the server at startup. The default is `262144`; oversized runtime asset manifests fail before the server listens.
Set `MAX_RUNTIME_ASSET_BYTES` to cap each sprite or terrain PNG checked by the server at startup. The default is `2097152`; oversized runtime asset images fail before the server listens.
Set `MAX_ACTIVE_CONNECTIONS` to cap concurrent WebSocket players before spawning sim entities. The default is `512`.
Set `MAX_CONNECTIONS_PER_IP` to cap concurrent WebSocket players from one peer IP before spawning sim entities. The default is `64`.
Set `SNAPSHOT_INTERVAL_MS` to tune per-client WebSocket snapshot cadence. The default is `50`, matching the 20 Hz sim tick; higher values reduce bandwidth and serialization work at the cost of visual update rate.
Set `INTEREST_RADIUS` to tune how many world units around each player are included in WebSocket snapshots. The default is `520`. Lower values reduce per-client payload size; `/api/snapshot` remains a full admin/debug snapshot.
Set `MAX_SNAPSHOT_BYTES` to cap serialized WebSocket welcome/snapshot payloads. The default is `65536`; payloads above the cap are rejected and the connection is closed instead of sending an unexpectedly large update.
Set `MAX_ADMIN_SNAPSHOT_BYTES` to cap the serialized full debug/admin `/api/snapshot` response. The default is `262144`; oversized debug snapshots return `413` and increment `sundermere_admin_snapshot_payload_rejected_total`.
Set `WS_HEARTBEAT_SECONDS` and `WS_IDLE_TIMEOUT_SECONDS` to tune WebSocket ping cadence and stale-connection eviction. Defaults are `30` and `180`; the idle timeout must be greater than the heartbeat interval.
Set `WS_MAX_TEXT_BYTES`, `WS_MESSAGE_BURST`, and `WS_MESSAGE_REFILL_PER_SECOND` to tune per-socket text-frame size and token-bucket ingress limits. Defaults are `4096`, `20`, and `30`.
Set `CLIENT_REJECT_LIMIT` to close a WebSocket after repeated rejected client messages on that connection. The default is `8`.
Invalid boolean or numeric environment values fail startup instead of silently falling back to defaults.

Set `JOURNAL_PATH` to override the durable append-only audit file. The default is `var/journal.jsonl`, which is ignored by git.
Set `SETTLEMENT_OUTBOX_PATH` to override the durable settlement outbox. The default is `var/settlement-outbox.jsonl`, which is ignored by git.

World content must declare `schemaVersion: "sundermere-world-v1"`, keep the safe zone and object footprints inside map bounds, and include the required `registrar` object with kind `registrar` so the demo title-office interaction cannot boot in a silently broken state. The server exposes the loaded content schema, stable hash, object count, and configured object cap in `/admin/summary` and `/metrics`.

Note: `/api/snapshot` is a full debug/admin snapshot and should be token-protected outside local dev. WebSocket `welcome` and `snapshot` messages are interest-filtered around the connected player.

## Load Smoke

Run the CI-shaped gate locally:

```sh
npm run verify:ci
```

The command runs Rust formatting, locked Rust check/tests, supply-chain smoke,
client projection/protocol/asset-loader tests, sprite and terrain manifest tests,
runtime asset verification, deploy/preflight smokes, startup/config/content
guard smokes, durable replay/corruption/sync smokes, account/admin/metrics auth
smokes, public deployment guardrails, ops snapshot/runtime provenance smokes,
readiness/metrics smokes, trace redaction smoke, session/admission smokes,
movement and interest-radius authority smokes, journal/restart/settlement replay
smokes, WebSocket abuse and admission-ordering/payload-cap smokes, and git
whitespace checks. GitHub Actions runs the same command on pushes to `main` and
`codex/**`, pull requests, and manual dispatches.

Run the broad local verification gate:

```sh
npm run verify:local
```

The command runs Rust formatting/tests, supply-chain smoke, client projection/protocol/asset-loader tests, sprite manifest tests, sprite asset verification, deployment preflight smoke, asset serving smoke, bad-config startup smoke, public chain-mode guard smoke, local chain-stub honesty smoke, external bind guard smoke, HTTP hardening smoke, bad-content-schema startup smoke, bad-content-contract startup smoke, bad-content-size startup smoke, durable-file-size startup smoke, durable-corruption startup smoke, durable-sync smoke, dev-token account auth smoke, JWT account auth smoke, account session rate-limit smoke, account-bound settlement smoke, admin auth smoke, admin event-limit smoke, admin snapshot-size smoke, metrics auth smoke, Origin allowlist smoke, public deployment guard smoke, metrics smoke, readiness smoke, trace redaction smoke, session ticket capacity smoke, session ticket expiry smoke, expired-ticket WebSocket rejection smoke, session issue rate-limit smoke, interest-radius smoke, movement authority smoke, journal anomaly smoke, journal replay smoke, gameplay journal replay smoke, settlement idempotency smoke, restart reconciliation smoke, graceful shutdown smoke, WebSocket admission preflight smoke, WebSocket ingress config smoke, WebSocket snapshot-size smoke, WebSocket payload-metrics smoke, WebSocket peer-capacity smoke, stale-WebSocket timeout smoke, a side-port client protocol smoke, a side-port deed smoke, a side-port resource-gather smoke, a side-port crafting smoke, a side-port WebSocket load smoke, and a side-port capacity smoke.

Run the live server doctor against an already-running development server:

```sh
npm run doctor:server
```

The command checks the local listener, health/readiness, root HTML, admin summary,
metrics, and one WebSocket join. It does not start or stop the server.

Run the redacted operations snapshot smoke:

```sh
npm run smoke:ops-snapshot
```

The command starts a hardened isolated server, captures an operations snapshot,
and verifies the output keeps tokens plus absolute durable paths out of the
artifact while preserving runtime identity, readiness, metrics, journal, and
settlement summaries.

Run the drain-mode smoke:

```sh
npm run smoke:drain-mode
```

The command starts an isolated drained shard, verifies `/healthz` remains live,
`/readyz` reports unavailable with `shardNotDraining`, `/api/session` returns
`503`, and admin/metrics expose the drain state plus rejected-admission counter.

Run the HTTP hardening smoke:

```sh
npm run smoke:http-hardening
```

The command verifies security headers, response cache policy, generated and
forwarded `x-request-id` behavior, admin/metrics visibility of
`HTTP_BODY_LIMIT_BYTES`, and `413` rejection for oversized HTTP request bodies.

Run the trace redaction smoke:

```sh
npm run smoke:trace-redaction
```

The command starts an isolated strict-session server with HTTP trace logging enabled, attempts a WebSocket upgrade with a sentinel `?session=` token, and verifies the trace logs include only the sanitized path without the query string or token value.

Run the supply-chain smoke:

```sh
npm run verify:supply-chain
```

The command verifies the Node package has no runtime/dev dependency sections, workspace Rust packages declare `MIT`, direct Rust dependencies come from crates.io, `Cargo.lock` has no git sources, registry entries include checksums, and the active build graph resolves from the lockfile.

Run the sprite manifest verifier:

```sh
npm run assets:verify
```

The command validates `assets/sprites/manifest.json` against the current client projection contract, rejects `64x32`/dimetric drift, checks clean-room provenance, non-placeholder generator audit fields, render metadata, and prompt hygiene, and validates PNG sheet dimensions when sheet files are listed.

Run the asset serving smoke:

```sh
npm run smoke:assets
```

The command starts an isolated server and verifies `/assets/sprites/manifest.json` and the placeholder PNG sheet are served with dimensions matching the manifest.

Run the live client protocol smoke against a running server:

```sh
npm run smoke:client-protocol
```

The command gets a session ticket, connects over WebSocket, parses the live welcome and snapshot with the same defensive browser parser used by `client/app.js`, and verifies the parsed snapshot contains visible players, objects, and client-compatible hex colors.

Run the bad-config smoke:

```sh
npm run smoke:bad-config
```

The command starts the server with an invalid env var and expects startup to fail with the config key named in the error.

Run the HTTP hardening smoke:

```sh
npm run smoke:http-hardening
```

The command verifies security headers, asset cache headers, admin/metrics visibility of `HTTP_BODY_LIMIT_BYTES`, and `413` rejection for oversized HTTP request bodies.

Run the external bind guard smoke:

```sh
npm run smoke:external-bind-guard
```

The command verifies a non-loopback `BIND_ADDR` refuses to boot unless public deployment mode is explicitly enabled.

Run the content schema smoke:

```sh
npm run smoke:content-schema
```

The command starts the server with a temporary world file using an unsupported `schemaVersion` and expects startup to fail before serving clients.

Run the content contract smoke:

```sh
npm run smoke:content-contract
```

The command starts isolated servers with missing or mis-typed required registrar content and expects startup to fail before serving clients.

Run the content size smoke:

```sh
npm run smoke:content-size
```

The command starts the server with a valid but oversized temporary world file and `MAX_CONTENT_OBJECTS=1`, then expects startup to fail before serving clients.

Run the durable size smoke:

```sh
npm run smoke:durable-size
```

The command starts isolated servers with oversized journal and settlement outbox files, then expects startup to fail before serving clients.

Run the durable corruption smoke:

```sh
npm run smoke:durable-corruption
```

The command starts isolated servers with malformed journal JSONL, oversized durable JSONL lines, and malformed or semantically invalid settlement outbox JSONL, then expects startup to fail before serving clients.

Run the durable sync smoke:

```sh
npm run smoke:durable-sync
```

The command starts an isolated strict-session server with `DURABLE_SYNC_WRITES=true`, claims a deed, and verifies admin summary, metrics, journal bytes, and settlement outbox bytes all reflect synced durable appends.

Run the admin auth smoke:

```sh
npm run smoke:admin-auth
```

The command starts an isolated server with `ADMIN_TOKEN` set, verifies admin endpoints and the full debug `/api/snapshot` reject missing/wrong tokens, verifies the right token works, and checks health/session endpoints remain usable.

Run the account auth smoke:

```sh
npm run smoke:account-auth
```

The command starts an isolated server with `REQUIRE_ACCOUNT=true`, verifies `/api/session` rejects missing or wrong bearer account tokens before parsing the request body, verifies the right bearer issues a ticket, and checks account-auth summary plus metrics visibility.

Run the JWT account auth smoke:

```sh
npm run smoke:account-jwt-auth
```

The command starts an isolated server with `ACCOUNT_AUTH_MODE=jwt-hs256`, verifies missing, wrongly signed, expired, wrong-audience, and empty-subject JWT bearer tokens are rejected before ticket issuance, verifies a correct JWT mints a ticket with `accountSubject`, and checks account-auth summary plus metrics visibility.

Run the account session rate-limit smoke:

```sh
npm run smoke:account-session-rate-limit
```

The command starts an isolated JWT-gated server with a tight account-subject issue budget, verifies an invalid authenticated display-name request consumes account budget, verifies one valid ticket issues, and verifies the next request from the same `accountSubject` returns `429` with account limiter summary and metrics visibility.

Run the account-bound settlement smoke:

```sh
npm run smoke:account-settlement
```

The command starts an isolated JWT-gated server, issues an account-bound session, claims a dry-run deed over WebSocket, and verifies the same `accountSubject` appears in the player snapshot, settlement receipt, `/admin/ownership`, and ownership journal events.

Run the admin event-limit smoke:

```sh
npm run smoke:admin-events-limit
```

The command starts an isolated strict-session server with `ADMIN_EVENT_LIMIT_CAP=3`, creates real join/leave journal events, verifies oversized `/admin/events?limit=999` reads are clamped, verifies `after=<sequence>` returns a bounded newer-than cursor range, and checks admin/metrics visibility.

Run the admin snapshot-size smoke:

```sh
npm run smoke:admin-snapshot-size
```

The command starts an isolated admin-protected server with a tiny `MAX_ADMIN_SNAPSHOT_BYTES`, verifies the full debug `/api/snapshot` returns `413`, and checks admin/metrics visibility.

Run the metrics auth smoke:

```sh
npm run smoke:metrics-auth
```

The command starts an isolated server with `METRICS_TOKEN` set, verifies `/metrics` rejects missing/wrong tokens, verifies the right `x-metrics-token` works, and checks health/session endpoints remain usable.

Run the metrics smoke:

```sh
npm run smoke:metrics
```

The command starts an isolated server, verifies `/metrics` exposes parseable runtime counters/gauges including tick timing, issues a session ticket, and verifies the pending-ticket gauge moves.

Run the interest radius smoke:

```sh
npm run smoke:interest-radius
```

The command starts an isolated strict-session server with a tight `INTEREST_RADIUS`, connects multiple clients, and verifies each WebSocket snapshot remains interest-filtered while admin/metrics report the configured radius.

Run the movement authority smoke:

```sh
npm run smoke:movement-authority
```

The command drives cardinal and diagonal movement through real WebSocket clients and verifies diagonal travel stays within the same server-authoritative speed budget.

Run the public deployment smoke:

```sh
npm run smoke:public-deployment
```

The command verifies `PUBLIC_DEPLOYMENT=true` refuses unsafe local defaults, weak public tokens, and placeholder public tokens, then starts an isolated hardened server and checks account bearer protection before session issuance, admin token protection, metrics token protection, strict sessions, Origin allowlisting, and the public-deployment admin/metrics signal.

Run the public chain-mode guard smoke:

```sh
npm run smoke:chain-public-guard
```

The command verifies a hardened `PUBLIC_DEPLOYMENT=true` server still refuses startup when `CHAIN_ENABLED=true`, because the PoC does not yet have signer or indexer configuration.

Run the local chain-stub honesty smoke:

```sh
npm run smoke:chain-local-stub
```

The command starts an isolated local `CHAIN_ENABLED=true` server, claims a deed, and verifies the receipt is marked `needs-signer` with `chainTx: null`, proving local chain mode is still a stub rather than real on-chain finality.

Run the readiness smoke:

```sh
npm run smoke:readiness
```

The command starts an isolated strict-session server, verifies `/readyz` is ready with durable journal/outbox files, parent directories, and durable persistence health present, issues one session ticket to fill the pending-ticket capacity, and verifies `/readyz` returns `503` with the failed check named.

Run the end-to-end deed smoke against a running server:

```sh
npm run smoke:deed
```

The command gets a session ticket, connects over WebSocket, steers the player to the Title Office, claims the dry-run deed, and waits for the settlement receipt to appear in snapshots.

Run the resource gathering smoke against a running server:

```sh
npm run smoke:resource-gather
```

The command gets a session ticket, connects over WebSocket, steers the player to the grove, gathers wood into a bounded inventory stack through server-authoritative interaction, and verifies the resource-gather event is visible through the admin journal.

Run the starter crafting smoke against a running server:

```sh
npm run smoke:crafting
```

The command gets a session ticket, connects over WebSocket, gathers wood and ore, steers the player to the Field Forge, crafts a Trail Kit through server-authoritative recipe validation, verifies the raw resources were consumed, and checks the `itemCrafted` journal event.

Run the journal anomaly smoke:

```sh
npm run smoke:journal-anomaly
```

The command starts an isolated server from a deliberately non-monotonic journal and verifies admin/metrics expose the sequence anomaly count without blocking startup.

Run the journal replay smoke:

```sh
npm run smoke:journal-replay
```

The command starts an isolated strict-session server, records more join/leave journal events than the configured retained window, restarts from the same JSONL journal, and verifies `/admin/events` is rebuilt as a bounded recent window while journal sequence continuity is preserved.

Run the gameplay journal replay smoke:

```sh
npm run smoke:gameplay-journal-replay
```

The command starts an isolated strict-session server, runs the real crafting journey, stops the server, restarts from the same JSONL journal, and verifies the replayed admin window still contains the wood gather, ore gather, and Trail Kit craft events for the same player in sequence.

Run the restart reconciliation smoke:

```sh
npm run smoke:restart-reconcile
```

The command starts an isolated server on a side port, runs the deed smoke, stops the server, restarts with the same JSONL outbox, and verifies `/admin/ownership` is rebuilt from the persisted receipt.

Run the settlement idempotency smoke:

```sh
npm run smoke:settlement-idempotency
```

The command boots from a deliberately duplicated settlement outbox and verifies replay keeps pending jobs, confirmed receipts, and ownership indexed once by settlement job ID.

Run the graceful shutdown smoke:

```sh
npm run smoke:shutdown
```

The command starts an isolated server, verifies health, sends SIGTERM, and expects the process to exit cleanly.

Run the session ticket capacity smoke:

```sh
npm run smoke:session-capacity
```

The command starts an isolated server with one pending-ticket slot, verifies the first `/api/session` succeeds, verifies the second is rejected, and checks admin/metrics visibility.

Run the session ticket expiry smoke:

```sh
npm run smoke:session-expiry
```

The command starts an isolated server with one pending-ticket slot and a one-second ticket TTL, verifies an expired unconsumed ticket is cleaned before the next issue, and checks admin/metrics visibility.

Run the expired-ticket WebSocket rejection smoke:

```sh
npm run smoke:session-expired-ws
```

The command starts an isolated strict-session server with a one-second ticket TTL, waits for a real issued ticket to expire, attempts a raw WebSocket upgrade with that token, and verifies the server rejects it before upgrade/player spawn while recording rejection metrics.

Run the session issue rate-limit smoke:

```sh
npm run smoke:session-rate-limit
```

The command starts an isolated server with a two-request per-IP burst, verifies an invalid display-name request consumes one burst token, verifies one valid `/api/session` request succeeds, verifies the third request is rejected with `429`, and checks admin/metrics visibility for the per-IP token bucket and tracked-client cap.

Run the rename validation smoke:

```sh
npm run smoke:rename-validation
```

The command starts an isolated strict-session server, verifies invalid and unknown-field session request bodies are rejected before ticket issuance, verifies a valid spawn display name is bound to the consumed ticket, verifies pending-name and active-name collisions reject before ticket issuance, verifies display-name rejection metrics, verifies a valid player rename appears in snapshots, verifies an invalid rename is rejected without mutating the player name, and checks rejection metrics plus the admin event journal.

Run the snapshot interval smoke:

```sh
npm run smoke:snapshot-interval
```

The command starts an isolated strict-session server with `SNAPSHOT_INTERVAL_MS=200`, observes a single client, and verifies the slower cadence is visible in admin summary, metrics, and snapshot count.

Run the stale WebSocket timeout smoke:

```sh
npm run smoke:ws-idle-timeout
```

The command starts an isolated strict-session server with short heartbeat/idle settings, opens a raw WebSocket connection that never responds to ping frames, and verifies the server closes it and increments idle-timeout metrics.

Run the WebSocket admission preflight smoke:

```sh
npm run smoke:ws-admission-preflight
```

The command starts an isolated strict-session server with one connection slot, holds the slot open, verifies missing/invalid tickets are rejected before capacity accounting, verifies a valid ticket rejected for capacity remains pending, then connects successfully with that same ticket after capacity frees up.

Run the binary-frame rejection smoke:

```sh
npm run smoke:ws-binary-reject
```

The command starts an isolated strict-session server, sends an unsupported binary WebSocket frame over a raw upgraded socket, and verifies the server closes the connection while recording rejection metrics and a journal event.

Run the WebSocket ingress config smoke:

```sh
npm run smoke:ws-ingress-config
```

The command starts an isolated strict-session server with tight WebSocket frame and token-bucket limits, verifies oversized and over-burst client messages are rejected and journaled, and checks admin/metrics visibility of the configured ingress limits.

Run the WebSocket snapshot-size smoke:

```sh
npm run smoke:ws-snapshot-size
```

The command starts an isolated strict-session server with a tiny `MAX_SNAPSHOT_BYTES`, verifies the oversized welcome snapshot is rejected before send, and checks admin/metrics visibility.

Run the WebSocket payload-metrics smoke:

```sh
npm run smoke:ws-payload-metrics
```

The command starts an isolated strict-session server, receives a real welcome and snapshots, and verifies `/metrics` reports exact last/max outbound message bytes, snapshot bytes, and interest-filtered snapshot player/object gauges.

Run the WebSocket peer-capacity smoke:

```sh
npm run smoke:ws-peer-capacity
```

The command starts an isolated strict-session server with `MAX_CONNECTIONS_PER_IP=1`, holds one connection open, verifies a second connection from the same peer IP is closed before welcome, and checks admin/metrics visibility.

Run the WebSocket reject-limit smoke:

```sh
npm run smoke:ws-reject-limit
```

The command starts an isolated strict-session server with `CLIENT_REJECT_LIMIT=2`, sends malformed text plus a syntactically valid message with an unknown field, and verifies the server closes the connection while recording rejection metrics and admin journal events.

Run a small WebSocket benchmark against a running server:

```sh
npm run bench:ws -- --clients 20 --durationMs 5000 --inputHz 10
```

The command opens N clients, sends input at the requested rate, scrapes `/metrics` before and after the run, and reports connected clients, snapshot throughput, payload bytes, errors, join latency, plus benchmark-window deltas for tick overruns, send errors, and snapshot-payload rejections. It fails when any client misses welcome/snapshots, identity mismatches occur, the per-client snapshot rate drops below `--minSnapshotsPerClientSecond`, average outbound message bytes exceed `--maxAverageMessageBytes`, p95 join latency exceeds `--maxJoinP95Ms`, benchmark-window tick overruns exceed `--maxTickOverruns`, send errors exceed `--maxSendErrors`, or snapshot-payload rejections exceed `--maxSnapshotPayloadRejects`. Use `--metricsToken` for token-protected metrics or `--skipMetrics` when intentionally benchmarking an endpoint whose metrics surface is unavailable. It is a regression smoke, not a replacement for a proper soak test.

## Production Direction

The current server keeps the sim and settlement worker in one deployable for iteration speed, but their boundary is already queue-shaped. The intended production split is:

1. Rust simulation server owns live game state.
2. Dedicated settlement service owns keys and Base transactions.
3. Indexer reconciles event logs back to Postgres.
4. Client only reads gameplay from the sim API or app DB, never directly from chain.

Base-chain token direction: reserve `$DUSK` as the Duskfell ticker for future Base deployments. The PoC does not mint or trade `$DUSK`; any token contract should wait until account identity, signer isolation, indexer reconciliation, treasury controls, and legal review are in place.

Chain integration should remain optional for the core game loop. If `CHAIN_ENABLED=true` is set in local mode today, the worker deliberately returns `needs-signer`; real signing is not implemented in the PoC. Public deployment rejects `CHAIN_ENABLED=true` until signer and indexer configuration exist.
