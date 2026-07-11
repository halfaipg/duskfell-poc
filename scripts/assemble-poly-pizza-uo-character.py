#!/usr/bin/env python3
"""Assemble Poly Pizza / Quaternius UO character renders."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
DIRECTIONS = ["south", "east", "north", "west"]


def main() -> None:
    card = render_card()
    strip = render_strip()
    sprite_card = sprite_treat(card, "duskfell-poly-pizza-uo-character-card-sprite.png", 0.62)
    sprite_strip = sprite_treat(strip, "duskfell-poly-pizza-uo-character-direction-strip-sprite.png", 0.50)
    manifest = {
        "schemaVersion": "duskfell-poly-pizza-uo-character-assembled-v1",
        "outputs": [
            str(card.relative_to(ROOT)),
            str(strip.relative_to(ROOT)),
            str(sprite_card.relative_to(ROOT)),
            str(sprite_strip.relative_to(ROOT)),
        ],
    }
    (OUT_DIR / "duskfell-poly-pizza-uo-character-assembled-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(card)
    print(strip)
    print(sprite_card)
    print(sprite_strip)


def render_card() -> Path:
    subject = Image.open(OUT_DIR / "duskfell-poly-pizza-uo-character-paperdoll.png").convert("RGBA")
    card_w, card_h = 380, 520
    out = Image.new("RGBA", (card_w, card_h), (23, 23, 26, 255))
    draw = ImageDraw.Draw(out, "RGBA")
    draw.rounded_rectangle((8, 8, card_w - 8, card_h - 8), radius=8, fill=(12, 12, 15, 255), outline=(4, 4, 6, 255), width=3)
    draw.rectangle((24, 22, card_w - 24, card_h - 64), fill=(54, 21, 30, 255), outline=(102, 60, 53, 190), width=1)
    draw.rectangle((24, card_h - 54, card_w - 24, card_h - 24), fill=(83, 73, 51, 255), outline=(132, 117, 78, 255))
    out.alpha_composite(subject, ((card_w - subject.width) // 2, 24))
    path = OUT_DIR / "duskfell-poly-pizza-uo-character-card.png"
    out.save(path)
    return path


def render_strip() -> Path:
    cells = [Image.open(OUT_DIR / f"duskfell-poly-pizza-uo-character-{direction}.png").convert("RGBA") for direction in DIRECTIONS]
    out = Image.new("RGBA", (224 * len(cells), 320), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        out.alpha_composite(cell, (224 * index, 0))
    path = OUT_DIR / "duskfell-poly-pizza-uo-character-direction-strip.png"
    out.save(path)
    return path


def sprite_treat(source_path: Path, output_name: str, scale: float) -> Path:
    source = Image.open(source_path).convert("RGBA")
    small_size = (max(1, round(source.width * scale)), max(1, round(source.height * scale)))
    small = source.resize(small_size, Image.Resampling.LANCZOS)
    small = ImageEnhance.Contrast(small).enhance(1.12)
    small = ImageEnhance.Color(small).enhance(0.88)
    alpha = small.getchannel("A").point(lambda value: 255 if value > 18 else 0)
    matte = Image.new("RGBA", small.size, (10, 9, 10, 255))
    matte.alpha_composite(small)
    rgb = matte.convert("RGB").quantize(colors=72, method=Image.Quantize.MEDIANCUT).convert("RGB")
    treated = Image.merge("RGBA", (*rgb.split(), alpha))
    treated = treated.filter(ImageFilter.UnsharpMask(radius=0.6, percent=120, threshold=3))
    outline_alpha = alpha.filter(ImageFilter.MaxFilter(3))
    outline_alpha = Image.composite(outline_alpha, Image.new("L", alpha.size, 0), Image.eval(alpha, lambda value: 0 if value else 255))
    outline = Image.new("RGBA", small.size, (13, 12, 13, 220))
    outline.putalpha(outline_alpha)
    outlined = Image.new("RGBA", small.size, (0, 0, 0, 0))
    outlined.alpha_composite(outline)
    outlined.alpha_composite(treated)
    treated = outlined
    treated = treated.resize(source.size, Image.Resampling.NEAREST)
    path = OUT_DIR / output_name
    treated.save(path)
    return path


if __name__ == "__main__":
    main()
