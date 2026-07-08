"""Material painting recipes for the generated terrain atlas."""

from __future__ import annotations

import math
import random

from PIL import Image

from pixel_art_primitives import draw_leaf_chip, ellipse, line, mix, polygon, put_pixel, rect, shade
from terrain_atlas_materials import CELL, MATERIAL_PALETTES


def paint_material_marks(image: Image.Image, material: str, palette: dict, rng: random.Random, variant: str) -> None:
    if material == "grass":
        paint_grass(image, palette, rng, variant)
    elif material == "field":
        paint_field(image, palette, rng, variant)
    elif material == "dirt":
        paint_dirt(image, palette, rng, variant)
    elif material == "stone":
        paint_rocky_ground(image, palette, rng, variant)
    elif material == "water":
        paint_water(image, palette, rng, variant)
    elif material == "settlement":
        paint_settlement(image, palette, rng, variant)
    elif material == "cobble":
        paint_cobble(image, palette, rng, variant)
    elif material == "rock":
        paint_rocky_ground(image, palette, rng, variant)
        paint_rock_faces(image, palette, rng, variant)
    elif material == "ruin":
        paint_ruin_masonry(image, palette, rng, variant)
    elif material == "shore":
        paint_shore_bank(image, palette, rng, variant)


def paint_block_noise(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for y in range(0, CELL, 4):
        for x in range(0, CELL, 4):
            color = palette["base"]
            roll = rng.random()
            if roll < 0.22:
                color = shade(color, 0.82)
            elif roll > 0.82:
                color = mix(color, palette["light"], 0.2 if variant == "flat" else 0.13)
            rect(image, x, y, 4, 4, (*color, 255))
    for _ in range(120):
        x = rng.randrange(CELL)
        y = rng.randrange(CELL)
        color = palette["mid"] if rng.random() > 0.45 else palette["dark"]
        put_pixel(image, x, y, (*color, 120))


def paint_slope_striations(image: Image.Image, palette: dict, rng: random.Random, material: str) -> None:
    for offset in range(-CELL, CELL * 2, 13):
        alpha = 58 if material != "water" else 42
        line(image, offset, CELL, offset + CELL, 0, (*palette["dark"], alpha), width=1)
        if material not in {"settlement", "cobble"}:
            line(image, offset + 4, CELL, offset + CELL + 4, 0, (*palette["light"], 34), width=1)


def paint_transition_scatter(image: Image.Image, palette: dict, rng: random.Random, material: str) -> None:
    edge_color = MATERIAL_PALETTES["grass"]["dark"] if material not in {"grass", "water"} else palette["accent"]
    for _ in range(22):
        x = rng.randrange(CELL)
        y = rng.randrange(CELL)
        if rng.random() > 0.55:
            ellipse(image, x, y, rng.choice([1, 2]), 1, (*edge_color, 72))
        else:
            line(image, x, y + 2, x + rng.choice([-1, 0, 1]), y - 3, (*edge_color, 92), width=1)


def paint_grass(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    clumps = 26 if variant != "transition" else 16
    for _ in range(clumps):
        x = rng.randrange(2, CELL - 3)
        y = rng.randrange(3, CELL - 4)
        height = rng.randrange(3, 8)
        color = palette["light"] if rng.random() > 0.72 else palette["mid"]
        line(image, x, y + 2, x + rng.choice([-1, 0, 1]), y - height, (*color, 160), width=1)
        if rng.random() > 0.55:
            line(image, x - 1, y + 2, x - 2, y - max(2, height - 2), (*palette["dark"], 120), width=1)
        if rng.random() > 0.62:
            line(image, x + 1, y + 2, x + 2, y - max(2, height - 1), (*palette["mid"], 135), width=1)
        if rng.random() > 0.78:
            rect(image, x - 1, y - height - 1, 2, 2, (*palette["accent"], 150))
    for _ in range(16):
        draw_leaf_chip(image, rng.randrange(2, CELL - 8), rng.randrange(2, CELL - 8), rng.randrange(4, 8), rng.randrange(2, 5), (*palette["dark"], 130), rng.randrange(99))


def paint_field(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    spacing = 9 if variant != "slope" else 8
    for y in range(4, CELL, spacing):
        wobble = rng.randrange(-2, 3)
        line(image, 1, y + wobble, CELL - 2, y - 4 + wobble, (*palette["dark"], 86), width=1)
        line(image, 3, y - 2 + wobble, CELL - 5, y - 6 + wobble, (*palette["light"], 58), width=1)
    for _ in range(16):
        x = rng.randrange(2, CELL - 3)
        y = rng.randrange(2, CELL - 3)
        line(image, x, y + 3, x + rng.choice([-1, 0, 1]), y - rng.randrange(3, 7), (*palette["light"], 132), width=1)


def paint_dirt(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for _ in range(70 if variant != "transition" else 44):
        x = rng.randrange(2, CELL - 2)
        y = rng.randrange(2, CELL - 2)
        radius = rng.choice([1, 1, 2, 2, 3])
        color = palette["light"] if rng.random() > 0.72 else palette["dark"] if rng.random() < 0.38 else palette["mid"]
        ellipse(image, x, y, radius, max(1, radius - 1), (*color, 155))
    for _ in range(12):
        x = rng.randrange(0, CELL - 9)
        y = rng.randrange(0, CELL - 5)
        draw_leaf_chip(image, x, y, rng.randrange(5, 10), rng.randrange(2, 4), (*palette["dark"], 130), rng.randrange(99))


def paint_rocky_ground(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for _ in range(42 if variant != "transition" else 30):
        x = rng.randrange(0, CELL - 8)
        y = rng.randrange(0, CELL - 7)
        w = rng.randrange(5, 13)
        h = rng.randrange(4, 9)
        color = palette["mid"] if rng.random() > 0.42 else palette["base"]
        points = [
            (x + 1, y + h // 2),
            (x + w // 3, y),
            (x + w, y + rng.randrange(1, max(2, h // 2 + 1))),
            (x + w - 1, y + h),
            (x + rng.randrange(1, max(2, w // 2)), y + h),
        ]
        polygon(image, points, (*palette["dark"], 150))
        inner = [(px, py + 1) for px, py in points]
        polygon(image, inner, (*color, 210))
        if rng.random() > 0.55:
            line(image, x + 2, y + 2, x + w - 2, y + h - 1, (*palette["light"], 110), width=1)


def paint_water(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for y in range(2, CELL, 6):
        shift = int(math.sin(y * 0.4) * 4)
        line(image, shift, y, CELL + shift, y - 5, (*palette["light"], 70), width=1)
        line(image, shift - 5, y + 3, CELL + shift - 5, y - 2, (*palette["dark"], 90), width=1)
    for _ in range(18):
        x = rng.randrange(2, CELL - 8)
        y = rng.randrange(2, CELL - 3)
        line(image, x, y, x + rng.randrange(4, 12), y - rng.choice([1, 2]), (*palette["mid"], 115), width=1)


def paint_settlement(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for y in range(-8, CELL + 8, 14):
        for x in range(-16, CELL + 16, 18):
            offset = 9 if (y // 14) % 2 else 0
            px = x + offset
            color = palette["mid"] if rng.random() > 0.35 else palette["base"]
            polygon(
                image,
                [(px, y + 7), (px + 8, y), (px + 17, y + 7), (px + 9, y + 14)],
                (*palette["dark"], 130),
            )
            polygon(
                image,
                [(px + 1, y + 7), (px + 8, y + 1), (px + 16, y + 7), (px + 9, y + 13)],
                (*color, 230),
            )
            if rng.random() > 0.62:
                line(image, px + 4, y + 6, px + 13, y + 8, (*palette["light"], 115), width=1)
    for _ in range(8):
        rect(image, rng.randrange(0, CELL - 5), rng.randrange(0, CELL - 4), rng.randrange(2, 5), 1, (*palette["accent"], 100))


def paint_cobble(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for y in range(-6, CELL + 8, 11):
        row_offset = 7 if (y // 11) % 2 else 0
        for x in range(-10, CELL + 12, 15):
            px = x + row_offset + rng.randrange(-1, 2)
            py = y + rng.randrange(-1, 2)
            w = rng.randrange(10, 16)
            h = rng.randrange(6, 10)
            color = palette["mid"] if rng.random() > 0.42 else palette["base"]
            polygon(
                image,
                [(px, py + h // 2), (px + w // 2, py), (px + w, py + h // 2), (px + w // 2, py + h)],
                (*palette["dark"], 150),
            )
            polygon(
                image,
                [(px + 1, py + h // 2), (px + w // 2, py + 1), (px + w - 1, py + h // 2), (px + w // 2, py + h - 1)],
                (*color, 225),
            )
            if rng.random() > 0.64:
                line(image, px + 3, py + h // 2, px + w - 3, py + h // 2 + rng.choice([-1, 1]), (*palette["light"], 95), width=1)
    for _ in range(12 if variant != "flat" else 7):
        x = rng.randrange(1, CELL - 6)
        y = rng.randrange(1, CELL - 4)
        draw_leaf_chip(image, x, y, rng.randrange(4, 8), rng.randrange(2, 4), (*palette["accent"], 92), rng.randrange(99))


def paint_rock_faces(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for _ in range(24 if variant != "transition" else 16):
        x = rng.randrange(-3, CELL - 10)
        y = rng.randrange(-2, CELL - 8)
        w = rng.randrange(10, 20)
        h = rng.randrange(7, 14)
        points = [
            (x, y + h // 2),
            (x + w // 4, y + 1),
            (x + w - 2, y),
            (x + w, y + h // 2),
            (x + w // 2, y + h),
        ]
        polygon(image, points, (*palette["dark"], 150))
        inner = [(px + 1, py + 1) for px, py in points]
        polygon(image, inner, (*palette["mid"], 190))
        line(image, x + 3, y + 3, x + w - 4, y + h // 2, (*palette["light"], 110), width=1)
        if rng.random() > 0.58:
            line(image, x + w // 2, y + 2, x + w // 3, y + h - 2, (*palette["dark"], 120), width=1)


def paint_ruin_masonry(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    paint_cobble(image, palette, rng, variant)
    for _ in range(20 if variant != "transition" else 12):
        x = rng.randrange(0, CELL - 12)
        y = rng.randrange(0, CELL - 9)
        w = rng.randrange(8, 18)
        h = rng.randrange(4, 9)
        color = palette["mid"] if rng.random() > 0.46 else palette["base"]
        rect(image, x, y, w, h, (*palette["dark"], 105))
        rect(image, x + 1, y + 1, w - 2, h - 2, (*color, 160))
        if rng.random() > 0.52:
            line(image, x + 2, y + 2, x + w - 3, y + rng.randrange(2, max(3, h - 1)), (*palette["light"], 75), width=1)
    for _ in range(18):
        x = rng.randrange(1, CELL - 5)
        y = rng.randrange(2, CELL - 6)
        color = palette["accent"] if rng.random() > 0.44 else MATERIAL_PALETTES["grass"]["dark"]
        line(image, x, y + 3, x + rng.choice([-1, 0, 1]), y - rng.randrange(2, 6), (*color, 105), width=1)


def paint_shore_bank(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    paint_dirt(image, palette, rng, variant)
    for y in range(2, CELL, 8):
        shift = rng.randrange(-5, 5)
        line(image, shift, y + 2, CELL + shift, y - 3, (*MATERIAL_PALETTES["water"]["light"], 70), width=1)
        line(image, shift - 3, y + 5, CELL + shift - 3, y, (*MATERIAL_PALETTES["water"]["dark"], 60), width=1)
    for _ in range(24 if variant != "slope" else 16):
        x = rng.randrange(2, CELL - 3)
        y = rng.randrange(4, CELL - 3)
        height = rng.randrange(4, 10)
        reed = MATERIAL_PALETTES["field"]["light"] if rng.random() > 0.48 else palette["dark"]
        line(image, x, y + 2, x + rng.choice([-1, 0, 1]), y - height, (*reed, 130), width=1)
        if rng.random() > 0.72:
            rect(image, x - 1, y - height - 1, 2, 2, (*palette["accent"], 115))
