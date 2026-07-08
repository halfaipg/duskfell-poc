export const TERRAIN_MATERIALS = {
  grass: {
    fill: "#496a3f",
    light: "#7f935a",
    dark: "#273d2c",
    stroke: "rgba(25, 35, 28, 0.08)",
    transition: "#36573b",
  },
  field: {
    fill: "#5f7043",
    light: "#8d965e",
    dark: "#35422d",
    stroke: "rgba(42, 55, 35, 0.08)",
    transition: "#637345",
  },
  dirt: {
    fill: "#6e4e39",
    light: "#9a714f",
    dark: "#3d2d26",
    stroke: "rgba(42, 31, 24, 0.1)",
    transition: "#513a2c",
  },
  stone: {
    fill: "#626966",
    light: "#8d9088",
    dark: "#343b39",
    stroke: "rgba(31, 35, 34, 0.1)",
    transition: "#4a524f",
  },
  water: {
    fill: "#315f73",
    light: "#6fa5ad",
    dark: "#1b3f52",
    stroke: "rgba(16, 51, 63, 0.1)",
    transition: "#b49f68",
  },
  settlement: {
    fill: "#afa487",
    light: "#d2c49f",
    dark: "#766c58",
    stroke: "rgba(78, 67, 52, 0.09)",
    transition: "#8f7d60",
  },
  cobble: {
    fill: "#82796a",
    light: "#b9aa8e",
    dark: "#443f39",
    stroke: "rgba(52, 46, 39, 0.1)",
    transition: "#6d6354",
  },
  rock: {
    fill: "#555b57",
    light: "#8c8e7d",
    dark: "#252b2a",
    stroke: "rgba(27, 31, 30, 0.12)",
    transition: "#3e4743",
  },
  ruin: {
    fill: "#746757",
    light: "#b29f79",
    dark: "#332e2b",
    stroke: "rgba(42, 34, 29, 0.11)",
    transition: "#5f553f",
  },
  shore: {
    fill: "#66704e",
    light: "#a49d65",
    dark: "#29362f",
    stroke: "rgba(28, 42, 36, 0.1)",
    transition: "#3f6f6b",
  },
};

const MATERIAL_PRIORITY = ["water", "shore", "rock", "ruin", "stone", "cobble", "dirt", "settlement", "field", "grass"];

export function materialPriority(material) {
  return MATERIAL_PRIORITY.indexOf(material);
}
