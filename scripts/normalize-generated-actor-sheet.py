#!/usr/bin/env python3
"""Normalize an AI-assisted actor concept sheet into runtime sprite sheets."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "assets" / "sprites" / "duskfell-wayfarer-source.png"
OUTPUT_PATH = ROOT / "assets" / "sprites" / "duskfell-wayfarer.png"
MANIFEST_PATH = ROOT / "assets" / "sprites" / "manifest.json"

CELL = 128
COLUMNS = 8
ROWS = 4
SOURCE_COLUMNS = 8
SOURCE_ROWS = 4

GREEN_WEIGHT = 1.0
RED_BLUE_WEIGHT = 0.62
KEY_THRESHOLD = 54
OPAQUE_THRESHOLD = 90

VARIANTS = {
    "duskfell-ranger": {
        "path": ROOT / "assets" / "sprites" / "duskfell-ranger.png",
        "role": "ranger",
        "cloak": (47, 92, 65),
        "leather": (91, 78, 49),
        "metal": (104, 122, 108),
    },
    "duskfell-warden": {
        "path": ROOT / "assets" / "sprites" / "duskfell-warden.png",
        "role": "warden",
        "cloak": (43, 62, 86),
        "leather": (79, 76, 69),
        "metal": (117, 128, 135),
    },
    "duskfell-brigand": {
        "path": ROOT / "assets" / "sprites" / "duskfell-brigand.png",
        "role": "brigand",
        "cloak": (92, 48, 44),
        "leather": (76, 51, 34),
        "metal": (93, 93, 91),
    },
}


def main() -> None:
    if not SOURCE_PATH.exists():
        raise SystemExit(f"missing generated actor source: {SOURCE_PATH}")

    source = Image.open(SOURCE_PATH).convert("RGBA")
    sheet = Image.new("RGBA", (CELL * COLUMNS, CELL * ROWS), (0, 0, 0, 0))
    source_cell_width = source.width / SOURCE_COLUMNS
    source_cell_height = source.height / SOURCE_ROWS

    for row in range(ROWS):
        for column in range(COLUMNS):
            box = (
                round(column * source_cell_width),
                round(row * source_cell_height),
                round((column + 1) * source_cell_width),
                round((row + 1) * source_cell_height),
            )
            frame = source.crop(box)
            frame = remove_green_screen(frame)
            frame = remove_detached_artifacts(frame)
            frame = trim_and_fit(frame)
            sheet.alpha_composite(frame, (column * CELL, row * CELL))

    sheet = ImageEnhance.Contrast(sheet).enhance(1.04)
    sheet.save(OUTPUT_PATH)

    base_hash = sha256_file(OUTPUT_PATH)
    source_hash = sha256_file(SOURCE_PATH)
    variant_hashes = {}
    for sheet_id, variant in VARIANTS.items():
        variant_image = make_role_variant(sheet, variant)
        variant_image.save(variant["path"])
        variant_hashes[sheet_id] = sha256_file(variant["path"])

    update_manifest(base_hash, source_hash, variant_hashes)
    print(f"wrote {OUTPUT_PATH}")
    print(f"updated {MANIFEST_PATH} duskfell-wayfarer imageSha256={base_hash}")
    for sheet_id, digest in variant_hashes.items():
        print(f"updated {sheet_id} imageSha256={digest}")


def remove_green_screen(image: Image.Image) -> Image.Image:
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pixels = []
    for r, g, b, a in image.getdata():
        key_score = g * GREEN_WEIGHT - max(r, b) * RED_BLUE_WEIGHT
        if key_score >= OPAQUE_THRESHOLD:
            alpha = 0
        elif key_score <= KEY_THRESHOLD:
            alpha = a
        else:
            alpha = round(a * (OPAQUE_THRESHOLD - key_score) / (OPAQUE_THRESHOLD - KEY_THRESHOLD))
        if alpha <= 3:
            pixels.append((0, 0, 0, 0))
        else:
            # Despill the green matte without flattening the warm leather highlights.
            green_cap = max(r, b) + 22
            pixels.append((r, min(g, green_cap), b, alpha))
    out.putdata(pixels)
    return out


def remove_detached_artifacts(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    width, height = image.size
    visited = bytearray(width * height)
    components: list[list[int]] = []

    for index, value in enumerate(alpha.getdata()):
        if value <= 8 or visited[index]:
            continue
        stack = [index]
        visited[index] = 1
        component = []
        while stack:
            current = stack.pop()
            component.append(current)
            x = current % width
            y = current // width
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= width or ny >= height:
                    continue
                neighbor = ny * width + nx
                if visited[neighbor]:
                    continue
                if alpha.getpixel((nx, ny)) <= 8:
                    continue
                visited[neighbor] = 1
                stack.append(neighbor)
        components.append(component)

    if not components:
        return image

    largest = max(len(component) for component in components)
    keep = {index for component in components if len(component) >= max(90, largest * 0.035) for index in component}
    pixels = list(image.getdata())
    cleaned = []
    for index, pixel in enumerate(pixels):
        cleaned.append(pixel if index in keep else (0, 0, 0, 0))
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.putdata(cleaned)
    return out


def trim_and_fit(frame: Image.Image) -> Image.Image:
    alpha = frame.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))

    trimmed = frame.crop(expand_box(bbox, frame.size, 6))
    scale = min(98 / trimmed.width, 108 / trimmed.height, 1.0)
    target_size = (
        max(1, round(trimmed.width * scale)),
        max(1, round(trimmed.height * scale)),
    )
    resized = trimmed.resize(target_size, Image.Resampling.LANCZOS)

    output = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    x = round((CELL - resized.width) / 2)
    y = CELL - 12 - resized.height
    output.alpha_composite(resized, (x, y))
    return output


def expand_box(box: tuple[int, int, int, int], size: tuple[int, int], padding: int) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    width, height = size
    return (
        max(0, left - padding),
        max(0, top - padding),
        min(width, right + padding),
        min(height, bottom + padding),
    )


def recolor_variant(sheet: Image.Image, variant: dict[str, object]) -> Image.Image:
    out = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
    pixels = []
    for r, g, b, a in sheet.getdata():
        if a == 0:
            pixels.append((0, 0, 0, 0))
            continue
        hue_target = None
        if b >= r * 0.88 and b >= g * 0.82 and r < 80:
            hue_target = variant["cloak"]
        elif r > g * 1.08 and r > b * 1.18 and g < 120:
            hue_target = variant["leather"]
        elif abs(r - g) < 28 and abs(g - b) < 32 and max(r, g, b) > 72:
            hue_target = variant["metal"]

        if hue_target is None:
            pixels.append((r, g, b, a))
        else:
            brightness = max(r, g, b) / 150
            nr, ng, nb = hue_target
            pixels.append((
                clamp(round(nr * brightness)),
                clamp(round(ng * brightness)),
                clamp(round(nb * brightness)),
                a,
            ))
    out.putdata(pixels)
    return out


def make_role_variant(sheet: Image.Image, variant: dict[str, object]) -> Image.Image:
    role = str(variant["role"])
    out = recolor_variant(sheet, variant)
    for row in range(ROWS):
        for column in range(COLUMNS):
            box = (
                column * CELL,
                row * CELL,
                (column + 1) * CELL,
                (row + 1) * CELL,
            )
            frame = out.crop(box)
            if role == "ranger":
                frame = make_ranger_frame(frame, row, column)
            elif role == "warden":
                frame = make_warden_frame(frame, row, column)
            elif role == "brigand":
                frame = make_brigand_frame(frame, row, column)
            out.paste(frame, (column * CELL, row * CELL))
    return out


def make_ranger_frame(frame: Image.Image, direction: int, frame_index: int) -> Image.Image:
    erase_common_shield(frame, direction)
    erase_side_bulk(frame, direction, 0.42)
    stride = walk_phase(frame_index)

    overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    draw_ranger_hood(draw)
    draw_ranger_quiver(draw, direction)
    draw_ranger_bow(draw, direction, stride)
    draw_ranger_boot_wraps(draw, stride)
    return Image.alpha_composite(frame, overlay)


def make_warden_frame(frame: Image.Image, direction: int, frame_index: int) -> Image.Image:
    stride = walk_phase(frame_index)
    overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    draw_warden_shoulders(draw)
    draw_warden_plate(draw)
    draw_warden_tower_shield(draw, direction, stride)
    draw_warden_helmet_crest(draw)
    return Image.alpha_composite(frame, overlay)


def make_brigand_frame(frame: Image.Image, direction: int, frame_index: int) -> Image.Image:
    erase_common_shield(frame, direction)
    erase_helmet_glint(frame)
    erase_side_bulk(frame, direction, 0.24)
    stride = walk_phase(frame_index)

    overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    draw_brigand_hood(draw)
    draw_brigand_scarf(draw, stride)
    draw_brigand_knife(draw, direction, stride)
    draw_brigand_rags(draw, stride)
    return Image.alpha_composite(frame, overlay)


def erase_common_shield(frame: Image.Image, direction: int) -> None:
    masks_by_direction = {
        0: [("ellipse", (78, 57, 113, 103)), ("rect", (83, 47, 108, 72))],
        1: [("ellipse", (80, 58, 116, 106)), ("rect", (82, 45, 110, 72))],
        2: [("ellipse", (15, 60, 47, 106)), ("rect", (18, 48, 45, 75))],
        3: [("ellipse", (14, 59, 49, 106)), ("rect", (17, 47, 44, 73))],
    }
    erase_shapes(frame, masks_by_direction.get(direction, []))


def erase_side_bulk(frame: Image.Image, direction: int, amount: float) -> None:
    inset = round(8 + amount * 12)
    if direction in (0, 2):
        shapes = [
            ("polygon", [(18, 68), (18 + inset, 58), (23 + inset, 110), (18, 113)]),
            ("polygon", [(110, 68), (110 - inset, 58), (105 - inset, 110), (110, 113)]),
        ]
    elif direction == 1:
        shapes = [("polygon", [(19, 65), (28 + inset, 59), (33 + inset, 111), (21, 113)])]
    else:
        shapes = [("polygon", [(109, 65), (100 - inset, 59), (95 - inset, 111), (107, 113)])]
    erase_shapes(frame, shapes)


def erase_helmet_glint(frame: Image.Image) -> None:
    erase_shapes(frame, [("ellipse", (47, 22, 81, 49))])


def erase_shapes(frame: Image.Image, shapes: list[tuple[str, object]]) -> None:
    if not shapes:
        return
    alpha = frame.getchannel("A")
    draw = ImageDraw.Draw(alpha)
    for kind, payload in shapes:
        if kind == "ellipse":
            draw.ellipse(payload, fill=0)
        elif kind == "rect":
            draw.rectangle(payload, fill=0)
        elif kind == "polygon":
            draw.polygon(payload, fill=0)
    frame.putalpha(alpha)


def draw_ranger_hood(draw: ImageDraw.ImageDraw) -> None:
    draw.polygon([(50, 39), (57, 27), (72, 27), (79, 39), (76, 53), (52, 53)], fill=(23, 55, 37, 190))
    draw.line([(50, 39), (57, 27), (72, 27), (79, 39), (76, 53), (52, 53), (50, 39)], fill=(9, 18, 14, 185), width=2)
    draw.line((58, 43, 71, 43), fill=(177, 153, 96, 170), width=1)


def draw_ranger_quiver(draw: ImageDraw.ImageDraw, direction: int) -> None:
    if direction in (0, 3):
        body = [(35, 56), (44, 53), (46, 89), (37, 92)]
        arrows = [(37, 44, 38, 57), (42, 41, 42, 56)]
    else:
        body = [(84, 56), (94, 53), (91, 91), (82, 88)]
        arrows = [(85, 44, 85, 57), (91, 41, 89, 56)]
    draw.polygon(body, fill=(48, 35, 22, 170))
    draw.line(body + [body[0]], fill=(16, 12, 9, 160), width=1)
    for x1, y1, x2, y2 in arrows:
        draw.line((x1, y1, x2, y2), fill=(184, 176, 132, 190), width=1)
        draw.polygon([(x1 - 2, y1), (x1, y1 - 4), (x1 + 2, y1)], fill=(91, 109, 76, 180))


def draw_ranger_bow(draw: ImageDraw.ImageDraw, direction: int, stride: float) -> None:
    sway = round(stride * 2)
    if direction in (0, 2, 3):
        bbox = (21 + sway, 52, 43 + sway, 111)
        string_x = 33 + sway
    else:
        bbox = (86 + sway, 52, 108 + sway, 111)
        string_x = 98 + sway
    draw.arc(bbox, 82, 278, fill=(116, 79, 39, 190), width=2)
    draw.line((string_x, bbox[1] + 5, string_x, bbox[3] - 5), fill=(221, 211, 164, 150), width=1)


def draw_ranger_boot_wraps(draw: ImageDraw.ImageDraw, stride: float) -> None:
    offset = round(stride * 2)
    draw.line((47 - offset, 102, 57 - offset, 108), fill=(153, 125, 75, 205), width=2)
    draw.line((70 + offset, 102, 80 + offset, 108), fill=(153, 125, 75, 205), width=2)


def draw_warden_shoulders(draw: ImageDraw.ImageDraw) -> None:
    draw.ellipse((37, 47, 58, 66), fill=(93, 108, 116, 235), outline=(25, 31, 34, 230), width=2)
    draw.ellipse((70, 47, 91, 66), fill=(93, 108, 116, 235), outline=(25, 31, 34, 230), width=2)
    draw.line((41, 55, 55, 52), fill=(184, 181, 154, 185), width=1)
    draw.line((74, 52, 88, 55), fill=(184, 181, 154, 185), width=1)


def draw_warden_plate(draw: ImageDraw.ImageDraw) -> None:
    draw.polygon([(48, 60), (80, 60), (84, 90), (64, 99), (44, 90)], fill=(70, 83, 91, 185))
    draw.line([(47, 59), (81, 59), (86, 91), (64, 101), (42, 91), (47, 59)], fill=(19, 24, 27, 220), width=2)
    draw.line((64, 61, 64, 98), fill=(177, 174, 146, 185), width=2)
    draw.line((49, 72, 79, 72), fill=(120, 134, 139, 180), width=1)
    draw.line((47, 83, 81, 83), fill=(39, 48, 54, 180), width=1)


def draw_warden_tower_shield(draw: ImageDraw.ImageDraw, direction: int, stride: float) -> None:
    sway = round(stride * 2)
    x = 88 + sway if direction in (0, 1) else 26 + sway
    points = [(x - 12, 62), (x + 12, 62), (x + 11, 91), (x, 106), (x - 11, 91)]
    draw.polygon(points, fill=(58, 75, 84, 238))
    draw.line(points + [points[0]], fill=(16, 19, 20, 240), width=3)
    draw.line((x, 59, x, 103), fill=(183, 171, 120, 200), width=2)
    draw.line((x - 9, 73, x + 9, 73), fill=(153, 156, 139, 160), width=2)


def draw_warden_helmet_crest(draw: ImageDraw.ImageDraw) -> None:
    draw.polygon([(59, 20), (64, 12), (69, 20), (69, 33), (59, 33)], fill=(87, 94, 100, 235))
    draw.line((64, 13, 64, 34), fill=(208, 195, 139, 190), width=1)


def draw_brigand_hood(draw: ImageDraw.ImageDraw) -> None:
    draw.polygon([(47, 39), (55, 26), (67, 24), (79, 33), (81, 48), (73, 57), (53, 55)], fill=(35, 29, 26, 190))
    draw.line([(47, 39), (55, 26), (67, 24), (79, 33), (81, 48), (73, 57), (53, 55), (47, 39)], fill=(12, 9, 8, 190), width=2)
    draw.line((58, 43, 72, 43), fill=(15, 11, 9, 210), width=2)


def draw_brigand_scarf(draw: ImageDraw.ImageDraw, stride: float) -> None:
    flutter = round(stride * 3)
    draw.polygon([(50, 56), (79, 56), (73, 64), (56, 65)], fill=(104, 36, 30, 195))
    draw.polygon([(76, 58), (90 + flutter, 65), (78, 68)], fill=(104, 36, 30, 175))
    draw.line((50, 56, 79, 56, 73, 64, 56, 65, 50, 56), fill=(34, 13, 12, 185), width=1)


def draw_brigand_knife(draw: ImageDraw.ImageDraw, direction: int, stride: float) -> None:
    sway = round(stride * 3)
    if direction in (0, 1):
        hilt = (83 + sway, 78)
        tip = (104 + sway, 58)
    else:
        hilt = (44 + sway, 78)
        tip = (24 + sway, 58)
    draw.line((hilt[0], hilt[1], tip[0], tip[1]), fill=(197, 190, 154, 240), width=3)
    draw.line((hilt[0] - 5, hilt[1] + 3, hilt[0] + 5, hilt[1] - 3), fill=(73, 44, 25, 235), width=3)


def draw_brigand_rags(draw: ImageDraw.ImageDraw, stride: float) -> None:
    flutter = round(stride * 3)
    draw.polygon([(43, 88), (51, 108), (59, 94), (66, 111), (74, 94), (85 + flutter, 107), (82, 84), (46, 84)], fill=(32, 29, 27, 105))
    draw.line((45, 85, 83, 85), fill=(11, 10, 9, 145), width=2)


def walk_phase(frame_index: int) -> float:
    cycle = (frame_index % COLUMNS) / COLUMNS
    return -1.0 if cycle < 0.25 else 1.0 if cycle < 0.75 else -0.35


def update_manifest(base_hash: str, source_hash: str, variant_hashes: dict[str, str]) -> None:
    manifest = json.loads(MANIFEST_PATH.read_text())
    for sheet in manifest["sheets"]:
        if sheet["id"] == "duskfell-wayfarer":
            sheet["imageSha256"] = base_hash
            sheet["provenance"]["sourceHash"] = source_hash
            sheet["provenance"]["prompt"] = (
                "original clean-room military-plan-oblique dark fantasy adventurer with visible "
                "alternating boots, short split cloak, shield, spear, and four diagonal eight-frame walk cycles"
            )
        elif sheet["id"] in variant_hashes:
            sheet["imageSha256"] = variant_hashes[sheet["id"]]
            sheet["provenance"]["sourceHash"] = base_hash
            sheet["provenance"]["source"] = (
                "local silhouette and equipment variant derived from normalized eight-frame assets/sprites/duskfell-wayfarer.png"
            )
            sheet["provenance"]["prompt"] = role_prompt(sheet["id"])
    MANIFEST_PATH.write_text(f"{json.dumps(manifest, indent=2)}\n")


def role_prompt(sheet_id: str) -> str:
    prompts = {
        "duskfell-ranger": (
            "original clean-room military-plan-oblique dark fantasy ranger variant with green hood, "
            "quiver, longbow silhouette, lighter boots, and four diagonal eight-frame walk cycles"
        ),
        "duskfell-warden": (
            "original clean-room military-plan-oblique dark fantasy warden variant with heavier plate, "
            "large tower shield, helmet crest, bulkier shoulders, and four diagonal eight-frame walk cycles"
        ),
        "duskfell-brigand": (
            "original clean-room military-plan-oblique dark fantasy brigand variant with dark hood, "
            "red scarf, knife silhouette, ragged cloak, and four diagonal eight-frame walk cycles"
        ),
    }
    return prompts.get(sheet_id, "")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clamp(value: int) -> int:
    return max(0, min(255, value))


if __name__ == "__main__":
    main()
