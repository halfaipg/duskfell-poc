# Refactor Map

This document tracks the god-file breakup work. It is not a design victory lap:
the repo still has large files, and this map should keep future changes moving
toward smaller ownership boundaries without mixing refactors with new features.

## Current Largest Files

Checked July 8, 2026:

| File | Lines | Status |
| --- | ---: | --- |
| `README.md` | 832 | Large documentation entry point. Split only if docs navigation becomes painful; prefer topic docs with a short README index. |
| `scripts/normalize-generated-terrain-atlas.py` | 153 | Terrain atlas assembly coordinator. Owns source image loading/cropping, atlas row/column assembly, output writes, and manifest provenance updates. Shared hash/manifest IO lives in `scripts/asset_pipeline_utils.py`; material catalog data lives in `scripts/terrain_atlas_materials.py`; material-specific grass/field/dirt/stone/water/settlement/cobble/rock/ruin/shore painting lives in `scripts/terrain_atlas_material_details.py`; manifest tile metadata lives in `scripts/terrain_atlas_manifest.py`; shared raster helpers live in `scripts/pixel_art_primitives.py`; pair-transition recipes live in `scripts/terrain_atlas_pair_transitions.py`; edge/corner transition mask variants live in `scripts/terrain_atlas_transition_masks.py`. Split source tile extraction only if generated-source handling grows. |
| `scripts/verify-sprite-manifest.js` | 89 | Sprite manifest verifier coordinator. Owns manifest loading, top-level schema/version/sheets checks, async image validation dispatch, result shaping, and CLI output. Projection contract validation lives in `scripts/sprite-manifest/projection.js`; sheet schema validation lives in `scripts/sprite-manifest/sheet.js`; PNG/hash inspection, paperdoll stack validation, provenance/style policy, and primitive validators live in sibling child modules. |
| `scripts/verify-terrain-atlas.js` | 55 | Terrain atlas verifier facade only. Owns manifest file loading, result shaping, and CLI output. Schema/projection/path validation lives in `scripts/terrain-atlas/manifest.js`; tile coverage checks live in `coverage.js`; clean-room provenance and approval policy live in `provenance.js`; PNG dimension/hash checks live in `image.js`; constants and primitive validators live in sibling modules. |
| `scripts/normalize-generated-detail-sheet.py` | 107 | Detail sheet assembly coordinator. Owns generated source cleanup, source-frame fitting, static-frame assembly, output writes, and manifest hash/provenance updates. Shared hash/manifest IO lives in `scripts/asset_pipeline_utils.py`; generated sheet cleanup lives in `scripts/detail_sheet_normalization.py`; detail sheet metadata lives in `scripts/detail_sheet_manifest.py`; shared raster helpers live in `scripts/pixel_art_primitives.py`; locally authored tree-frame trunk/root/resource/age drawing lives in `scripts/detail_sheet_tree_frames.py`; crown recipes live in `scripts/detail_sheet_tree_crowns.py`. Split boulder/reeds/ruin static-frame drawing only if those recipes grow. |
| `scripts/blender-duskfell-tree-family.py` | 319 | Deterministic clean-room tree structure generator. Owns the fixed orthographic camera, seed, species/stage geometry, raw 640px renders, and saved Blender source scene. It never owns painterly finishing. |
| `scripts/assemble-blender-tree-family.py` | 160 | Blender tree candidate assembler. Preserves raw renders, creates normalized structural frames and the 4x3 control board, maps frames 8-19 into a review detail sheet, and records structural provenance. |
| `scripts/normalize-finished-tree-board.py` | 269 | Controlled tree img2img intake gate. Finds transparent row valleys, preserves one board-wide scale, anchors trunks, rejects clipping/coverage/scale drift, and emits a hash-recorded review sheet without changing the default sprite manifest. |
| `client/tree-review-sprite.js` | 38 | Explicit `?trees=blender` review loader. Pins the validated candidate SHA-256 and swaps only the terrain-detail sheet; ordinary sessions retain the manifest-selected default. |
| `scripts/normalize-generated-actor-sheet.py` | 57 | Actor sheet assembly coordinator. Owns source existence checks, source grid iteration, base/variant output writes, and command output. Shared dimensions/paths/variant metadata live in `scripts/actor_sheet_config.py`; source cleanup and trim fitting live in `scripts/actor_sheet_normalization.py`; role-specific silhouette/equipment overlays live in `scripts/actor_sheet_variants.py`; sprite manifest provenance updates live in `scripts/actor_sheet_manifest.py`. |
| `scripts/normalize-paperdoll-demo-sheet.py` | 49 | Paperdoll demo sheet coordinator. Owns source existence checks, base body generation, equipment layer generation, output writes, manifest update dispatch, and command output. Shared paths/dimensions/palette/provenance constants live in `scripts/paperdoll_demo_config.py`; generated body cleanup and fitting live in `scripts/paperdoll_body_normalization.py`; deterministic equipment-layer drawing lives in `scripts/paperdoll_layers.py`; paperdoll sheet and manifest assembly lives in `scripts/paperdoll_demo_manifest.py`. |
| `scripts/generate-placeholder-sprites.js` | 255 | Placeholder sprite recipe coordinator. Owns player/prop placeholder frame recipes, sheet generation order, output writes, and sprite manifest hash updates. PNG encoding is shared with `scripts/placeholder-terrain-atlas/png.js`; reusable RGBA raster primitives live in `scripts/placeholder-sprites/raster.js`. Split player and prop recipes only if placeholder art remains a maintained path rather than a fallback. |
| `scripts/generate-placeholder-terrain-atlas.js` | 300 | Placeholder terrain paint coordinator. Owns placeholder tile recipe dispatch, base/slope/transition tile assembly, pair-transition placeholder overlays, output writes, and manifest hash updates. Placeholder material catalog, masks, rows, pair metadata, and manifest tile entries live in `scripts/placeholder-terrain-atlas/catalog.js`; raster pixel primitives live in `scripts/placeholder-terrain-atlas/raster.js`; PNG encoding lives in `scripts/placeholder-terrain-atlas/png.js`; manifest shape updates live in `scripts/placeholder-terrain-atlas/manifest.js`; color/hash helpers live in `scripts/placeholder-terrain-atlas/color.js`; transition mask weights/accent placement live in `scripts/placeholder-terrain-atlas/transition-masks.js`; material-specific grass, field, dirt, stone, water, and settlement detail recipes live in `scripts/placeholder-terrain-atlas/material-details.js`. Production art path should stay in the Python terrain atlas generator. |
| `scripts/deployment-preflight.js` | 76 | Deployment preflight runner/reporter only. Owns CLI profile selection, ordered check orchestration, JSON result shaping, and process exit code. Runtime/profile/backend/public/build/durability/drain checks live in `scripts/deployment-preflight/runtime.js`; Origin/bind/chain/signer/indexer/production blocker checks live in `scripts/deployment-preflight/network.js`; low-level parsing helpers live in `scripts/deployment-preflight/parsing.js`; numeric budget validation lives in `scripts/deployment-preflight/budgets.js`; account/JWT identity checks live in `scripts/deployment-preflight/auth.js`. |
| `scripts/deploy-audit.js` | 45 | Deployment audit runner/reporter only. Owns config parsing dispatch, ordered audit orchestration, JSON result shaping, and exit code. CLI/profile/timeout validation lives in `scripts/deploy-audit/config.js`; fetch/token/protected-endpoint helpers live in `scripts/deploy-audit/request.js`; health/readiness/runtime/admin-summary/build-SHA checks live in `scripts/deploy-audit/runtime-checks.js`; metrics fetching/parsing/required metric checks live in `scripts/deploy-audit/metrics-checks.js`; shared-poc runtime and metrics posture assertions live in `scripts/deploy-audit/posture-checks.js`. |
| `server/src/sim.rs` | 226 | Simulation tick/replay coordinator. Owns tick/update flow, resource-node replay, resource/inventory lifecycle advancement, and public simulation re-exports. Player add/remove/rename/input assignment lives in `server/src/sim/players.rs`; shared ECS model/events/constants live in `server/src/sim/model.rs`; world/content bootstrap and object spawning live in `server/src/sim/world_init.rs`; inventory, crafting, interactions, lifecycle math, movement rules, resources/ecology catalog, ecology ticks, snapshots, spawn placement/blocker collection, and terrain-detail authority parsing/promotion live in child modules. |
| `server/src/sim/resources.rs` | 7 | Resource coordinator only. Owns child module declarations and sim-facing re-exports. Resource-node state/mutation, built-in object resource defaults, and generated ecology object catalog data live in `server/src/sim/resources/*.rs`. |
| `server/src/sim/resources/defaults.rs` | 195 | Leaf resource default module. Owns built-in resource-node defaults by object kind/id, including grove, ore, ruin, shrine, sapling, deadwood, mycelium, and field-coil resources. |
| `server/src/sim/resources/node.rs` | 123 | Leaf resource node module. Owns resource-node state, harvest/feed/restore/regeneration, lifecycle aging, changed-event shaping, resource snapshots, and lifecycle snapshots. |
| `server/src/sim/resources/generated.rs` | 103 | Leaf generated ecology catalog module. Owns generated ecology object structs and built-in generated ecology object placements. |
| `server/src/sim/inventory.rs` | 22 | Inventory coordinator only. Owns child module declarations and sim-facing re-exports. Inventory constants/recipes, item models, stack mutation, compost-spore output, snapshots, labels, and lifecycle/compost math live in `server/src/sim/inventory/*.rs`. |
| `server/src/sim/inventory/operations.rs` | 149 | Leaf inventory mutation module. Owns resource/item add, bounded stack behavior, totals, first available feed resources/items, resource/item consumption, and authoritative inventory aging. |
| `server/src/sim/inventory/lifecycle.rs` | 123 | Leaf inventory lifecycle module. Owns item lifecycle snapshots, profile tables, stage selection, compostability, and decay-scaled compost feed amounts. |
| `server/src/sim/inventory/labels.rs` | 57 | Leaf inventory naming module. Owns stable item IDs and display labels for resources, crafted items, and mixed inventory item kinds. |
| `server/src/sim/inventory/model.rs` | 52 | Leaf inventory model module. Owns inventory, stack, compost output/candidate, inventory item kind, and crafted item kind structs/enums. |
| `server/src/sim/inventory/compost.rs` | 42 | Leaf inventory compost module. Owns compost-spore candidate selection and fallback inventory spore output. |
| `server/src/sim/inventory/snapshot.rs` | 26 | Leaf inventory snapshot module. Owns inventory protocol snapshot shaping and deterministic inventory item ordering. |
| `server/src/sim/inventory/constants.rs` | 18 | Leaf inventory constants module. Owns feed amounts, compost intervals, feedable resources/items, trail-kit recipe, capacity, and stack limit constants. |
| `client/terrain.js` | 221 | Public terrain API/orchestrator. Owns `buildTerrain`, tile lookup, world-height sampling, interior height overlay, walkability, and terrain-detail blocker lookup. Composition classification, transition masks, decals, chunk/elevation metadata, projected geometry/facets, primitives, interiors, detail placement, detail metadata, and terrain-detail authority manifest shaping all live in child modules. |
| `client/terrain-primitives.js` | 5 | Terrain primitive facade only. Re-exports biome/material selection, profile validation/defaults, height metadata/corner generation, and deterministic noise/math helpers from focused terrain primitive modules. |
| `client/terrain-details.js` | 44 | Terrain detail instance builder/facade only. Owns deterministic per-tile anchor/position/scale assembly and preserves public re-exports for placement callers. Footprints live in `client/terrain-detail-footprints.js`; resource/lifecycle metadata lives in `client/terrain-detail-metadata.js`; authority manifest shaping lives in `client/terrain-detail-authority.js`. |
| `client/terrain-composition-kit.js` | 11 | Terrain composition-kit facade only. Re-exports the kit catalog, deterministic kit factory, material overrides, membership scoring, and geometry metrics from focused `client/terrain-composition-kit-*.js` modules. |
| `client/styles.css` | 6 | CSS entry point only. Imports base tokens/typography, layout/canvas/panel chrome, player-card UI, inventory/deed UI, controls/metrics, and responsive rules from focused files under `client/styles/*.css`. |
| `scripts/deployment-preflight-smoke.js` | 84 | Smoke runner only. Owns process spawning, JSON parsing, expected-check evaluation, and result reporting. Scenario catalogs and hardened/JWT env fixtures live under `scripts/deployment-preflight/smoke-*.js`. |
| `scripts/public-deployment-smoke.js` | 157 | Public deployment smoke scenario runner. Owns high-level startup guard execution, protected endpoint probes, result shaping, and final pass/fail assertion. CLI/runtime config parsing lives in `scripts/public-deployment-smoke/config.js`; server start/failure/stop helpers live in `server.js`; HTTP/metrics probes live in `http.js`; fail-closed startup guard scenarios live in `startup-cases.js`. |
| `scripts/ops-snapshot.js` | 49 | Ops snapshot runner only. Owns concurrent endpoint fetch orchestration, top-level snapshot envelope shaping, optional file write, and stdout output. CLI/config validation lives in `scripts/ops-snapshot/config.js`; authenticated HTTP helpers live in `http.js`; metric parsing and selected metric shaping live in `metrics.js`; readiness/runtime asset shaping lives in `runtime-summary.js`; admin summary redaction/shaping lives in `admin-summary.js`; posture, event, and ownership summaries live in `posture-summary.js`. |
| `scripts/metrics-smoke.js` | 63 | Metrics smoke runner only. Owns server startup orchestration, before/after session metric capture, timing sanity checks, result shaping, and exit code. CLI/runtime config lives in `scripts/metrics-smoke/config.js`; server lifecycle lives in `server.js`; session and metrics HTTP probes live in `http.js`; required metric names, expected values, and metric text parsing live in `contract.js`. |
| `scripts/ws-load-smoke.js` | 43 | WebSocket load smoke runner only. Owns before/after metric capture, parallel client orchestration, benchmark summary shaping, and exit code. CLI/threshold parsing lives in `scripts/ws-load-smoke/config.js`; client session/WebSocket behavior lives in `client.js`; server metric fetching/comparison lives in `metrics.js`; aggregate summary and threshold failure logic lives in `summary.js`. |
| `scripts/ws-account-capacity-smoke.js` | 100 | WebSocket account-capacity smoke runner only. Owns scenario orchestration, result shaping, and pass/fail assertion. CLI/runtime/JWT config lives in `scripts/ws-account-capacity-smoke/config.js`; server lifecycle lives in `server.js`; session/admin/metrics HTTP helpers live in `http.js`; held WebSocket and raw rejection handshake behavior lives in `websocket.js`. |
| `scripts/origin-allowlist-smoke.js` | 120 | Origin allowlist smoke runner only. Owns invalid-origin startup cases, allowed/rejected session and WebSocket scenario orchestration, result shaping, and pass/fail assertion. CLI/runtime config lives in `scripts/origin-allowlist-smoke/config.js`; server startup/failure/stop helpers live in `server.js`; session/admin/metrics HTTP helpers live in `http.js`; raw WebSocket upgrade probing lives in `websocket.js`. |
| `scripts/session-token-hardening-smoke.js` | 93 | Session-token hardening smoke runner only. Owns ticket issue, oversized-token rejection, valid-ticket acceptance, summary/metrics result shaping, and pass/fail assertion. CLI/runtime config lives in `scripts/session-token-hardening-smoke/config.js`; server lifecycle lives in `server.js`; session/admin/metrics HTTP helpers live in `http.js`; raw upgrade rejection and valid WebSocket welcome probes live in `websocket.js`. |
| `scripts/account-settlement-smoke.js` | 98 | Account-bound settlement smoke runner only. Owns JWT issuance, deed-claim scenario orchestration, ownership/journal lookup, result shaping, and pass/fail assertion. JWT signing lives in `scripts/account-settlement-smoke/auth.js`; CLI/runtime config lives in `config.js`; server lifecycle lives in `server.js`; session/admin HTTP helpers live in `http.js`; registrar movement and deed-claim WebSocket choreography live in `websocket.js`. |
| `scripts/rename-validation-smoke.js` | 109 | Rename validation smoke runner only. Owns invalid/duplicate session request cases, rename-flow orchestration, metrics/event lookup, result shaping, and pass/fail assertion. CLI/runtime/name config lives in `scripts/rename-validation-smoke/config.js`; server lifecycle lives in `server.js`; session/admin/metrics HTTP helpers live in `http.js`; valid/invalid WebSocket rename choreography lives in `websocket.js`. |
| `scripts/runtime-manifest-smoke.js` | 67 | Runtime manifest smoke runner only. Owns expected-state loading, protected admin runtime probes, runtime/summary fetch orchestration, result shaping, and pass/fail assertion. Runtime/provenance CLI config lives in `scripts/runtime-manifest-smoke/config.js`; expected local manifest/image state lives in `expected.js`; admin HTTP helpers live in `http.js`; server lifecycle lives in `server.js`; runtime contract checks live in `checks.js`; response summarizers live in `summary.js`. |
| `scripts/content-contract-smoke.js` | 30 | Content contract smoke runner only. Owns invalid-world case iteration, result aggregation, and CLI output. Negative world fixture cases live in `scripts/content-contract-smoke/cases.js`; CLI/runtime config lives in `config.js`; content-file writes, fail-closed server startup, output capture, and timeout handling live in `runner.js`. |
| `scripts/assets-smoke.js` | 39 | Served asset smoke runner only. Owns server startup, sprite/terrain inspector orchestration, JSON result shaping, and pass/fail assertion. CLI/runtime config lives in `scripts/assets-smoke/config.js`; server lifecycle lives in `server.js`; shared HTTP and hashing helpers live in `http.js` and `hash.js`; sprite sheet/projection/render/SHA/dimension checks live in `sprites.js`; terrain atlas/authority checks live in `terrain.js`. |
| `scripts/ws-peer-capacity-smoke.js` | 80 | WebSocket peer-capacity smoke runner only. Owns first/second connection orchestration, summary/metrics result shaping, and pass/fail assertion. CLI/runtime config lives in `scripts/ws-peer-capacity-smoke/config.js`; session/admin/metrics HTTP helpers live in `http.js`; server lifecycle lives in `server.js`; held WebSocket and raw rejected-upgrade probing live in `websocket.js`. |
| `scripts/ws-ingress-config-smoke.js` | 99 | WebSocket ingress-config smoke runner only. Owns oversized/rate-limit scenario orchestration, summary/metrics/event result shaping, and pass/fail assertion. CLI/runtime ingress config lives in `scripts/ws-ingress-config-smoke/config.js`; session/admin/metrics HTTP helpers and reject-count polling live in `http.js`; server lifecycle lives in `server.js`; oversized-frame and burst-until-close probes live in `websocket.js`. |
| `scripts/account-jwt-auth-smoke.js` | 122 | Account JWT auth smoke runner only. Owns negative/positive JWT session probes, summary/metrics result shaping, and pass/fail assertion. CLI/runtime JWT config lives in `scripts/account-jwt-auth-smoke/config.js`; test-token generation/signing lives in `jwt.js`; session/summary/metrics HTTP helpers live in `http.js`; server lifecycle lives in `server.js`. |
| `scripts/ws-admission-preflight-smoke.js` | 108 | WebSocket admission-preflight smoke runner only. Owns full-capacity admission-order scenario orchestration, before/after metrics shaping, and pass/fail assertion. Runtime config lives in `scripts/ws-admission-preflight-smoke/config.js`; metrics fetch/poll helpers live in `http.js`; server lifecycle lives in `server.js`; session issuance, held sockets, raw handshakes, and socket cleanup live in `websocket.js`. |
| `scripts/gameplay-journal-replay-smoke.js` | 74 | Gameplay journal replay smoke runner only. Owns first server run, crafting smoke invocation, restart/replay probes, result shaping, and pass/fail assertion. CLI/runtime config lives in `scripts/gameplay-journal-replay-smoke/config.js`; crafting/admin HTTP helpers live in `http.js`; gameplay event matching/ordering lives in `journal.js`; resource-node replay summaries live in `resources.js`; server lifecycle lives in `server.js`. |
| `scripts/crafting-smoke.js` | 46 | Crafting smoke runner only. Owns context/session/scenario orchestration, result shaping, and pass/fail assertion. CLI config and fallback target constants live in `scripts/crafting-smoke/config.js`; craft journal lookup lives in `journal.js`; session issuance, snapshot target loading, and session WebSocket URL shaping live in `session.js`; obstacle-aware steering lives in `scripts/lib/ws-smoke-steering.js`; WebSocket movement/gather/craft choreography lives in `websocket.js`. |
| `scripts/resource-gather-smoke.js` | 47 | Resource-gather smoke runner only. Owns context/session/scenario orchestration, result shaping, and pass/fail assertion. CLI config and fallback target constants live in `scripts/resource-gather-smoke/config.js`; resource journal lookup lives in `journal.js`; session issuance, snapshot target loading, and session WebSocket URL shaping live in `session.js`; obstacle-aware steering lives in `scripts/lib/ws-smoke-steering.js`; WebSocket movement/gather choreography lives in `websocket.js`. |
| `server/src/sim/terrain_authority.rs` | 18 | Terrain-detail authority coordinator only. Manifest structs/constants live in `server/src/sim/terrain_authority/model.rs`; movement blocker conversion lives in `blockers.rs`; decay-consumer rule loading/target validation lives in `decay.rs`; generated resource-object promotion and lifecycle metadata lives in `resource_objects.rs`; manifest header validation lives in `validation.rs`. |
| `server/src/sim/ecology.rs` | 11 | Ecology coordinator only. Owns child module declarations and test-facing tick interval re-exports. Tree-harvest fallout, inventory compost spore shedding, deadwood-to-mycelium decay, field-coil charging, candidate models/constants, and shared resource-transfer helpers live in `server/src/sim/ecology/*.rs`. |
| `server/src/sim/ecology/transfer.rs` | 206 | Leaf ecology transfer helper module. Owns ecology candidate collection, feedable-mycelium checks, deadwood/field-coil harvest and restore helpers, mycelium feed mutation, and terrain-detail decay-consumer requirement lookup. |
| `server/src/sim/ecology/compost.rs` | 92 | Leaf ecology compost module. Owns periodic inventory compost-spore shedding, nearby hungry mycelium feeding, item decay event shaping, and fallback inventory decay output. |
| `server/src/sim/ecology/decay.rs` | 60 | Leaf ecology decay module. Owns deadwood-to-mycelium tick cadence, nearest eligible target selection, terrain-detail decay recipe enforcement, and rollback on failed mycelium feed. |
| `server/src/sim/ecology/fallout.rs` | 58 | Leaf ecology fallout module. Owns tree-harvest deadwood fallout, nearest deadwood receiver lookup, fallout radius filtering, and deadwood resource-node event shaping. |
| `server/src/sim/ecology/coils.rs` | 58 | Leaf ecology field-coil module. Owns field-coil-to-mycelium charge cadence, nearest hungry mycelium selection, charge harvest, feed, and rollback behavior. |
| `server/src/sim/ecology/model.rs` | 20 | Leaf ecology model module. Owns ecology tick/radius constants and shared ecology feed candidate shape. |
| `server/src/metrics_routes.rs` | 54 | Route coordinator only. Owns admin/metrics authorization calls, `/api/snapshot` serialization and admin snapshot payload cap handling, and `/metrics` response headers. Runtime Prometheus collection/rendering lives in `server/src/metrics_routes/runtime_metrics.rs` with metric families split across `server/src/metrics_routes/runtime_metrics/*.rs`. |
| `server/src/persistence.rs` | 14 | Persistence coordinator only. Durable file locking, path distinctness, and file-size guards live in `server/src/persistence/file_guard.rs`; bounded JSONL line iteration and append writer live in `server/src/persistence/jsonl.rs`; journal replay loading/anomaly tracking lives in `server/src/persistence/journal_loader.rs`; persistence unit tests live in `server/src/persistence/tests.rs`. |
| `server/src/runtime_assets.rs` | 50 | Runtime asset coordinator only. Owns `RuntimeManifest::load` assembly and crate-facing re-exports. Serializable runtime manifest models live in `server/src/runtime_assets/model.rs`; sprite/terrain manifest loaders live in `asset_manifests.rs`; terrain-detail authority ops/sim loading lives in `terrain_authority.rs`; projection, safe-path, SHA-256 pin, image-size, and fingerprint helpers live in `validation.rs`. |
| `client/sprite-assets.js` | 2 | Runtime sprite asset facade only. Public exports stay stable while sheet selection/normalization lives in `client/sprite-assets/sheet.js`; projection, safe-path, SHA-256, and shared primitive manifest checks live in `manifest.js`; paperdoll layer ordering and overlay compatibility checks live in `paperdoll.js`. |
| `client/player-draw.js` | 104 | Player draw coordinator only. Owns player render ordering, projection/grounding lookup, sprite variant selection, and calls to specialized player draw helpers. Footstep/carried effects live in `client/player-effects-draw.js`; fallback procedural body drawing lives in `client/player-fallback-draw.js`; labels/inventory badges live in `client/player-label-draw.js`; sprite/paperdoll frame drawing and shadows live in `client/player-sprite-draw.js`; stable player hashing lives in `client/player-draw-utils.js`. |
| `server/src/content.rs` | 145 | Content loader/model coordinator. Owns world-content data structs, embedded demo loading, runtime JSON loading, manifest shaping, and terrain snapshot conversion. Content validation lives in `server/src/content/validation.rs`; stable ops fingerprinting lives in `server/src/content/hash.rs`; content contract tests live in `server/src/content/tests.rs`. |
| `server/src/journal.rs` | 108 | Event journal coordinator. Owns retained-event sequencing, retention trimming, recent/after queries, and default capacity. Durable event schema lives in `server/src/journal/model.rs`; journal retention tests live in `server/src/journal/tests.rs`. Keep public re-exports stable because persistence, WebSocket, admin, and replay code consume `crate::journal::*`. |
| `scripts/sprite-manifest.test.js` | 4 | Test aggregator only. Imports base sheet-schema, image/hash, paperdoll, and provenance sprite-manifest test modules so the existing `npm run test:sprites` command keeps working. |
| `client/terrain-detail-draw.js` | 49 | Terrain-detail draw coordinator only. Owns projected detail sort keys, local-player occlusion alpha application, and dispatch between sprite, prop, and procedural detail renderers. Sprite-sheet and prop-frame drawing live in `client/terrain-detail-sprite-draw.js`; procedural terrain-detail dispatch lives in `client/terrain-detail-procedural-draw.js`; tree, nature/ground, structure, and shared shadow drawing live in focused `client/terrain-detail-procedural-*.js` and `client/terrain-detail-shadow.js` modules. |
| `server/src/metrics/prometheus.rs` | 27 | Metrics renderer coordinator only. Owns Prometheus output assembly order and metric-line formatting. WebSocket connection/message/snapshot metrics live in `server/src/metrics/prometheus/websocket.rs`; session/admission/auth/origin/capacity metrics live in `server/src/metrics/prometheus/admission.rs`; durable persistence, settlement queue, and simulation tick metrics live in `server/src/metrics/prometheus/durability.rs`. |
| `server/src/ws.rs` | 116 | WebSocket route/admission coordinator only. Owns upgrade handling, Origin/session/draining checks, connection/peer/account permit acquisition, and upgrade dispatch. Player socket loops, client-message ingress handling, and outbound snapshot serialization live in `server/src/ws/*.rs`. |
| `server/src/ws/connection.rs` | 149 | Leaf WebSocket connection module. Owns player join/removal, welcome failure cleanup, snapshot/heartbeat/idle timers, receive loop dispatch, binary frame rejection handoff, reject-limit disconnects, and permit release. |
| `server/src/ws/client_messages.rs` | 110 | Leaf WebSocket ingress module. Owns text-frame budget checks, client message JSON parsing, input sequence validation, player input mutation, rename journaling, malformed-message journaling, and ingress rejection metrics. |
| `server/src/ws/snapshots.rs` | 83 | Leaf WebSocket outbound module. Owns welcome/snapshot payload construction, settlement snapshot inclusion, interest-radius snapshots, visibility metrics, payload-size enforcement, and socket text sends. |
| `server/src/settlement.rs` | 23 | Settlement coordinator only. Owns child module declarations, crate-facing re-exports, and shared ledger/outbox handle aliases. Config/job models, ledger state, outbox append/replay, validation, and worker/queue behavior live in `server/src/settlement/*.rs`. |
| `server/src/settlement/outbox.rs` | 196 | Leaf settlement durability module. Owns settlement outbox event serialization, append/flush/sync behavior, bounded JSONL replay, duplicate job/receipt collapse, and replay-time validation calls. |
| `server/src/settlement/worker.rs` | 116 | Leaf async settlement worker module. Owns settlement queue creation, dry-run receipt generation, append-before-confirm handling, persisted job enqueue, startup replay, and receipt seeding. |
| `server/src/settlement/validation.rs` | 88 | Leaf settlement validation module. Owns bounded printable-ASCII validation for jobs, receipts, asset IDs, reasons, statuses, chain transaction IDs, and account subjects. |
| `server/src/settlement/ledger.rs` | 51 | Leaf settlement ledger module. Owns pending/confirmed idempotency, latest receipt history, per-asset ownership, and settlement snapshot shaping. |
| `server/src/settlement/model.rs` | 20 | Leaf settlement model module. Owns settlement worker config and persisted settlement job schema. |
| `server/src/settlement/tests.rs` | 402 | Leaf test module. Owns settlement outbox replay/validation/sync tests, ledger idempotency/ownership tests, queue pressure tests, and receipt seeding tests. |
| `client/object-draw.js` | 118 | Object scene coordinator only. Owns renderer state refresh, terrain-detail/object/player render ordering, object projection, label visibility policy application, and dispatch to specialized object helpers. Terrain-detail bodies live in `client/terrain-detail-draw.js`; authority cue drawing lives in `client/object-authority-cue-draw.js`; fallback footprints/simple bodies live in `client/object-fallback-draw.js`; labels/extras live in `client/object-label-draw.js`; prop/ecology/field-coil sprite rendering lives in `client/object-sprite-draw.js`; cue overlays live in `client/object-cue-draw.js`. |
| `client/terrain-draw.js` | 157 | Terrain draw coordinator only. Owns renderer state refresh, chunk iteration, static-layer replay, atlas/debug dispatch, and tile paint orchestration. Side walls, slope facets, height/relief shading, and underpaint material selection live in `client/terrain-draw-surface.js`; water shimmer and ground decals live in `client/terrain-draw-decals.js`; shared tile edge/point helpers live in `client/terrain-draw-geometry.js`; atlas tile drawing, underpaint, transition atlas lookup, transition masks, and pattern caching live in `client/terrain-draw-atlas.js`; debug overlays live in `client/terrain-debug-draw.js`; chunk geometry, culling, and static layer caching live in `client/terrain-draw-layers.js`. |
| `client/object-cue-draw.js` | 33 | Object cue adapter only. Owns the `createObjectCueDrawer` façade over cue-family modules. Item icons, object resource meters, and meter colors live in `client/object-resource-cue-draw.js`; ecology lifecycle cues live in `client/ecology-lifecycle-cue-draw.js`; terrain-detail lifecycle/resource cues live in `client/terrain-detail-cue-draw.js`. |
| `client/server-messages.js` | 38 | Server-message coordinator only. Owns raw JSON parsing, top-level message type dispatch, welcome/snapshot/notice shaping, and crate-facing `parseServerMessage`. Snapshot, terrain, player, object, settlement, constants, and primitive validation live in `client/server-message-*.js`. |
| `client/server-message-player.js` | 107 | Leaf protocol parser module. Owns player snapshot normalization, resource summary bounds, inventory shape validation, duplicate item rejection, inventory item lifecycle parsing, and player identity/color fields. |
| `client/server-message-validators.js` | 95 | Leaf protocol parser helper module. Owns primitive bounded array/text/UUID/color/boolean/number/integer/resource/age/unit validators and object-shape checks. |
| `client/server-message-terrain.js` | 78 | Leaf protocol parser module. Owns map and terrain contract validation, terrain profile enforcement, military projection dimensions, height-scale contract, elevation bounds, and canonical material set validation. |
| `client/server-message-object.js` | 72 | Leaf protocol parser module. Owns world object shape validation, supported object/resource kind checks, object resource amount bounds, and object lifecycle parsing. |
| `client/server-message-constants.js` | 45 | Leaf protocol constants module. Owns parser caps, supported object/resource kinds, terrain profile, and canonical terrain material set. |
| `client/server-message-settlement.js` | 40 | Leaf protocol parser module. Owns settlement summary normalization and settlement receipt shape validation. |
| `client/server-message-snapshot.js` | 24 | Leaf protocol parser module. Owns snapshot assembly from normalized map, players, objects, settlement, and tick. |
| `client/terrain-draw-atlas.js` | 59 | Terrain atlas coordinator only. Owns atlas tile/underpaint frame selection and delegates frame drawing and transitions. Pattern-frame caching and raw atlas-frame drawing live in `client/terrain-draw-atlas-frames.js`; material transition atlas lookup, masks, transition strokes, and material cue chips live in `client/terrain-draw-atlas-transitions.js`; shared clipping/bounds/edge helpers live in `client/terrain-draw-geometry.js`. |
| `server/src/runtime.rs` | 243 | Runtime assembly module. Owns deployment/runtime env collection, runtime budget/public-deployment validation, settlement worker/replay orchestration, runtime asset verification, sim construction, and `RuntimeServer` assembly. Durable lock/file setup, JSONL size checks, journal/resource-node replay, writer opening, and settlement outbox opening live in `server/src/runtime/durable.rs`; runtime state carrier types live in `server/src/runtime/state.rs`. |
| `server/src/session.rs` | 15 | Session coordinator only. Re-exports session config/auth/error/ticket models from `server/src/session/model.rs`, ticket issue/validate/preflight storage from `server/src/session/tickets.rs`, IP/account rate limiters from `server/src/session/rate_limit.rs`, and tests from `server/src/session/tests.rs`. |
| `client/app.js` | 205 | Browser conductor only. Owns top-level render module wiring, input-state collection, network callbacks, frame scheduling, and HUD/panel orchestration. DOM lookup lives in `client/app-dom.js`; canvas resize, loading paint, and FPS smoothing live in `client/app-frame.js`; runtime sprite/terrain asset loading state lives in `client/app-assets.js`; deterministic terrain cache key/build ownership lives in `client/terrain-cache.js`; session issuance, WebSocket reconnects, server-message parsing, and input packet sends live in `client/network-client.js`. |
| `server/src/metrics.rs` | 78 | Metrics state coordinator only. Owns the `AppMetrics` atomic counter fields, shared max-counter helper, Prometheus render entrypoint, and child module declarations. WebSocket/payload counters live in `server/src/metrics/websocket.rs`; session/auth/admission counters live in `server/src/metrics/admission.rs`; durability/settlement/tick counters live in `server/src/metrics/durability.rs`; Prometheus text rendering lives under `server/src/metrics/prometheus/`. |
| `server/src/session/tests.rs` | 277 | Leaf test module. Owns one-shot ticket consumption, token hashing, missing/dev ticket behavior, ticket capacity, display-name/account-subject ticket metadata, preflight validation, expiration, and IP/account issue rate limiter tests. |
| `server/src/config/budget.rs` | 290 | Leaf config module. Owns runtime budget min/max constants, `RuntimeBudgetConfig`, session/admission/WebSocket/content/durable/asset budget validation, and primitive budget helper validators. |
| `server/src/config/public_deployment.rs` | 283 | Leaf config module. Owns public deployment fail-closed validation, public token strength/placeholder checks, public JWT issuer/audience checks, localhost issuer rejection, and account/admin/metrics credential distinctness checks. |
| `server/src/config/env.rs` | 243 | Leaf config module. Owns generic env parsing, deployment profile parsing, persistence/admission backend parsing, supported-backend guards, bind-address validation, chain-mode validation, and deployment profile validation. |
| `server/src/config/auth.rs` | 169 | Leaf config module. Owns account auth mode/config parsing, JWT HS256 claim validation, account subject validation, account auth mode reporting, and auth/JWT size constants. |
| `server/src/config/network.rs` | 168 | Leaf config module. Owns origin allowlist config/parsing, WebSocket timing/config, and client WebSocket ingress config. |
| `server/src/config.rs` | 143 | Config/security coordinator. Owns session ticket/rate-limit config and re-exports config child modules. Public deployment guardrails live in `server/src/config/public_deployment.rs`; network-facing config lives in `server/src/config/network.rs`; account auth/JWT validation lives in `server/src/config/auth.rs`; runtime budget validation lives in `server/src/config/budget.rs`; generic env parsing, deployment profile parsing, backend selection, bind-address guards, and chain-mode guards live in `server/src/config/env.rs`. |
| `server/src/config_tests/public_deployment.rs` | 328 | Leaf test module. Owns public deployment fail-closed guardrail tests for sessions, account auth, Origin allowlist, durable writes, persistence/admission posture, admin/metrics tokens, and JWT identity config. |
| `server/src/sim/tests/crafting_inventory.rs` | 462 | Leaf simulation test module. Owns inventory stack bounds, forge recipe crafting, crafted-item composting, crafted-item lifecycle aging, compost-spore shedding, and no-recipe crafting rejection tests. |
| `server/src/sim/tests/ecology_resources/lifecycle.rs` | 285 | Leaf simulation test module. Owns resource lifecycle aging, deadwood-to-mycelium feed ticks, organic inventory feeding, and field-coil mycelium energizing coverage. |
| `server/src/sim/tests/ecology_resources/generated.rs` | 261 | Leaf simulation test module. Owns generated ecology object/resource node presence, generated lifecycle metadata, and player harvesting/feeding interactions against generated nodes. |
| `server/src/sim/tests/terrain_detail_authority.rs` | 309 | Leaf simulation test module. Owns server-owned terrain-detail resource promotion, terrain-detail decay consumer recipes, missing consumer target rejection, off-map resource-node skipping, and terrain-detail ecology tests. |
| `server/src/sim/tests/ecology_resources/gathering.rs` | 185 | Leaf simulation test module. Owns player resource gathering, bounded inventory resource stacks, held-interact suppression, mycelium depletion, and resource-node regrowth coverage. |
| `server/src/sim/tests/ecology_resources/replay.rs` | 56 | Leaf simulation test module. Owns resource-node replay restoration, resource-kind mismatch rejection, and clamped replay amount coverage. |
| `server/src/sim/tests/movement.rs` | 246 | Leaf simulation test module. Owns speed normalization, world-object collision, terrain-detail movement blockers, overlapped-blocker escape, and water-blocked movement tests. |
| `server/src/sim/tests/player_identity.rs` | 243 | Leaf simulation test module. Owns player color snapshot contract, interest-radius snapshot filtering, display-name validation, active-name uniqueness/release, and spawn-slot separation tests. |
| `server/src/config_tests/auth.rs` | 138 | Leaf test module. Owns constant-time token comparison, bounded auth header parsing, JWT signature/issuer/audience checks, and account subject validation tests. |
| `server/src/config_tests/readiness.rs` | 117 | Leaf test module. Owns durable parent path readiness, durable basename redaction, durable persistence health, and settlement queue readiness tests. |
| `server/src/config_tests/env.rs` | 115 | Leaf test module. Owns env parsing, deployment profile parsing, backend parsing, and supported-backend guard tests. |
| `scripts/deployment-preflight/budgets.js` | 168 | Leaf preflight helper module. Owns numeric budget limits, integer/float budget parsing, primitive budget bounds, and cross-budget invariants. |
| `scripts/deployment-preflight/auth.js` | 169 | Leaf preflight helper module. Owns account auth, shared-token strength, token distinctness, JWT issuer/audience checks, and public JWT issuer guards. |
| `scripts/deployment-preflight/smoke-shared-poc-cases.js` | 306 | Leaf smoke scenario catalog. Owns shared-poc deployment preflight hardening, rejection, JWT, durable, budget, Origin, bind, and build provenance scenarios. |
| `scripts/deployment-preflight/smoke-production-cases.js` | 184 | Leaf smoke scenario catalog. Owns production blocker, JWT identity, Postgres, Redis, signer/indexer, local service URL, and local Origin deployment preflight scenarios. |
| `scripts/deployment-preflight/smoke-env.js` | 35 | Leaf smoke fixture helper. Owns shared-poc hardened env construction and JWT env construction for deployment preflight smoke scenarios. |
| `scripts/deployment-preflight/smoke-cases.js` | 4 | Smoke case aggregator only. Exports the ordered shared-poc and production deployment preflight smoke scenario list. |
| `scripts/deployment-preflight/parsing.js` | 122 | Leaf preflight helper module. Owns CLI arg parsing, exact Origin parsing, bind-address parsing, local-host checks, compact printable validation, and placeholder secret detection. |
| `scripts/sprite-manifest/provenance.js` | 176 | Leaf sprite-manifest policy module. Owns approval state checks, clean-room provenance, generator tool review requirements, quarantined generator identities, and prompt/style-reference guardrails. |
| `scripts/sprite-manifest/paperdoll.js` | 140 | Leaf sprite-manifest policy module. Owns paperdoll role/slot validation, base actor lookup, equipment layer compatibility, and direction/frame alignment. |
| `scripts/sprite-manifest/image.js` | 62 | Leaf sprite-manifest image module. Owns PNG IHDR parsing, declared sheet dimension verification, and sprite image SHA-256 checks. |
| `scripts/sprite-manifest/validation.js` | 34 | Leaf sprite-manifest helper module. Owns primitive object/string/integer/hash/path/subpath validators. |
| `scripts/sprite-manifest/base.test.js` | 111 | Leaf sprite-manifest test module. Owns clean manifest acceptance, projection drift rejection, sheet dimension mismatch, and render metadata validation coverage. |
| `scripts/sprite-manifest/paperdoll.test.js` | 92 | Leaf sprite-manifest test module. Owns aligned paperdoll acceptance and misaligned/missing equipment layer rejection coverage. |
| `scripts/sprite-manifest/provenance.test.js` | 95 | Leaf sprite-manifest test module. Owns clean-room, generator review, quarantined generator, and style/projection prompt policy coverage. |
| `scripts/sprite-manifest/image.test.js` | 71 | Leaf sprite-manifest test module. Owns PNG dimension parsing and sprite image hash mismatch/missing-hash coverage. |
| `scripts/sprite-manifest/test-fixtures.js` | 109 | Leaf test helper module. Owns valid sprite sheet/manifest fixtures, temp directory creation, PNG header fixtures, and fixture SHA-256 helpers. |
| `scripts/placeholder-terrain-atlas/catalog.js` | 121 | Leaf placeholder terrain module. Owns placeholder atlas cell size, material palettes, edge/corner masks, row count, and manifest tile metadata entries. |
| `scripts/pixel_art_primitives.py` | 127 | Leaf asset-pipeline helper module. Owns small RGBA drawing primitives shared by generated terrain/detail scripts: shade, mix, rect, ellipse, polygon, line, leaf chips, and alpha-composited pixel writes. |
| `scripts/terrain_atlas_manifest.py` | 97 | Leaf terrain atlas helper module. Owns generated runtime terrain tile metadata, tile IDs, masks, pair-transition entries, walkability, and surface role assignment. |
| `scripts/asset_pipeline_utils.py` | 29 | Leaf asset-pipeline helper module. Owns SHA-256 file hashing, deterministic source hashing, and JSON manifest read/write helpers for generated asset normalizers. |
| `scripts/detail_sheet_normalization.py` | 150 | Leaf asset-pipeline helper module. Owns magenta-screen removal, generated source sprite-box detection, detached artifact cleanup, and trim-to-cell fitting for generated detail sheets. |
| `scripts/terrain_atlas_materials.py` | 103 | Leaf asset-pipeline helper module. Owns terrain atlas dimensions, material list, source material aliases, transition pair catalog, masks, and material palettes. |
| `scripts/detail_sheet_manifest.py` | 85 | Leaf detail-sheet helper module. Owns generated detail sheet grid constants, static-frame offset, sprite manifest metadata, provenance, and review state. |
| `server/src/config_tests/network.rs` | 52 | Leaf test module. Owns WebSocket heartbeat/idle timing validation tests and Origin allowlist parsing/rejection tests. |
| `server/src/sim/tests.rs` | 216 | No longer a god file. Owns settlement deed/account-subject tests, generic far-interaction no-op coverage, object-position indexing, shared snapshot/node-event helpers, and shared player-position helpers for child sim test modules. |
| `server/src/sim/spawn.rs` | 80 | Leaf simulation module. Owns spawn-slot selection, existing-player spawn separation, spawn walkability/elevation validation, and movement blocker collection for player collision checks. |
| `server/src/main.rs` | 96 | Entry point only. Initializes tracing, asks `server/src/runtime.rs` to assemble runtime state, starts the tick loop, builds routes, binds the listener, and handles graceful shutdown. |
| `server/src/sim/tests/ecology_resources.rs` | 8 | Test module aggregator only. Imports shared ecology-resource test context and declares gathering, generated object, lifecycle/feed, and replay child modules. |

## Completed Splits

- `scripts/normalize-generated-actor-sheet.py`
  - Source image chroma-key cleanup, detached-artifact pruning, grid trim/fit,
    role variant painting, actor sheet paths/constants, and actor sprite
    manifest provenance updates moved into focused `scripts/actor_sheet_*.py`
    modules.
- `scripts/normalize-paperdoll-demo-sheet.py`
  - Review-only paperdoll body cleanup, equipment-layer drawing, shared
    sheet/provenance constants, and paperdoll manifest assembly moved into
    focused `scripts/paperdoll_*.py` modules.
- `scripts/deploy-audit.js`
  - CLI/profile validation, HTTP/token helpers, health/runtime/summary checks,
    metrics parsing, and shared-poc posture assertions moved into focused
    `scripts/deploy-audit/*.js` modules.
- `server/src/metrics/prometheus.rs`
  - WebSocket, session/admission/auth, and durability/tick metric families moved
    into focused child modules while keeping the parent renderer responsible for
    output order and line formatting.
- `scripts/public-deployment-smoke.js`
  - Public deployment startup guard cases, server lifecycle helpers, HTTP probes,
    metrics parsing, and CLI config moved into focused
    `scripts/public-deployment-smoke/*.js` modules.
- `scripts/ops-snapshot.js`
  - Ops snapshot config parsing, authenticated HTTP probes, metrics extraction,
    readiness/runtime summaries, admin-summary redaction, posture/event, and
    ownership summaries moved into focused `scripts/ops-snapshot/*.js` modules.
- `scripts/metrics-smoke.js`
  - Metrics smoke config, server lifecycle, session/metrics HTTP probes, and the
    required metric contract moved into focused `scripts/metrics-smoke/*.js`
    modules.
- `scripts/ws-load-smoke.js`
  - WebSocket load config/thresholds, client session/socket behavior, server
    metric comparison, and benchmark summary/failure logic moved into focused
    `scripts/ws-load-smoke/*.js` modules.
- `scripts/ws-account-capacity-smoke.js`
  - WebSocket account-capacity smoke config/JWT signing, server lifecycle,
    session/admin/metrics HTTP helpers, and held/raw WebSocket probes moved into
    focused `scripts/ws-account-capacity-smoke/*.js` modules.
- `scripts/origin-allowlist-smoke.js`
  - Origin allowlist smoke config, invalid-startup server lifecycle,
    session/admin/metrics HTTP helpers, and raw WebSocket upgrade probes moved
    into focused `scripts/origin-allowlist-smoke/*.js` modules.
- `scripts/session-token-hardening-smoke.js`
  - Session-token hardening smoke config, server lifecycle,
    session/admin/metrics HTTP helpers, and raw/accepted WebSocket probes moved
    into focused `scripts/session-token-hardening-smoke/*.js` modules.
- `scripts/account-settlement-smoke.js`
  - Account-bound settlement smoke config, JWT signing, server lifecycle,
    session/admin HTTP helpers, and registrar/deed WebSocket choreography moved
    into focused `scripts/account-settlement-smoke/*.js` modules.
- `scripts/rename-validation-smoke.js`
  - Rename validation smoke config, server lifecycle, session/admin/metrics
    HTTP helpers, and valid/invalid rename WebSocket choreography moved into
    focused `scripts/rename-validation-smoke/*.js` modules.
- `scripts/runtime-manifest-smoke.js`
  - Runtime manifest smoke config, expected local manifest/image state, admin
    HTTP helpers, server lifecycle, runtime contract checks, and response
    summarizers moved into focused `scripts/runtime-manifest-smoke/*.js`
    modules.
- `scripts/content-contract-smoke.js`
  - Content contract negative-world fixtures, CLI/runtime config, fail-closed
    server startup, output capture, and timeout handling moved into focused
    `scripts/content-contract-smoke/*.js` modules.
- `scripts/assets-smoke.js`
  - Served asset smoke config, server lifecycle, HTTP/hash helpers, sprite
    sheet/projection/render/SHA/dimension checks, and terrain atlas/authority
    checks moved into focused `scripts/assets-smoke/*.js` modules.
- `scripts/ws-peer-capacity-smoke.js`
  - WebSocket peer-capacity smoke config, session/admin/metrics HTTP helpers,
    server lifecycle, and held/raw WebSocket probes moved into focused
    `scripts/ws-peer-capacity-smoke/*.js` modules.
- `scripts/ws-ingress-config-smoke.js`
  - WebSocket ingress-config smoke config, session/admin/metrics HTTP helpers,
    reject-count polling, server lifecycle, and oversized/rate-limit WebSocket
    probes moved into focused `scripts/ws-ingress-config-smoke/*.js` modules.
- `scripts/account-jwt-auth-smoke.js`
  - Account JWT auth smoke config, JWT test-token generation/signing,
    session/summary/metrics HTTP helpers, and server lifecycle moved into
    focused `scripts/account-jwt-auth-smoke/*.js` modules.
- `scripts/ws-admission-preflight-smoke.js`
  - WebSocket admission-preflight smoke config, metrics fetch/poll helpers,
    server lifecycle, session issuance, held sockets, raw handshakes, and socket
    cleanup moved into focused `scripts/ws-admission-preflight-smoke/*.js`
    modules.
- `scripts/gameplay-journal-replay-smoke.js`
  - Gameplay journal replay smoke config, crafting/admin HTTP helpers, gameplay
    event matching/ordering, resource-node replay summaries, and server
    lifecycle moved into focused `scripts/gameplay-journal-replay-smoke/*.js`
    modules.
- `scripts/crafting-smoke.js`
  - Crafting smoke CLI config, journal lookup, session/target HTTP helpers,
    and WebSocket gather/craft choreography moved into focused
    `scripts/crafting-smoke/*.js` modules; obstacle-aware movement steering
    moved into `scripts/lib/ws-smoke-steering.js`.
- `scripts/resource-gather-smoke.js`
  - Resource-gather smoke CLI config, journal lookup, session/target HTTP
    helpers, and WebSocket gather choreography moved into focused
    `scripts/resource-gather-smoke/*.js` modules; obstacle-aware movement
    steering now reuses `scripts/lib/ws-smoke-steering.js`.
- `scripts/generate-placeholder-sprites.js`
  - Low-level placeholder sprite raster primitives moved into
    `scripts/placeholder-sprites/raster.js`, and PNG encoding now reuses the
    shared placeholder terrain PNG encoder.
- `client/styles.css`
  - Base tokens/typography, layout/canvas/panels, player card, inventory/deed
    UI, controls/metrics, and responsive rules moved into imported
    `client/styles/*.css` files.
- `client/player-config.js`
  - Player, paperdoll, sprite-sheet, item-icon, detail-sprite, portrait, and
    clustering constants moved out of `client/app.js`.
- `client/sprite-loader.js`
  - Sprite manifest selection, actor-sheet loading, paperdoll stack loading, and
    item icon data URL generation moved out of `client/app.js`.
- `client/sprite-assets.js`
  - Runtime sprite-sheet selection, projection/safe-path/SHA/render metadata
    checks, animation normalization, and paperdoll overlay compatibility moved
    into focused `client/sprite-assets/*.js` modules behind a stable facade.
- `client/runtime-image-loader.js`
  - Runtime PNG fetch, content-type check, SHA-256 verification, and browser
    image construction moved out of `client/app.js`.
- `client/terrain-loader.js`
  - Terrain manifest fetch, atlas normalization, verified terrain PNG loading,
    and pattern-source construction moved out of `client/app.js`.
- `client/ui-panels.js`
  - HUD, player card, deed panel, inventory panel, item icon lookup, lifecycle
    display text, and player display-name formatting moved out of `client/app.js`.
- `client/overlay.js`
  - Canvas overlay prompt rendering, nearby interactable lookup, and prompt tone
    colors moved out of `client/app.js`.
- `client/player-render-state.js`
  - Player visual smoothing, crowd spread offsets, proximity clustering,
    deterministic variant assignment, nearby-player counts, and movement motion
    tracking moved out of `client/app.js`.
- `client/network-client.js`
  - Session issuance, WebSocket connect/reconnect, authoritative server-message
    parsing, welcome/snapshot callbacks, input packet deduplication, and socket
    sends moved out of `client/app.js`.
- `client/app.js`
  - DOM lookup, canvas resize/FPS/loading paint, runtime asset load state, and
    deterministic terrain cache ownership moved into `client/app-dom.js`,
    `client/app-frame.js`, `client/app-assets.js`, and `client/terrain-cache.js`
    so `client/app.js` stays a browser conductor.
- `client/server-message-test-fixtures.js`
  - Shared valid server snapshot, terrain, player, object, UUID, and settlement
    receipt fixtures moved out of the former `client/server-messages.test.js`.
- `client/server-messages-basic.test.js`
  - Valid welcome/snapshot parsing, unsupported message rejection, malformed
    JSON rejection, and notice parsing moved out of the former
    `client/server-messages.test.js`.
- `client/server-messages-player-state.test.js`
  - Player coordinate bounds, player-list caps, resource count validation,
    inventory shape validation, and inventory lifecycle coverage moved out of
    the former `client/server-messages.test.js`.
- `client/server-messages-world-state.test.js`
  - Object-kind validation, object resource/lifecycle validation, terrain
    profile/projection checks, material validation, and settlement receipt
    validation moved out of the former `client/server-messages.test.js`.
- `client/server-messages.js`
  - Snapshot normalization, terrain/map contract validation, player resource and
    inventory parsing, object resource/lifecycle parsing, settlement receipt
    parsing, parser constants, and primitive validators moved into focused
    `client/server-message-*.js` child modules.
- `client/player-draw.js`
  - Player sort keys, sprite/paperdoll drawing, fallback body drawing, shadows,
    labels, footstep visuals, carried charge/decay effects, and player inventory
    badges moved out of `client/app.js`.
- `client/player-effects-draw.js`
  - Player footfall rendering, footstep particles, carried charge sparks, and
    carried decay/compost motes moved out of `client/player-draw.js`.
- `client/player-fallback-draw.js`
  - Procedural fallback player body, cloak, equipment silhouette, and fallback
    color shading moved out of `client/player-draw.js`.
- `client/player-label-draw.js`
  - Player name labels, deed marker, inventory badge drawing, and player label
    offset calculation moved out of `client/player-draw.js`.
- `client/player-sprite-draw.js`
  - Actor sprite drawing, paperdoll layer drawing, animation frame selection,
    and player shadow drawing moved out of `client/player-draw.js`.
- `client/player-draw-utils.js`
  - Stable player hash/index helper moved out of `client/player-draw.js` for
    shared player draw helper use.
- `client/ecology-renderer.js`
  - Ecology render orchestration moved out of `client/app.js`, then split so
    this file now only gathers ground effects/links and delegates drawing.
    Ground-plane rot, mycelium, charge, tree-litter, and mineral dust painting
    lives in `client/ecology-ground-effect-draw.js`; field-coil and
    deadwood-to-mycelium link painting lives in `client/ecology-link-draw.js`;
    curve points, ground projection, and stable hashing live in
    `client/ecology-renderer-utils.js`.
- `client/interior-renderer.js`
  - Interior roof fading, indoor reveal floors, upper-gallery outlines,
    stair/portal highlights, interior projection helpers, and roof-local
    stable hashing moved out of `client/app.js`.
- `client/object-draw.js`
  - Object/entity render sorting, world object rendering, ecology object
    sprites, fallback footprints, labels, object extras, and terrain-detail
    authority cues moved out of `client/app.js`.
- `client/object-authority-cue-draw.js`
  - Terrain-detail authority resource cue drawing and proximity/debug visibility
    checks moved out of `client/object-draw.js`.
- `client/object-fallback-draw.js`
  - Fallback object footprints, registrar/forge fallback bodies, and object
    fallback color selection moved out of `client/object-draw.js`.
- `client/object-label-draw.js`
  - Object labels and world object item/resource extras moved out of
    `client/object-draw.js`.
- `client/object-sprite-draw.js`
  - Prop sprite drawing, ecology object sprite selection/scaling, field-coil
    procedural sprite drawing, and prop-frame helpers moved out of
    `client/object-draw.js`.
- `client/object-cue-draw.js`
  - Item icon drawing, object resource meters, resource meter colors, ecology
    lifecycle cue overlays, terrain-detail tree/lifecycle cue overlays, and
    terrain resource cue stroke/fill rendering moved out of
    `client/object-draw.js`.
- `client/object-resource-cue-draw.js`
  - World item icon drawing, object resource meters, and resource meter color
    selection moved out of `client/object-cue-draw.js`.
- `client/ecology-lifecycle-cue-draw.js`
  - Tree, deadwood, mycelium, and stone-ruin lifecycle cue overlays moved out of
    `client/object-cue-draw.js`.
- `client/terrain-detail-cue-draw.js`
  - Terrain-detail tree lifecycle cues plus generated terrain resource cue
    rendering moved out of `client/object-cue-draw.js`.
- `client/terrain-detail-draw.js`
  - Terrain-detail sprite rendering, procedural trees, rocks, ruins, walls,
    stairs, foundations, reeds, ground details, detail shadows, detail
    occlusion, and detail sort keys moved out of `client/object-draw.js`.
- `client/terrain-detail-sprite-draw.js`
  - Terrain-detail sprite-sheet frame selection, tree sprite frame selection,
    prop-frame rock rendering, sprite shadows, and terrain-detail lifecycle cue
    calls moved out of `client/terrain-detail-draw.js`.
- `client/terrain-detail-procedural-draw.js`
  - Procedural terrain-detail trees, structures, nature/ground details, and
    shared detail shadows moved out of `client/terrain-detail-draw.js`, then
    split again so this file only dispatches. Tree drawing lives in
    `client/terrain-detail-procedural-trees.js`; ruins, walls, stairs, and
    foundations live in `client/terrain-detail-procedural-structures.js`;
    reeds, pebble clusters, and grass/flower tufts live in
    `client/terrain-detail-procedural-nature.js`; the common ellipse shadow
    helper lives in `client/terrain-detail-shadow.js`.
- `client/terrain-draw.js`
  - Terrain tile drawing, atlas frame drawing, slope facets, material
    transitions, underpaint, relief edges, and decals moved out of
    `client/app.js`, then split again so this file now coordinates renderer
    state, chunk iteration, atlas/debug dispatch, and static-layer replay.
- `client/terrain-draw-surface.js`
  - Terrain side walls, slope facet shading, height lighting, relief-edge
    shading, and underpaint material selection moved out of
    `client/terrain-draw.js`.
- `client/terrain-draw-decals.js`
  - Water shimmer and ground decals for cracks, moss, masonry joints, pebbles,
    road/ridge chips, and grass tufts moved out of `client/terrain-draw.js`.
- `client/terrain-draw-geometry.js`
  - Terrain draw edge selection, edge-band construction, tile interpolation,
    band centers, and alpha tint helpers moved out of `client/terrain-draw.js`.
- `client/terrain-debug-draw.js`
  - Terrain debug mode normalization, chunk outlines, biome/material/elevation
    fills, transition diagnostics, walkability overlays, and terrain authority
    overlays moved out of `client/terrain-draw.js`.
- `client/terrain-draw-layers.js`
  - Terrain chunk geometry, projected tile bounds, visible-bounds culling,
    static offscreen chunk layer caching, and terrain render cache keys moved
    out of `client/terrain-draw.js`.
- `client/terrain-draw-atlas.js`
  - Terrain atlas tile drawing and grass underpaint moved out of
    `client/terrain-draw.js`, then split again so this file now only selects
    atlas frames and delegates drawing.
- `client/terrain-draw-atlas-frames.js`
  - Pattern-frame caching, raw atlas-frame drawing, pixel smoothing control,
    and repeated pattern fills moved out of `client/terrain-draw-atlas.js`.
- `client/terrain-draw-atlas-transitions.js`
  - Material transition atlas lookup, edge/corner mask clipping, transition
    stroke styling, and transition material cue chips moved out of
    `client/terrain-draw-atlas.js`.
- `client/terrain-primitives.js`
  - Terrain material palette, profile validation/defaults, biome channels,
    material selection, deterministic corner heights, height metadata,
    material priority, deterministic noise/hash helpers, interpolation, and
    numeric clamping moved out of `client/terrain.js`, then split again so
    `client/terrain-primitives.js` is now a facade. Material palette/priority
    lives in `client/terrain-materials.js`; projection profile validation lives
    in `client/terrain-profile.js`; biome/material selection lives in
    `client/terrain-biome.js`; corner heights and height metadata live in
    `client/terrain-height.js`; deterministic noise/hash/interpolation/clamp
    helpers live in `client/terrain-noise.js`.
- `client/terrain-interiors.js`
  - Terrain interior space metadata for gatehouse passages, sunken courtyard
    floors, stair/threshold portals, roof reveal metadata, and world bounds
    moved out of `client/terrain.js`.
- `client/terrain-details.js`
  - Terrain detail footprint profiles, per-detail resource/lifecycle metadata,
    tree age/decay derivation, detail instance construction, and terrain-detail
    authority manifest shaping moved out of `client/terrain.js`, then split
    again so `client/terrain-details.js` is now only the detail instance
    builder/facade. Footprints live in `client/terrain-detail-footprints.js`;
    resource/lifecycle metadata lives in `client/terrain-detail-metadata.js`;
    detail authority manifests live in `client/terrain-detail-authority.js`.
- `client/terrain-detail-placement.js`
  - Terrain detail placement orchestration moved out of `client/terrain.js`,
    then split again so the file is now only the coordinator. Composition-kit
    dispatch lives in `client/terrain-detail-kit-details.js`; ruin/courtyard
    placement catalogs live in `client/terrain-detail-ruin-kits.js`; ecology
    and nature placement catalogs live in `client/terrain-detail-nature-kits.js`;
    per-tile ambient detail selection lives in `client/terrain-detail-tile.js`;
    footprint reservation and deterministic placement emission live in
    `client/terrain-detail-placement-utils.js`.
- `client/terrain-composition.js`
  - Terrain zone classification, elevation/moisture/detail bands, road-axis
    derivation, landmark pressure, and composition-kit material/object-band
    overrides moved out of `client/terrain.js`.
- `client/terrain-habitat.js`
  - Correlated woodland, wetland, rocky, scrub, and negative-space habitat
    scoring from continuous biome, slope, path, water, and wind authority.
    `client/terrain-composition.js` records the result; ambient detail placement
    consumes it without inventing a second ecology model.
- `client/terrain-composition-kit.js`
  - Terrain composition-kit catalog, deterministic kit construction, material
    overrides, geometry metrics, and membership scoring moved out of
    `client/terrain-composition-kit.js` into focused
    `client/terrain-composition-kit-*.js` modules. The original file is now a
    public facade for existing terrain imports.
- `client/terrain-transitions.js`
  - Terrain material edge/corner transitions, transition priority, transition
    family/depth selection, and stable transition seeds moved out of
    `client/terrain.js`.
- `client/terrain-decals.js`
  - Procedural pebble/tuft decals plus viaduct and sunken-courtyard decay
    decals moved out of `client/terrain.js`.
- `client/terrain-chunks.js`
  - Terrain chunk construction, aggregate chunk height metadata, elevation
    edge cues, and local height averaging moved out of `client/terrain.js`.
- `client/terrain-geometry.js`
  - Projected terrain tile corners and UO-style split facet metadata moved out
    of `client/terrain.js`; `client/terrain.js` re-exports these public helpers.
- `client/terrain-test-fixtures.js`
  - Shared deterministic terrain map fixture, terrain profile fixture, and
    detail-to-tile helper moved out of `client/terrain.test.js`.
- `client/terrain-sampling.test.js`
  - Terrain height metadata, water flattening, height sampling, walkability,
    sub-tile projected vertical motion, interior stair sampling, seed changes,
    projected terrain corners, and slope facet tests moved out of
    the former `client/terrain.test.js` god test module.
- `client/terrain-build.test.js`
  - Deterministic terrain build, chunk coverage, projection metadata, interior
    exposure metadata, transition masks, elevation cues, and high-level detail
    presence checks moved out of the former `client/terrain.test.js`.
- `client/terrain-family-biome.test.js`
  - Terrain family catalog contracts, family placement rules, biome channel
    bounds, and direct biome/material selection checks moved out of the former
    `client/terrain.test.js`.
- `client/terrain-composition.test.js`
  - Terrain composition zones, open-space clutter budgets, composition kit
    district separation, ruin scenes, grove scenes, reedbeds, and charged
    ecology kit checks moved out of the former `client/terrain.test.js`.
- `client/terrain-detail-authority.test.js`
  - Terrain detail footprint spacing, detail authority manifest export,
    resource node mapping, decay consumers, organic lifecycle metadata, and
    mineral decay metadata moved out of the former `client/terrain.test.js`.
- `server/src/player_identity.rs`
  - Player display-name validation, normalized name keys, name errors, max-name
    limit, and deterministic fallback colors moved out of `server/src/sim.rs`.
- `server/src/sim/model.rs`
  - Shared simulation ECS components, public tick outcome/event types,
    `SimWorld` storage, simulation constants, gather targets, and position/math
    helpers moved out of `server/src/sim.rs`.
- `server/src/sim/world_init.rs`
  - `SimWorld` construction from validated world content, terrain-detail
    authority promotion, generated ecology object bootstrapping, spatial index
    setup, and ECS world-object spawning moved out of `server/src/sim.rs`.
- `server/src/sim/players.rs`
  - Player add/remove, display-name validation and collision checks, default
    name generation, spawn insertion, player index updates, rename updates, and
    input assignment moved out of `server/src/sim.rs`.
- `server/src/sim/terrain_authority/model.rs`
  - Terrain-detail authority manifest structs, resource requirement structs, and
    authority caps moved out of `server/src/sim/terrain_authority.rs`.
- `server/src/sim/terrain_authority/blockers.rs`
  - Terrain-detail movement blocker conversion and collision validation moved
    out of `server/src/sim/terrain_authority.rs`.
- `server/src/sim/terrain_authority/decay.rs`
  - Terrain-detail decay-consumer rule loading, consume requirement merging, and
    target-object validation moved out of
    `server/src/sim/terrain_authority.rs`.
- `server/src/sim/terrain_authority/resource_objects.rs`
  - Terrain-detail resource-node promotion, lifecycle family derivation,
    generated object kind/label/radius selection, regen, health, stage, and
    species metadata moved out of `server/src/sim/terrain_authority.rs`.
- `server/src/sim/terrain_authority/validation.rs`
  - Terrain-detail authority schema, projection, profile, and units-per-tile
    header validation moved out of `server/src/sim/terrain_authority.rs`.
- `server/src/runtime_paths.rs`
  - Runtime path helpers for client, assets, content, journal, and settlement
    outbox moved out of `server/src/main.rs`.
- `server/src/sim/tests.rs`
  - The simulation test module moved out of `server/src/sim.rs` as a child
    module, preserving private access while removing test mass from production
    code.
- `server/src/sim/tests/player_identity.rs`
  - Player color snapshot contract, interest-radius snapshot filtering,
    display-name validation, active-name uniqueness/release, prevalidated
    display-name spawn, and plaza spawn separation tests moved out of
    `server/src/sim/tests.rs`.
- `server/src/sim/tests/movement.rs`
  - Diagonal speed normalization, world-object collision, terrain-detail
    movement blocker, overlapped-blocker escape, and water-blocked movement
    tests moved out of `server/src/sim/tests.rs`.
- `server/src/sim/tests/terrain_detail_authority.rs`
  - Server-owned terrain-detail resource promotion, terrain-detail decay
    consumer recipes, missing consumer target rejection, off-map resource-node
    skipping, and terrain-detail ecology tests moved out of
    `server/src/sim/tests.rs`.
- `server/src/sim/tests/crafting_inventory.rs`
  - Inventory stack bounds, forge recipe crafting, crafted-item composting,
    crafted-item lifecycle aging, compost-spore shedding, and no-recipe
    crafting rejection tests moved out of `server/src/sim/tests.rs`.
- `server/src/sim/tests/ecology_resources.rs`
  - Generated ecology object/resource node coverage, resource gathering,
    resource depletion/regrowth, resource-node replay, resource lifecycle
    aging, deadwood/mycelium decay, coil energizing, and organic inventory feed
    tests moved out of `server/src/sim/tests.rs`.
- `server/src/config_tests.rs`
  - The main runtime/config/security test module moved out of `server/src/main.rs`
    as a child module, preserving private access while removing test mass from
    production boot code.
- `server/src/config.rs`
  - Session ticket config and session issue/account rate-limit config moved out
    of `server/src/main.rs`.
- `server/src/config/env.rs`
  - Boolean/positive env parsing, optional env string parsing, deployment
    profile parsing, persistence/admission backend parsing, supported backend
    guards, bind-address parsing and validation, public chain-mode validation,
    and deployment profile validation moved out of `server/src/config.rs`.
- `server/src/config/auth.rs`
  - Account auth config parsing, account auth mode reporting, HS256 JWT
    validation, account JWT subject validation, and auth/JWT size constants
    moved out of `server/src/config.rs`.
- `server/src/config/budget.rs`
  - Runtime budget min/max constants, `RuntimeBudgetConfig`, session/admission/
    WebSocket/content/durable/asset budget validation, and primitive budget
    helper validators moved out of `server/src/config.rs`.
- `server/src/config/public_deployment.rs`
  - Public deployment fail-closed validation, public token strength and
    placeholder checks, public JWT issuer/audience checks, localhost issuer
    rejection, and account/admin/metrics credential distinctness checks moved
    out of `server/src/config.rs`.
- `server/src/config/network.rs`
  - Origin allowlist config/parsing, allowed-origin validation, WebSocket
    timing/config, and client WebSocket ingress config moved out of
    `server/src/config.rs`.
- `scripts/normalize-generated-detail-sheet.py`
  - Removed the unreachable legacy tree renderer left after
    `draw_tree_frame()` switched to `draw_clean_tree_frame()`, reducing the
    generator without changing the active output path.
- `scripts/detail_sheet_normalization.py`
  - Magenta-screen removal, generated source sprite-box detection, detached
    artifact cleanup, and trim-to-cell fitting moved out of
    `scripts/normalize-generated-detail-sheet.py`.
- `scripts/deployment-preflight/parsing.js`
  - CLI arg parsing, exact Origin parsing, bind-address parsing, local-host
    checks, compact printable validation, and placeholder secret detection moved
    out of `scripts/deployment-preflight.js`.
- `scripts/deployment-preflight/budgets.js`
  - Numeric budget limits, integer/float budget parsing, primitive budget
    bounds, and cross-budget invariant checks moved out of
    `scripts/deployment-preflight.js`.
- `scripts/deployment-preflight/auth.js`
  - Account auth mode checks, shared-token strength/distinctness checks, and JWT
    identity guardrails moved out of `scripts/deployment-preflight.js`.
- `scripts/deployment-preflight/runtime.js`
  - Deployment profile matching, persistence/admission backend posture, public
    mode requirements, build provenance, durable write/path checks, drain-mode
    checks, and shared boolean env parsing moved out of
    `scripts/deployment-preflight.js`.
- `scripts/deployment-preflight/network.js`
  - Origin allowlist checks, bind-address posture, chain-mode guardrails,
    production signer/indexer URL validation, Redis URL validation, and final
    production blocker checks moved out of `scripts/deployment-preflight.js`.
- `scripts/deployment-preflight/smoke-cases.js`
  - Deployment preflight smoke case aggregation moved out of
    `scripts/deployment-preflight-smoke.js`.
- `scripts/deployment-preflight/smoke-env.js`
  - Shared-poc hardened env and JWT env fixture builders moved out of
    `scripts/deployment-preflight/smoke-cases.js`.
- `scripts/deployment-preflight/smoke-shared-poc-cases.js`
  - Shared-poc deployment preflight hardening, rejection, JWT, durable, budget,
    Origin, bind, and build provenance scenarios moved out of
    `scripts/deployment-preflight/smoke-cases.js`.
- `scripts/deployment-preflight/smoke-production-cases.js`
  - Production deployment preflight blocker and hardening scenarios moved out of
    `scripts/deployment-preflight/smoke-cases.js`.
- `scripts/sprite-manifest/validation.js`
  - Primitive object/string/integer/hash/path/subpath validators moved out of
    `scripts/verify-sprite-manifest.js`.
- `scripts/sprite-manifest/image.js`
  - PNG IHDR parsing, sprite sheet dimension verification, and image SHA-256
    verification moved out of `scripts/verify-sprite-manifest.js`.
- `scripts/sprite-manifest/projection.js`
  - Sprite manifest military-plan-oblique projection contract checks moved out
    of `scripts/verify-sprite-manifest.js`.
- `scripts/sprite-manifest/sheet.js`
  - Sprite sheet ID/path/hash, frame-grid, anchor, footprint, render, shadow,
    direction, approval, and provenance dispatch validation moved out of
    `scripts/verify-sprite-manifest.js`.
- `scripts/sprite-manifest/paperdoll.js`
  - Paperdoll base/layer lookup, role/slot checks, sheet compatibility checks,
    and direction/frame alignment moved out of
    `scripts/verify-sprite-manifest.js`.
- `scripts/sprite-manifest/provenance.js`
  - Approval state checks, clean-room provenance policy, generator tool review
    requirements, quarantined generator checks, and prompt/style-reference
    guardrails moved out of `scripts/verify-sprite-manifest.js`.
- `scripts/sprite-manifest/test-fixtures.js`
  - Shared valid sheet/manifest fixtures, PNG header generation, temp directory
    setup, and fixture hashing moved out of `scripts/sprite-manifest.test.js`.
- `scripts/sprite-manifest/base.test.js`
  - Clean manifest acceptance, projection drift, sheet dimension mismatch, and
    render metadata tests moved out of `scripts/sprite-manifest.test.js`.
- `scripts/sprite-manifest/image.test.js`
  - PNG dimension and image hash validation tests moved out of
    `scripts/sprite-manifest.test.js`.
- `scripts/sprite-manifest/paperdoll.test.js`
  - Paperdoll stack alignment and layer mismatch tests moved out of
    `scripts/sprite-manifest.test.js`.
- `scripts/sprite-manifest/provenance.test.js`
  - Clean-room provenance, generator review, quarantined generator, and
    prompt/style-reference guardrail tests moved out of
    `scripts/sprite-manifest.test.js`.
- `scripts/placeholder-terrain-atlas/catalog.js`
  - Placeholder material palettes, edge/corner masks, row count, pair-transition
    catalog, and manifest tile metadata generation moved out of
    `scripts/generate-placeholder-terrain-atlas.js`. The catalog now matches the
    current 10-material/120-tile terrain atlas contract.
- `scripts/placeholder-terrain-atlas/raster.js`
  - Placeholder atlas pixel blending, triangle/diamond/ellipse/rect/line
    drawing, clipped lines, diamond clearing, and raster bounds checks moved out
    of `scripts/generate-placeholder-terrain-atlas.js`.
- `scripts/placeholder-terrain-atlas/png.js`
  - Minimal PNG scanline encoding, zlib compression, chunks, IHDR, and CRC-32
    moved out of `scripts/generate-placeholder-terrain-atlas.js`.
- `scripts/placeholder-terrain-atlas/manifest.js`
  - Placeholder terrain manifest row/frame/tile shape update moved out of
    `scripts/generate-placeholder-terrain-atlas.js`.
- `scripts/placeholder-terrain-atlas/color.js`
  - Placeholder atlas shade/mix/hash helpers moved out of
    `scripts/generate-placeholder-terrain-atlas.js`.
- `scripts/placeholder-terrain-atlas/transition-masks.js`
  - Placeholder transition mask weights, edge/corner falloff, and deterministic
    transition accent placement moved out of
    `scripts/generate-placeholder-terrain-atlas.js`.
- `scripts/placeholder-terrain-atlas/material-details.js`
  - Placeholder grass, field, dirt, stone, water, settlement, paver-grid, and
    cobble-field detail recipes moved out of
    `scripts/generate-placeholder-terrain-atlas.js`, leaving the generator
    responsible for atlas assembly and output writes.
- `scripts/terrain-atlas/*.js`
  - Terrain atlas schema/projection/path validation, tile coverage checks,
    clean-room provenance and approval policy, PNG dimension/hash checks,
    constants, and primitive validators moved out of
    `scripts/verify-terrain-atlas.js`.
- `scripts/terrain_atlas_manifest.py`
  - Generated terrain atlas tile metadata, tile IDs, masks, pair-transition
    entries, walkability, and surface role assignment moved out of
    `scripts/normalize-generated-terrain-atlas.py`.
- `scripts/pixel_art_primitives.py`
  - Shared shade/mix, rect, ellipse, polygon, line, leaf-chip, and
    alpha-composited pixel helpers moved out of generated terrain/detail asset
    scripts.
- `scripts/detail_sheet_manifest.py`
  - Detail sheet grid constants, static-frame offset, sprite manifest metadata,
    provenance, and review state moved out of
    `scripts/normalize-generated-detail-sheet.py`.
- `scripts/detail_sheet_tree_frames.py`
  - Locally authored sapling, mature, and ancient tree-frame drawing, species
    palettes, branch/root/resource/age cues, and tree pixel noise moved out of
    `scripts/normalize-generated-detail-sheet.py`; broadleaf, needle, sparse,
    chunky cluster, crown notch, and crown facet recipes live in
    `scripts/detail_sheet_tree_crowns.py`.
- `scripts/asset_pipeline_utils.py`
  - SHA-256 file hashing, deterministic source hashing, and JSON manifest
    read/write helpers moved out of generated terrain/detail normalization
    scripts.
- `scripts/terrain_atlas_materials.py`
  - Terrain atlas dimensions, material lists, source aliases, transition pair
    catalog, masks, and material palettes moved out of
    `scripts/normalize-generated-terrain-atlas.py`.
- `scripts/terrain_atlas_material_details.py`
  - Generated terrain atlas material recipe dispatch plus grass, field, dirt,
    stone, water, settlement, cobble, rock, ruin, shore, slope-striation, and
    transition-scatter painting moved out of
    `scripts/normalize-generated-terrain-atlas.py`.
- `scripts/terrain_atlas_pair_transitions.py`
  - Terrain atlas pair-transition family classification, source-patch blending,
    and path/rocky/shore/plaza/soft transition detail painting moved out of
    `scripts/normalize-generated-terrain-atlas.py`.
- `scripts/terrain_atlas_transition_masks.py`
  - Directional edge/corner transition variants, mask edge marks, transition
    weights, and falloff math moved out of
    `scripts/normalize-generated-terrain-atlas.py`.
- `server/src/config_tests/env.rs`
  - Env boolean/positive parsing tests, deployment profile parsing tests,
    persistence/admission backend parsing tests, and reserved backend guard tests
    moved out of `server/src/config_tests.rs`.
- `server/src/config_tests/network.rs`
  - WebSocket heartbeat/idle timing tests and Origin allowlist parsing/rejection
    tests moved out of `server/src/config_tests.rs`.
- `server/src/config_tests/readiness.rs`
  - Durable parent path readiness, durable path basename redaction, durable
    persistence health, and settlement queue readiness tests moved out of
    `server/src/config_tests.rs`.
- `server/src/config_tests/auth.rs`
  - Constant-time token comparison tests, bounded auth header parsing tests,
    JWT validation tests, and account subject validation tests moved out of
    `server/src/config_tests.rs`.
- `server/src/config_tests/public_deployment.rs`
  - Public deployment fail-closed guardrail tests for session/account auth,
    Origin allowlist, durable persistence posture, admin/metrics tokens, and
    JWT identity configuration moved out of `server/src/config_tests.rs`.
- `server/src/sim/tests/ecology_resources/gathering.rs`
  - Player gathering, bounded inventory resources, held-interact suppression,
    mycelium depletion, and node regrowth tests moved out of
    `server/src/sim/tests/ecology_resources.rs`.
- `server/src/sim/tests/ecology_resources/generated.rs`
  - Generated ecology object/resource-node presence, lifecycle metadata, and
    generated-node harvesting/feeding tests moved out of
    `server/src/sim/tests/ecology_resources.rs`.
- `server/src/sim/tests/ecology_resources/lifecycle.rs`
  - Resource lifecycle aging, deadwood-to-mycelium feed ticks, organic inventory
    feeding, and field-coil energizing tests moved out of
    `server/src/sim/tests/ecology_resources.rs`.
- `server/src/sim/tests/ecology_resources/replay.rs`
  - Resource-node replay restoration, resource-kind mismatch rejection, and
    replay amount checks moved out of
    `server/src/sim/tests/ecology_resources.rs`.
- `server/src/runtime.rs`
  - Runtime env collection, durable lock/file setup, journal replay, resource
    node replay, settlement worker/replay setup, runtime asset verification,
    terrain-detail authority loading, sim construction, and runtime assembly
    moved out of `server/src/main.rs`; `AppState` and `RuntimeServer` carrier
    types now live in `server/src/runtime/state.rs`. Durable lock/file setup,
    JSONL size checks, journal/resource-node replay, writer opening, and
    settlement outbox opening later moved into `server/src/runtime/durable.rs`.
- `server/src/runtime/durable.rs`
  - Durable path distinctness checks, file lock acquisition, JSONL size checks,
    settlement outbox opening, confirmed receipt seeding, journal replay,
    resource-node replay loading, and journal writer opening moved out of
    `server/src/runtime.rs`.
- `server/src/persistence/file_guard.rs`
  - Durable file lock acquisition/cleanup, durable path distinctness validation,
    and durable file size guards moved out of `server/src/persistence.rs`.
- `server/src/persistence/jsonl.rs`
  - Bounded JSONL line iteration and synced/unsynced JSONL event writing moved
    out of `server/src/persistence.rs`.
- `server/src/persistence/journal_loader.rs`
  - Journal replay loading, retained event trimming, next sequence tracking, and
    sequence anomaly counting moved out of `server/src/persistence.rs`.
- `server/src/persistence/tests.rs`
  - Durable lock, size guard, JSONL append, replay parsing, line-size, retained
    event, and sequence anomaly tests moved out of `server/src/persistence.rs`.
- `server/src/readiness.rs`
  - `/readyz`, readiness response structs, durable persistence health checks,
    settlement queue capacity checks, durable parent directory checks, and
    durable path basename redaction moved out of `server/src/main.rs`.
- `server/src/runtime_assets.rs`
  - Runtime app/sprite/terrain/terrain-authority manifest serialization,
    manifest size checks, safe relative image path validation, SHA-256 image pin
    verification, runtime fingerprints, projection parsing, and terrain detail
    authority loading moved out of `server/src/main.rs`.
- `server/src/runtime_assets/model.rs`
  - Runtime manifest response structs for app, content, sprite/terrain assets,
    projection metadata, verified images, and terrain authority ops reporting
    moved out of `server/src/runtime_assets.rs`.
- `server/src/runtime_assets/asset_manifests.rs`
  - Runtime sprite and terrain manifest loading, entry counting, approval state
    capture, manifest fingerprints, and image pin verification orchestration
    moved out of `server/src/runtime_assets.rs`.
- `server/src/runtime_assets/terrain_authority.rs`
  - Terrain-detail authority runtime manifest validation plus sim authority JSON
    loading moved out of `server/src/runtime_assets.rs`.
- `server/src/runtime_assets/validation.rs`
  - Runtime projection parsing, safe relative asset path checks, SHA-256 pin
    validation, image size/hash verification, required JSON field helpers, and
    stable runtime fingerprinting moved out of `server/src/runtime_assets.rs`.
- `server/src/http_routes.rs`
  - HTTP hardening middleware, content security policy, hidden-path rejection,
    request ID validation/generation, asset cache headers, and sanitized trace
    path helpers moved out of `server/src/main.rs`.
- `server/src/routes.rs`
  - Router construction, route registration, body-limit and trace layer wiring,
    static asset/client serving, health check handling, and application state
    attachment moved out of `server/src/main.rs`.
- `server/src/admin_routes.rs`
  - Admin events, admin ownership, runtime manifest, admin summary response
    shaping, admin event query parsing, and admin summary redacted durable path
    reporting moved out of `server/src/main.rs`.
- `server/src/content/validation.rs`
  - World schema version checks, map bounds checks, terrain projection/material
    contract validation, object ID/label/footprint validation, required
    registrar/forge checks, and object-count cap enforcement moved out of
    `server/src/content.rs`.
- `server/src/content/hash.rs`
  - Stable FNV-1a content fingerprinting for ops/runtime manifests moved out of
    `server/src/content.rs`.
- `server/src/content/tests.rs`
  - Content contract unit coverage for required objects, schema version,
    terrain contract, object bounds, object caps, and stable hash behavior
    moved out of `server/src/content.rs`.
- `server/src/journal.rs`
  - Durable journal event schema moved into `server/src/journal/model.rs`, and
    retained-event behavior tests moved into `server/src/journal/tests.rs`,
    leaving the parent module responsible for in-memory event sequencing,
    retention, and query behavior.
- `server/src/metrics_routes.rs`
  - `/metrics` authorization/response shaping and `/api/snapshot` admin
    snapshot serialization moved out of `server/src/main.rs`; Prometheus
    runtime metric rendering now lives in child modules.
- `server/src/metrics_routes/runtime_metrics.rs`
  - Runtime metric collection, base `AppMetrics` render orchestration,
    metric-value snapshotting, and shared metric-line formatting moved out of
    `server/src/metrics_routes.rs`.
- `server/src/metrics_routes/runtime_metrics/sim_journal.rs`
  - Tick, player, journal, replay, and journal budget Prometheus gauge
    emission moved out of the metrics route handler.
- `server/src/metrics_routes/runtime_metrics/settlement_content.rs`
  - Settlement ledger/outbox, settlement queue, durable write, and content
    budget Prometheus gauge emission moved out of the metrics route handler.
- `server/src/metrics_routes/runtime_metrics/session.rs`
  - Session ticket capacity plus IP/account session rate-limit Prometheus
    gauge emission moved out of the metrics route handler.
- `server/src/metrics_routes/runtime_metrics/connection_ws.rs`
  - Active connection, WebSocket timing, snapshot budget, ingress budget, and
    client reject-limit Prometheus gauge emission moved out of the metrics
    route handler.
- `server/src/metrics_routes/runtime_metrics/deployment_auth.rs`
  - Origin allowlist, deployment profile, backend posture, drain mode, account
    auth, chain mode, HTTP body limit, and admin-event limit Prometheus gauge
    emission moved out of the metrics route handler.
- `server/src/session_routes.rs`
  - `/api/session` ticket issuance, session request/response types, session
    body content-type validation, display-name parsing, session issue error
    mapping, and player-name response mapping moved out of
    `server/src/main.rs`.
- `server/src/auth.rs`
  - Admin token authorization, metrics token authorization, account session
    authorization, Origin allowlist checks, bounded header/bearer parsing,
    constant-time token comparison, session reject response mapping, and
    session-auth identity extraction moved out of `server/src/main.rs`.
- `server/src/ws.rs`
  - WebSocket upgrade handling, session ticket preflight/validation, peer/account
    permit acquisition for sockets, player socket loop, welcome/snapshot sends,
    heartbeat/idle handling, client-message parsing, ingress rejection
    journaling, and snapshot payload-size checks moved out of
    `server/src/main.rs`; connection-loop, inbound-message, and outbound-snapshot
    behavior now live in focused `server/src/ws/*.rs` child modules.
- `server/src/tick_loop.rs`
  - Simulation tick loop orchestration, tick-budget metrics, simulation outcome
    journal event mapping, persisted settlement enqueue handling, settlement
    persistence failure journaling, player removal journaling, and shared journal
    append failure accounting moved out of `server/src/main.rs`.
- `server/src/resource_replay.rs`
  - Durable journal scan for resource-node replay, resource-node change event
    parsing, replay amount clamping, and replay parse context moved out of
    `server/src/main.rs`.
- `server/src/admission.rs`
  - Peer IP connection counters, account-subject connection counters,
    connection permit acquisition/release, and drop-time async permit cleanup
    moved out of `server/src/main.rs`.
- `server/src/sim/inventory.rs`
  - Inventory stacks, inventory item kinds, crafted item kinds, stack limits,
    resource/crafted item labels, inventory lifecycle snapshots, compostability,
    compost feed amounts, and inventory decay/spore output moved out of
    `server/src/sim.rs`; those responsibilities now live in focused
    `server/src/sim/inventory/*.rs` child modules with
    `server/src/sim/inventory.rs` as the coordinator.
- `server/src/sim/lifecycle.rs`
  - Lifecycle families, snapshot family names, stage selection, age pressure,
    health wear, decay math, and lifecycle year-rate rules moved out of
    `server/src/sim.rs`.
- `server/src/sim/movement.rs`
  - Movement blockers, player step validation, blocker penetration checks,
    object movement blocking, object solid radius calculation, and distance
    helpers moved out of `server/src/sim.rs`.
- `server/src/sim/resources.rs`
  - Resource node state/mutation, resource snapshots, lifecycle snapshots for
    resource nodes, built-in object resource defaults, and generated ecology
    catalog data moved out of `server/src/sim.rs`; those responsibilities now
    live in focused `server/src/sim/resources/*.rs` child modules with
    `server/src/sim/resources.rs` as the coordinator.
- `server/src/sim/terrain_authority.rs`
  - Terrain detail authority manifest structs, blocker validation/conversion,
    promoted resource object conversion, decay-consumer requirement mapping,
    authority header validation, terrain-detail object kind/label/radius rules,
    and terrain-detail lifecycle defaults moved out of `server/src/sim.rs`.
- `server/src/sim/crafting.rs`
  - Server-authoritative forge crafting, trail-kit recipe consumption,
    crafted-item rollback on inventory failure, and crafted-item event shaping
    moved out of `server/src/sim.rs`.
- `server/src/sim/ecology.rs`
  - Tree-harvest deadwood fallout, inventory compost spore shedding,
    deadwood-to-mycelium decay feeding, field-coil-to-mycelium charging,
    ecology feed candidate selection, terrain-detail decay recipe checks, and
    ecology restore/rollback helpers moved out of `server/src/sim.rs`; those
    responsibilities now live in focused `server/src/sim/ecology/*.rs` child
    modules with `server/src/sim/ecology.rs` as the coordinator.
- `server/src/sim/snapshot.rs`
  - Full-world and interest-radius snapshot assembly, map/player/object protocol
    shaping, resource summary shaping, lifecycle/resource snapshots, and
    deterministic snapshot ordering moved out of `server/src/sim.rs`.
- `server/src/sim/interactions.rs`
  - Player interaction dispatch targets for deed claiming, gathering, direct
    mycelium resource feeding, compostable-item feeding, resource/feed event
    shaping, interaction target lookup, and object-position lookup moved out of
    `server/src/sim.rs`.
- `server/src/sim/spawn.rs`
  - Player spawn slot selection, existing-player spacing, spawn walkability and
    elevation validation, and movement blocker collection moved out of
    `server/src/sim.rs`.
- `server/src/settlement/tests.rs`
  - Settlement outbox replay, account-subject persistence, sync-write behavior,
    malformed/oversized/invalid outbox rejection, duplicate replay handling,
    ledger ownership/idempotency, queue pressure, and receipt seeding tests moved
    out of `server/src/settlement.rs`.
- `server/src/settlement.rs`
  - Settlement config/job models, ledger state, outbox append/replay, field
    validation, queue creation, worker loop, persisted enqueue, startup replay,
    and receipt seeding moved into focused `server/src/settlement/*.rs` child
    modules.
- `server/src/metrics/tests.rs`
  - Prometheus counter rendering coverage moved out of `server/src/metrics.rs`.
- `server/src/metrics/admission.rs`
  - Session ticket, auth, Origin, capacity, display-name, and admin snapshot
    rejection counter methods moved out of `server/src/metrics.rs`.
- `server/src/metrics/durability.rs`
  - Durable append failure, settlement queue pressure, and authoritative tick
    timing counter methods moved out of `server/src/metrics.rs`.
- `server/src/metrics/websocket.rs`
  - WebSocket connection, ingress rejection, payload byte, snapshot visibility,
    heartbeat, send-error, and idle-timeout counter methods moved out of
    `server/src/metrics.rs`.
- `server/src/metrics/prometheus.rs`
  - Prometheus counter snapshot loading, metric text exposition, and metric-line
    formatting moved out of `server/src/metrics.rs`.
- `server/src/session/tests.rs`
  - One-shot ticket consumption, pending token hashing, missing/dev ticket
    behavior, ticket capacity, display-name/account-subject metadata, preflight
    validation, expiration, and IP/account issue rate limiter tests moved out of
    `server/src/session.rs`.
- `server/src/session.rs`
  - Session config/auth/error/ticket models, ticket storage and validation, and
    IP/account issue rate limiters moved into focused
    `server/src/session/*.rs` child modules, leaving `session.rs` as a stable
    crate-facing façade.

## Split Rules

- Refactor commits should be behavior-preserving unless explicitly marked as a
  feature commit.
- Extract leaf modules before orchestration modules.
- Keep tests green after each extraction.
- Do not split by line count alone. Split by ownership and contract.
- Do not move server-authoritative logic into client modules.
- Do not mix art asset experiments with god-file breakup commits.

## Next Client Splits

1. `client/terrain-draw-geometry.js`
   - Consider moving tile clip/bounds helpers, side-wall points, relief-edge
     point helpers, and height facet point derivation if `client/terrain-draw.js`
     grows again.

2. `client/terrain-detail-cue-styles.js`
   - Consider moving terrain resource cue colors and repeated cue geometry
     constants from `client/terrain-detail-cue-draw.js` only if that leaf grows
     again.

`client/app.js` should stay a conductor: initialize DOM/canvas, load assets,
collect input state, hold render state, and call render/update modules.

## Next Server Splits

1. `server/src/sim/resources/replay.rs`
   - Consider splitting resource-node replay application from `server/src/sim.rs`
     if resource persistence/replay rules grow.

3. `server/src/config_tests/session.rs`
   - Split session display-name and session body content-type tests from
   `server/src/config_tests.rs` if session request validation grows.

4. `server/src/config_tests/http.rs`
   - Split request ID, trace path, and hidden-path hardening tests from
   `server/src/config_tests.rs` if HTTP hardening coverage grows.

`server/src/main.rs` should stay entry-point wiring: initialize tracing, request
runtime state, start the tick loop, build routes, bind the listener, and shut
down cleanly.

## Next Simulation Splits

1. `server/src/sim/resource_replay.rs`
   - Move `apply_resource_node_replay` if resource persistence or replay policy
     expands beyond simple clamped amount restoration.

`server/src/sim.rs` should stay authoritative simulation orchestration:
components, `SimWorld`, tick/update flow, add/remove/rename player, resource
replay coordination, and small math helpers.

## Verification Ladder

- Client extraction: `node --check` for touched modules, then
  `npm run test:client`.
- Server extraction: `cargo fmt --all --check`, then
  `cargo test -p sundermere-server`.
- Asset-loader extraction: also run `npm run assets:verify` when manifests or
  runtime asset pin behavior changes.
- Terrain extraction: also run `npm run test:terrain` when terrain generation,
  atlas selection, or authority output changes.
- Public/auth/deployment extraction: run the relevant `npm run smoke:*` scripts,
  not just unit tests.

## Character Authoring Boundary

- `scripts/blender-duskfell-locomotion.py` owns deterministic CC0 mocap
  action-neutral retargeting, bounded gait correction, full Blender actions,
  eight-direction camera rendering, and candidate provenance.
- `scripts/validate-character-sheet.py` owns fail-closed image structure review
  for candidate dimensions, hashes, clipping, components, direction scale, pose
  change, lower-body spread, crouch, and body-relative locomotion extent.
- `client/kimodo-review-sprite.js` remains a reversible review loader only. The
  `character=blender` entry must not imply manifest approval or runtime model
  inference.
- Image generation may finish an accepted structure sheet, but it must not own
  skeletal timing, camera projection, direction mapping, or foot registration.
