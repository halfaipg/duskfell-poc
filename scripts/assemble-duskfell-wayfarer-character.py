#!/usr/bin/env python3
"""Assemble Duskfell wayfarer Blender renders into card and direction review art."""

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
    sprite_card = sprite_treat(card, "duskfell-wayfarer-card-sprite.png", 0.60, colors=88)
    sprite_strip = sprite_treat(strip, "duskfell-wayfarer-direction-strip-sprite.png", 0.52, colors=72)
    comparison = render_comparison(sprite_card)
    manifest = {
        "schemaVersion": "duskfell-wayfarer-character-assembled-v1",
        "outputs": [
            str(card.relative_to(ROOT)),
            str(strip.relative_to(ROOT)),
            str(sprite_card.relative_to(ROOT)),
            str(sprite_strip.relative_to(ROOT)),
            str(comparison.relative_to(ROOT)),
        ],
    }
    (OUT_DIR / "duskfell-wayfarer-character-assembled-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for path in [card, strip, sprite_card, sprite_strip, comparison]:
        print(path)


def render_card() -> Path:
    subject = Image.open(OUT_DIR / "duskfell-wayfarer-paperdoll.png").convert("RGBA")
    subject = crop_alpha(subject, pad=12)
    subject.thumbnail((310, 442), Image.Resampling.LANCZOS)

    card_w, card_h = 380, 520
    out = Image.new("RGBA", (card_w, card_h), (18, 18, 20, 255))
    draw = ImageDraw.Draw(out, "RGBA")
    draw.rounded_rectangle((8, 8, card_w - 8, card_h - 8), radius=8, fill=(10, 10, 13, 255), outline=(3, 3, 5, 255), width=3)
    draw.rectangle((23, 22, card_w - 23, card_h - 64), fill=(49, 18, 27, 255), outline=(110, 70, 58, 190), width=1)
    for y in range(23, card_h - 64):
        shade = int(24 * (y - 23) / (card_h - 87))
        draw.line((24, y, card_w - 24, y), fill=(49 - shade // 3, 18 - shade // 5, 27 - shade // 4, 18))
    draw.rectangle((24, card_h - 54, card_w - 24, card_h - 24), fill=(86, 75, 52, 255), outline=(141, 124, 82, 255))
    draw.rectangle((33, card_h - 48, card_w - 33, card_h - 30), fill=(47, 42, 31, 185))
    out.alpha_composite(subject, ((card_w - subject.width) // 2, 26))

    path = OUT_DIR / "duskfell-wayfarer-card.png"
    out.save(path)
    return path


def render_strip() -> Path:
    cells = [Image.open(OUT_DIR / f"duskfell-wayfarer-{direction}.png").convert("RGBA") for direction in DIRECTIONS]
    cells = [crop_alpha(cell, pad=16).resize((196, 292), Image.Resampling.LANCZOS) for cell in cells]
    out = Image.new("RGBA", (224 * len(cells), 320), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        out.alpha_composite(cell, (224 * index + (224 - cell.width) // 2, 14))
    path = OUT_DIR / "duskfell-wayfarer-direction-strip.png"
    out.save(path)
    return path


def render_comparison(sprite_card: Path) -> Path:
    current = Image.open(OUT_DIR / "duskfell-quaternius-farmer-card-sprite.png").convert("RGBA")
    new = Image.open(sprite_card).convert("RGBA")
    out = Image.new("RGBA", (current.width + new.width + 28, max(current.height, new.height)), (21, 21, 24, 255))
    out.alpha_composite(current, (0, 0))
    out.alpha_composite(new, (current.width + 28, 0))
    draw = ImageDraw.Draw(out, "RGBA")
    draw.rectangle((current.width + 10, 0, current.width + 17, out.height), fill=(80, 66, 45, 255))
    path = OUT_DIR / "duskfell-wayfarer-card-comparison.png"
    out.save(path)
    return path


def sprite_treat(source_path: Path, output_name: str, scale: float, *, colors: int) -> Path:
    source = Image.open(source_path).convert("RGBA")
    alpha = source.getchannel("A")
    shadow = alpha.filter(ImageFilter.GaussianBlur(3))
    shadow_rgba = Image.new("RGBA", source.size, (0, 0, 0, 70))
    shadow_rgba.putalpha(shadow.point(lambda value: min(70, value // 3)))

    matted = Image.new("RGBA", source.size, (13, 12, 13, 255))
    matted.alpha_composite(shadow_rgba)
    matted.alpha_composite(source)

    small_size = (max(1, round(source.width * scale)), max(1, round(source.height * scale)))
    small = matted.resize(small_size, Image.Resampling.LANCZOS)
    small = ImageEnhance.Contrast(small).enhance(1.16)
    small = ImageEnhance.Color(small).enhance(0.86)
    small = ImageEnhance.Sharpness(small).enhance(1.18)
    rgb = small.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT).convert("RGB")

    alpha_small = source.getchannel("A").resize(small_size, Image.Resampling.LANCZOS)
    alpha_small = alpha_small.point(lambda value: 255 if value > 16 else 0)
    treated = Image.merge("RGBA", (*rgb.split(), alpha_small))
    treated = treated.filter(ImageFilter.UnsharpMask(radius=0.55, percent=110, threshold=3))

    outline_alpha = alpha_small.filter(ImageFilter.MaxFilter(3))
    outline_alpha = Image.composite(outline_alpha, Image.new("L", alpha_small.size, 0), ImageOps.invert(alpha_small))
    outline = Image.new("RGBA", small.size, (12, 11, 12, 225))
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
