#!/usr/bin/env python3
"""Normalize an AI-assisted actor concept sheet into runtime sprite sheets."""

from __future__ import annotations

from PIL import Image, ImageEnhance

from actor_sheet_config import CELL, COLUMNS, MANIFEST_PATH, OUTPUT_PATH, ROWS, SOURCE_COLUMNS, SOURCE_PATH, SOURCE_ROWS, VARIANTS
from actor_sheet_manifest import update_actor_manifest
from actor_sheet_normalization import remove_detached_artifacts, remove_green_screen, trim_and_fit
from actor_sheet_variants import make_role_variant
from asset_pipeline_utils import sha256_file


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

    update_actor_manifest(base_hash, source_hash, variant_hashes)
    print(f"wrote {OUTPUT_PATH}")
    print(f"updated {MANIFEST_PATH} duskfell-wayfarer imageSha256={base_hash}")
    for sheet_id, digest in variant_hashes.items():
        print(f"updated {sheet_id} imageSha256={digest}")


if __name__ == "__main__":
    main()
