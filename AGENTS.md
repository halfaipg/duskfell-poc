# Duskfell Agent Instructions

This file is the root of the Duskfell agent instruction hierarchy. Before
editing any file, read this file and every `AGENTS.md` between the repo root and
the file being changed. The nearest file owns local details; the root owns
project-wide rules.

## How To Traverse This Repo

1. Start here.
2. Read each nearer `AGENTS.md` on the path to the file you will edit.
3. Read `HUMANS.md` when you need the senior-dev explanation of how the pieces
   fit together.
4. Read the topic doc for the system you are touching.
5. Check sibling scopes when a change crosses a boundary. For example, a new
   server protocol field usually touches `server/`, `client/`, tests, and docs;
   a new runtime asset usually touches `assets/`, `scripts/`, client rendering,
   server runtime verification, and manifests.

Do not rely on chat history for project state. If a decision matters to future
work, put it in the nearest durable doc.

## Order Of Authority

1. User instructions and safety/legal constraints.
2. `docs/development-constitution.md`.
3. This `AGENTS.md` hierarchy.
4. Subsystem docs in `docs/`.
5. Existing code, tests, and manifests.

When rules conflict, use the higher item and update docs if the conflict reveals
a real project decision.

## Project North Star

Duskfell is an original dark-age sandbox MMO with an async Base/$DUSK settlement
boundary. It is not a UO clone, emulator, asset extraction project, or copied
content pack. Classic MMO research can inform camera discipline, composition,
paperdoll layering, server authority, and operations, but implementation and art
must be original.

## Required Reading

For any substantial change, read the relevant subset:

- `docs/development-constitution.md` for project law.
- `HUMANS.md` for the human-readable system map and common change recipes.
- `docs/architecture.md` for server/client/runtime shape.
- `docs/security.md` for auth, clean-room, public deployment, and threat model.
- `docs/art-direction.md` for camera, style, terrain, character, and decay rules.
- `docs/art-pipeline.md` for sprite/terrain provenance and approval.
- `docs/terrain-system.md` for terrain authority and composition rules.
- `docs/rendering.md` for camera/projection/rendering constraints.
- `docs/reference-research.md` before using external MMO repos or screenshots as
  research.

## General Rules

- Keep changes small enough to review and explain.
- Prefer existing project patterns over new abstractions.
- Treat the browser client as untrusted: it renders snapshots and sends intent.
- Keep the server authoritative for state that affects players, resources,
  movement, settlement, inventory, crafting, decay, or ownership.
- Keep generated assets in review/provenance flow until approved by manifests
  and in-browser inspection.
- Do not copy protected game assets, packets, names, maps, tables, formulas, or
  art crops.
- Do not hide incomplete work behind optimistic wording. Say implemented,
  stubbed, review-state, blocked, or planned.
- Update the nearest durable doc when a change alters architecture, security,
  art contracts, deployment posture, gameplay rules, or agent workflow.

## Verification

Run the smallest useful verification for the touched surface and report what ran.
Common gates:

- Rust server: `cargo test` or focused `cargo test -p sundermere-server`.
- Browser/client modules: `npm run test:client`.
- Sprite manifests: `npm run test:sprites` and `npm run assets:verify`.
- Terrain pipeline: `npm run test:terrain`, `npm run terrain:generate`, and
  `npm run terrain:authority:generate` when generation logic changes.
- Art direction: `npm run art:direction`.
- Deployment/security: the relevant `npm run smoke:*` script.
- Broad local gate: `npm run verify:local`.
- CI-shaped gate: `npm run verify:ci`.

If a check is too expensive or blocked, say so plainly and explain the residual
risk.

## Worktree Discipline

The worktree may contain user changes. Never revert files you did not change
unless the user explicitly asks. When touching files already modified, read them
carefully and work with the existing changes.

Split large work into logical commits before adding another unrelated feature.
Do not mix art experiments, server authority, docs, and deployment/security in a
single commit unless it is clearly an integration commit.

## Important Child Scopes

Read child instructions when working under these directories:

- `client/AGENTS.md`: browser renderer, input capture, protocol parsing,
  asset loading, UI, terrain/player/object drawing.
- `server/AGENTS.md`: authoritative sim, runtime, sessions, WebSocket ingress,
  settlement, durability, content, metrics, admin surfaces.
- `assets/AGENTS.md`: runtime image assets, manifests, provenance, generated
  candidates, sprites, terrain, detail authority.
- `scripts/AGENTS.md`: generators, verifiers, smoke tests, deployment/ops gates.
- `docs/AGENTS.md`: durable project state, architecture/security/art docs,
  handoffs, refactor map.
- `contracts/AGENTS.md`: future Base/$DUSK settlement boundary only.

When in doubt, open the nearest child file plus the sibling file for any surface
that consumes your output. This is especially important for protocol changes,
runtime asset changes, deployment/security changes, and art/camera changes.
