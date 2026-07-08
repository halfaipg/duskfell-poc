# Rendering Direction

Checked July 6, 2026 and live-reviewed again on July 7, 2026. The visual target should be a clean-room military/plan-oblique 2D tile renderer, not true isometric and not the common `64x32` dimetric pixel-art style.

The running PoC camera is aligned with that target: the screen reads as square `64x64` diamond tiles in plan-oblique projection. The remaining visual weakness is the placeholder art direction: flat repeated terrain, weak transition/edge families, limited elevation character, and simple props/actors. The next graphics work should replace the placeholder terrain and prop atlas through the checked manifest pipeline before investing heavily in final character polish.

## Projection

Use 45-degree plan-oblique, sometimes called military projection:

- ground plan remains true and unforeshortened
- tiles are drawn as 1:1 diamonds
- vertical structures keep screen-vertical lines
- no perspective vanishing point

PoC tile standard:

```ts
const tileW = 64;
const tileH = 64;
const tileAspectRatio = 1;
const axisAngleDegrees = 45;
const heightAxis = "screen-y";
const halfW = tileW / 2;
const halfH = tileH / 2;
const zPx = 6;
```

Those values are part of the checked asset contract, not only renderer implementation details. Sprite and terrain manifests must declare the same `military-plan-oblique` kind, `1` tile aspect ratio, `45` degree plan axes, `screen-y` vertical-height axis, `64x64` tiles, and `64` world units per tile before the client will load their sheets.

World to screen:

```ts
screenX = originX + (mapX - mapY) * halfW;
screenY = originY + (mapX + mapY) * halfH - mapZ * zPx;
```

Screen to tile, ignoring height:

```ts
dx = (screenX - originX) / halfW;
dy = (screenY - originY) / halfH;

mapX = (dy + dx) / 2;
mapY = (dy - dx) / 2;
```

Sorting should key primarily by the projected footprint/foot-anchor y position, then `mapZ`, then object footprint/priority. Sprite sheets declare their render layer, sort mode, z-bias, and shadow metadata in `assets/sprites/manifest.json`; the browser client consumes that metadata for actor draw order and shadows.

Actors and props should never be visually flat-stamped onto the ground plane.
Their foot anchors sample `terrainHeightAtWorld(...)`, which bilinearly blends
the current tile's corner heights. That means even a small move across a sloped
tile can lift or lower the projected sprite by a fraction of the terrain height
scale, while sorting uses the same sampled anchor. Interior spaces can add a
floor or stair-portal height offset to the same sample, so a player crossing an
indoor stair connector visibly climbs or descends without a separate scene or
screen-space animation trick.

## Renderer Stack

Near-term recommendation:

- Keep the Rust server authoritative and protocol-stable.
- Replace the current ad hoc Canvas renderer with a small TypeScript PixiJS v8 renderer.
- Use PixiJS WebGL as the stable default.
- Keep WebGPU behind a future feature flag.

Godot remains a reasonable future native-client/editor path, but it should not drive this browser-first wallet PoC yet. Unity is heavier than this PoC needs and has weaker browser/wallet ergonomics for the current goal.

## Terrain Target

The July 6, 2026 attached r/gamedev discussion about the old UO terrain effect changes the graphics priority. The current PoC sprites are only placeholders; the actual Duskfell terrain pass should focus on elevation-aware terrain and tile transitions before polishing player sprites.

Clean-room takeaways to preserve without copying UO data or formulas:

- Treat terrain as tile data plus per-corner height, not as a flat backdrop. A tile needs its own height and the neighboring heights needed to draw a sloped quad.
- Keep derived min/max/average height, slope, normal, and lighting metadata on
  tiles and chunks so terrain shading, object anchoring, culling, and future GPU
  buffers share one measured height contract.
- Keep a terrain composition layer above raw biome noise. Tiles should expose a
  named zone, road axis, elevation/moisture bands, detail family, object band,
  and optional composition-kit membership so roads, plazas, groves, ridges,
  shorelines, decals, and detail statics stay coherent across rendering,
  debugging, and future gameplay.
- Use composition kits for authored-feeling scene structure. Kits should define
  anchors and roles for features like crossroads, viaduct ruins, groves,
  reedbeds, walls, stairs, courtyards, and gardens; renderers can then layer
  matching materials, decals, detail statics, lifecycle cues, and future
  occluders from one shared scene description. The current courtyard kit renders
  wall, stair, and foundation statics from kit roles and includes stable
  terrain-detail authority metadata so vertical depth can exist before final
  bitmap architecture sprites land and before the server mirrors the same
  generated objects.
- Treat larger terrain statics as footprint-bearing world entities. Trees,
  boulders, ruins, reeds, and equivalent environment objects should reserve
  tile-space during generation and sort by their projected anchor on the shared
  height field.
- Give tall statics explicit occlusion metadata. The current renderer fades
  nearby ruin and masonry details when the local player is behind their
  footprint, keeping old-school vertical depth readable without permanently
  hiding the actor.
- Draw flat ground from pre-authored tile art, and draw non-flat ground as textured quads split into two triangles so hills, furrows, and ramps can distort the texture.
- Keep the plan-oblique projection contract, but add a terrain-height contract around vertex height, slope limits, impassable height gaps, and tile surface flags.
- Build original transition tiles between terrain materials. Do not rely on alpha blending alone; the old look came from deliberate grass/dirt/stone/water edge art, embankments, and noisy terrain variation.
- Use anchored object sorting: tall objects and actors sort from a bottom-center foot anchor, then by tile, height, and render layer.
- Support surface and stair metadata on art/content definitions, not a separate path graph. Movement, pathing, and rendering should read the same authoritative tile/object flags.
- Split extra-wide props into render strips or equivalent sub-sprites so painter-order sorting fails less often.
- Add dirty-region redraw only if Canvas remains in use. With PixiJS/WebGL, preserve the spirit of the optimization through chunked terrain layers, texture atlases, and culling instead.

Terrain renderer v2 should add these layers:

1. base terrain tiles
2. sloped textured terrain quads
3. transition/edge overlays
4. decals and small ground variation
5. footprint-bearing terrain statics and props
6. actors/equipment/FX
7. roofs, canopy, and overhead occluders

The first visual milestone should be a tiny atlas with original grass, dirt, stone, shallow water, embankment, and ramp families, plus a small height-painted test chunk that proves rippled ground, transitions, walkable slopes, and actor foot anchoring.

The current PoC exposes a validated `duskfell-terrain-v1` profile through `server/data/world.json` and every server snapshot. The browser renderer builds its deterministic terrain from that profile, including seed, `64x64` tile dimensions, height scale, elevation range, water level, walkable-step metadata, and canonical material set. Unsupported terrain profiles, projection drift, bad material sets, and missing terrain metadata fail either server startup or the browser's defensive snapshot parser.

The browser also loads `assets/terrain/manifest.json` as a checked clean-room terrain atlas. The current atlas is still placeholder art, but the contract is production-shaped: every canonical material must declare flat-base, slope-texture, generic transition, edge-transition, and corner-transition frames, plus surface metadata, clean-room provenance, and approval state. `npm run terrain:verify` checks the atlas projection, material coverage, edge/corner mask coverage, safe image path, PNG dimensions, water walkability, prompt hygiene, and non-placeholder provenance. At runtime, malformed atlas metadata or a missing image fails closed to procedural canvas fills; valid atlases are used for flat terrain, sloped terrain, and clipped material-edge overlays. The atlas is now generated through deterministic local sprite-painting rules rather than cropped source swatches, so grass, field, dirt, stone, water, and settlement materials can evolve as authored tile families. Terrain transitions carry material-pair metadata and are grouped into shore, plaza, rocky, path, and soft families, letting the renderer prefer exact pair-transition atlas frames and then add family-specific alpha, strokes, and small edge chips as needed. The first pair frames cover dirt-to-grass, stone-to-dirt, water-to-dirt, water-to-grass, dirt-to-settlement, and settlement-to-grass. The raised-art selector chooses slope-texture frames for non-surface tiles with actual height range, steep elevation edges, or high ridge metadata, while water and settlement materials stay on stable base art.

Terrain detail statics use the same checked sprite manifest path. The current
`duskfell-details` sheet contains small ground details plus atlas-backed tree,
boulder, reeds, ruin, and ruined-stone frames. Trees resolve by lifecycle stage and
per-tree variant, so sapling, mature, and ancient trees can read differently
while still sorting and anchoring through the same terrain-detail pipeline.
Their atlas frames now include age and species cues, while the runtime can draw
subtle resource/health/decay markers from metadata after the frame is stamped.
Server-owned ruins render through the same detail path, with crack, moss, and
stone resource cues layered from their mineral lifecycle so ancient structures
can visibly erode without being baked into one static image.
Terrain details also share a compact resource-cue model for wood, seed, fiber,
deadwood, spores, mycelium, charge, stone, and ore. The renderer turns those
model cues into tiny ground-hugging rings, pips, cracks, tendrils, arcs, reeds,
and stone chips, making gatherable/living/decaying state readable without
adding text labels or debug badges.
Terrain-detail ruins, walls, stairs, and foundations can also carry occlusion
metadata; the client uses that metadata to locally fade only the blocking static
when the controlled player is tucked behind it.
The first indoor-space contract is now terrain-owned too. Composition kits can
emit `interiorSpaces` with world bounds, reveal padding, floor levels, and roof
opacity metadata. They can also emit stair/portal bounds connecting floor
levels. The renderer draws the upper shell/roof as a top-layer occluder, then
fades it when the local player's footprint enters the space and reveals the
sunken floor, upper-gallery outline, and active stair connector. The same
portal metadata contributes a ramped height offset through
`terrainHeightAtWorld(...)`, so actor feet climb the connector instead of merely
seeing a highlighted stair decal. This matches the old-school readable-interior
behavior without switching scenes or copying any UO building data.
Canvas fallback drawings remain only as a resilience path when a frame or sheet
is unavailable.

Authoritative ecology cues are rendered as ground-plane effects, not UI-only
badges. The client derives deadwood-to-mycelium feed links from nearby server
snapshot objects, samples terrain height at both endpoints, and draws faint
mycelium/rot strands under the sprites so passive decay and hungry blooms read
as part of the terrain surface. It also derives field-coil-to-mycelium links
from the same snapshot data, rendering sparking blue ground arcs for charged
coils and faint spent wiring once a coil has discharged.

While the browser client remains Canvas-based, static terrain now follows the
same architectural direction as old-school chunk renderers: projected 8x8 chunk
geometry is prepared once, and static ground/cliff/transition layers are cached
into offscreen chunk bitmaps. Per-frame drawing keeps only camera culling, water
shimmer, debug overlays, terrain details, props, actors, and UI dynamic. If the
renderer moves to PixiJS/WebGL later, preserve this chunk-layer contract as
texture-backed terrain containers instead of returning to per-tile redraws.

Actor animation derives facing from the same military-plan-oblique projection
used for terrain. World movement is first projected to screen motion before a
`south/east/north/west` sprite row is selected, which keeps diagonal plan-axis
movement from snapping to the wrong cardinal row. Runtime actor sheets are
foot-anchored: the walk cycle can use a tiny horizontal sway, but the renderer
does not vertically bob the full sprite, so animated boots stay grounded on the
projected terrain height. The player animation sampler keeps a short movement
grace window across server tick gaps and scales frame cadence by measured
movement speed, so feet do not snap to idle during tiny network pauses and
faster movement advances through the eight-frame sheets more quickly. The same
sampler now emits an alternating footfall pulse; the renderer samples the
terrain material under the actor and draws compact grass, dirt, stone,
settlement, water, or crude-electric field scuffs at the footprint so walking
reads as contact with the world rather than a sprite sliding over it.

For terrain tuning, the browser exposes local-only visual overlays through the
query string: `?terrainDebug=authority`, `biome`, `chunks`, `detail`,
`elevation`, `kit`, `material`, `moisture`, `path`, `rock`, `transition`,
`vegetation`, `walkability`, or `zone`. These overlays are diagnostic tools for tuning biome
channels, material placement, composition kits, density, transition masks,
walkability, and chunk culling; they are not player-facing UI.

## Clean-Room Art Rules

- Use original `64x64`, `96x96`, or `128x128` 1:1 diamond ground tiles.
- Do not use copied UO tiles, sprites, maps, UI, names, data files, or formulas.
- Do not target UO client compatibility.
- Avoid `64x32` unless the art direction intentionally shifts away from the UO-like military projection.
- Tall sprites should be anchored to a footprint point, usually bottom-center or tile-bottom-center.
- Any sprite sheet entering the client should be declared in `assets/sprites/manifest.json` and pass `npm run assets:verify`, which checks the manifest projection contract against the client constants, requires render-layer/shadow metadata, and verifies PNG sheet dimensions against declared square frame cells. Terrain sheets should enter through `assets/terrain/manifest.json`, which is also covered by `npm run assets:verify`. The browser repeats smaller runtime normalization before loading selected sheets and verifies fetched PNG bytes against the manifest SHA-256 pins with Web Crypto, so malformed metadata, unsafe paths, or byte drift fall back instead of driving image paths or draw state.
