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
npm run art:direction
npm run sprites:pipeline
npm run sprites:gait
```

The verifier rejects projection drift, ambiguous positive prompts, commercial style references, missing provenance, incomplete non-placeholder generator audit fields, unreviewed or quarantined generator tooling, missing render metadata, bad frame grids, unsafe paths, PNG sheets whose pixel dimensions do not match their declared rows, columns, and cell size, and image hashes that do not match the declared `imageSha256`. The browser also normalizes the selected sheet at runtime before loading its image path, so projection drift, unsafe paths, unsupported render layers/sorts, malformed image hashes, and invalid frame ranges fail closed to the fallback renderer.

The gait analyzer measures per-row pose changes, lower-body foot-spread range, and foot-baseline jitter for transparent actor sheets. It is a review gate, not a replacement for art direction: if it flags a row, the sheet needs a stronger pose guide or cleanup pass before we treat the animation as credible.

The character pipeline audit is the one-command Duskfell paperdoll status report. It checks that default player paperdolls remain body-only, counts available equipment overlays, runs the gait analyzer against `duskfell-body-base.png`, and prints the next blocking art action. It exits successfully by default so local iteration can continue with known review failures; use `python3 scripts/character-pipeline-audit.py --fail-on-warning` when we want a CI-style quality gate.

Every player paperdoll must also have a matching full-body front-facing 2D portrait for player-card UI:

```text
assets/sprites/player-cards/<paperdoll-id>-front.png
```

The portrait is not copied out of the oblique walk sheet. It should be generated or painted as a clean full-body front/card view that matches the current body, face, hair, and equipped look for that paperdoll/loadout. Default/base portraits must stay minimally clothed, because clothing, armor, cloaks, weapons, boots, and class outfits are equipment/loadout overlays. `npm run sprites:pipeline` reports missing portraits.

The current live base-card portrait set is split from `player-cards/duskfell-player-cards-stylized-source-20260708.png`. It intentionally targets a less-realistic carved paperdoll miniature style. Older realistic review cards are archived under `player-cards/archive/` for comparison only.

The clean-room Blender-to-illustrated tree-family proof is under
`candidates/blender-tree-family-v1/`. Its twelve frames cover four species and
three lifecycle stages while sharing a `(96, 176)` trunk anchor. Raw Blender
renders, normalized structure frames, img2img output, alpha-cleaned output, and
the finished candidate remain separate. Rebuild the structural and finishing
stages with `npm run sprites:trees:structure`,
`npm run sprites:trees:assemble`, and `npm run sprites:trees:finish`. Review the
hash-pinned candidate in game with `?trees=blender`; this does not promote it to
the default manifest.

The current eight-direction character structure proof is under
`candidates/blender-locomotion-v2/`. It removes the imported rig's static
action-space offset, retargets the remaining CC0 Quaternius idle and walk
motion onto the minimally clothed wretch rig with bounded leg and arm motion,
hides the unreliable detachable hair, and renders one fixed plan-oblique
camera into `128x160` cells. Rebuild and validate it with:

```sh
npm run sprites:locomotion:structure
npm run sprites:locomotion:validate
```

The validator rejects wrong dimensions or hashes, clipped alpha, detached
components, empty frames, weak pose change, weak foot spread, direction scale
drift, excessive crouch, and implausible locomotion extent. Review the moving
cycle before the live `?character=blender` check. The current hash passes those
gates and stays registered to the footprint in the live world, but it remains a
review candidate rather than a manifest promotion. Its raw body material,
player-card portrait, equipment layers, and illustrated treatment are not
final art.

For ComfyUI or Comfy Cloud sprite workflows, inspect the downloaded API workflow before spending generation credits:

```sh
npm run sprites:comfy:audit -- /path/to/workflow.json
```

That audit reports generator nodes, model names, action prompts, save outputs, custom node dependencies, and Duskfell fit warnings. A Comfy workflow can be a useful candidate generator, but outputs still need local alpha cleanup, anchoring, gait review, manifest provenance, and paperdoll validation.

The checked-in placeholder actor and prop sheets are deterministic and can be regenerated with:

```sh
npm run sprites:generate
```

That command rewrites `player-placeholder.png` and `props-placeholder.png`, then refreshes their `imageSha256` values in the manifest. They are temporary original-art smoke assets, not final production character or prop art.

The review-only paperdoll prototype is generated from `duskfell-paperdoll-body-source.png` with:

```sh
python3 scripts/normalize-paperdoll-demo-sheet.py
```

That script writes `duskfell-body-base.png` plus per-archetype trousers, boots, jack, cloak, and weapon overlays, then refreshes the `paperdolls` manifest definitions for Wayfarer, Ranger, Warden, and Brigand. Default player paperdolls intentionally reference only the unclothed base body; clothing, armor, cloaks, and weapons stay as available overlay sheets for a future equipment/loadout system. These layers prove the runtime stack and make players larger/lankier in the demo, but they are still internal review assets. Replace the body source with a stronger Duskfell oblique walk sheet before production approval.
