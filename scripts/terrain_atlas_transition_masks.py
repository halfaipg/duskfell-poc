"""Directional edge and corner variants for generated terrain transitions."""

from __future__ import annotations

import random

from PIL import Image

from pixel_art_primitives import line, rect
from terrain_atlas_materials import CELL


def directional_transition_variant(source: Image.Image, edge: str | None = None, corner: str | None = None) -> Image.Image:
    variant = source.copy()
    pixels = variant.load()
    for y in range(CELL):
        for x in range(CELL):
            alpha = transition_weight(x, y, edge=edge, corner=corner)
            if alpha <= 0:
                continue
            r, g, b, a = pixels[x, y]
            highlight = min(255, int(r * 1.2 + 18)), min(255, int(g * 1.17 + 15)), min(255, int(b * 1.08 + 8))
            shadow = int(r * 0.55), int(g * 0.55), int(b * 0.55)
            t = min(1.0, alpha)
            if edge in {"south", "west"} or corner in {"southEast", "southWest"}:
                mixed = tuple(int(shadow[i] * t + (r, g, b)[i] * (1 - t)) for i in range(3))
            else:
                mixed = tuple(int(highlight[i] * t + (r, g, b)[i] * (1 - t)) for i in range(3))
            pixels[x, y] = (mixed[0], mixed[1], mixed[2], a)
    paint_mask_edge_marks(variant, edge=edge, corner=corner)
    return variant


def paint_mask_edge_marks(image: Image.Image, edge: str | None = None, corner: str | None = None) -> None:
    rng = random.Random(f"{edge}:{corner}")
    for _ in range(16):
        x = rng.randrange(CELL)
        y = rng.randrange(CELL)
        if transition_weight(x, y, edge=edge, corner=corner) <= 0.08:
            continue
        color = (31, 39, 30, 80) if rng.random() > 0.45 else (211, 196, 137, 70)
        if rng.random() > 0.45:
            line(image, x - 2, y + 1, x + 3, y - 1, color, width=1)
        else:
            rect(image, x, y, rng.randrange(2, 5), 1, color)


def transition_weight(x: int, y: int, edge: str | None, corner: str | None) -> float:
    u = x / max(1, CELL - 1)
    v = y / max(1, CELL - 1)
    depth = 0.42
    feather = 0.12
    if edge == "north":
        return falloff(v, depth, feather)
    if edge == "east":
        return falloff(1 - u, depth, feather)
    if edge == "south":
        return falloff(1 - v, depth, feather)
    if edge == "west":
        return falloff(u, depth, feather)
    if corner == "northEast":
        return max(0.0, min(falloff(v, depth, feather), falloff(1 - u, depth, feather)))
    if corner == "southEast":
        return max(0.0, min(falloff(1 - v, depth, feather), falloff(1 - u, depth, feather)))
    if corner == "southWest":
        return max(0.0, min(falloff(1 - v, depth, feather), falloff(u, depth, feather)))
    if corner == "northWest":
        return max(0.0, min(falloff(v, depth, feather), falloff(u, depth, feather)))
    return 0.0


def falloff(distance: float, depth: float, feather: float) -> float:
    if distance <= depth - feather:
        return 0.34
    if distance >= depth:
        return 0.0
    return ((depth - distance) / feather) * 0.34
