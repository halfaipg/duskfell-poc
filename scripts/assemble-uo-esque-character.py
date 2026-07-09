#!/usr/bin/env python3
"""Assemble UO-esque character Blender renders into review assets."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
DIRECTIONS = ["south", "east", "north", "west"]


def main() -> None:
    card = render_card_frame()
    strip = assemble_strip()
    manifest = {
        "schemaVersion": "duskfell-uo-esque-character-assembled-v1",
        "note": "Review assets assembled from the clothed UO-esque Blender character render.",
        "outputs": [str(card.relative_to(ROOT)), str(strip.relative_to(ROOT))],
    }
    (OUT_DIR / "duskfell-uo-esque-character-assembled-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(card)
    print(strip)


def render_card_frame() -> Path:
    subject = Image.open(OUT_DIR / "duskfell-uo-esque-character-paperdoll.png").convert("RGBA")
    card_w, card_h = 380, 520
    out = Image.new("RGBA", (card_w, card_h), (23, 23, 26, 255))
    draw = ImageDraw.Draw(out, "RGBA")
    draw.rounded_rectangle((8, 8, card_w - 8, card_h - 8), radius=8, fill=(12, 12, 15, 255), outline=(4, 4, 6, 255), width=3)
    draw.rectangle((24, 22, card_w - 24, card_h - 64), fill=(54, 21, 30, 255), outline=(102, 60, 53, 190), width=1)
    draw.rectangle((24, card_h - 54, card_w - 24, card_h - 24), fill=(83, 73, 51, 255), outline=(132, 117, 78, 255))
    out.alpha_composite(subject, ((card_w - subject.width) // 2, 24))
    path = OUT_DIR / "duskfell-uo-esque-character-card.png"
    out.save(path)
    return path


def assemble_strip() -> Path:
    cells = [Image.open(OUT_DIR / f"duskfell-uo-esque-character-{direction}.png").convert("RGBA") for direction in DIRECTIONS]
    out = Image.new("RGBA", (224 * len(cells), 320), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        out.alpha_composite(cell, (224 * index, 0))
    path = OUT_DIR / "duskfell-uo-esque-character-direction-strip.png"
    out.save(path)
    return path


if __name__ == "__main__":
    main()
