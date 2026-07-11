#!/usr/bin/env python3
"""Assemble Blender prototype frames into review sheets and card previews."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
FRAME_DIR = ROOT / "var" / "blender-paperdoll-prototype" / "frames"
LOW_W = 96
LOW_H = 128
SCALE = 3
DIRECTIONS = ["south", "east", "north", "west"]
FRAMES = 4
VARIANTS = ["base", "equipped", "ghost"]


def main() -> None:
    outputs = [assemble_sheet(variant) for variant in VARIANTS]
    outputs.append(render_cards())
    manifest = {
        "schemaVersion": "duskfell-blender-prototype-assembled-v1",
        "note": "Prototype review assets assembled from deterministic Blender frame renders.",
        "sourceFrames": str(FRAME_DIR.relative_to(ROOT)),
        "cell": {"width": LOW_W, "height": LOW_H, "displayScale": SCALE},
        "directions": DIRECTIONS,
        "frames": FRAMES,
        "outputs": [str(path.relative_to(ROOT)) for path in outputs],
    }
    (OUT_DIR / "duskfell-blender-prototype-assembled-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for output in outputs:
        print(output)


def assemble_sheet(variant: str) -> Path:
    sheet = Image.new("RGBA", (LOW_W * FRAMES, LOW_H * len(DIRECTIONS)), (0, 0, 0, 0))
    for row, direction in enumerate(DIRECTIONS):
        for frame in range(FRAMES):
            path = FRAME_DIR / f"{variant}-{direction}-{frame}.png"
            cell = Image.open(path).convert("RGBA")
            sheet.alpha_composite(cell, (frame * LOW_W, row * LOW_H))
    out = OUT_DIR / f"duskfell-blender-prototype-{variant}-sheet.png"
    sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.Resampling.NEAREST).save(out)
    return out


def render_cards() -> Path:
    cells = [
        Image.open(FRAME_DIR / f"{variant}-south-1.png")
        .convert("RGBA")
        .resize((192, 256), Image.Resampling.NEAREST)
        for variant in VARIANTS
    ]
    card_w, card_h = 236, 328
    gap = 18
    out = Image.new("RGBA", (card_w * 3 + gap * 2, card_h), (24, 24, 27, 255))
    for index, cell in enumerate(cells):
        x = index * (card_w + gap)
        card = Image.new("RGBA", (card_w, card_h), (29, 29, 32, 255))
        draw = ImageDraw.Draw(card, "RGBA")
        draw.rounded_rectangle(
            (8, 8, card_w - 8, card_h - 8),
            radius=10,
            fill=(52, 22, 30, 255),
            outline=(8, 8, 10, 255),
            width=4,
        )
        draw.rectangle((22, 22, card_w - 22, card_h - 26), fill=(62, 28, 34, 255))
        card.alpha_composite(cell, ((card_w - cell.width) // 2, 34))
        out.alpha_composite(card, (x, 0))
    path = OUT_DIR / "duskfell-blender-prototype-player-card-triptych.png"
    out.save(path)
    return path


if __name__ == "__main__":
    main()
