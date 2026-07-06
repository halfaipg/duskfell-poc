# Terrain Assets

This directory is the clean-room terrain atlas intake boundary.

Every generated, commissioned, or hand-edited terrain atlas should be listed in `manifest.json` before the browser uses it. Terrain art has stricter needs than actor sprites: every canonical material needs `64x64` military-plan-oblique flat-base, slope-texture, and transition tiles, `tileSheet.sha256` matching the exact PNG bytes, plus surface metadata and clean-room provenance. Future revisions should add decals, ramps, stairs, and occluders through this manifest rather than hard-coding art in the renderer.

Run:

```sh
npm run terrain:verify
```

The checked-in placeholder atlas is deterministic and can be regenerated with:

```sh
npm run terrain:generate
```

That command rewrites the PNG and refreshes `tileSheet.sha256` in the manifest. It is temporary original block-in art, not final Duskfell terrain.
