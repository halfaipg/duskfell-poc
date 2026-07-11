# Server Data Agent Instructions

Files in this directory define original Duskfell world content loaded by the
server.

## Read First

- Root `AGENTS.md`.
- `HUMANS.md` for how content flows into runtime loading and simulation.
- `docs/architecture.md` content pipeline notes.
- `docs/terrain-system.md` when map, terrain, blockers, resource placement, or
  world-depth assumptions change.
- `docs/art-direction.md` when changing authored spaces, density, ruins, roads,
  ecology, or interior layout.

## Rules

- Keep content original. Do not copy maps, names, spawn tables, item tables, or
  formulas from commercial games or emulator repositories.
- Keep schema changes versioned and mirrored in server validation.
- Treat resource, blocker, deed, terrain, and settlement-affecting data as
  authoritative inputs.
- Update content smoke tests and docs when world data contracts change.
- Keep demo content coherent and sparse enough to read. Do not add clutter just
  to fill the map.

## Cross-Scope Links

- Schema changes usually require `server/src/content.rs`, content smokes, and
  docs updates.
- Gameplay-significant object changes usually require sim interaction/resource
  tests and client rendering checks.
- Terrain or blocker changes should be checked against server movement authority
  and browser terrain/object depth.

## Tests

- Run content schema/contract/size smokes after world schema or size changes.
