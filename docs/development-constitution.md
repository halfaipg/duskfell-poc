# Duskfell Development Constitution

This is the project law for Duskfell. Architecture docs explain how the current
system works. This constitution explains how we decide what to build, what to
reject, and what evidence is required before calling something done.

When this conflicts with a casual plan, TODO, branch note, or agent suggestion,
this document wins. If this document conflicts with law, platform policy, user
safety, or license boundaries, those higher constraints win.

## Prime Directive

Duskfell is an original dark-age sandbox MMO with an async chain settlement
boundary. It is not a clone, asset extraction project, emulator, or nostalgia
skin. Classic online worlds are allowed as research inspiration only: camera
discipline, readable terrain composition, paperdoll layering, systemic depth,
and social sandbox pressure. The implementation, art, names, data, mechanics,
content, and economics must be Duskfell's own.

## Article 1: Build The Game, Not The Pitch

Every major feature must make the playable world deeper, clearer, safer, or more
operable.

- MUST prioritize a playable loop over narrative claims, token claims, or demo
  decoration.
- MUST keep the running browser shard as the center of truth for player-visible
  progress.
- SHOULD prefer small, inspectable systems that can ship into the live PoC over
  large speculative rewrites.
- DO NOT call infrastructure impressive unless it improves actual gameplay,
  security, reliability, performance, or operations.

## Article 2: Clean-Room Is Non-Negotiable

Duskfell can study how old MMOs solve problems, but it cannot borrow protected
implementation material.

- MUST use original code, original assets, original content names, original
  world layouts, and original formulas.
- MUST record source/provenance for generated, commissioned, or third-party
  candidate assets before they become runtime assets.
- MUST treat emulator/client repos and screenshots as research references, not
  implementation inputs.
- DO NOT copy UO code, packet structures, maps, cities, items, spells, assets,
  data tables, art crops, or derived sprite sheets.
- DO NOT use img2img to launder copyrighted game assets into the project.

## Article 3: The Server Owns Reality

The browser is a renderer and input device. It is never an authority.

- MUST keep position, speed, collision, resources, inventory, crafting, deeds,
  settlement state, and decay under server authority.
- MUST validate bounds, rates, sizes, identities, and state transitions on the
  server before mutation.
- MUST fail closed for shared or public environments.
- MUST protect admin, metrics, debug, and future mutating operations with
  explicit auth and auditability.
- SHOULD keep every player-affecting event replayable or reconstructable from
  durable state.
- DO NOT add client-trusted inventory, client-trusted positions, client-trusted
  rewards, or hidden admin shortcuts.

## Article 4: Chain Is Settlement, Not The Game Loop

The game must stay playable when chain settlement is slow, unavailable, or
disabled.

- MUST treat chain writes as asynchronous settlement of already valid server
  events.
- MUST keep signer/indexer/private-key concerns isolated from the sim server.
- MUST be honest in docs and UI about local stubs, dry-runs, pending receipts,
  and unimplemented production chain paths.
- SHOULD design Base/$DUSK integration around auditability, idempotency, and
  rollback safety before economics.
- DO NOT expose real-value claims, public chain mode, or token promises until
  signer, indexer, replay, abuse, and legal constraints are designed and tested.

## Article 5: Art Direction Is A Contract

Duskfell should look like a stylized carved paperdoll world seen through a
disciplined plan-oblique camera.

- MUST keep the camera contract: `military-plan-oblique`, `64x64` square diamond
  ground cells, bottom-center actor anchors, and consistent terrain footprints.
- MUST use stylized, readable, hand-painted game art language rather than
  photoreal portraits, glossy fantasy renders, SVG-looking blobs, or random
  AI texture soup.
- MUST keep base player bodies minimally clothed and layer clothing, armor,
  weapons, hair, and status effects as equipment/loadout overlays.
- MUST review generated art in the live browser at game scale before approval.
- SHOULD build assets as composition kits: terrain families, prop stages,
  decay overlays, elevation treatments, paperdoll layers, and animation sets.
- DO NOT approve art just because it looks good as a standalone image.
- DO NOT change projection or actor facing to fix one sprite without updating
  the whole camera and asset contract.

## Article 6: The World Is Systemic

The world should feel authored and alive, not randomly scattered.

- MUST make terrain coherent by material family, transition, elevation, and
  biome logic.
- MUST model decay as a general material property: plants, wood, cloth, metal,
  stone, ruins, and bodies can all age on appropriate timescales.
- MUST give resource-bearing objects identity, stage, depletion, replenishment,
  and server authority before making them economically important.
- SHOULD use composition rules to create towns, roads, ruins, wilderness, and
  interiors that make spatial sense.
- SHOULD support depth: elevation offsets, occlusion, roof hiding, multi-floor
  interiors, sortable props, and walk-behind structures.
- DO NOT fill empty space with clutter to make the demo look busy.

## Article 7: Performance Is A Feature

The target feel is smooth, stable, and readable.

- MUST protect the sim tick budget and avoid blocking gameplay on settlement,
  asset generation, logging, or external services.
- MUST keep the browser rendering path measurable and smooth, with 60 FPS as the
  minimum target for ordinary local demo scenes.
- MUST verify visual changes in the running browser when they affect layout,
  camera, assets, animation, or interaction.
- SHOULD use manifest checks, asset budgets, interest filtering, and load smokes
  before scaling content.
- DO NOT hide performance regressions behind prettier art or bigger maps.

## Article 8: Small Modules Beat Hero Files

The codebase should become easier to reason about as it grows.

- MUST split large files when a subsystem boundary is clear and testable.
- MUST keep protocol changes explicit across server, client, tests, and docs.
- MUST prefer typed/structured parsing over ad hoc strings for content, manifests,
  contracts, and protocols.
- SHOULD isolate gameplay, rendering, asset verification, content loading,
  settlement, auth, and operations into understandable modules.
- DO NOT add broad rewrites to unrelated feature work unless the rewrite is the
  feature and has its own verification plan.

## Article 9: Evidence Beats Vibes

A feature is not done because it feels done.

- MUST include the smallest useful verification for the risk: unit tests, smoke
  tests, asset verifiers, browser checks, screenshots, runtime endpoint checks,
  or benchmark receipts.
- MUST say what was not verified when a change ships without the full gate.
- MUST update docs when behavior, architecture, security posture, art contracts,
  or operational commands change.
- SHOULD keep audits blunt: list blockers and risks before praise.
- DO NOT bury failing checks under aspirational language.

## Article 10: Worktree Discipline

Big creative work can be messy; permanent history should not be.

- MUST split large branches into logical commits before piling on more unrelated
  features.
- MUST avoid mixing art experiments, server authority, docs, and deploy/security
  changes in one commit unless the commit is explicitly an integration point.
- MUST never revert user work or unrelated dirty files to make a branch look
  clean.
- SHOULD leave experimental assets clearly labeled as review candidates until
  promoted through manifests and docs.
- DO NOT push a giant mixed diff and pretend future maintainers will infer the
  story.

## Article 11: Future Agents Are Maintainers

Every agent or human should be able to continue from the repo, not from memory.

- MUST preserve decisions in durable docs when they affect future work.
- MUST keep status honest: distinguish implemented, experimental, review-state,
  stubbed, and planned work.
- MUST maintain the Duskfell `AGENTS.md` hierarchy as the durable instruction
  path for future agents and humans.
- SHOULD add handoff notes for large unfinished systems before stopping.
- DO NOT rely on chat history as the only place a rule, blocker, or design
  decision exists.

## Article 12: Definition Of Done

For normal code changes, done means:

- The change is implemented in the intended surface.
- The relevant tests, smoke checks, or verifiers have run, or missing checks are
  explicitly called out.
- Docs or manifests are updated when contracts change.
- The browser is checked for player-visible changes.
- The worktree story is understandable.

For art changes, done means:

- The asset matches the camera and style contracts.
- The asset has provenance and manifest status.
- Anchors, scale, direction, animation, and sorting are reviewed in-game.
- Generated source material and approved runtime assets are clearly separated.

For security or deployment changes, done means:

- Fail-closed behavior is tested.
- Auth, size limits, rate limits, and logs are reviewed for the touched path.
- Runtime inspection or smoke scripts prove the intended posture.
- Public/shared deployment docs remain honest about what is production-ready.

## Amendment Rule

This constitution can change, but changes must be explicit. Amendments should
name the rule being changed, why it is wrong or incomplete, and what practical
behavior changes after the edit.
