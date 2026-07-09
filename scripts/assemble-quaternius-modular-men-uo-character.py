#!/usr/bin/env python3
"""Assemble slimmer Quaternius modular men renders into reviewable Duskfell sheets."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
CANDIDATES = ["beach", "adventurer", "farmer", "worker", "king"]
DIRECTIONS = ["south", "east", "north", "west"]


def main() -> None:
    lineup = render_lineup()
    card = render_card("farmer")
    strip = render_strip("farmer")
    sprite_lineup = sprite_treat(lineup, "duskfell-quaternius-modular-men-lineup-sprite.png", 0.58)
    sprite_card = sprite_treat(card, "duskfell-quaternius-farmer-card-sprite.png", 0.62)
    sprite_strip = sprite_treat(strip, "duskfell-quaternius-farmer-direction-strip-sprite.png", 0.50)
    manifest = {
        "schemaVersion": "duskfell-quaternius-modular-men-assembled-v1",
        "outputs": [
            str(lineup.relative_to(ROOT)),
            str(card.relative_to(ROOT)),
            str(strip.relative_to(ROOT)),
            str(sprite_lineup.relative_to(ROOT)),
            str(sprite_card.relative_to(ROOT)),
            str(sprite_strip.relative_to(ROOT)),
        ],
    }
    (OUT_DIR / "duskfell-quaternius-modular-men-assembled-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for path in [lineup, card, strip, sprite_lineup, sprite_card, sprite_strip]:
        print(path)


def render_lineup() -> Path:
    cells = [
        Image.open(OUT_DIR / f"duskfell-quaternius-{name}-paperdoll.png").convert("RGBA")
        for name in CANDIDATES
    ]
    cell_w, cell_h = 260, 400
    out = Image.new("RGBA", (cell_w * len(cells), cell_h), (18, 18, 20, 255))
    draw = ImageDraw.Draw(out, "RGBA")
    for index, cell in enumerate(cells):
        x = index * cell_w
        draw.rectangle((x, 0, x + cell_w - 1, cell_h - 1), fill=(32, 25, 27, 255), outline=(76, 62, 50, 180))
        scaled = cell.resize((round(cell.width * 0.86), round(cell.height * 0.86)), Image.Resampling.LANCZOS)
        out.alpha_composite(scaled, (x + (cell_w - scaled.width) // 2, 4))
        draw.rectangle((x + 16, cell_h - 34, x + cell_w - 16, cell_h - 13), fill=(73, 62, 43, 245), outline=(123, 106, 70, 210))
        draw.text((x + 24, cell_h - 31), CANDIDATES[index].replace("-", " ").title(), fill=(214, 198, 151, 255))
    path = OUT_DIR / "duskfell-quaternius-modular-men-lineup.png"
    out.save(path)
    return path


def render_card(name: str) -> Path:
    subject = Image.open(OUT_DIR / f"duskfell-quaternius-{name}-paperdoll.png").convert("RGBA")
    card_w, card_h = 380, 520
    out = Image.new("RGBA", (card_w, card_h), (22, 22, 25, 255))
    draw = ImageDraw.Draw(out, "RGBA")
    draw.rounded_rectangle((8, 8, card_w - 8, card_h - 8), radius=8, fill=(12, 12, 15, 255), outline=(4, 4, 6, 255), width=3)
    draw.rectangle((24, 22, card_w - 24, card_h - 64), fill=(52, 22, 30, 255), outline=(102, 60, 53, 190), width=1)
    draw.rectangle((24, card_h - 54, card_w - 24, card_h - 24), fill=(83, 73, 51, 255), outline=(132, 117, 78, 255))
    out.alpha_composite(subject, ((card_w - subject.width) // 2, 24))
    path = OUT_DIR / f"duskfell-quaternius-{name}-card.png"
    out.save(path)
    return path


def render_strip(name: str) -> Path:
    cells = [Image.open(OUT_DIR / f"duskfell-quaternius-{name}-{direction}.png").convert("RGBA") for direction in DIRECTIONS]
    out = Image.new("RGBA", (224 * len(cells), 320), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        out.alpha_composite(cell, (224 * index, 0))
    path = OUT_DIR / f"duskfell-quaternius-{name}-direction-strip.png"
    out.save(path)
    return path


def sprite_treat(source_path: Path, output_name: str, scale: float) -> Path:
    source = Image.open(source_path).convert("RGBA")
    small_size = (max(1, round(source.width * scale)), max(1, round(source.height * scale)))
    small = source.resize(small_size, Image.Resampling.LANCZOS)
    small = ImageEnhance.Contrast(small).enhance(1.13)
    small = ImageEnhance.Color(small).enhance(0.84)
    alpha = small.getchannel("A").point(lambda value: 255 if value > 18 else 0)
    matte = Image.new("RGBA", small.size, (10, 9, 10, 255))
    matte.alpha_composite(small)
    rgb = matte.convert("RGB").quantize(colors=76, method=Image.Quantize.MEDIANCUT).convert("RGB")
    treated = Image.merge("RGBA", (*rgb.split(), alpha))
    treated = treated.filter(ImageFilter.UnsharpMask(radius=0.6, percent=125, threshold=3))
    outline_alpha = alpha.filter(ImageFilter.MaxFilter(3))
    outline_alpha = Image.composite(outline_alpha, Image.new("L", alpha.size, 0), Image.eval(alpha, lambda value: 0 if value else 255))
    outline = Image.new("RGBA", small.size, (13, 12, 13, 220))
    outline.putalpha(outline_alpha)
    outlined = Image.new("RGBA", small.size, (0, 0, 0, 0))
    outlined.alpha_composite(outline)
    outlined.alpha_composite(treated)
    treated = outlined.resize(source.size, Image.Resampling.NEAREST)
    path = OUT_DIR / output_name
    treated.save(path)
    return path


if __name__ == "__main__":
    main()
