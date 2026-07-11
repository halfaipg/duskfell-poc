#!/usr/bin/env python3
"""Assemble Quaternius real-model Duskfell review renders."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
DIRECTIONS = ["south", "east", "north", "west"]
CARD_W = 224
CARD_H = 320


def main() -> None:
    cells = [Image.open(OUT_DIR / f"duskfell-quaternius-realmodel-{direction}.png").convert("RGBA") for direction in DIRECTIONS]
    strip = Image.new("RGBA", (CARD_W * len(cells), CARD_H), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        strip.alpha_composite(cell, (index * CARD_W, 0))
    strip_path = OUT_DIR / "duskfell-quaternius-realmodel-direction-strip.png"
    strip.save(strip_path)

    card = render_card_preview(Image.open(OUT_DIR / "duskfell-quaternius-realmodel-paperdoll-lineup.png").convert("RGBA"))
    card_path = OUT_DIR / "duskfell-quaternius-realmodel-paperdoll-card-preview.png"
    card.save(card_path)

    manifest = {
        "schemaVersion": "duskfell-quaternius-realmodel-assembled-v1",
        "note": "Assembled review assets from real Quaternius model renders.",
        "outputs": [
            str(strip_path.relative_to(ROOT)),
            str(card_path.relative_to(ROOT)),
        ],
    }
    manifest_path = OUT_DIR / "duskfell-quaternius-realmodel-assembled-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(strip_path)
    print(card_path)


def render_card_preview(lineup: Image.Image) -> Image.Image:
    card_w, card_h = 620, 370
    out = Image.new("RGBA", (card_w, card_h), (24, 24, 27, 255))
    draw = ImageDraw.Draw(out, "RGBA")
    draw.rounded_rectangle((8, 8, card_w - 8, card_h - 8), radius=8, fill=(12, 12, 14, 255), outline=(4, 4, 6, 255), width=3)
    draw.rectangle((24, 22, card_w - 24, card_h - 58), fill=(56, 22, 31, 255), outline=(99, 59, 54, 180), width=1)
    draw.rectangle((24, card_h - 48, card_w - 24, card_h - 22), fill=(86, 76, 55, 255), outline=(135, 122, 84, 255))
    out.alpha_composite(lineup, ((card_w - lineup.width) // 2, 28))
    return out


if __name__ == "__main__":
    main()
