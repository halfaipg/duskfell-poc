export const DEFAULT_MANIFEST = "assets/terrain/manifest.json";
export const TERRAIN_SCHEMA_VERSION = "duskfell-terrain-atlas-v1";
export const ALLOWED_APPROVAL_STATES = new Set(["placeholder", "review", "approved", "rejected"]);
export const EDGE_MASKS = ["north", "east", "south", "west"];
export const CORNER_MASKS = ["northEast", "southEast", "southWest", "northWest"];

export const DISALLOWED_CLEAN_ROOM_PROMPT_TERMS =
  /\b(ultima|uo|britain|moongate|broadsword|ea)\b/i;
export const DISALLOWED_PROJECTION_PROMPT_TERMS =
  /\b(isometric|dimetric|64\s*x\s*32|128\s*x\s*64|2\s*:\s*1|rpg[-\s]?maker\s+iso|classic\s+iso)\b/i;
export const DISALLOWED_COMMERCIAL_STYLE_PROMPT_TERMS =
  /\b(zelda|stardew|diablo|runescape|tibia|albion online|world of warcraft|warcraft)\b/i;
