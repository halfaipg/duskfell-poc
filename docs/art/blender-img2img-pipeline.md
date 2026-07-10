# Blender + Img2Img Art Pipeline

## Decision

Duskfell art should use Blender/3D as the deterministic structure pass and img2img as the richness pass.

Blender owns:
- camera angle, scale, silhouettes, masks, depth, elevation, object placement, collision-aligned structure
- repeatability for terrain chunks, paperdolls, equipment registration, walk-cycle poses, and provenance

Img2img owns:
- painterly material richness, grass/rock/water detail, subtle decay, cloth/leather/skin texture, color variation
- the final UO-like illustrative surface that raw 3D does not provide

This is now the preferred path over trying to make raw Blender renders look final.

## Reference Artifacts

- `docs/art/references/blender-img2img-terrain-before-after.png`
- `docs/art/references/img2img-alpine-valley-wide.png`
- `docs/art/references/img2img-alpine-valley-topdown.png`
- `docs/art/references/img2img-biome-tileset-sampler.png`
- `docs/art/references/human-base-walk-cycle-reference.png`

## Terrain Rule

Generate a clean 3D bake with simple readable materials and masks:
- water mask
- grass/dirt/rock/snow masks
- height/elevation map
- cliff and shoreline structure
- prop placement masks for stones, brush, reeds, flowers, roots, ruins, roads

Then run img2img with low-to-medium denoise so the output enriches the bake without moving the map geometry.

Reject outputs where:
- rivers, cliffs, roads, or tile borders drift from the structural pass
- details become mushy/noisy at gameplay zoom
- transitions stop matching across chunk edges
- decorative richness destroys walkability/collision meaning

## Reproducible Terrain Proof (July 9, 2026)

The original before/after candidates proved the sandwich but the Blender
terrain scene was not committed. That gap is now closed by:

- `scripts/art-reset/blender-terrain-structure.py`: seeded headless Blender
  structure bake with real elevation, a water-plane/channel intersection,
  irregular biome regions, and a saved `.blend` proof.
- `scripts/art-reset/grid-img2img-proof.mjs`: one-input Grid img2img runner
  that records model, style, seed, source hash, and output hash.
- `assets/terrain/candidates/proof-structure-model-bakeoff.png`: frozen-input
  comparison of Blender, Grid FLUX variants, and the OpenAI native edit.

The current Grid capability check found that `Krea 2 Turbo` and
`z-image-turbo` reject input images. `FLUX.2 Klein 4B FP8` is the only
currently live Grid model that can run the terrain sandwich. Its default and
`fantasy-art` styles produce the strongest overt game-art finish;
`oil-painting` pushes texture harder but also drifts farther. The OpenAI native
edit preserved the river and rock footprint best in this proof, but its surface
treatment is quieter.

The proof also establishes a stricter production rule: **AI output is never
the geometry authority.** Blender must export height, normal, water, shore,
rock, and biome-ID masks. Enrichment is accepted only when automated boundary
comparison stays inside tolerance, and final composition reapplies those masks
so an image model cannot invent collision-changing ponds, cliffs, or roads.
Grid FLUX is useful for style/material proposals; a production structure pass
still needs explicit mask/depth control or post-enrichment recomposition.

The live proof at `assets/demos/terrain-sandwich-live.html` exercises two
separate enrichment levels: `alpine-sandwich-0.png` for the regional view and
the new structure-enriched candidates for the walking view. Zoom crossfades
between the images instead of scaling one source across incompatible detail
levels. Production LOD1 must be generated from an exact crop of its LOD0
region, retaining layout and palette while replacing mountain-scale marks with
player-scale grass, pebbles, shore detail, and props.

## Character Rule

For characters, Blender should render:
- a neutral minimally clothed base body
- 8 direction pose frames
- walk-cycle frames with foot anchors
- paperdoll/front-card pose
- clean masks for body, hair, cloth, leather, metal, weapon, shield
- optional depth/normal passes for img2img control

Img2img should enrich those renders into Duskfell/UO-like sprite art while preserving:
- limb length and body proportion
- hand/weapon registration
- foot anchors
- facing angle
- silhouette consistency across frames
- paperdoll equipment slots

Reject outputs where:
- legs do not complete a walk cycle
- body height changes between directions
- hands or feet mutate frame-to-frame
- clothing/equipment moves off its registration point
- the result becomes realistic portrait art instead of sprite/paperdoll art

## Immediate Next Character Step

Use the human base mesh bundle from Downloads as a better body source:

`/Users/j/Downloads/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend`

Preferred candidates to preview:
- `GEO-body_male_stylized`
- `GEO-body_male_realistic`
- `GEO-body_female_stylized`
- `GEO-body_female_realistic`

The likely best path is:
1. Append or load a stylized human base mesh into a Duskfell Blender scene.
2. Pose it into the UO paperdoll stance.
3. Add simple clothing/equipment geometry as separate material groups.
4. Render body/color/depth/mask passes.
5. Run img2img for final sprite/paperdoll richness.
6. Validate with frame consistency checks before it becomes a game asset.
