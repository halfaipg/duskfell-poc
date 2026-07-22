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

The in-game `M`-key world map uses a reviewed pathless painting derived from an
authoritative material/height control. The runtime builder normalizes it to
`1536x1024`, exactly eight pixels per world tile, rejects it unless sampled
mountain, water, and overall semantic agreement clear their drift gates, then
bakes the server-authored routes through the same polyline distance field used
by playable terrain. The control, accepted painting, resulting WebP, and
diagnostic trail mask are hash-pinned with the current world and route set.
Rebuild the deterministic control and runtime intake with:

```sh
npm run terrain:world-map:generate
```

The client redraws only exact live terrain coastlines and player coordinates;
it does not draw route polylines. Day/night presentation color-grades the same
aligned image so paths cannot shift geography between lighting states.

Named trails are generated from the baked material and elevation authority:

```sh
npm run terrain:trails
```

The generator pathfinds around water, massif rock, and illegal elevation steps,
then writes compact route control points to `map.terrain.trails` in
`server/data/world.json`. Those server-validated routes are the shared source
for worn trail surfaces in the playable world and baked trail texture on the
`M`-key map. A pathless base is mandatory: AI-authored or hand-painted roads
must never compete with authoritative route data.
Future world-editor tooling should edit this route layer and rerun validation,
not paint disconnected map-only lines.

Worlds whose painted surface does not yet have an aligned procedural detail
layer set `map.terrain.detailAuthorityEnabled` to `false`. Regenerating
`detail-authority.json` then produces an intentionally empty, still-validated
authority set instead of retaining stale invisible blockers. Re-enable the
layer only after its rendered statics and server collision are reviewed
together in the connected world.

The contained loam art-direction slice is available at
`?verticalSlice=loam&dayTint=day&npcs=0`. Its ground source is
`candidates/finegrain-packed-dirt.png`, SHA-256
`98cd299d2ce369eceefe690c531301f4754b30b0382a8529cfcbd930d0cf1482`.
It remains a candidate rather than a production manifest entry: runtime access
is explicit, hash-verified, and review-only. The successful pipeline split is
the important result: top-down material source, world-aligned bombing, quiet
soil grade, independent rocks, shader grass, and lifecycle-aware bush
instances. Final intake should promote a replacement ground source and a
transparent sprite bush kit together, then record their exact hashes and
provenance in the manifests before removing the query gate.

That command rewrites the PNG and refreshes `tileSheet.sha256` in the manifest. It is temporary original block-in art, not final Duskfell terrain.
