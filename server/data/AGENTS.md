# Server Data Agent Instructions

Files in this directory define original Duskfell world content loaded by the
server.

## Rules

- Keep content original. Do not copy maps, names, spawn tables, item tables, or
  formulas from commercial games or emulator repositories.
- Keep schema changes versioned and mirrored in server validation.
- Treat resource, blocker, deed, terrain, and settlement-affecting data as
  authoritative inputs.
- Update content smoke tests and docs when world data contracts change.
- Keep demo content coherent and sparse enough to read. Do not add clutter just
  to fill the map.

## Tests

- Run content schema/contract/size smokes after world schema or size changes.
