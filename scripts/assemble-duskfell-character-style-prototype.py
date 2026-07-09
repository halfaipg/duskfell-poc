#!/usr/bin/env python3
"""Assemble the Duskfell Blender style prototype into review assets."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
FRAME_DIR = ROOT / "var" / "blender-duskfell-style-prototype" / "frames"

LOW_W = 128
LOW_H = 160
SCALE = 3
DIRECTIONS = ["south", "east", "north", "west"]
FRAMES = 8
VARIANTS = ["base", "leather", "hooded", "ghost"]


def main() -> None:
    outputs = [assemble_sheet(variant) for variant in VARIANTS]
    outputs.append(render_card_lineup())
    outputs.append(render_game_scale_lineup())
    manifest = {
        "schemaVersion": "duskfell-character-style-prototype-assembled-v1",
        "note": "Review assets assembled from deterministic Blender character style frames.",
        "sourceFrames": str(FRAME_DIR.relative_to(ROOT)),
        "cell": {"width": LOW_W, "height": LOW_H, "displayScale": SCALE},
        "directions": DIRECTIONS,
        "frames": FRAMES,
        "variants": VARIANTS,
        "outputs": [str(path.relative_to(ROOT)) for path in outputs],
    }
    (OUT_DIR / "duskfell-character-style-prototype-assembled-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for output in outputs:
        print(output)


def assemble_sheet(variant: str) -> Path:
    sheet = Image.new("RGBA", (LOW_W * FRAMES, LOW_H * len(DIRECTIONS)), (0, 0, 0, 0))
    for row, direction in enumerate(DIRECTIONS):
        for frame in range(FRAMES):
            cell = Image.open(FRAME_DIR / f"{variant}-{direction}-{frame}.png").convert("RGBA")
            sheet.alpha_composite(cell, (frame * LOW_W, row * LOW_H))
    out = OUT_DIR / f"duskfell-character-style-prototype-{variant}-sheet.png"
    sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.Resampling.NEAREST).save(out)
    return out


def render_card_lineup() -> Path:
    card_w, card_h = 244, 340
    gap = 18
    out = Image.new("RGBA", (card_w * len(VARIANTS) + gap * (len(VARIANTS) - 1), card_h), (22, 22, 24, 255))
    for index, variant in enumerate(VARIANTS):
        cell = Image.open(FRAME_DIR / f"{variant}-south-2.png").convert("RGBA")
        cell = cell.resize((LOW_W * 2, LOW_H * 2), Image.Resampling.NEAREST)
        card = render_card(card_w, card_h)
        card.alpha_composite(cell, ((card_w - cell.width) // 2, 16))
        out.alpha_composite(card, (index * (card_w + gap), 0))
    path = OUT_DIR / "duskfell-character-style-prototype-player-card-lineup.png"
    out.save(path)
    return path


def render_card(card_w: int, card_h: int) -> Image.Image:
    card = Image.new("RGBA", (card_w, card_h), (26, 26, 29, 255))
    draw = ImageDraw.Draw(card, "RGBA")
    draw.rounded_rectangle((8, 8, card_w - 8, card_h - 8), radius=9, fill=(16, 16, 18, 255), outline=(4, 4, 6, 255), width=3)
    draw.rectangle((19, 19, card_w - 19, card_h - 30), fill=(55, 22, 30, 255))
    draw.rectangle((23, 23, card_w - 23, card_h - 34), outline=(94, 57, 50, 180), width=1)
    draw.rectangle((21, card_h - 54, card_w - 21, card_h - 27), fill=(88, 77, 55, 255), outline=(135, 122, 84, 255))
    return card


def render_game_scale_lineup() -> Path:
    out = Image.new("RGBA", (640, 260), (24, 27, 24, 255))
    draw = ImageDraw.Draw(out, "RGBA")
    for i in range(0, 640, 64):
        draw.polygon([(i, 190), (i + 64, 158), (i + 128, 190), (i + 64, 222)], fill=(48, 56, 43, 255), outline=(62, 70, 54, 180))
    for index, variant in enumerate(VARIANTS):
        cell = Image.open(FRAME_DIR / f"{variant}-south-2.png").convert("RGBA")
        cell = cell.resize((LOW_W * 2, LOW_H * 2), Image.Resampling.NEAREST)
        x = 58 + index * 145
        y = 25
        out.alpha_composite(cell, (x, y))
    path = OUT_DIR / "duskfell-character-style-prototype-world-lineup.png"
    out.save(path)
    return path


if __name__ == "__main__":
    main()
