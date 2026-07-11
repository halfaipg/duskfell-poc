#!/usr/bin/env python3
"""Assemble bespoke Blender paperdoll renders into reviewable Duskfell art."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
DIRECTIONS = ["south", "east", "north", "west"]


def main() -> None:
    card = render_card()
    strip = render_strip()
    sprite_card = sprite_treat(card, "duskfell-painted-paperdoll-card-sprite.png", 0.58, colors=96)
    sprite_strip = sprite_treat(strip, "duskfell-painted-direction-strip-sprite.png", 0.52, colors=84)
    comparison = render_comparison(sprite_card)
    manifest = {
        "schemaVersion": "duskfell-painted-paperdoll-assembled-v1",
        "outputs": [
            str(card.relative_to(ROOT)),
            str(strip.relative_to(ROOT)),
            str(sprite_card.relative_to(ROOT)),
            str(sprite_strip.relative_to(ROOT)),
            str(comparison.relative_to(ROOT)),
        ],
    }
    (OUT_DIR / "duskfell-painted-paperdoll-assembled-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for path in [card, strip, sprite_card, sprite_strip, comparison]:
        print(path)


def render_card() -> Path:
    subject = Image.open(OUT_DIR / "duskfell-painted-paperdoll.png").convert("RGBA")
    subject = crop_alpha(subject, pad=14)
    subject.thumbnail((325, 454), Image.Resampling.LANCZOS)

    card_w, card_h = 380, 520
    out = Image.new("RGBA", (card_w, card_h), (18, 18, 20, 255))
    draw = ImageDraw.Draw(out, "RGBA")
    draw.rounded_rectangle((8, 8, card_w - 8, card_h - 8), radius=8, fill=(10, 10, 13, 255), outline=(3, 3, 5, 255), width=3)
    draw.rectangle((23, 22, card_w - 23, card_h - 64), fill=(48, 18, 27, 255), outline=(112, 72, 57, 190), width=1)
    draw.rectangle((24, card_h - 54, card_w - 24, card_h - 24), fill=(87, 76, 52, 255), outline=(143, 126, 83, 255))
    draw.rectangle((33, card_h - 48, card_w - 33, card_h - 30), fill=(47, 42, 31, 185))
    out.alpha_composite(subject, ((card_w - subject.width) // 2, 20))

    path = OUT_DIR / "duskfell-painted-paperdoll-card.png"
    out.save(path)
    return path


def render_strip() -> Path:
    cells = [Image.open(OUT_DIR / f"duskfell-painted-{direction}.png").convert("RGBA") for direction in DIRECTIONS]
    cropped = []
    for cell in cells:
        frame = crop_alpha(cell, pad=18)
        frame.thumbnail((208, 300), Image.Resampling.LANCZOS)
        cropped.append(frame)
    out = Image.new("RGBA", (224 * len(cropped), 320), (0, 0, 0, 0))
    for index, cell in enumerate(cropped):
        out.alpha_composite(cell, (224 * index + (224 - cell.width) // 2, 10 + (300 - cell.height) // 2))
    path = OUT_DIR / "duskfell-painted-direction-strip.png"
    out.save(path)
    return path


def render_comparison(sprite_card: Path) -> Path:
    old = Image.open(OUT_DIR / "duskfell-wayfarer-card-sprite.png").convert("RGBA")
    new = Image.open(sprite_card).convert("RGBA")
    out = Image.new("RGBA", (old.width + new.width + 28, max(old.height, new.height)), (21, 21, 24, 255))
    out.alpha_composite(old, (0, 0))
    out.alpha_composite(new, (old.width + 28, 0))
    draw = ImageDraw.Draw(out, "RGBA")
    draw.rectangle((old.width + 10, 0, old.width + 17, out.height), fill=(80, 66, 45, 255))
    path = OUT_DIR / "duskfell-painted-paperdoll-comparison.png"
    out.save(path)
    return path


def sprite_treat(source_path: Path, output_name: str, scale: float, *, colors: int) -> Path:
    source = Image.open(source_path).convert("RGBA")
    alpha = source.getchannel("A")
    shadow = alpha.filter(ImageFilter.GaussianBlur(2))
    shadow_rgba = Image.new("RGBA", source.size, (0, 0, 0, 58))
    shadow_rgba.putalpha(shadow.point(lambda value: min(58, value // 4)))

    matted = Image.new("RGBA", source.size, (13, 12, 13, 255))
    matted.alpha_composite(shadow_rgba)
    matted.alpha_composite(source)
    small_size = (max(1, round(source.width * scale)), max(1, round(source.height * scale)))
    small = matted.resize(small_size, Image.Resampling.LANCZOS)
    small = ImageEnhance.Contrast(small).enhance(1.12)
    small = ImageEnhance.Color(small).enhance(0.90)
    small = ImageEnhance.Sharpness(small).enhance(1.10)
    rgb = small.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT).convert("RGB")

    alpha_small = source.getchannel("A").resize(small_size, Image.Resampling.LANCZOS)
    alpha_small = alpha_small.point(lambda value: 255 if value > 18 else 0)
    treated = Image.merge("RGBA", (*rgb.split(), alpha_small))
    treated = treated.filter(ImageFilter.UnsharpMask(radius=0.55, percent=100, threshold=3))

    outline_alpha = alpha_small.filter(ImageFilter.MaxFilter(3))
    outline_alpha = Image.composite(outline_alpha, Image.new("L", alpha_small.size, 0), ImageOps.invert(alpha_small))
    outline = Image.new("RGBA", small.size, (12, 11, 12, 220))
    outline.putalpha(outline_alpha)
    composed = Image.new("RGBA", small.size, (0, 0, 0, 0))
    composed.alpha_composite(outline)
    composed.alpha_composite(treated)
    composed = composed.resize(source.size, Image.Resampling.NEAREST)

    path = OUT_DIR / output_name
    composed.save(path)
    return path


def crop_alpha(image: Image.Image, *, pad: int) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    if not bbox:
        return image
    left, top, right, bottom = bbox
    return image.crop((max(0, left - pad), max(0, top - pad), min(image.width, right + pad), min(image.height, bottom + pad)))


if __name__ == "__main__":
    main()
