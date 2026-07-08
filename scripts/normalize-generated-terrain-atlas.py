#!/usr/bin/env python3
"""Build the clean-room runtime terrain atlas."""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageEnhance

from asset_pipeline_utils import read_json, sha256_file, source_hash as asset_source_hash, write_json
from terrain_atlas_materials import (
    ATLAS_ROWS,
    CELL,
    CORNER_MASKS,
    EDGE_MASKS,
    MATERIAL_PALETTES,
    MATERIAL_SOURCE_ALIASES,
    MATERIAL_SOURCE_COLUMNS,
    MATERIALS,
    PAIR_TRANSITIONS,
    SOURCE_COLUMNS,
    SOURCE_MATERIALS,
)
from terrain_atlas_material_details import (
    paint_block_noise,
    paint_material_marks,
    paint_slope_striations,
    paint_transition_scatter,
)
from terrain_atlas_manifest import terrain_tiles
from terrain_atlas_pair_transitions import pair_family, paint_pair_transition_details, paint_source_pair_blend
from terrain_atlas_transition_masks import directional_transition_variant


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "assets" / "terrain" / "terrain-placeholder.png"
MANIFEST_PATH = ROOT / "assets" / "terrain" / "manifest.json"

SOURCE_PATH = ROOT / "assets" / "terrain" / "terrain-generated-source.png"


def main() -> None:
    source_image = load_source_image()
    atlas = Image.new("RGBA", (CELL * len(MATERIALS), CELL * ATLAS_ROWS), (0, 0, 0, 255))
    for material_index, material in enumerate(MATERIALS):
        for row, variant in enumerate(("flat", "slope", "transition")):
            tile = paint_material_tile(material, variant, material_index * 101 + row * 37, source_image)
            atlas.alpha_composite(tile, (material_index * CELL, row * CELL))

    for material_index, material in enumerate(MATERIALS):
        generic = atlas.crop((material_index * CELL, 2 * CELL, (material_index + 1) * CELL, 3 * CELL))
        for edge_index, edge in enumerate(EDGE_MASKS):
            variant = directional_transition_variant(generic, edge=edge)
            atlas.alpha_composite(variant, (material_index * CELL, (3 + edge_index) * CELL))
        for corner_index, corner in enumerate(CORNER_MASKS):
            variant = directional_transition_variant(generic, corner=corner)
            atlas.alpha_composite(variant, (material_index * CELL, (7 + corner_index) * CELL))

    for pair_index, (from_material, to_material) in enumerate(PAIR_TRANSITIONS):
        pair_tile = paint_pair_transition_tile(from_material, to_material, 900 + pair_index * 41, source_image)
        atlas.alpha_composite(pair_tile, (pair_index * CELL, 11 * CELL))

    atlas.save(OUTPUT_PATH)
    digest = sha256_file(OUTPUT_PATH)
    source_digest = asset_source_hash(Path(__file__), SOURCE_PATH)
    manifest = read_json(MANIFEST_PATH)
    manifest["tileSheet"]["columns"] = SOURCE_COLUMNS
    manifest["tileSheet"]["rows"] = ATLAS_ROWS
    manifest["tileSheet"]["frameCount"] = SOURCE_COLUMNS * ATLAS_ROWS
    manifest["tileSheet"]["sha256"] = digest
    manifest["tiles"] = terrain_tiles()
    provenance = manifest.setdefault("provenance", {})
    provenance["source"] = "AI-assisted clean-room source texture sheet normalized by scripts/normalize-generated-terrain-atlas.py"
    provenance["prompt"] = "original clean-room military-plan-oblique fantasy MMO terrain texture source sheet with lush grass, trampled field grass, dirt path, rocky ground, shallow water, worn stone plaza, cobble, ruin masonry, shore bank, slopes, and edge transition variants"
    provenance["method"] = "ai-assisted-source-plus-deterministic-local-normalization"
    provenance["tool"] = "OpenAI built-in image generation plus Pillow local image processing"
    provenance["toolVersion"] = "Pillow 2026-07-07 runtime"
    provenance["sourceHash"] = source_digest
    if SOURCE_PATH.exists():
        provenance["sourceImageHash"] = sha256_file(SOURCE_PATH)
    provenance["termsSnapshot"] = "OpenAI service terms reviewed 2026-07-07 for source concept; local deterministic terrain generation adds no external source"
    write_json(MANIFEST_PATH, manifest)
    print(f"wrote {OUTPUT_PATH}")
    print(f"updated {MANIFEST_PATH} tileSheet.sha256={digest}")
    print(f"updated {MANIFEST_PATH} provenance.sourceHash={source_digest}")


def load_source_image() -> Image.Image | None:
    if not SOURCE_PATH.exists():
        return None
    return Image.open(SOURCE_PATH).convert("RGBA")


def paint_material_tile(material: str, variant: str, seed: int, source_image: Image.Image | None = None) -> Image.Image:
    palette = MATERIAL_PALETTES[material]
    rng = random.Random(seed)
    if source_image is not None:
        image = source_material_tile(source_image, material, variant, rng)
    else:
        image = Image.new("RGBA", (CELL, CELL), (*palette["base"], 255))
        paint_block_noise(image, palette, rng, variant)

    paint_material_marks(image, material, palette, rng, variant)

    if variant == "slope":
        paint_slope_striations(image, palette, rng, material)
    elif variant == "transition":
        paint_transition_scatter(image, palette, rng, material)
    return image


def source_material_tile(source: Image.Image, material: str, variant: str, rng: random.Random) -> Image.Image:
    source_material = MATERIAL_SOURCE_ALIASES.get(material, material)
    column = MATERIAL_SOURCE_COLUMNS[source_material]
    column_width = max(1, source.width // len(SOURCE_MATERIALS))
    x0 = column * column_width
    x1 = source.width if column == len(SOURCE_MATERIALS) - 1 else (column + 1) * column_width
    crop_size = min(source.height, x1 - x0, 256)
    inset = max(0, crop_size // 16)
    max_x = max(x0, x1 - crop_size - inset)
    max_y = max(0, source.height - crop_size - inset)
    crop_x = rng.randint(x0 + inset, max_x) if max_x > x0 + inset else x0
    crop_y = rng.randint(inset, max_y) if max_y > inset else 0
    patch = source.crop((crop_x, crop_y, crop_x + crop_size, crop_y + crop_size))
    patch = patch.resize((CELL, CELL), Image.Resampling.LANCZOS)
    patch = ImageEnhance.Color(patch).enhance(0.9 if material in {"grass", "field"} else 0.86)
    patch = ImageEnhance.Contrast(patch).enhance(1.12 if material != "water" else 1.04)
    patch = ImageEnhance.Brightness(patch).enhance(0.92 if material in {"stone", "settlement"} else 0.96)
    return patch.convert("RGBA")


def paint_pair_transition_tile(
    from_material: str,
    to_material: str,
    seed: int,
    source_image: Image.Image | None = None,
) -> Image.Image:
    rng = random.Random(seed)
    base = paint_material_tile(to_material, "transition", seed + 7, source_image)
    from_palette = MATERIAL_PALETTES[from_material]
    to_palette = MATERIAL_PALETTES[to_material]
    family = pair_family(from_material, to_material)
    if source_image is not None:
        from_tile = source_material_tile(source_image, from_material, "transition", random.Random(seed + 13))
        paint_source_pair_blend(base, from_tile, family, rng)

    paint_pair_transition_details(base, family, from_palette, to_palette, rng)
    return base


if __name__ == "__main__":
    main()
