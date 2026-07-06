# Rendering Direction

Checked July 6, 2026. The visual target should be a clean-room military/plan-oblique 2D tile renderer, not true isometric and not the common `64x32` dimetric pixel-art style.

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
5. props and surfaces
6. actors/equipment/FX
7. roofs, canopy, and overhead occluders

The first visual milestone should be a tiny atlas with original grass, dirt, stone, shallow water, embankment, and ramp families, plus a small height-painted test chunk that proves rippled ground, transitions, walkable slopes, and actor foot anchoring.

The current PoC exposes a validated `duskfell-terrain-v1` profile through `server/data/world.json` and every server snapshot. The browser renderer builds its deterministic terrain from that profile, including seed, `64x64` tile dimensions, height scale, elevation range, water level, walkable-step metadata, and canonical material set. Unsupported terrain profiles, projection drift, bad material sets, and missing terrain metadata fail either server startup or the browser's defensive snapshot parser.

The browser also loads `assets/terrain/manifest.json` as a checked clean-room terrain atlas. The current atlas is still placeholder art, but the contract is production-shaped: every canonical material must declare a flat-base tile, a slope-texture tile, a transition tile, surface metadata, clean-room provenance, and approval state. `npm run terrain:verify` checks the atlas projection, material coverage, safe image path, PNG dimensions, water walkability, prompt hygiene, and non-placeholder provenance. At runtime, malformed atlas metadata or a missing image fails closed to procedural canvas fills; valid atlases are used for flat terrain, sloped terrain, and clipped material-edge overlays.

## Clean-Room Art Rules

- Use original `64x64`, `96x96`, or `128x128` 1:1 diamond ground tiles.
- Do not use copied UO tiles, sprites, maps, UI, names, data files, or formulas.
- Do not target UO client compatibility.
- Avoid `64x32` unless the art direction intentionally shifts away from the UO-like military projection.
- Tall sprites should be anchored to a footprint point, usually bottom-center or tile-bottom-center.
- Any sprite sheet entering the client should be declared in `assets/sprites/manifest.json` and pass `npm run assets:verify`, which checks the manifest projection contract against the client constants, requires render-layer/shadow metadata, and verifies PNG sheet dimensions against declared square frame cells. Terrain sheets should enter through `assets/terrain/manifest.json`, which is also covered by `npm run assets:verify`. The browser repeats smaller runtime normalization before loading selected sheets and verifies fetched PNG bytes against the manifest SHA-256 pins with Web Crypto, so malformed metadata, unsafe paths, or byte drift fall back instead of driving image paths or draw state.
