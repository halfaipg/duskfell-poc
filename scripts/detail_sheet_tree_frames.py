"""Locally authored tree frames for the generated detail sprite sheet."""

from __future__ import annotations

from PIL import Image

from detail_sheet_tree_crowns import draw_broad_tree_crown, draw_needle_tree_crown, draw_sparse_tree_crown
from detail_sheet_manifest import CELL
from pixel_art_primitives import ellipse, line, polygon, put_pixel

def draw_tree_frame(atlas: Image.Image, frame: int, stage: str, variant: int) -> None:
    draw_clean_tree_frame(atlas, frame, stage, variant)


def draw_clean_tree_frame(atlas: Image.Image, frame: int, stage: str, variant: int) -> None:
    ox = frame * CELL
    base_y = 57
    species = variant % 4
    palettes = [
        {
            "bark": (79, 50, 31, 255),
            "bark_dark": (39, 29, 23, 245),
            "bark_light": (135, 94, 57, 145),
            "leaf": (36, 88, 50, 255),
            "leaf_dark": (10, 34, 27, 240),
            "leaf_mid": (57, 113, 62, 255),
            "leaf_light": (142, 166, 92, 115),
            "seed": (205, 177, 80, 185),
            "rot": (96, 72, 50, 145),
            "moss": (86, 120, 72, 150),
        },
        {
            "bark": (57, 42, 31, 255),
            "bark_dark": (25, 24, 22, 248),
            "bark_light": (110, 83, 55, 125),
            "leaf": (25, 64, 48, 255),
            "leaf_dark": (8, 25, 25, 245),
            "leaf_mid": (42, 86, 60, 255),
            "leaf_light": (103, 139, 91, 105),
            "seed": (148, 168, 108, 150),
            "rot": (72, 58, 45, 150),
            "moss": (66, 111, 83, 165),
        },
        {
            "bark": (88, 62, 39, 255),
            "bark_dark": (43, 31, 24, 250),
            "bark_light": (163, 128, 75, 140),
            "leaf": (61, 94, 54, 250),
            "leaf_dark": (18, 38, 31, 230),
            "leaf_mid": (96, 122, 69, 245),
            "leaf_light": (181, 176, 102, 105),
            "seed": (219, 158, 77, 180),
            "rot": (106, 74, 49, 160),
            "moss": (118, 129, 78, 145),
        },
        {
            "bark": (96, 83, 62, 255),
            "bark_dark": (42, 38, 32, 248),
            "bark_light": (174, 158, 112, 130),
            "leaf": (79, 113, 70, 245),
            "leaf_dark": (23, 48, 38, 226),
            "leaf_mid": (120, 143, 85, 238),
            "leaf_light": (205, 198, 130, 118),
            "seed": (225, 207, 118, 170),
            "rot": (121, 99, 68, 150),
            "moss": (138, 151, 100, 130),
        },
    ][species]
    stage_data = {
        "sapling": {"height": 30, "trunk": 4, "crown_y": 32, "crown": 0.76, "roots": 1},
        "mature": {"height": 46, "trunk": 8, "crown_y": 25, "crown": 1.02, "roots": 2},
        "ancient": {"height": 56, "trunk": 12, "crown_y": 19, "crown": 1.2, "roots": 3},
    }[stage]
    lean = [-4, 2, -2, 4][species]
    trunk_w = stage_data["trunk"]
    top_x = ox + 32 + lean
    base_x = ox + 32
    trunk_top_y = base_y - stage_data["height"]

    root_spread = 6 + stage_data["roots"] * 3
    polygon(
        atlas,
        [
            (base_x - trunk_w - root_spread, base_y),
            (base_x - trunk_w // 2, base_y - 5),
            (top_x - max(2, trunk_w // 2), trunk_top_y),
            (top_x + max(2, trunk_w // 2), trunk_top_y + 1),
            (base_x + trunk_w // 2, base_y - 5),
            (base_x + trunk_w + root_spread, base_y),
            (base_x + trunk_w // 2, base_y + 1),
            (base_x - trunk_w // 2, base_y + 1),
        ],
        palettes["bark"],
    )
    line(atlas, base_x - trunk_w // 2, base_y - 4, top_x - 1, trunk_top_y + 5, palettes["bark_dark"], width=2)
    line(atlas, base_x + trunk_w // 2, base_y - 5, top_x + 2, trunk_top_y + 7, palettes["bark_light"], width=1)
    draw_tree_root_knuckles(atlas, base_x, base_y, stage, species, palettes)

    branch_sets = {
        "sapling": [(-8, -17, -2), (9, -20, 2)],
        "mature": [(-16, -25, -3), (17, -29, 4), (-10, -36, -1), (12, -38, 3)],
        "ancient": [(-23, -30, -5), (24, -34, 5), (-18, -45, -2), (18, -48, 4), (-10, -22, -6), (11, -24, 7)],
    }[stage]
    for dx, dy, bias in branch_sets:
        start_y = base_y + dy * 0.58
        line(atlas, round(top_x + bias * 0.45), round(start_y), round(top_x + dx), base_y + dy, palettes["bark_dark"], width=2)
        line(atlas, round(top_x + bias * 0.45), round(start_y - 1), round(top_x + dx), base_y + dy - 1, palettes["bark"], width=1)
    draw_tree_side_branches(atlas, top_x, base_y, stage, species, palettes)

    if species == 1:
        draw_needle_tree_crown(atlas, ox, top_x, trunk_top_y, stage, palettes, stage_data["crown"])
    elif species == 2:
        draw_sparse_tree_crown(atlas, ox, top_x, trunk_top_y, stage, palettes, stage_data["crown"])
    else:
        draw_broad_tree_crown(atlas, ox, top_x, base_y - stage_data["crown_y"], stage, palettes, stage_data["crown"], species)

    if stage == "ancient":
        hollow_y = base_y - 13
        ellipse(atlas, base_x + lean // 2, hollow_y, 3, 5, (14, 12, 11, 170))
        line(atlas, base_x - 7, base_y - 1, base_x - 17, base_y + 2, palettes["bark_dark"], width=2)
        line(atlas, base_x + 7, base_y - 1, base_x + 18, base_y + 2, palettes["bark_dark"], width=2)

    draw_tree_age_cues(atlas, ox, top_x, base_x, base_y, trunk_top_y, stage, species, palettes)
    draw_tree_resource_cues(atlas, ox, frame, top_x, base_y, stage, species, palettes)
    draw_tree_pixel_noise(atlas, ox, frame, stage, species, palettes)


def draw_tree_root_knuckles(
    atlas: Image.Image,
    base_x: int,
    base_y: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    roots = {
        "sapling": [(-5, 0, -11, 3), (5, -1, 11, 2)],
        "mature": [(-7, 0, -17, 4), (6, -1, 16, 2), (-2, 1, -7, 5)],
        "ancient": [(-9, -1, -22, 4), (8, -1, 23, 3), (-3, 1, -15, 7), (4, 1, 15, 7)],
    }[stage]
    for index, (x0, y0, x1, y1) in enumerate(roots):
        color = palette["bark_dark"] if (index + species) % 2 else palette["bark"]
        line(atlas, base_x + x0, base_y + y0, base_x + x1, base_y + y1, color, width=2)
        line(atlas, base_x + x0, base_y + y0 - 1, base_x + x1, base_y + y1 - 1, palette["bark_light"], width=1)


def draw_tree_side_branches(
    atlas: Image.Image,
    top_x: int,
    base_y: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    if stage == "sapling":
        twigs = [(-5, -26, -13, -31), (4, -23, 12, -29)]
    elif stage == "mature":
        twigs = [(-8, -31, -22, -36), (8, -34, 23, -41), (-4, -23, -17, -25), (5, -26, 19, -29)]
    else:
        twigs = [
            (-10, -37, -31, -43),
            (10, -39, 31, -47),
            (-7, -25, -28, -27),
            (8, -27, 29, -30),
            (-1, -47, -10, -55),
            (4, -49, 14, -57),
        ]
    for index, (x0, y0, x1, y1) in enumerate(twigs):
        if stage == "sapling" and (index + species) % 3 == 0:
            continue
        line(atlas, top_x + x0, base_y + y0, top_x + x1, base_y + y1, palette["bark_dark"], width=1)


def draw_tree_age_cues(
    atlas: Image.Image,
    ox: int,
    top_x: int,
    base_x: int,
    base_y: int,
    trunk_top_y: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    if stage == "sapling":
        ellipse(atlas, top_x - 7, trunk_top_y + 17, 2, 2, palette["leaf_light"])
        ellipse(atlas, top_x + 8, trunk_top_y + 19, 2, 2, palette["leaf_light"])
        return

    if stage == "mature":
        for offset in (-9, 8):
            line(atlas, base_x + offset, base_y - 21, base_x + offset + (species % 3) - 1, base_y - 8, palette["moss"], width=1)
        if species == 2:
            ellipse(atlas, ox + 19, base_y - 19, 3, 5, palette["rot"])
        return

    for offset in (-14, -6, 7, 15):
        line(atlas, base_x + offset, trunk_top_y + 21, base_x + offset + (species % 3) - 1, base_y - 5, palette["moss"], width=1)
    for index, x in enumerate((base_x - 12, base_x + 12, base_x + 3)):
        ellipse(atlas, x, base_y - 10 - index * 5, 2 + (index % 2), 3, palette["rot"])
    if species in (2, 3):
        for x0, y0, x1, y1 in ((-20, -18, -31, -12), (18, -22, 30, -16), (-4, -34, 4, -43)):
            line(atlas, top_x + x0, base_y + y0, top_x + x1, base_y + y1, (35, 28, 23, 185), width=1)


def draw_tree_resource_cues(
    atlas: Image.Image,
    ox: int,
    frame: int,
    top_x: int,
    base_y: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    counts = {"sapling": 2, "mature": 4, "ancient": 6}
    for index in range(counts[stage]):
        x = ox + 14 + ((frame * 11 + species * 13 + index * 9) % 37)
        y = 9 + ((frame * 7 + species * 17 + index * 11) % (32 if stage != "sapling" else 25))
        if atlas.getpixel((x, y))[3] <= 30:
            x = top_x + ((index % 3) - 1) * (7 + species)
            y = base_y - (26 + index * 4)
        rx = 1 if stage == "sapling" else 2
        ellipse(atlas, x, y, rx, rx, palette["seed"])
    if stage == "ancient":
        fungus_color = (186, 164, 111, 170) if species != 1 else (126, 151, 134, 160)
        for index in range(3):
            ellipse(atlas, ox + 23 + index * 8, base_y - 4 - (index % 2), 2, 1, fungus_color)


def draw_tree_pixel_noise(
    atlas: Image.Image,
    ox: int,
    frame: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    count = {"sapling": 22, "mature": 42, "ancient": 58}[stage]
    for index in range(count):
        x = ox + 8 + ((frame * 29 + index * 17 + species * 11) % 48)
        y = 6 + ((frame * 13 + index * 23 + species * 7) % 45)
        existing = atlas.getpixel((x, y))
        if existing[3] <= 20:
            continue
        color = palette["leaf_light"] if index % 5 == 0 else palette["leaf_dark"] if index % 3 == 0 else palette["leaf_mid"]
        put_pixel(atlas, x, y, color)
        if stage != "sapling" and index % 11 == 0:
            put_pixel(atlas, min(ox + CELL - 1, x + 1), y, color)
