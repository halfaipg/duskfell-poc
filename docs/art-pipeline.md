# Art Pipeline

Initial research snapshot from July 6, 2026. Refreshed July 7, 2026 against the running PoC and current GitHub topic results. Production adoption still needs a final license/API/terms check for each tool and model. This project needs original assets only. Do not use UO-derived art, screenshots, extracted tiles, paperdolls, hue tables, maps, UI, or "style reference" prompts based on UO.

## July 9, 2026 Decision Update

The graphics direction was reset around a Blender world-kit pipeline after AI
sheet generation failed structurally and 3D-rendered characters (MPFB2 + rig +
procedural cloth) produced the first approved player look. Character animation
sheets now come from the 3D factory, AI generation is retained for props,
icons, portraits, and source textures, and terrain is moving to a hybrid where
base materials may stay AI-sourced but transitions/slopes/lighting render
through the same 3D sun as characters. See `docs/graphics-reset-plan.md` for
the full decision record, the terrain comparison artifact, the ground decal
layer plan (footprints/wear), and the installed toolchain (blender-mcp, MPFB2,
CC0 asset packs).

## July 7, 2026 Decision Update

The current camera/projection contract is right for the target: the live PoC renders `64x64` square diamond tiles in `military-plan-oblique` projection, not the common squashed `64x32` dimetric look. The graphics problem is asset quality and terrain richness, not the camera math. The placeholder atlas reads flat and repetitive, with weak terrain transitions, elevation character, props, shadows, and sprite identity.

Use **Agent Sprite Forge** as the first pipeline spine for the next experiment. It has the best fit from the `sprite-generator` topic for prompt-to-sheet orchestration, transparent frames, maps/props, frame extraction, previews, and metadata. Keep **SpriteBrew** as a UX/export comparison only because its AGPL-3.0 license is a product constraint. Use **Texel Studio** as a terrain/autotile R&D comparison, not as the character-animation pipeline. Treat **sprite-sheet-creator** as a promising no-vendor reference for RPG-directional character workflow, but do not rely on it until its license is clarified.

The next art milestone should be a one-screen Duskfell oblique asset bake-off, not a random prettier hero sprite:

1. 9 terrain families: grass, dirt, cobble, shore, shallow water, cliff edge, road, field, and dungeon floor.
2. 12 props: barrel, crate, anvil, forge, bedroll, tree stump, dead tree, ore rock, campfire, signpost, ruined wall, and market stall.
3. 1 paperdoll-ish humanoid base with 4 directions and 4-frame walk cycles.
4. 2 equipment overlays, such as cloak and sword, tested on the same base.
5. Exported transparent PNG frames, contact shadows where possible, frame metadata, and a bottom-center foot anchor per character frame.

The pass succeeds only if the assets survive the existing manifest intake: `military-plan-oblique`, square cells, clean-room prompts, negative prompt guarding against dimetric/isometric drift, SHA-256 pins, provenance, tool review, frame bounds, render layer, footprint, shadow metadata, and approval state.

## July 8, 2026 Player-Made UO Asset Pack Deep Dive

Research copies were cloned outside this repo at `/Users/j/Documents/New project/asset-reference-repos` so asset experiments do not pollute Duskfell source control. Local visual contact sheets were generated under `/tmp/duskfell_asset_research` for review.

Important legal/art-direction conclusion: these packs are valuable research, but they are not automatically safe production art for Duskfell. Both primary packs carry CC0 metadata, but they describe themselves as Ultima Online modifications/overrides. Some contents are explicitly paintovers or replacements for classic client art, and one Fiddle-Me-This README note says a header dragon icon was purchased from a third-party marketplace. For a commercial or web3 clean-room game, treat the packs as pipeline and composition references unless counsel and an art lead explicitly approve direct use of a specific file.

### Primary Asset Findings

| Candidate | URL | License signal | Local inventory | Best use for Duskfell |
| --- | --- | --- | --- | --- |
| CorvaeOboro/ultima_online_mods | https://github.com/CorvaeOboro/ultima_online_mods | GitHub and repo LICENSE report CC0-1.0 | about 1.9 GB; 4,476 BMP, 3,277 PSD, 1,209 PNG; `ART`, `ENV`, `UI`, and tool folders | Best research source for UO-like terrain families, tree slicing, gump composition, item/icon polish, and asset-pipeline structure. Use as blueprint first, direct pixels only after review. |
| NewYears1978/Fiddle-Me-This | https://github.com/NewYears1978/Fiddle-Me-This | GitHub and repo LICENSE report CC0-1.0 | about 15 MB; 174 PNG, 6 XML gumps, 3 GIF previews | UI/gump reference for readable larger status panels and TazUO-style external image overrides. Not useful for terrain. |
| KitaByte/UOGumpEditor | https://github.com/KitaByte/UOGumpEditor | MIT | tool repo, not an art pack | Useful reference if Duskfell needs a gump/layout editor concept. |
| CorexUO/GumpStudio | https://github.com/CorexUO/GumpStudio | no GitHub license signal found | tool repo, not an art pack | Reference only unless license is clarified. |
| polserver/UOFiddler | https://github.com/polserver/UOFiddler | GitHub metadata has no SPDX license; repo description says Beerware | UO file inspection/import tool | Reference only. Do not build Duskfell around UO client file formats. |
| CorvaeOboro/zenv_blender | https://github.com/CorvaeOboro/zenv_blender | CC0-1.0 | Blender addon/tools repo | Worth inspecting later for terrain/render workflow ideas, especially map-to-landtile generation. |

### What Corvae Teaches Us

The most important lesson is not "copy prettier tiles." It is that the convincing look comes from coherent asset families:

- `ENV` is split by terrain family: cave dark, dirt hills, farm lands, forest grove, heartwood, mountain path, poison/paroxysmus, sand dunes, snow ridge.
- Terrain uses both source texture scale and land-art scale. The inspected files include many `128x128` source textures and `44x44` oblique land tiles.
- Terrain families include flat tiles, slope/embankment variants, material transitions, and roughness variation. This is why UO-style terrain feels authored instead of randomly tiled.
- `ART_Tree` and `ENV_HeartWood/ART_S` show tree variants, autumn variants, dead/bare variants, and large trees split into sortable vertical slices.
- Heartwood tree composites include JSON offsets for many 44px-wide slices. That maps directly to the Duskfell renderer problem: a big tree should not be one flat billboard. It should be a layered object with trunk/canopy slices, z-bias, collision footprint, resource state, and canopy occlusion/fade.
- The tools folder includes a texture-to-oblique-land-tile converter. It rotates square textures into land-art tiles, darkens slightly, blends small noise, sharpens lightly, and applies an alpha mask. We should build a clean-room Duskfell equivalent for `64x64` military-plan-oblique tiles.
- MassImport XML/TXT files are not useful as runtime formats for us, but the metadata pattern is useful: every art tile has a stable id, source path, category, and import role.

### What Fiddle-Me-This Teaches Us

Fiddle-Me-This is mostly UI/gumps:

- custom XML gumps and PNG external images for TazUO-style override loading
- larger status bars and health/mana/stamina treatments for high-resolution play
- useful reminder that Duskfell needs readable MMO UI at modern resolutions

It is not a terrain source and should not distract from the world-art pipeline.

### Duskfell Pipeline Decision

Build a clean-room composition kit inspired by the structure above:

1. Author or generate `128x128` source textures per biome: grass, dirt, rock, cobble, sand, snow, marsh, shallow water, field, ruin floor.
2. Normalize them into `64x64` military-plan-oblique runtime land tiles, not 64x32 isometric tiles.
3. For each material, require a family: flat base, 4 cardinal edge transitions, 4 corner transitions, ramps/slopes, elevation lip, worn/path variant, sparse/detail variant, and decal overlays.
4. Store terrain family metadata in our manifest: material, biome, transition mask, slope mask, elevation role, collision role, and allowed neighbors.
5. Replace blob trees with sliceable sprite-art trees: trunk, canopy, dead limbs, stump, resource-bearing canopy, seasonal/decay overlays, and JSON slice offsets.
6. Render large trees and ruins as layered composition objects so players can walk behind fronts, under canopy fade, and around real collision footprints.
7. Use AI generation for breadth, but make final runtime art pass through human cleanup and the existing asset manifest provenance gates.

### Direct-Use Policy

- OK now: study folder structure, dimensions, metadata patterns, tree slicing, transition coverage, UI layout ideas, and tooling concepts.
- Maybe later: use individual CC0 files only after source review confirms they are original enough and not derived from EA/UO assets, third-party marketplace assets, shard-specific assets, or classic-client paintovers.
- Avoid: copying UO ids, maps, tile names, hue behavior, original gumps, original linework, screenshots, or exact replacement-art semantics into Duskfell.
- Production target: original Duskfell art with the same level of disciplined composition, not the same pixels.

## July 8, 2026 Paperdoll Character Direction

The player character pipeline should move away from baked one-piece adventurer sheets and toward a paperdoll stack:

1. Clean-room nude/base body sheets.
2. Optional hair and body-detail overlays.
3. Clothing layers.
4. Armor layers.
5. Cloak/back layers.
6. Held weapon and shield overlays.
7. FX/status overlays.
8. A matching front-facing 2D player-card portrait for every player paperdoll.

`client/sprite-assets.js` now exposes `selectPaperdollStack(...)` plus a fixed layer order. It validates that a base body and every overlay share the same projection, square cell size, row/column geometry, direction range, frame count, foot anchor, and render sort. This is the runtime contract needed for "naked guy sprites, then clothes and armor on top" without frame drift.

`client/app.js` can now render manifest-declared player paperdolls when `assets/sprites/manifest.json` includes `paperdolls` entries. Each player stack should use this shape:

```json
{
  "id": "duskfell-paperdoll-wayfarer",
  "role": "player",
  "label": "Wayfarer",
  "baseSheetId": "duskfell-body-base",
  "layers": [
    { "slot": "hair", "sheetId": "duskfell-hair-ash" },
    { "slot": "armor", "sheetId": "duskfell-riveted-jack" },
    { "slot": "cloak", "sheetId": "duskfell-black-cloak" },
    { "slot": "weapon", "sheetId": "duskfell-short-spear" }
  ]
}
```

The client prefers `duskfell-paperdoll-wayfarer`, `duskfell-paperdoll-ranger`, `duskfell-paperdoll-warden`, and `duskfell-paperdoll-brigand` when those definitions and every referenced sheet exist. If no valid paperdoll stack is present, it falls back to the current baked actor sheets, so the demo remains playable while the clean-room body/equipment sheets are still being produced.

Every player paperdoll also needs a matching full-body front portrait for account/player-card UI. The default/base portrait must match the default/base paperdoll state: minimal modest underclothes, no armor, no cloak, no weapon, no class outfit. Geared portraits are generated later as loadout/equipment variants, not as the default card. The required convention is:

```text
assets/sprites/player-cards/<paperdoll-id>-front.png
```

Example: `assets/sprites/player-cards/duskfell-paperdoll-wayfarer-front.png`. This is a 2D full-body front/card view, not a frame copied from the oblique walk sheet. It should preserve the same body, face, hair, and current equipment state as the active paperdoll/loadout.

The first review-only prototype is now checked into `assets/sprites`:

- `duskfell-paperdoll-body-source.png`: AI-generated clean-room body source with clear eight-frame leg motion.
- `duskfell-body-base.png`: transparent normalized base layer.
- `duskfell-{wayfarer,ranger,warden,brigand}-{trousers,boots,jack,cloak,weapon}.png`: deterministic local equipment overlays.
- `scripts/normalize-paperdoll-demo-sheet.py`: rebuilds the prototype sheets and manifest entries.

This prototype intentionally renders larger and lankier (`render.scale: 0.9`) so players read as prominent characters on the terrain. It is not the final body direction: the current source is still too cardinal/side-view in some rows, so the next generation pass should keep the size and leg clarity but improve the military-plan-oblique facing angles.

Run `npm run sprites:gait` after every body-sheet change. The current review body confirms why the in-game walk still feels weak: the analyzer reports row 2 with only `2px` of foot-spread range, below the `7px` review floor. That row needs a new pose guide or cleanup pass before we call the animation acceptable.

Use img2img only with sources we can safely transform:

- OK: original generated base sheets, commissioned base sheets, internally drawn pose guides, or clearly permissive assets after license/attribution review.
- Caution: OpenGameArt/LPC-style paperdoll assets can teach the layering model, but many are attribution-heavy and stylistically orthogonal rather than Duskfell military-plan-oblique.
- Avoid for production: UO client art, shard art, screenshots, or "found" sprites with unclear rights. Img2img on those sources may still create derivative-output risk.

The preferred Duskfell generation loop is:

1. Build a high-resolution pose guide, likely `192x192` or `256x256` cells, with 4 directions and at least 8 walk frames per direction.
2. Generate a clean nude/base body from that guide with transparent background, bottom-center foot anchor, and no gear.
3. Lock the base body silhouette and run img2img/inpaint passes for clothing and armor overlays on the same frame grid.
4. Validate each overlay with `selectPaperdollStack(...)` before adding it to the manifest.
5. Downsample or sharpen into the runtime target after review. The source can be HD compared with old UO, but the runtime sheet still needs stable anchors, bounded cells, and pixel-readable silhouettes.
6. Keep each overlay provenance separate: prompt, source guide hash, generator/model, seed, cleanup tool, license/terms snapshot, and reviewer.
7. Generate or update the matching full-body front-facing player-card portrait for every player paperdoll/loadout that can appear in UI. Base/default portraits stay minimally clothed until equipment is assigned.

## July 8, 2026 Focused Sprite Generator Repo Inspection

Reference repos cloned under `/Users/j/Documents/New project/asset-reference-repos` were inspected locally after the broad GitHub-topic scan:

| Repo | License posture | Useful for Duskfell | Decision |
| --- | --- | --- | --- |
| https://github.com/aldegad/sprite-gen | Apache-2.0 | Component-row sprite workflow, accepted identity anchors, chroma-to-alpha cleanup, connected-component frame extraction, curation webview, per-state GIF/contact QA, and runtime `manifest.json.frame_layout` | Primary character-pipeline reference. This is closest to what our broken gait/body problem needs. |
| https://github.com/0x0funky/agent-sprite-forge | MIT | Codex-oriented sprite/map workflow wrapper, transparent frame cleanup, map prop extraction, GIF previews, Godot/Unity handoff ideas | Supporting workflow glue, especially for maps/props and prototype wiring. Not as focused on paperdoll gait quality as `sprite-gen`. |
| https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator | Mixed per-asset licenses with attribution/share-alike/GPL concerns | Mature paperdoll layering, body/gear taxonomy, animation row catalogs, palette recoloring, z-position metadata | Architecture reference only. Do not import LPC assets into Duskfell without explicit asset-by-asset license review. |
| https://github.com/GAlbanese09/spritebrew | AGPL-3.0 | Strong UX benchmark: upload/slice, contour detection, keyboard animation preview, export formats, Retro Diffusion style choices, pixel editor | UX/export benchmark only. Do not embed code unless we intentionally accept AGPL obligations. |

The hard call: for player characters, we should stop treating AI sprite sheets as deliverables. They are raw candidates. A Duskfell character run is not successful until it has accepted direction anchors, extracted transparent frames, runtime frame metadata, curation artifacts, and motion QA. That is the `sprite-gen` lesson and it matches the current failure: our sheet looks decent in still frames, but the row-2 gait barely changes.

## July 8, 2026 Comfy Cloud Sprite Sheet Workflow Inspection

The user-provided Comfy template and downloaded workflow were inspected:

- Template page: https://comfy.org/workflows/templates-sprite_sheet-fe5600667e2c/
- Local API workflow: `/Users/j/Downloads/Sprite Sheet Generator.json`
- Audit command: `npm run sprites:comfy:audit -- /Users/j/Downloads/Sprite\ Sheet\ Generator.json`

The template is useful because it turns one uploaded sprite into generated action rows and preview media. The actual graph has 387 API-format nodes, including:

- 4 `GeminiImage2Node` generator nodes using `gemini-3-pro-image-preview` / Nano Banana Pro.
- 4 actions: walk, idle/breathing, jump, and attack.
- Prompts asking for `4-frame` pixel-art sprite sheets arranged as `2x2` grids.
- Uniform `#00FF00` chroma-key background instructions.
- Cropping, masking, resizing, frame save nodes, and `SaveVideo` preview outputs.
- Custom/partner node dependencies such as `BatchImagesNode`, `ImageResizeKJv2`, `LayerUtility: ColorImage V2`, `MaskBoundingBox+`, `SimpleMath+`, and `SplitImageWithAlpha`.

This is a possible Comfy Cloud R&D lane, but the current choice is to use built-in image generation for candidate art and keep Comfy optional. It is not a drop-in Duskfell runtime pipeline:

- It generates a right-facing character only; Duskfell needs four military-plan-oblique directions.
- It uses 4-frame actions; the Duskfell walk target is 8 frames per direction before gait approval.
- It uses chroma-key frames; the client needs transparent PNG cells with stable foot anchors.
- It generates dressed/action sprites from a single input; Duskfell needs a nude/base body first, then equipment overlays.
- It produces preview images/videos, not a Duskfell manifest with provenance, frame metadata, render layer, shadow, footprint, and gait status.

Duskfell usage decision if Comfy is revisited:

1. Use this workflow as a **candidate generator backend** in Comfy Cloud, not as the final asset pipeline.
2. Fork/adapt prompts to clean-room Duskfell requirements: nude/base paperdoll body, no gear, no commercial references, no UO references, 45-degree military/plan-oblique facing, bottom-center foot anchor, and one direction per run.
3. Generate each direction separately if the workflow cannot reliably output all four directions in one sheet.
4. Post-process every output locally: green-key to alpha, crop/normalize into `128x128` cells, align to the same anchor, and assemble the 4-row body sheet.
5. Run `npm run sprites:gait`, `npm run sprites:pipeline`, and `npm run assets:verify` before any manifest promotion.
6. Only after the nude/base body passes should we use Comfy img2img/inpaint runs for clothing, armor, cloaks, weapons, and hair overlays on the same exact frame grid.

## July 8, 2026 Robust Character Generation Pipeline

The immediate fix is not to keep generating dressed sprites. Duskfell should use a staged pipeline:

1. **Pose guide:** Build or generate a naked/minimally clothed body sheet first. It must be 4 rows, 8 frames per row, bottom-center foot anchor, and clear stride silhouettes in every facing.
2. **Gait gate:** Normalize the body with `scripts/normalize-paperdoll-demo-sheet.py`, then run `npm run sprites:gait`. Reject sheets with low pose difference, low foot-spread range, empty frames, or unstable baselines.
3. **Body approval:** Only after the body walk works do we make it the default player base. Default players should not spawn with armor, cloak, weapons, trousers, or boots unless a loadout/equipment system assigns those overlays.
4. **Equipment overlays:** Use img2img/inpaint against the approved body frames to create each equipment layer on the same exact frame grid. Never regenerate gear as a separate character sheet from scratch.
5. **Overlay validation:** Each overlay must pass `selectPaperdollStack(...)` and manifest paperdoll validation: same cell size, rows, columns, direction ranges, foot anchor, render sort, and render scale.
6. **Runtime loadout:** The manifest `paperdolls` entries stay body-only for default players. Inventory/equipment state should decide which overlay sheets are active.
7. **Preview bake:** Generate contact sheets and animation previews for every direction before shipping to the browser. A still sheet can look good while the walk is bad.
8. **Player-card portrait:** Generate a matching full-body front-facing 2D portrait for every player paperdoll. Store it at `assets/sprites/player-cards/<paperdoll-id>-front.png`. Default/base cards must be minimally clothed; do not show armor, cloaks, weapons, boots, or class outfits until those layers are actually equipped.
9. **Pipeline audit:** Run `npm run sprites:pipeline` for the current one-shot truth report. It verifies that player paperdolls are body-only, checks player-card portraits, counts available equipment overlays, runs the gait analyzer, and reports the next blocking art action.

Tooling decision after the focused clone inspection:

- **aldegad/sprite-gen** is the best character-pipeline reference because it formalizes the missing steps: accepted base identity, component-row generation, alpha cleanup, frame extraction, curation, GIF/contact-sheet QA, and runtime frame manifests.
- **Agent Sprite Forge** remains useful as the broader Codex workflow wrapper for maps, props, effects, transparent exports, and engine handoff.
- **Universal LPC Spritesheet Generator** remains the architecture reference for paperdoll layering, not a style target. It proves that nude/base bodies plus clothing/equipment layers can scale, but its projection and license/attribution posture do not make it drop-in Duskfell art.
- **SpriteBrew** is useful for upload/slice/animation preview/export UX, but license/product constraints keep it as a benchmark instead of embedded code.
- **Texel Studio** is more promising for terrain/tile R&D than for four-direction character animation because its core pitch is pixel-accurate generation rather than paperdoll gait/overlay validation.

The current audit result is intentionally not green: default players are correctly body-only and 20 overlay sheets exist, but `duskfell-body-base.png` still fails gait review because row 2 only has `2px` of foot-spread range against a `7px` floor. The next serious art milestone should be one approved naked Duskfell body sheet that passes the gait gate in all 4 rows. Only then should we spend img2img time on clothing and armor.

## July 8, 2026 Graphics Quality Reset

The graphics problem is now formalized in `docs/art-direction.md`. The practical shift is to stop promoting one-off generated images as "the look" and instead force every asset through the Duskfell visual contract:

1. Keep the `military-plan-oblique` camera fixed.
2. Build coherent terrain families from source textures, transitions, elevation lips, decals, shadows, and decay overlays.
3. Treat generated terrain and characters as source candidates until they are normalized, anchored, hashed, and reviewed.
4. Make the base player body walk correctly before spending more effort on armor/clothing overlays.
5. Keep full-body player cards in sync with paperdoll body/loadout state.

Run the art-direction posture report with:

```sh
npm run art:direction
```

That command does not pretend the art is finished. It reports the exact current gaps: terrain family coverage, placeholder/review-state art, paperdoll/card readiness, gait warnings, and whether anything has been incorrectly marked approved while the gates still fail.

## July 8, 2026 Character Style Reset

The player-card/body direction should become less realistic. The live/generated concepts should move toward a stylized carved paperdoll miniature: simplified planes, strong silhouette, muted dark-age color, crisp painted edges, and obvious layer boundaries for later equipment. Avoid realistic body studies, cinematic lighting, glossy skin, painterly portrait detail, and over-rendered cloth.

Reference concept saved for review:

```text
assets/sprites/concepts/duskfell-character-style-exploration-20260708.png
```

The bottom-left quadrant is the strongest style signal so far. It is still only a front-facing concept, not a runtime walk sheet. The next character generation prompt should use that language while asking for a 4-row by 8-frame oblique walk sheet with a minimal base body and stable foot anchors.

A first live card replacement pass now uses the same less-realistic direction:

```text
assets/sprites/player-cards/duskfell-player-cards-stylized-source-20260708.png
assets/sprites/player-cards/duskfell-paperdoll-{wayfarer,ranger,warden,brigand}-front.png
```

The previous more-realistic review cards are preserved under `assets/sprites/player-cards/archive/`. This card pass is a visible improvement but not final approval: it still needs a matching oblique walk sheet in the same style before the player identity is coherent in both UI and world.

## GitHub Sprite Generator Topic Verdict

The July 6, 2026 scan of https://github.com/topics/sprite-generator found 16 public repos. Do not clone or vendor the whole topic. Most entries are SVG/icon spriters, unrelated agents, stale/no-license experiments, or tools with product/legal assumptions that do not match this project.

Actionable candidates from that topic:

1. **Agent Sprite Forge** remains the best PoC trial because it is MIT, Codex-native, sprite-sheet aware, and already handles transparent frames, GIF previews, local cleanup, frame extraction, alignment, prop-pack slicing, and metadata.
2. **Texel Studio** is the best production R&D candidate because it has a self-hostable job API, local/Ollama option, palette-constrained pixel placement, Redis worker scaling, S3-compatible storage, and history. Its custom source-available license allows internal/commercial use of outputs, but it forbids offering a competing hosted service, so treat it as internal tooling only unless counsel approves otherwise.
3. **SpriteBrew** is a strong UX/export/reference benchmark, especially around Retro Diffusion, slicing, previews, Aseprite/GameMaker/Godot/Unity exports, and 64x64 prep. Do not embed its code in this project unless AGPL-3.0 obligations are intentionally accepted.
4. **codex-pet-generator** is not a general MMO asset generator, but its row semantics, approval gating, deterministic packing, and validator approach are worth copying into our own normalizer.

Avoid as core dependencies:

- **marcelontime/spriteforge**: useful UI ideas, but its named commercial-style prompts are the wrong clean-room habit for this project.
- **MaartenGr/Sprite-Generator**, **piotrekgelert/sprite-generator**, and **lguibr/pixel-forge**: small reference/placeholder experiments; no-license or low-maturity concerns make them poor production dependencies.
- **svg-symbol-sprite**, **svg-spritify**, **astro-svgs**, and **ngx-sprite**: SVG/icon bundlers, not game sprite generators.
- **Sheet-Agent**: unrelated spreadsheet agent.
- **AntumDeluge/chargen**: based on third-party/OpenGameArt-style bases; skip for clean-room reasons.

## Shortlist

1. **Retro Diffusion API**
   - URL: https://github.com/Retro-Diffusion/api-examples
   - Best for: original pixel art, tiles, item icons, character sheets, transparent sprites.
   - Fit: best near-term generator for the PoC because it is API-friendly, batchable, and pixel-art focused.
   - Risk: SaaS dependency; log request metadata and keep account-level commercial terms snapshots.

2. **ComfyUI**
   - URL: https://github.com/Comfy-Org/ComfyUI
   - License: GPL-3.0 for the app; generated-asset rights depend on model/checkpoint licenses.
   - Best for: powerful local/cloud graph workflows, ControlNet/LoRA pipelines, repeatability.
   - Fit: best self-hosted automation candidate if kept as internal tooling with locked workflows, model hashes, seeds, prompts, and output manifests.
   - Risk: workflow complexity and extension supply chain; avoid turning random community nodes into production infrastructure without review.

3. **InvokeAI**
   - URL: https://github.com/invoke-ai/InvokeAI
   - License: Apache-2.0 plus model-license considerations.
   - Best for: commercially friendlier self-hosted image workflow once the art direction is mature.
   - Fit: better artist-workstation option than ComfyUI when graph flexibility is less important than operational simplicity.

4. **Agent Sprite Forge**
   - URL: https://github.com/0x0funky/agent-sprite-forge
   - License: MIT.
   - Best for: prompt-to-sprite workflow glue, transparent PNG/GIF output, sprite sheets, metadata.
   - Fit: strong local workflow wrapper around whatever generator we choose.

5. **Pixelorama**
   - URL: https://github.com/Orama-Interactive/Pixelorama
   - License: MIT.
   - Best for: cleanup, frame edits, animation review, spritesheet exports.
   - Fit: safe open tooling for manual polish; not a generation backend by itself.

6. **Aseprite**
   - URL: https://www.aseprite.org/
   - License: custom source-available EULA for the editor; use the tool without embedding its code.
   - Best for: production sprite cleanup, animation timing, CLI spritesheet export, JSON metadata.
   - Fit: likely the most practical final assembly/export tool for artists.

7. **Scenario**
   - URL: https://www.scenario.com/
   - Best for: style-consistent game-asset batches and team review workflows.
   - Fit: possible acceleration lane after terms and provenance controls are reviewed.
   - Risk: SaaS lock-in and training/source provenance.

8. **PixelLab**
   - URL: https://www.pixellab.ai/
   - Best for: quick pixel-art candidates, icons, and small sprite experiments.
   - Fit: worth testing, but API maturity and commercial terms need verification.

## Reference Or Caution Only

- **SpriteBrew**
   - URL: https://github.com/GAlbanese09/spritebrew
   - License: AGPL-3.0.
   - Best for: web UI over Retro Diffusion, animation preview, game-engine export.
   - Fit: excellent as a reference/workbench; avoid embedding or modifying a hosted version unless AGPL obligations are acceptable.

- **Texel Studio**
   - URL: https://github.com/EYamanS/texel-studio
   - License: source-available, commercial output allowed, competing SaaS restricted.
   - Best for: deterministic pixel art, tiles, item icons, palette-locked experiments.
   - Fit: promising for tiles and icons, but check license carefully before making it core infrastructure.

- **Stable Diffusion WebUI / Forge**
   - URL: https://github.com/AUTOMATIC1111/stable-diffusion-webui
   - Fit: useful fallback for local generation experiments.
   - Risk: heavier dependency and extension surface; less ideal than ComfyUI for deterministic asset-pipeline automation.

## Supporting Tools

- **Asset manifest script**: implemented as `npm run assets:verify`. Every runtime sheet must pin the exact PNG bytes with a lowercase SHA-256 digest (`imageSha256` for sprites, `tileSheet.sha256` for terrain). Every non-placeholder asset must write prompt, method, tool, tool version, source hash, source terms snapshot, generated date, human editor/reviewer, and final approval state. AI-generated sheets must additionally record model, model version/checkpoint, and seed.
- **Generator review gate**: non-placeholder sheets must include `provenance.toolReview` with `approved-internal` or `approved-production` status, reviewer, review date, source URL, and risk note. The verifier quarantines known-bad topic hits such as third-party base-art generators, SVG/icon spriters, stale no-license references, and mis-tagged non-sprite agents.
- **Aspect-ratio normalizer**: partially enforced at intake by `assets/sprites/manifest.json`, `assets/terrain/manifest.json`, and their verifiers. The verifier rejects projection drift, missing foot anchors, missing footprint metadata, missing render-layer/shadow metadata, missing direction labels, missing clean-room provenance, incomplete non-placeholder generator audit fields, unreviewed or quarantined generator tooling, unsafe image paths, PNG sheets whose dimensions do not match declared rows/columns/cell size, and image hashes that do not match the PNG bytes.

## Projection And Aspect Ratio

Do not rely on "isometric sprite generator" defaults. Most tools and prompt packs drift toward 64x32 dimetric tiles, which is not this PoC's target. When someone says the old MMO look is "military," they usually mean 45-degree military projection or plan-oblique projection: the ground plan is drawn as a true 1:1 diamond grid, verticals stay vertical, and there is no perspective vanishing point.

Use this positive prompt language for candidate generation and validation:

> 45-degree military / plan-oblique RPG view, 1:1 diamond-grid ground footprint, verticals remain vertical, original clean-room sandbox fantasy character.

For manifest intake, keep the positive `provenance.prompt` free of rejected projection terms. Put the rejection language in `provenance.negativePrompt`, for example:

> not isometric, not 2:1 dimetric, not 64x32 tiles, not RPG Maker iso

The verifier rejects positive prompts that ask for `isometric`, `dimetric`, `64x32`, `128x64`, `2:1`, or named commercial game styles. This catches prompt drift before a sheet can pass on dimensions alone.

For Duskfell, generated art must be normalized into the client projection:

- 64x64 1:1 diamond terrain tiles.
- 45-degree military/plan-oblique visual language.
- Directional character frames generated or edited as neutral/front/side/back/diagonal views, then aligned by foot anchor.
- Props and structures rendered to the same footprint grid rather than copied from any existing MMO reference.

For the PoC, normalize character and creature outputs into fixed square transparent cells, likely 96x96 or 128x128, with:

- bottom-center or tile-bottom-center foot anchor metadata
- no frame touching cell edges
- consistent body scale across directions and frames
- separate sheets for body, equipment, projectiles, and FX
- explicit frame bounds, collision footprint, render sort, z-bias, shadow anchor, and approval state

The checked-in intake contract lives at `assets/sprites/manifest.json`:

- `schemaVersion` must be `sundermere-sprite-manifest-v1`.
- `projection.kind` must be `military-plan-oblique`.
- `projection.tileWidth` and `projection.tileHeight` must match the client `64x64` 1:1 diamond tile constants.
- `projection.tileAspectRatio`, `projection.axisAngleDegrees`, and `projection.heightAxis` must match the client `1`, `45`, and `screen-y` military-projection constants.
- each sheet must use a relative PNG path under `assets/sprites/`
- each sheet must declare `imageSha256`, matching the exact PNG bytes on disk
- each sheet must declare square `64`, `96`, `128`, or `192` pixel cells
- each sheet must declare a lower-cell foot anchor, diamond footprint, render metadata, direction frame ranges, clean-room provenance, and approval state
- non-placeholder sheets must declare provenance `method`, `tool`, `toolVersion`, `sourceHash`, and `termsSnapshot`
- non-placeholder sheets must declare `provenance.toolReview.status` as `approved-internal` or `approved-production`, plus `reviewedAt`, `reviewer`, `sourceUrl`, and `risk`
- AI-generated sheets must also declare provenance `model`, `modelVersion`, and `seed`
- positive prompts must stay original and projection-specific; rejected projection defaults belong in `provenance.negativePrompt`
- terrain atlases must declare `tileSheet.sha256`, matching the exact terrain PNG bytes on disk

Run `npm run test:sprites` to test the sprite verifier itself, `npm run test:terrain` to test the terrain atlas verifier, and `npm run assets:verify` to check the live sprite and terrain manifests.

The PoC includes deterministic generated placeholders at `assets/sprites/player-placeholder.png`, `assets/sprites/props-placeholder.png`, and `assets/terrain/terrain-placeholder.png`. Regenerate them with `npm run assets:generate-placeholders`; the generators update the matching manifest SHA-256 fields after writing PNG bytes. The terrain atlas now starts from the generated clean-room source sheet at `assets/terrain/terrain-generated-source.png`, then `scripts/normalize-generated-terrain-atlas.py` crops and normalizes those generated sprite textures into the runtime 72-frame atlas. The browser loads art through the manifests and falls back to canvas-drawn placeholders if runtime normalization or image loading fails. Replace placeholders with reviewed production art through the same manifest contracts rather than bypassing the intake path.

## Terrain Art Brief

The attached r/gamedev UO terrain thread points to a better near-term art target than "make the placeholder player prettier." Duskfell needs a small original terrain atlas and a height-painted test chunk first, because the world feel comes from terrain shape, transitions, object anchoring, and draw order. The PoC now has the intake boundary for that work in `assets/terrain/manifest.json`: every canonical material must have flat-base, slope-texture, and transition entries before `npm run terrain:verify` passes.

Terrain generation and cleanup should produce original families for:

- flat base tiles: grass, dirt, stone, shallow water, wood floor
- slope textures: the same materials rendered cleanly when stretched over a two-triangle quad
- edge transitions: grass-to-dirt, grass-to-stone, dirt-to-stone, land-to-water, embankment, ramp
- variation decals: pebbles, runnels, flowers, roots, worn path marks, small shadows
- surfaces and stairs: visual tiles that also carry walkable surface/stair metadata
- occluders: roof/canopy/overhead pieces with deliberate pop/fade rules

Prompt and review guidance:

- Ask generators for original plan-oblique terrain families, not a named MMO style.
- Prefer small coherent tilesets over one-off pretty tiles. A beautiful grass tile that has no edge, ramp, and slope partners will look worse in motion.
- Require human cleanup for high-value terrain. AI output is acceptable as block-in; final terrain should be palette-normalized, edge-checked, and tested in a height-painted chunk.
- Record whether each terrain tile is flat art, slope texture, transition overlay, surface, stair, decal, prop, or occluder in the manifest or the next terrain content schema.
- Keep UO screenshots, extracted files, map data, hue tables, and tile names out of prompts and review references.

## Near-Term Workflow

1. Define a tiny Duskfell art bible: palette, outline rules, scale, 64x64 military-projection tiles, sprite anchor points.
2. Replace the checked review terrain atlas with production-candidate grass, field, dirt, stone, shallow water, settlement, cobble, rock, ruin, and shore families, keeping flat-base, slope-texture, and transition entries for every canonical material.
3. Trial Agent Sprite Forge on a controlled character/prop set: player idle, four-direction walk, one NPC, one creature, one tree or rock prop, and one spell FX.
4. Use Retro Diffusion for fast pixel-art candidates and ComfyUI or InvokeAI for self-hosted repeatable batches.
5. Test Texel Studio separately for palette-locked terrain tiles, item icons, and simple props before using it for animated characters.
6. Slice and normalize outputs through Agent Sprite Forge or an equivalent local script.
7. Force every output through the aspect-ratio normalizer before it can become a game atlas.
8. Clean important assets in Pixelorama or Aseprite.
9. Save prompt, negative prompt, generation method, tool and tool version, date, source hash, license/terms snapshot, human editor, and approval state in the manifest. For AI-generated outputs, also save model/provider/version and seed.

## Production Path

- Keep generated assets as placeholders until the identity is stable.
- Commission or manually repaint final hero assets, player bodies, UI, and high-value items.
- Use automated generation for breadth, then human review for consistency and ownership confidence.
- Store atlases with JSON metadata for frame bounds, anchor points, footprint, collision, and render-layer priority.
