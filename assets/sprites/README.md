# Sprite Assets

This directory is the clean-room sprite intake boundary.

Every generated, commissioned, or hand-edited sprite sheet should be listed in `manifest.json` before the client uses it. The manifest pins the project to the Sundermere projection contract:

- `military-plan-oblique`
- `64x64` 1:1 diamond ground tiles
- `1` tile aspect ratio, `45` degree plan axes, and `screen-y` height axis
- fixed transparent square cells for actors and props
- `imageSha256` matching the exact PNG bytes on disk
- explicit foot anchors, footprint metadata, render-layer/shadow metadata, direction labels, and approval state
- provenance metadata proving the asset is original and clean-room safe
- non-placeholder provenance with method, tool, tool version, source hash, and license/terms snapshot; AI-generated sheets must also record model, model version, and seed
- `provenance.toolReview` for non-placeholder sheets, with an approved internal/production tool status, reviewer, source URL, review date, and risk note

Use positive prompt text for what the asset is: original `military-plan-oblique` art with a `1:1` diamond-grid footprint. Put rejected generator defaults such as `not isometric`, `not 2:1 dimetric`, or `not 64x32 tiles` in `provenance.negativePrompt` instead of mixing them into the positive prompt. Do not use commercial game/style references or UO-derived terms in either prompt.

Run:

```sh
npm run assets:verify
```

The verifier rejects projection drift, ambiguous positive prompts, commercial style references, missing provenance, incomplete non-placeholder generator audit fields, unreviewed or quarantined generator tooling, missing render metadata, bad frame grids, unsafe paths, PNG sheets whose pixel dimensions do not match their declared rows, columns, and cell size, and image hashes that do not match the declared `imageSha256`. The browser also normalizes the selected sheet at runtime before loading its image path, so projection drift, unsafe paths, unsupported render layers/sorts, malformed image hashes, and invalid frame ranges fail closed to the fallback renderer.

The checked-in placeholder actor and prop sheets are deterministic and can be regenerated with:

```sh
npm run sprites:generate
```

That command rewrites `player-placeholder.png` and `props-placeholder.png`, then refreshes their `imageSha256` values in the manifest. They are temporary original-art smoke assets, not final production character or prop art.
