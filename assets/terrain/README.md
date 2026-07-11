# Terrain Assets

This directory is the clean-room terrain atlas intake boundary.

Every generated, commissioned, or hand-edited terrain atlas should be listed in `manifest.json` before the browser uses it. Terrain art has stricter needs than actor sprites: every canonical material needs `64x64` military-plan-oblique flat-base, slope-texture, and transition tiles, `tileSheet.sha256` matching the exact PNG bytes, plus surface metadata and clean-room provenance. The optional `groundPatches` collection must cover all eight visual biomes as unique PNG or WebP images with exact dimensions and SHA-256 pins. Future revisions should add decals, ramps, stairs, and occluders through this manifest rather than hard-coding art in the renderer.

Run:

```sh
npm run terrain:verify
npm run art:direction
```

The checked-in placeholder atlas is deterministic and can be regenerated with:

```sh
npm run terrain:generate
```

The current 2048px biome proof sources can be rebuilt deterministically from
the reviewed clean-room material candidates with:

```sh
npm run terrain:ground-patches:generate
```

`scripts/art-reset/blender-terrain-structure.py` creates a seeded orthographic
terrain structure bake and matching `.blend` proof. The bake can be enriched
through Grid with `scripts/art-reset/grid-img2img-proof.mjs`; the script requires
`GRID_API_KEY` in the environment and writes source/output hashes beside the
candidate. Candidate outputs stay under `assets/terrain/candidates/` until
human review and runtime manifest intake.

That command rewrites the PNG and refreshes `tileSheet.sha256` in the manifest. It is temporary original block-in art, not final Duskfell terrain.
