export const PLAYER_RENDER_SCALE = 0.66;
export const PLAYER_DIRECTION_NAMES = [
  "south",
  "east",
  "north",
  "west",
  "southeast",
  "northeast",
  "northwest",
  "southwest",
];

export const PREFERRED_PLAYER_SHEET_ID = "duskfell-wretch";
export const PREFERRED_PLAYER_SHEET_IDS = [
  "duskfell-wretch",
  "duskfell-wayfarer",
  "duskfell-ranger",
  "duskfell-warden",
  "duskfell-brigand",
];

export const PLAYER_ARCHETYPE_LABELS = {
  "duskfell-wretch": "Wretch",
  "duskfell-wayfarer": "Wayfarer",
  "duskfell-ranger": "Ranger",
  "duskfell-warden": "Warden",
  "duskfell-brigand": "Brigand",
  "duskfell-paperdoll-wayfarer": "Wayfarer",
  "duskfell-paperdoll-ranger": "Ranger",
  "duskfell-paperdoll-warden": "Warden",
  "duskfell-paperdoll-brigand": "Brigand",
};

export const PREFERRED_PLAYER_PAPERDOLL_IDS = [
  "duskfell-paperdoll-wayfarer",
  "duskfell-paperdoll-ranger",
  "duskfell-paperdoll-warden",
  "duskfell-paperdoll-brigand",
];

export const PLAYER_CARD_PORTRAITS = {
  "duskfell-wretch": "/assets/sprites/player-cards/duskfell-wretch-hero.png?v=painted-hero-1",
  "duskfell-wayfarer": "/assets/sprites/player-cards/duskfell-wayfarer-hero.png?v=painted-hero-1",
  "duskfell-ranger": "/assets/sprites/player-cards/duskfell-ranger-hero.png?v=painted-hero-1",
  "duskfell-warden": "/assets/sprites/player-cards/duskfell-warden-hero.png?v=painted-hero-1",
  "duskfell-brigand": "/assets/sprites/player-cards/duskfell-brigand-hero.png?v=painted-hero-1",
  "duskfell-paperdoll-wayfarer": "/assets/sprites/player-cards/duskfell-wayfarer-hero.png?v=painted-hero-1",
  "duskfell-paperdoll-ranger": "/assets/sprites/player-cards/duskfell-ranger-hero.png?v=painted-hero-1",
  "duskfell-paperdoll-warden": "/assets/sprites/player-cards/duskfell-warden-hero.png?v=painted-hero-1",
  "duskfell-paperdoll-brigand": "/assets/sprites/player-cards/duskfell-brigand-hero.png?v=painted-hero-1",
};

export const GENERATED_WAYFARER_NAME_RE = /^Wayfarer-([0-9a-f]{4})$/i;
// de-stacking only kicks in when sprites genuinely overlap (~half a tile);
// wider thresholds made bystanders visibly teleport whenever someone walked past
export const PLAYER_CLUSTER_DISTANCE = 30;
export const PLAYER_CLUSTER_SPREAD_RADIUS = 26;
export const PLAYER_CLUSTER_RING_STEP = 20;
export const PLAYER_CLUSTER_RING_SIZE = 8;
export const PLAYER_CLUSTER_SMOOTHING_MS = 140;
export const PLAYER_RENDER_MARGIN = 24;
export const FALLBACK_PLAYER_SHEET_ID = "player-placeholder";
export const PREFERRED_PROP_SHEET_ID = "duskfell-props";
export const FALLBACK_PROP_SHEET_ID = "props-placeholder";
export const ITEM_SHEET_ID = "duskfell-items";
export const DETAIL_SHEET_ID = "duskfell-details";

export const ITEM_ICON_FRAMES = {
  wood: 0,
  ore: 1,
  stone: 1,
  charge: 3,
  deadwood: 0,
  fiber: 0,
  seed: 0,
  mycelium: 3,
  spores: 3,
  "trail-kit": 2,
  deed: 3,
};

export const DETAIL_SPRITE_FRAMES = {
  rock: 0,
  pebble: 1,
  tuft: 2,
  flower: 3,
  scrub: 4,
  "fallen-log": 5,
  stump: 6,
  mushroom: 7,
  tree: {
    sapling: [8, 9, 10, 11],
    mature: [12, 13, 14, 15],
    ancient: [16, 17, 18, 19],
  },
  boulder: 20,
  reeds: 21,
  ruin: 22,
};

export const DETAIL_SPRITE_SCALE = {
  rock: 0.28,
  pebble: 0.18,
  tuft: 0.85,
  flower: 0.18,
  scrub: 1.9,
  "fallen-log": 0.14,
  stump: 0.22,
  mushroom: 0.1,
  tree: 1.35,
  boulder: 0.31,
  reeds: 0.29,
  ruin: 0.32,
  wall: 0.22,
  stairs: 0.22,
  foundation: 0.22,
};
