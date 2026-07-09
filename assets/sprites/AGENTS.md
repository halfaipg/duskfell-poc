# Sprite Asset Agent Instructions

Sprite assets cover actors, paperdolls, equipment, props, details, and player
cards.

## Read First

- Parent `assets/AGENTS.md`.
- `docs/art-direction.md` for character style, silhouettes, and paperdolls.
- `docs/art-pipeline.md` for provenance, review, and manifest approval.
- `docs/rendering.md` for facing, anchors, scale, and projection.

## Rules

- Base player bodies are minimally clothed. Clothing, armor, cloaks, weapons,
  hair, and status effects are equipment/loadout overlays.
- Runtime actor sheets must use Duskfell oblique facings, bottom-center anchors,
  stable scale, and readable gait.
- Do not bake default armor into base bodies unless the asset is explicitly a
  loadout or NPC variant.
- Player-card/paperdoll art must stay stylistically aligned with in-world actor
  art, even when resolution differs.
- Keep generated sources, candidates, archives, and approved runtime sheets
  clearly separated.
- Update `assets/sprites/README.md`, `assets/sprites/manifest.json`, and art docs
  when approval status or runtime assets change.

## Cross-Scope Links

- Actor sheet changes usually require client player animation/rendering checks
  and `scripts/analyze-sprite-gait.py` if gait quality is affected.
- Paperdoll/player-card changes should stay aligned with the in-world actor and
  should update manifest metadata for base body/equipment layering.
- Detail/prop sprite changes can affect object sorting, terrain-detail cues, and
  server-promoted terrain detail resource nodes.

## Tests

- Run `npm run test:sprites`.
- Run `npm run assets:verify`.
- Run `npm run art:direction` when changing characters, cards, props, or style
  rules.
