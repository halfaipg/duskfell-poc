# Terrain System Direction

Duskfell should borrow terrain architecture ideas from classic UO, not UO code,
formats, art, maps, or data. The useful lesson is that the ground is not a flat
background: it is a projected height field with land tiles, static details,
material transitions, cliffs/edges, and actor/object sorting all sharing the same
world-space contract.

## Current Contract

- Projection is 64x64 military/plan-oblique, not 2:1 dimetric isometric.
- Terrain uses shared per-corner tile heights and samples the same height field
  for actors, props, and terrain details.
- Actor and prop anchors use bilinear sub-tile height sampling, so walking
  across even partial slopes changes projected screen Y smoothly instead of
  snapping at tile boundaries.
- Every tile exposes derived height metadata: min, max, average, range, north,
  south, east, west, slope, normal, and lighting. Chunks expose aggregate height
  bounds so renderers can cull, shade, sort, and later build GPU buffers without
  recomputing those values ad hoc.
- Every tile carries explicit biome channels for elevation, moisture, rockiness,
  dryness, settlement pressure, plaza pressure, path pressure, north/south path
  pressure, east/west path pressure, shore path pressure, water pressure, shore
  pressure, vegetation, and detail density.
- Every tile also carries a terrain composition record with a named zone
  (`water`, `plaza`, `road`, `shore`, `ridge`, `grove`, `scrub`, or `meadow`),
  elevation/moisture bands, road axis, detail family, object band, optional
  composition-kit membership, and density budget. Materials, decals, detail
  objects, and debug overlays use that shared composition layer instead of each
  renderer inventing its own terrain meaning.
- Every tile now resolves that composition into a terrain family profile such as
  `living-meadow`, `old-growth-woodland`, `charged-rotland`, `scrub-path`,
  `ancient-stonework`, `reedbed-shore`, or `settlement-plaza`. These profiles
  encode the source texture size, runtime tile size, required atlas roles
  (flat, slope, edge, corner, elevation lip, worn/sparse variants, decals),
  allowed detail kinds, resource kinds, lifecycle time scales, neighbor blend
  policy, and sliceable object hints. This is the clean-room version of the
  player-made UO terrain-pack lesson: terrain must be built as coherent
  material families, not isolated pretty tiles.
- Named composition kits sit above tile noise. The first kits anchor a
  settlement crossroads, an ancient viaduct approach, a sunken courtyard ruin,
  an old grove ring, a stormroot charged ruin, a Leywell garden, and a river
  reedbed; tiles inside those anchors receive kit roles such as causeway,
  rubble, wall, stairs, courtyard floor, charged core, wire scar, rot ring,
  basin, conduit, wet garden, canopy, reedline, road, or plaza. The viaduct kit
  already forces a coherent stone causeway, rubble field,
  cracked/mossy decals, and coordinated ruin/rubble/overgrowth statics. The
  courtyard kit adds vertical wall runs, eroded stairs, broken foundation
  pieces, masonry joint decals, mineral lifecycle state, and stone resources.
  The stormroot kit reserves the previously-unused `field` terrain material for
  crude-electric ground scars and clusters mycelium, deadwood, a stormroot tree,
  grounding stones, charged blooms, and ruin plinths into one readable ecology
  scene. The old-grove and reedbed kits now also place coordinated statics:
  staged canopy trees, deadfall, mycelium rings, understory, reeds, wet stones,
  bank grass, and driftwood with the same resource/lifecycle authority metadata.
  The Leywell garden adds a cracked basin, fallen rim stones, wet plants,
  crude-electric conduit ground, mycelium, and waterlogged deadfall so fountain
  ruins can become ecology/gameplay surfaces rather than inert landmarks.
- Procedural materials, transitions, decals, elevation edges, and details are
  generated from the map seed, tile biome channels, composition zone, and
  composition kit membership.
- Terrain details now include footprint metadata. Larger statics such as trees,
  ruins, and boulders reserve tile-space before spawning so groves,
  ridges, and shorelines have depth without overlapping into visual noise.
- Terrain details also emit a compact `detailAuthority` manifest with stable
  IDs, generation source, tile anchors, blocking collision shapes, resource
  node IDs, terrain family IDs, lifecycle state, and decay-consumer inputs. The same data is
  generated into `assets/terrain/detail-authority.json`, verified by
  `npm run assets:verify`, capped at server startup, and exposed through
  `/admin/runtime`. The Rust simulation now consumes the blocking entries as
  authoritative AABB movement blockers and promotes checked primary
  `resourceNodes` into server-owned objects with finite resource amounts,
  lifecycle snapshots, gather depletion, regeneration where applicable, replay
  support through the existing `resourceNodeChanged` journal path, passive
  deadwood-to-mycelium feeding through the existing ecology tick, and checked
  `decayConsumers` recipes that constrain which organic resources an authored
  terrain-detail mycelium node can passively consume. Multi-resource yields
  remain metadata until a later authority pass.
- Tall detail statics expose a shared depth profile alongside their footprint.
  Ruins, masonry pieces, and staged tree canopies now declare vertical height,
  occlusion radius, fade alpha, and sort bias so the browser can keep the player
  readable when a wall, stair mass, ruin, or canopy sorts in front of them.
- Terrain can now expose explicit indoor spaces. The first space comes from the
  sunken courtyard kit and carries world bounds, reveal padding, two floor
  levels, a stair portal connecting the sunken floor to the upper gallery, and
  roof opacity metadata. The browser draws its roof/upper shell as an occluding
  layer and fades that layer when the local player steps inside, revealing the
  interior floor, gallery outline, and active stair connector. Interior floor
  and portal metadata also contribute to `terrainHeightAtWorld(...)`: floor
  samples add the room's floor offset, and stair portals interpolate between
  their lower and upper floor heights even when they cross the room threshold.
  This establishes the clean-room version of old-school roof reveal and visible
  indoor elevation for future houses, towers, multi-floor halls, gates, and
  dungeons.
- Organic terrain details carry lifecycle/resource metadata. Trees have
  deterministic sapling, mature, and ancient stages, four clean-room silhouettes
  per stage, species labels, age, health, decay, wood yields, and occasional seed
  yields. Deadwood, stumps, mushrooms, and reeds expose decay, growth,
  consumption, and gatherable resource hooks so the world can later grow old,
  rot, feed mycelium, and regrow from the same terrain contract.
- Mineral terrain details use the same lifecycle/resource contract at a much
  longer clock. Ruins can expose stone, extreme age, low health, and high decay,
  allowing ancient walls, roads, foundations, and monuments to sit in visible
  states of erosion instead of being inert scenery.
- The current tree atlas frames encode stage and species shape directly:
  saplings, mature trees, and ancient trees have different trunk mass, roots,
  crown shape, moss, rot, seed, and fungus cues. Runtime tree rendering also
  overlays compact lifecycle/resource cues from the detail metadata, so wood
  fullness, seeds, health, and decay can be visible without turning trees into
  UI widgets. Broadleaf and sparse crowns should stay chunky and broken-edged,
  with deliberate pixel clusters and negative-space cuts, rather than soft
  circular blobs.
- Terrain detail resources share a bounded cue model before they reach canvas:
  wood, seed, fiber, deadwood, spores, mycelium, charge, stone, and ore each map
  to a compact visual signal derived from amount/fullness, health, age, decay,
  species, and lifecycle family. This keeps terrain art and server resource
  state aligned while leaving room for future sprite-generator output to replace
  the current cue marks with authored pixels.
- The authoritative server now exposes the first live resource-node slice for
  that contract. Grove, ore, and shrine objects have finite remaining/max
  resource amounts, lifecycle family, stage, species, age, health,
  growth/decay values, gather depletion, and slow regeneration in server
  snapshots. Gather and regeneration changes are journaled as resource-node
  state and replayed on restart, so depletion is not merely live process memory.
  The browser renders compact resource meters and lifecycle cues from that
  server state instead of inventing local gatherability.
- A first bridge from decorative terrain details into authoritative ecology is
  in place: the server now spawns a small lifecycle vignette with a sapling,
  mature tree, ancient tree, fresh log, decaying and hollow stumps, mycelium
  blooms, an ancient stone ruin, and crude field coils as terrain-like resource
  objects. They use the same snapshot resource contract as authored landmarks,
  are addressable in snapshots, can be gathered, expose lifecycle/resource
  state, and participate in node replay.
- Resource-node lifecycle age now advances from server ticks, not browser time.
  Family-specific age pressure feeds the same snapshot health/decay values, so
  fast-rotting deadwood and extremely slow stone decay can share one lifecycle
  contract without becoming decorative-only terrain.
- Organic inventory is now an ecological input, not only loot. A player carrying
  deadwood, fiber, seed, or spores can feed a nearby hungry mycelium node; the
  server consumes the item, grows the mycelium resource, updates lifecycle
  state, journals `resourceFed`, and replays the resulting node amount through
  the existing resource-node journal path. Inventory stacks now expose bounded
  lifecycle state too, so carried wood, ore, deadwood, and crafted goods have
  server-derived age, health, decay, and compostability instead of being timeless
  counters. Crafted inventory can enter the same decay economy: the first
  compostable item is the Trail Kit, which ages in inventory, feeds hungry
  mycelium, consumes the item, and journals a distinct `itemFed` event. The feed
  value scales with the item's decay state, so rotten carried objects are more
  valuable to the fungal economy than fresh ones. Composting crafted items also
  passively shed spores into inventory on a bounded server interval, emitting
  `itemDecayed`, so carrying rot has a gameplay consequence before the player
  actively feeds it to a bloom. If the player is close to hungry mycelium, the
  passive shed feeds that bloom directly and journals the target object before
  falling back to inventory spores. The browser renders compact carried-spore
  motes from that same snapshot state, making the fungal pressure visible around
  the character without inventing client-only gameplay. Players carrying finite
  charge also emit compact crude-electric sparks from the same snapshot resource
  summary, tying the low-tech electrical economy back into character rendering.
  Nearby world deadwood can also passively decay into mycelium on the
  authoritative tick, producing durable `resourceNodeChanged` events for the
  consumed stump/log and the grown bloom. Promoted terrain-detail mycelium now
  honors checked `decayConsumers` recipes, so a generated mushroom's authored
  consumption rules participate in the passive ecology loop instead of staying
  decorative metadata.
- Living tree harvest now feeds that loop too. When the server accepts a wood
  harvest from a tree-family node, it can add fallout to a nearby non-full
  deadwood node and journal the same `resourceNodeChanged` state, making
  logging visibly affect the local rot/mycelium economy.
- Crude electricity now participates in ecology too: a charged stormroot field
  coil can spend finite charge into nearby hungry mycelium, creating the same
  durable node-change trail while tying the low-tech electrical theme into
  growth rather than keeping it as isolated decoration. The terrain composition
  layer now mirrors that theme with a stormroot ruin kit whose charged field
  scars, deadwood, mycelium, old tree, and mineral details emit the same
  authority metadata shape as other terrain details.
- Material transitions carry explicit edge and corner mask metadata so the
  renderer can clip transition art and mask-specific atlas frames through stable
  shapes.
- Material transitions also carry `from`, `to`, `pair`, `family`, and a stable
  seed. The renderer uses those transition families now: shore, plaza, rocky,
  path, and soft seams get different overlay alpha, stroke treatment, and small
  edge chips. This is the bridge toward true material-pair atlas frames.
- The terrain atlas now includes optional `pair-transition` frames. The current
  review atlas covers 10 canonical material families: grass, field, dirt,
  stone, water, settlement, cobble, rock, ruin, and shore. The renderer prefers
  an exact pair frame before falling back to target material edge/corner frames.
- The runtime terrain atlas is now normalized from an AI-assisted clean-room
  source texture sheet, not only local procedural marks. The checked-in source
  sheet provides seed texture columns for the original six materials, while the
  normalizer derives cobble, rock, ruin, and shore as Duskfell-specific runtime
  families with deterministic 64x64 military-plan-oblique grid alignment,
  transition rows, manifest hash, and provenance.
- Terrain is chunked into fixed 8x8 tile chunks so visibility and future caching
  operate above individual tiles.
- Terrain authoring steps that survive review now have stable recipe ids in
  `assets/terrain/authoring-recipes.json`. This is the contract for a future
  level editor: maps retain recipe version, seed, knobs, and verified asset ids,
  while the server retains elevation, collision, resources, and decay
  authority. The current runtime biome builder rejects four-way mirror symmetry
  and atomically updates all eight WebP hashes; runtime placement uses seamless
  world-aligned sampling and forbids mirroring and free rotation.
- The renderer prepares projected chunk geometry once per terrain/origin, then
  culls chunks and tiles against the camera bounds each frame.
- Static land, slope, cliff, road, and transition layers are rendered into
  offscreen chunk bitmaps. Water shimmer, debug overlays, terrain details,
  props, and actors stay dynamic.
- Raised edges draw side-wall skirts and slope facets so tiles read as a
  coherent height field instead of isolated flat diamonds.
- Raised terrain atlas frames are selected from generated height metadata:
  sloped land, steep edge drops, and high ridge tiles use slope-texture art,
  while water and settlement tiles keep stable flat-base art.
- Terrain atlas generation is deterministic after the source sheet is checked
  in. The runtime atlas is cropped from generated material texture columns, then
  locally normalized into flat, slope, generic transition, edge, corner, and
  material-pair rows. Pair-transition frames now blend patches sampled from both
  source materials so paths, shores, rocky cuts, and plaza edges read as mixed
  ground rather than one material with a procedural overlay.
- Dev-only terrain debug overlays can be enabled with `?terrainDebug=...` for
  `authority`, `biome`, `chunks`, `detail`, `elevation`, `kit`, `material`,
  `moisture`, `path`, `rock`, `transition`, `vegetation`, `walkability`, or
  `zone`.

## Clean-Room Boundary

Allowed:

- Height-tile architecture.
- Chunk visibility and render-list ideas.
- Original terrain atlases generated for Duskfell.
- Original biome, material, slope, road, cliff, water, and decoration rules.

Off limits:

- UO art, maps, data files, formats, packet constants, item/static IDs, or copied
  formulas.
- UO compatibility as a renderer goal.
- "Looks identical to UO" as a requirement.

## Next Milestones

1. Broaden pair-transition art from generic pair frames to directional
   edge/corner pair frames. The renderer can already prefer exact pair masks
   when present, but the atlas only ships generic pair frames today.
2. Broaden the composition kit library: the first kit slice anchors crossroads,
   a viaduct ruin, a sunken courtyard ruin, a grove, a stormroot charged ecology
   ruin, a Leywell garden/fountain, and a reedbed, but Duskfell still needs
   bridges, gates, cliffs, multi-level wall runs, and richer occlusion rules.
3. Broaden server-authoritative ecology beyond the first terrain-detail resource
   promotion. The server now owns finite gather depletion, regeneration, restart
   replay, tree-harvest deadwood fallout, checked terrain-detail blockers,
   checked primary terrain-detail resource nodes, and checked terrain-detail
   decay-consumer recipes, but multi-resource detail yields, Rust-side
   generation, durable per-tile identity, rot spread, seasonal growth, and item
   drops still need promotion.
4. Improve environment art quality: trees, ruins, reeds, boulders, rocks,
   woodland scrub, fallen logs, stumps, flowers, mushrooms, shore tufts, and
   pebbles now spawn from composition bands with footprint spacing,
   manifest-backed detail frames, and lifecycle variants. The larger static
   frames are clean-room reviewed PoC art, but still need a final art pass
   before this reads like production Duskfell environment art.
5. Broaden occlusion-aware static sorting: tall statics now share one local
   fade/depth rule for the controlled player, including tree canopies and
   masonry, but roofs, multi-tile walls, and explicit hide/show regions still
   need richer rules.
6. Keep widening terrain-detail authority server-side. The server now rejects
   movement into server-owned world object footprints and checked terrain-detail
   authority blockers, promotes checked primary terrain-detail resources into
   gatherable server-owned nodes, applies checked terrain-detail decay-consumer
   recipes, and lets promoted deadwood feed promoted mycelium through the
   authoritative ecology tick. The next step is making multi-resource yields,
   durable per-tile identity, and authored rot-spread rules first-class.

## Quality Bar

The terrain system is good enough for a serious Duskfell demo when it can show a
large map with coherent hills, grass/rock/dirt/water blends, settlement roads,
rocks and vegetation, no obvious tile gaps, stable 60 FPS or better on a normal
laptop viewport, and actors/props sitting convincingly on the same height field.
