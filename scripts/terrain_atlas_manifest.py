"""Manifest tile metadata for the generated runtime terrain atlas."""

from __future__ import annotations

from terrain_atlas_materials import CORNER_MASKS, EDGE_MASKS, MATERIALS, PAIR_TRANSITIONS


def terrain_tiles() -> list[dict]:
    tiles: list[dict] = []
    for index, material in enumerate(MATERIALS):
        tiles.append(tile_entry(material, "flat-base", index, surface_role(material, "flat")))
    for index, material in enumerate(MATERIALS):
        tiles.append(tile_entry(material, "slope-texture", len(MATERIALS) + index, surface_role(material, "slope")))
    for index, material in enumerate(MATERIALS):
        tiles.append(tile_entry(material, "transition", len(MATERIALS) * 2 + index, surface_role(material, "transition")))
    for edge_index, edge in enumerate(EDGE_MASKS):
        for material_index, material in enumerate(MATERIALS):
            tiles.append(
                tile_entry(
                    material,
                    "transition",
                    len(MATERIALS) * 3 + edge_index * len(MATERIALS) + material_index,
                    surface_role(material, "transition"),
                    mask={"type": "edge", "edge": edge},
                )
            )
    for corner_index, corner in enumerate(CORNER_MASKS):
        for material_index, material in enumerate(MATERIALS):
            tiles.append(
                tile_entry(
                    material,
                    "transition",
                    len(MATERIALS) * 7 + corner_index * len(MATERIALS) + material_index,
                    surface_role(material, "transition"),
                    mask={"type": "corner", "corner": corner},
                )
            )
    pair_frame_start = len(MATERIALS) * 11
    for pair_index, (from_material, to_material) in enumerate(PAIR_TRANSITIONS):
        tiles.append(
            tile_entry(
                to_material,
                "pair-transition",
                pair_frame_start + pair_index,
                surface_role(to_material, "transition"),
                pair={"from": from_material, "to": to_material},
            )
        )
    return tiles


def tile_entry(material: str, kind: str, frame: int, role: str, mask: dict | None = None, pair: dict | None = None) -> dict:
    entry = {
        "id": f"{material}-{tile_id_part(kind, mask)}",
        "material": material,
        "kind": kind,
        "frame": frame,
        "surface": {
            "walkable": material != "water",
            "role": role,
        },
    }
    if mask:
        entry["mask"] = mask
    if pair:
        entry["id"] = f"{pair['from']}-to-{pair['to']}-pair-transition"
        entry["pair"] = pair
    return entry


def tile_id_part(kind: str, mask: dict | None) -> str:
    if not mask:
        return {
            "flat-base": "flat-base",
            "slope-texture": "slope-texture",
            "transition": "transition-generic",
            "pair-transition": "pair-transition",
        }[kind]
    if mask["type"] == "edge":
        return f"transition-{mask['edge']}"
    return f"transition-{mask['corner']}"


def surface_role(material: str, variant: str) -> str:
    if material == "water":
        return "liquid" if variant == "flat" else "liquid-slope" if variant == "slope" else "shoreline"
    if material == "shore":
        return "wet-bank" if variant == "flat" else "wet-bank-slope" if variant == "slope" else "shore-edge"
    if material == "settlement":
        return "surface" if variant == "flat" else "surface-slope" if variant == "slope" else "surface-edge"
    if material == "cobble":
        return "cobble" if variant == "flat" else "cobble-slope" if variant == "slope" else "cobble-edge"
    if material == "rock":
        return "rock" if variant == "flat" else "rock-slope" if variant == "slope" else "rock-edge"
    if material == "ruin":
        return "ruin-floor" if variant == "flat" else "ruin-slope" if variant == "slope" else "ruin-edge"
    return "slope" if variant == "slope" else "edge" if variant == "transition" else "ground"
