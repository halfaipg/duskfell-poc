# Duskfell Art Direction

Duskfell should feel like a dark-ages world seen through a disciplined plan-oblique game camera: readable, grounded, weathered, and systemic. The target is not to imitate or trace any commercial game. The target is an original clean-room world with the same level of composition discipline: coherent terrain families, layered props, sortable vertical objects, paperdoll characters, and decay that feels built into the world.

## Camera Contract

The live camera stays `military-plan-oblique` with `64x64` square diamond ground cells. Do not generate or approve assets for a `64x32` dimetric/isometric camera.

Required asset behavior:

- Ground tiles use one shared diamond footprint and do not rotate differently per tile.
- Characters and props use bottom-center foot anchors, not visual centering.
- Vertical objects rise from the tile footprint and sort by footprint/screen position.
- Large props such as trees, ruins, fountains, and walls should be sliceable/layered when the player can pass behind or under them.
- Elevation is visible through terrain lips, shadows, vertical offsets, stairs, ramps, and object grounding, not through arbitrary per-tile tilt.

## Visual Pillars

1. **Old World, Not Cartoon Fantasy**
   Use iron, raw linen, dark leather, faded dyes, wet stone, moss, fungus, old timber, ash, and broken masonry. Avoid shiny toy proportions, bright saturated primary colors, and SVG-like flat shapes.

2. **Composed Terrain, Not Random Tiles**
   Terrain should be assembled from material families: base, worn variant, sparse/detail variant, edge transition, corner transition, slope/ramp, elevation lip, decal, and shadow. A single pretty grass tile is not enough.

3. **Decay Is A System**
   Stone, wood, metal, cloth, plants, bodies, and ruins all need decay states. The timescale may be years for wood and plants or hundreds of thousands of years for stone, but every material should have a path toward age, damage, moss, cracks, dust, or collapse.

4. **Paperdoll Characters First**
   Player bodies start minimally clothed and readable. Clothing, armor, cloaks, weapons, hair, and status effects are overlays on an approved base body, not baked into the default body sheet.

5. **Generated Art Is Source Material**
   AI images, Comfy outputs, and img2img passes are candidates. Runtime art is approved only after cleanup, anchoring, manifest provenance, gait/terrain review, and in-browser visual inspection.

## Character Style Language

The current player concepts are too realistic. Duskfell characters should not look like fantasy portrait studies pasted onto a tile map. The target is a **stylized carved paperdoll miniature**:

- simplified anatomy with graphic planes, not realistic muscle rendering
- strong readable silhouette at game scale
- hard-edged hand-painted forms with light pixel/sprite texture
- restrained facial detail and slightly iconic features
- muted dark-age palette: raw linen, soot, iron, old leather, weathered skin, moss, umber
- clear clothing/equipment layer boundaries for paperdoll overlays
- no cinematic rim lighting, glossy skin, photoreal fabric, or realistic portrait shading

The best current reference direction is the bottom-left quadrant of:

```text
assets/sprites/concepts/duskfell-character-style-exploration-20260708.png
```

That concept is not final body art because it is a front-facing player-card exploration, not an oblique walk sheet. Use it as the style target: blockier planes, stronger outline, more designed shapes, less realism.

## Terrain Composition Kit

The first production-grade kit should cover:

- grass: flat, trampled, sparse, rocky, flowered, wet, mossy
- dirt: path, packed earth, mud, dry cracks, ruts
- stone/cobble: plaza stone, broken cobble, worn stair, ruin floor, wall lip
- rock: exposed stone, slope face, cliff edge, rubble, ore-bearing rock
- water/shore: shallow water, wet edge, reeds, stones, driftwood
- field/marsh: old crop rows, fungus, deadfall, root tangles
- decay overlays: cracks, moss, lichen, dust, ash, rubble, rot, mycelium

Every terrain material promoted past review should include:

- at least one flat base
- at least one worn/detail variant
- transition tiles to its likely neighbors
- slope or elevation treatment when the material appears on raised ground
- decal overlays that can break repetition without changing collision

## Character Contract

Base player sheets must satisfy this before gear work:

- 4 rows by 8 frames minimum for walking.
- All rows use Duskfell oblique facing, not straight cardinal side/front/back poses.
- Feet visibly alternate in every row.
- Frame height and foot baseline remain stable.
- Bottom-center foot anchor is consistent across body and overlays.
- The default paperdoll has no armor, cloak, weapon, boots, or class outfit.
- Each paperdoll has a matching full-body front player-card portrait.

Equipment follows only after the base body passes gait review:

- hair/body marks
- underlayer
- shirt/legs
- boots
- armor
- cloak/back
- weapon/shield
- fx/status overlays

## Player Cards

Player cards are full-body paperdoll portraits, not busts. The base/default card should show the minimally clothed body identity. Equipped cards can be generated later from the same identity plus current loadout. The portrait should be visually richer than the in-world sprite, but it must still match the body, face, hair, silhouette, and equipment state of the active paperdoll.

## Approval Gates

An asset can move from candidate to live review only when:

- It is original clean-room art with no commercial-game pixels or style-prompt dependency.
- It uses the Duskfell projection and correct frame/tile dimensions.
- The background is transparent where the runtime needs transparency.
- Anchors, shadows, render scale, sort layer, and provenance are declared.
- Its PNG hash is pinned in the manifest.
- Character sheets pass `npm run sprites:gait`.
- Paperdoll stacks pass `npm run sprites:pipeline`.
- Terrain passes `npm run terrain:verify`.
- The full art posture is reviewed with `npm run art:direction`.

Review-state art can be playable. Approved-state art should survive this whole checklist.
