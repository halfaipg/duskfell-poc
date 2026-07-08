# Terrain Asset Agent Instructions

Terrain assets define material families and visual ground authority.

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

## Tests

- Run `npm run test:terrain`.
- Run `npm run terrain:generate` and `npm run terrain:authority:generate` after
  generator changes.
- Run `npm run assets:verify` after manifest or PNG changes.
