"""Tree crown drawing recipes for the generated detail sprite sheet."""

from __future__ import annotations

from PIL import Image

from detail_sheet_manifest import CELL
from pixel_art_primitives import draw_leaf_chip, line, polygon, rect


def draw_broad_tree_crown(
    atlas: Image.Image,
    ox: int,
    cx: int,
    cy: int,
    stage: str,
    palette: dict[str, tuple[int, int, int, int]],
    size: float,
    species: int,
) -> None:
    base = {
        "sapling": [(-8, 0, 8, 11), (2, -7, 10, 12), (11, 2, 7, 9), (0, 9, 13, 8)],
        "mature": [(-17, 1, 14, 16), (-5, -13, 16, 18), (14, -8, 15, 17), (21, 6, 11, 13), (1, 12, 22, 13), (-19, 14, 10, 10)],
        "ancient": [(-25, 4, 16, 18), (-13, -13, 18, 19), (7, -18, 20, 22), (25, -5, 17, 18), (18, 14, 20, 15), (-8, 15, 25, 15), (-28, 20, 12, 10)],
    }[stage]
    seed = {"sapling": 17, "mature": 31, "ancient": 47}[stage] + species * 23
    for dx, dy, rx, ry in base:
        draw_chunky_leaf_cluster(
            atlas,
            round(cx + dx * size),
            round(cy + dy * size),
            round(rx * size + 3),
            round(ry * size + 3),
            palette["leaf_dark"],
            seed + dx * 3 + dy,
            ragged=True,
        )
    colors = [palette["leaf"], palette["leaf_mid"], palette["leaf_dark"], palette["leaf"]]
    for index, (dx, dy, rx, ry) in enumerate(base):
        draw_chunky_leaf_cluster(
            atlas,
            round(cx + dx * size),
            round(cy + dy * size),
            round(rx * size),
            round(ry * size),
            colors[(index + species) % len(colors)],
            seed + index * 19,
        )
    carve_crown_notches(atlas, ox, cx, cy, stage, species)
    draw_crown_leaf_facets(atlas, ox, cx, cy, stage, species, palette)


def draw_needle_tree_crown(
    atlas: Image.Image,
    ox: int,
    cx: int,
    trunk_top_y: int,
    stage: str,
    palette: dict[str, tuple[int, int, int, int]],
    size: float,
) -> None:
    rows = {
        "sapling": [(23, 15), (31, 21), (40, 27)],
        "mature": [(12, 19), (23, 28), (34, 36), (45, 42)],
        "ancient": [(6, 20), (18, 32), (31, 43), (44, 49), (55, 54)],
    }[stage]
    for index, (offset_y, width) in enumerate(rows):
        y = trunk_top_y + offset_y
        half = round(width * size * 0.5)
        points = [
            (cx, y - round(12 * size)),
            (cx - half, y + round(8 * size)),
            (cx + (index % 2) - round(half * 0.28), y + round(4 * size)),
            (cx + half, y + round(8 * size)),
        ]
        polygon(atlas, points, palette["leaf_dark"] if index % 2 else palette["leaf"])
        line(atlas, cx - half + 2, y + round(6 * size), cx + half - 2, y + round(6 * size), palette["leaf_mid"], width=1)


def draw_sparse_tree_crown(
    atlas: Image.Image,
    ox: int,
    cx: int,
    trunk_top_y: int,
    stage: str,
    palette: dict[str, tuple[int, int, int, int]],
    size: float,
) -> None:
    clusters = {
        "sapling": [(-7, 7, 7, 8), (8, 2, 8, 9), (0, -5, 7, 8)],
        "mature": [(-20, 4, 10, 11), (-7, -13, 11, 12), (13, -11, 12, 13), (22, 6, 9, 10), (0, 11, 13, 10)],
        "ancient": [(-27, 5, 10, 12), (-16, -15, 12, 13), (8, -22, 13, 14), (27, -7, 11, 13), (16, 15, 12, 10), (-6, 19, 14, 9)],
    }[stage]
    crown_y = trunk_top_y + (17 if stage == "sapling" else 11 if stage == "mature" else 9)
    for index, (dx, dy, rx, ry) in enumerate(clusters):
        color = palette["leaf_mid"] if index % 2 else palette["leaf"]
        draw_chunky_leaf_cluster(
            atlas,
            round(cx + dx * size),
            round(crown_y + dy * size),
            round(rx * size),
            round(ry * size),
            color,
            59 + index * 17 + len(stage) * 11,
        )
        if index % 2 == 0:
            draw_leaf_chip(
                atlas,
                round(cx + dx * size - 4),
                round(crown_y + dy * size - 4),
                max(3, round(rx * size * 0.5)),
                max(2, round(ry * size * 0.34)),
                palette["leaf_light"],
                93 + index,
            )
    carve_crown_notches(atlas, ox, cx, crown_y, stage, 2)


def draw_chunky_leaf_cluster(
    image: Image.Image,
    cx: int,
    cy: int,
    rx: int,
    ry: int,
    color: tuple[int, int, int, int],
    seed: int,
    ragged: bool = False,
) -> None:
    rx = max(3, rx)
    ry = max(3, ry)
    jitter_x = (seed % 5) - 2
    jitter_y = ((seed // 5) % 5) - 2
    points = [
        (cx - rx + jitter_x, cy - ry // 4),
        (cx - rx // 2, cy - ry + jitter_y),
        (cx + rx // 5, cy - ry - (1 if ragged else 0)),
        (cx + rx, cy - ry // 3 + ((seed // 3) % 3) - 1),
        (cx + rx - rx // 5, cy + ry // 2),
        (cx + rx // 4, cy + ry + ((seed // 7) % 3) - 1),
        (cx - rx // 2, cy + ry - ry // 5),
        (cx - rx - ((seed // 11) % 2), cy + ry // 3),
    ]
    polygon(image, points, color)

    chip_count = 2 if rx < 8 else 3 if rx < 15 else 4
    for index in range(chip_count):
        px = cx - rx + 2 + ((seed * 13 + index * 11) % max(3, rx * 2 - 4))
        py = cy - ry + 2 + ((seed * 17 + index * 7) % max(3, ry * 2 - 4))
        if ((px - cx) / max(1, rx)) ** 2 + ((py - cy) / max(1, ry)) ** 2 > 1.1:
            continue
        chip_w = 2 + ((seed + index) % 3)
        chip_h = 1 + ((seed // 3 + index) % 3)
        rect(image, px, py, chip_w, chip_h, color)


def carve_crown_notches(image: Image.Image, ox: int, cx: int, cy: int, stage: str, species: int) -> None:
    notches = {
        "sapling": [(-15, -2, 5, 5), (13, 6, 5, 4), (0, -15, 4, 4)],
        "mature": [(-28, 0, 7, 6), (25, 4, 7, 7), (-7, -28, 6, 5), (8, 19, 6, 5)],
        "ancient": [(-34, 5, 8, 7), (31, -1, 8, 8), (-12, -35, 7, 6), (13, 25, 8, 6), (-27, 21, 6, 5)],
    }[stage]
    for index, (dx, dy, width, height) in enumerate(notches):
        if (index + species) % 4 == 0 and stage != "ancient":
            continue
        clear_rect(image, cx + dx, cy + dy, width, height, ox, ox + CELL)


def draw_crown_leaf_facets(
    image: Image.Image,
    ox: int,
    cx: int,
    cy: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    count = {"sapling": 5, "mature": 9, "ancient": 13}[stage]
    for index in range(count):
        x = ox + 9 + ((species * 23 + index * 7 + len(stage) * 11) % 47)
        y = 6 + ((species * 13 + index * 11 + len(stage) * 5) % 43)
        if image.getpixel((x, y))[3] <= 20:
            continue
        color = palette["leaf_light"] if index % 3 == 0 else palette["leaf_dark"]
        draw_leaf_chip(image, x, y, 3 + (index % 3), 2 + ((index + species) % 2), color, index + species)


def clear_rect(image: Image.Image, x: int, y: int, width: int, height: int, min_x: int, max_x: int) -> None:
    for py in range(y, y + height):
        for px in range(x, x + width):
            if px < min_x or px >= max_x or py < 0 or py >= image.height:
                continue
            image.putpixel((px, py), (0, 0, 0, 0))
