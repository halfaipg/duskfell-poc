# Terrain Asset Agent Instructions

Terrain assets define material families and visual ground authority.

## Read First

- Parent `assets/AGENTS.md`.
- `docs/terrain-system.md` for terrain authority and composition contracts.
- `docs/rendering.md` for the `64x64` plan-oblique footprint.
- `docs/art-direction.md` for UO-inspired readability without copied assets.

## Rules

- Keep tiles aligned to the shared `64x64` diamond footprint. Do not rotate
  tiles independently or leave gaps between footprints.
- Build material families: base, worn/detail, transition, edge, corner, slope,
  elevation lip, decal, and shadow.
- Keep terrain coherent by biome, neighbor material, elevation, moisture, and
  decay logic.
- Maintain `manifest.json` and `detail-authority.json` whenever generated
  terrain or authority metadata changes.
- Do not approve terrain that only looks good in isolation. Review it as a
  connected world in the browser.

## Cross-Scope Links

- Atlas changes usually require `scripts/normalize-generated-terrain-atlas.py`,
  `scripts/verify-terrain-atlas.js`, client terrain drawing, and
  `npm run terrain:verify`.
- Detail authority changes usually require
  `scripts/generate-terrain-detail-authority.js`, server terrain authority
  promotion/collision checks, client detail rendering, and
  `npm run terrain:authority:verify`.
- Elevation or footprint changes are camera-contract changes unless they preserve
  the existing `64x64` square diamond projection.

## Tests

- Run `npm run test:terrain`.
- Run `npm run terrain:generate` and `npm run terrain:authority:generate` after
  generator changes.
- Run `npm run assets:verify` after manifest or PNG changes.
