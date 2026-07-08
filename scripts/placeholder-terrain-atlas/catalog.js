export const CELL = 64;
export const EDGE_MASKS = ["north", "east", "south", "west"];
export const CORNER_MASKS = ["northEast", "southEast", "southWest", "northWest"];
export const MATERIALS = [
  {
    name: "grass",
    base: [65, 96, 55, 255],
    light: [119, 141, 78, 255],
    dark: [30, 55, 37, 255],
    accent: [147, 147, 82, 255],
  },
  {
    name: "field",
    base: [91, 108, 63, 255],
    light: [140, 150, 91, 255],
    dark: [50, 63, 43, 255],
    accent: [111, 126, 69, 255],
  },
  {
    name: "dirt",
    base: [101, 70, 52, 255],
    light: [150, 105, 72, 255],
    dark: [53, 39, 34, 255],
    accent: [151, 121, 80, 255],
  },
  {
    name: "stone",
    base: [91, 99, 96, 255],
    light: [135, 137, 128, 255],
    dark: [42, 50, 49, 255],
    accent: [75, 86, 84, 255],
  },
  {
    name: "water",
    base: [42, 91, 112, 255],
    light: [104, 165, 174, 255],
    dark: [21, 58, 78, 255],
    accent: [190, 224, 211, 255],
  },
  {
    name: "settlement",
    base: [167, 154, 122, 255],
    light: [207, 192, 150, 255],
    dark: [97, 88, 70, 255],
    accent: [67, 61, 55, 255],
  },
  {
    name: "cobble",
    base: [118, 111, 100, 255],
    light: [190, 179, 151, 255],
    dark: [62, 58, 54, 255],
    accent: [77, 92, 72, 255],
  },
  {
    name: "rock",
    base: [72, 76, 73, 255],
    light: [146, 146, 128, 255],
    dark: [34, 39, 38, 255],
    accent: [88, 74, 53, 255],
  },
  {
    name: "ruin",
    base: [104, 94, 80, 255],
    light: [181, 164, 126, 255],
    dark: [50, 46, 43, 255],
    accent: [54, 79, 57, 255],
  },
  {
    name: "shore",
    base: [87, 92, 68, 255],
    light: [164, 157, 101, 255],
    dark: [43, 56, 47, 255],
    accent: [65, 111, 107, 255],
  },
];

export const PAIR_TRANSITIONS = [
  ["dirt", "grass"],
  ["rock", "dirt"],
  ["water", "shore"],
  ["shore", "grass"],
  ["dirt", "settlement"],
  ["settlement", "cobble"],
  ["cobble", "dirt"],
  ["ruin", "cobble"],
  ["rock", "grass"],
  ["shore", "dirt"],
];

export const ROWS = 12;

export function terrainTiles() {
  return [
    ...MATERIALS.map((material, index) => tileEntry(material.name, "flat-base", index, surfaceRole(material.name, "flat"))),
    ...MATERIALS.map((material, index) => tileEntry(material.name, "slope-texture", MATERIALS.length + index, surfaceRole(material.name, "slope"))),
    ...MATERIALS.map((material, index) => tileEntry(material.name, "transition", MATERIALS.length * 2 + index, surfaceRole(material.name, "transition"))),
    ...EDGE_MASKS.flatMap((edge, edgeIndex) =>
      MATERIALS.map((material, materialIndex) =>
        tileEntry(
          material.name,
          "transition",
          MATERIALS.length * 3 + edgeIndex * MATERIALS.length + materialIndex,
          surfaceRole(material.name, "transition"),
          { type: "edge", edge },
        ),
      ),
    ),
    ...CORNER_MASKS.flatMap((corner, cornerIndex) =>
      MATERIALS.map((material, materialIndex) =>
        tileEntry(
          material.name,
          "transition",
          MATERIALS.length * 7 + cornerIndex * MATERIALS.length + materialIndex,
          surfaceRole(material.name, "transition"),
          { type: "corner", corner },
        ),
      ),
    ),
    ...PAIR_TRANSITIONS.map(([from, to], pairIndex) =>
      tileEntry(to, "pair-transition", MATERIALS.length * 11 + pairIndex, surfaceRole(to, "transition"), null, { from, to }),
    ),
  ];
}

function tileEntry(material, kind, frame, role, mask = null, pair = null) {
  const entry = {
    id: `${material}-${tileIdPart(kind, mask)}`,
    material,
    kind,
    frame,
    surface: {
      walkable: material !== "water",
      role,
    },
  };
  if (mask) entry.mask = mask;
  if (pair) {
    entry.id = `${pair.from}-to-${pair.to}-pair-transition`;
    entry.pair = pair;
  }
  return entry;
}

function tileIdPart(kind, mask) {
  if (!mask) {
    return {
      "flat-base": "flat-placeholder",
      "slope-texture": "slope-placeholder",
      transition: "transition-placeholder",
      "pair-transition": "pair-transition",
    }[kind];
  }
  return mask.type === "edge" ? `transition-${mask.edge}` : `transition-${mask.corner}`;
}

function surfaceRole(material, variant) {
  if (material === "water") {
    return variant === "flat" ? "liquid" : variant === "slope" ? "liquid-slope" : "shoreline";
  }
  if (material === "shore") {
    return variant === "flat" ? "wet-bank" : variant === "slope" ? "wet-bank-slope" : "shore-edge";
  }
  if (material === "settlement") {
    return variant === "flat" ? "surface" : variant === "slope" ? "surface-slope" : "surface-edge";
  }
  if (material === "cobble") return variant === "flat" ? "cobble" : variant === "slope" ? "cobble-slope" : "cobble-edge";
  if (material === "rock") return variant === "flat" ? "rock" : variant === "slope" ? "rock-slope" : "rock-edge";
  if (material === "ruin") return variant === "flat" ? "ruin-floor" : variant === "slope" ? "ruin-slope" : "ruin-edge";
  if (variant === "slope") return "slope";
  if (variant === "transition") return "edge";
  return "ground";
}
