export const PLAYER_RENDER_SCALE = 0.66;
export const PLAYER_DIRECTION_NAMES = ["south", "east", "north", "west"];

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
  "duskfell-paperdoll-wayfarer": "/assets/sprites/player-cards/duskfell-paperdoll-wayfarer-front.png?v=stylized-base-1",
  "duskfell-paperdoll-ranger": "/assets/sprites/player-cards/duskfell-paperdoll-ranger-front.png?v=stylized-base-1",
  "duskfell-paperdoll-warden": "/assets/sprites/player-cards/duskfell-paperdoll-warden-front.png?v=stylized-base-1",
  "duskfell-paperdoll-brigand": "/assets/sprites/player-cards/duskfell-paperdoll-brigand-front.png?v=stylized-base-1",
  "duskfell-wayfarer": "/assets/sprites/player-cards/duskfell-paperdoll-wayfarer-front.png?v=stylized-base-1",
  "duskfell-ranger": "/assets/sprites/player-cards/duskfell-paperdoll-ranger-front.png?v=stylized-base-1",
  "duskfell-warden": "/assets/sprites/player-cards/duskfell-paperdoll-warden-front.png?v=stylized-base-1",
  "duskfell-brigand": "/assets/sprites/player-cards/duskfell-paperdoll-brigand-front.png?v=stylized-base-1",
};

export const GENERATED_WAYFARER_NAME_RE = /^Wayfarer-([0-9a-f]{4})$/i;
export const PLAYER_CLUSTER_DISTANCE = 118;
export const PLAYER_CLUSTER_SPREAD_RADIUS = 142;
export const PLAYER_CLUSTER_RING_STEP = 66;
export const PLAYER_CLUSTER_RING_SIZE = 8;
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
  rock: 1.28,
  pebble: 0.82,
  tuft: 0.9,
  flower: 0.84,
  scrub: 1.1,
  "fallen-log": 1.06,
  stump: 1,
  mushroom: 0.78,
  tree: 1.48,
  boulder: 1.42,
  reeds: 1.34,
  ruin: 1.46,
  wall: 1,
  stairs: 1,
  foundation: 1,
};
