#!/usr/bin/env python3
"""Build review-only paperdoll demo layers from a clean-room generated body sheet."""

from __future__ import annotations

from PIL import Image, ImageEnhance

from asset_pipeline_utils import sha256_file
from paperdoll_body_normalization import normalize_body_sheet
from paperdoll_demo_config import ASSET_DIR, MANIFEST_PATH, SOURCE_PATH, VARIANTS
from paperdoll_demo_manifest import update_manifest
from paperdoll_layers import (
    frame_boxes,
    make_armor_layer,
    make_boots_layer,
    make_cloak_layer,
    make_legs_layer,
    make_weapon_layer,
)


def main() -> None:
    if not SOURCE_PATH.exists():
        raise SystemExit(f"missing generated source image: {SOURCE_PATH}")

    source_hash = sha256_file(SOURCE_PATH)
    body = normalize_body_sheet(Image.open(SOURCE_PATH).convert("RGBA"))
    body = ImageEnhance.Contrast(body).enhance(1.04)
    write_sheet("duskfell-body-base", body)

    for variant_id, palette in VARIANTS.items():
        body_boxes = frame_boxes(body)
        write_sheet(f"duskfell-{variant_id}-trousers", make_legs_layer(body_boxes, palette))
        write_sheet(f"duskfell-{variant_id}-boots", make_boots_layer(body_boxes, palette))
        write_sheet(f"duskfell-{variant_id}-jack", make_armor_layer(body_boxes, palette))
        write_sheet(f"duskfell-{variant_id}-cloak", make_cloak_layer(body_boxes, palette))
        write_sheet(f"duskfell-{variant_id}-weapon", make_weapon_layer(body_boxes, palette, variant_id))

    update_manifest(source_hash)
    print(f"updated {MANIFEST_PATH}")
    print(f"sourceHash={source_hash}")


def write_sheet(sheet_id: str, image: Image.Image) -> None:
    image.save(ASSET_DIR / f"{sheet_id}.png")


if __name__ == "__main__":
    main()
