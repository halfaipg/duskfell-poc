# Art Pipeline

Initial research snapshot from July 6, 2026. Refreshed July 7, 2026 against the running PoC and current GitHub topic results. Production adoption still needs a final license/API/terms check for each tool and model. This project needs original assets only. Do not use UO-derived art, screenshots, extracted tiles, paperdolls, hue tables, maps, UI, or "style reference" prompts based on UO.

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

The PoC includes deterministic generated placeholders at `assets/sprites/player-placeholder.png`, `assets/sprites/props-placeholder.png`, and `assets/terrain/terrain-placeholder.png`. Regenerate them with `npm run assets:generate-placeholders`; the generators update the matching manifest SHA-256 fields after writing PNG bytes. The browser loads art through the manifests and falls back to canvas-drawn placeholders if runtime normalization or image loading fails. Replace placeholders with reviewed production art through the same manifest contracts rather than bypassing the intake path.

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
2. Replace the checked placeholder terrain atlas with production-candidate grass, field, dirt, stone, shallow water, and settlement families, keeping flat-base, slope-texture, and transition entries for every canonical material.
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
