#!/usr/bin/env python3
"""Normalize generated landscape details into a runtime sprite sheet."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageEnhance

from asset_pipeline_utils import read_json, sha256_file, write_json
from detail_sheet_manifest import CELL, COLUMNS, DETAIL_SHEET, ROWS, SOURCE_COLUMNS, STATIC_FRAME_START
from detail_sheet_normalization import remove_detached_artifacts, remove_magenta_screen, sprite_boxes, trim_and_fit
from detail_sheet_tree_frames import draw_tree_frame
from pixel_art_primitives import ellipse, line, polygon, rect


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "assets" / "sprites" / "duskfell-details-source.png"
OUTPUT_PATH = ROOT / "assets" / "sprites" / "duskfell-details.png"
MANIFEST_PATH = ROOT / "assets" / "sprites" / "manifest.json"

def main() -> None:
    if not SOURCE_PATH.exists():
        raise SystemExit(f"missing generated detail source: {SOURCE_PATH}")

    source = remove_magenta_screen(Image.open(SOURCE_PATH).convert("RGBA"))
    atlas = Image.new("RGBA", (CELL * COLUMNS, CELL * ROWS), (0, 0, 0, 0))
    boxes = sprite_boxes(source, SOURCE_COLUMNS)

    for column, box in enumerate(boxes):
        frame = source.crop(box)
        frame = remove_detached_artifacts(frame)
        frame = trim_and_fit(frame, CELL)
        atlas.alpha_composite(frame, (column * CELL, 0))

    draw_static_frames(atlas)

    atlas = ImageEnhance.Contrast(atlas).enhance(1.04)
    atlas.save(OUTPUT_PATH)

    image_hash = sha256_file(OUTPUT_PATH)
    source_hash = sha256_file(SOURCE_PATH)
    update_manifest(image_hash, source_hash)
    print(f"wrote {OUTPUT_PATH}")
    print(f"updated {MANIFEST_PATH} duskfell-details imageSha256={image_hash}")


def draw_static_frames(atlas: Image.Image) -> None:
    for variant in range(4):
        draw_tree_frame(atlas, STATIC_FRAME_START + variant, "sapling", variant)
        draw_tree_frame(atlas, STATIC_FRAME_START + 4 + variant, "mature", variant)
        draw_tree_frame(atlas, STATIC_FRAME_START + 8 + variant, "ancient", variant)
    draw_boulder_frame(atlas, STATIC_FRAME_START + 12)
    draw_reeds_frame(atlas, STATIC_FRAME_START + 13)
    draw_ruin_frame(atlas, STATIC_FRAME_START + 14)


def draw_boulder_frame(atlas: Image.Image, frame: int) -> None:
    ox = frame * CELL
    polygon(atlas, [(ox + 13, 50), (ox + 20, 35), (ox + 34, 29), (ox + 50, 38), (ox + 55, 51), (ox + 35, 58)], (57, 61, 59, 255))
    polygon(atlas, [(ox + 20, 35), (ox + 34, 29), (ox + 43, 39), (ox + 28, 43)], (104, 105, 94, 255))
    polygon(atlas, [(ox + 43, 39), (ox + 55, 51), (ox + 35, 58), (ox + 36, 47)], (39, 44, 43, 255))
    polygon(atlas, [(ox + 14, 50), (ox + 28, 43), (ox + 35, 58)], (73, 74, 65, 255))
    line(atlas, ox + 27, 40, ox + 35, 55, (199, 184, 129, 135), width=1)
    line(atlas, ox + 39, 36, ox + 49, 48, (30, 33, 31, 140), width=1)


def draw_reeds_frame(atlas: Image.Image, frame: int) -> None:
    ox = frame * CELL
    for index, base_x in enumerate(range(18, 48, 5)):
        top_x = ox + base_x + ((index % 3) - 1) * 3
        top_y = 26 + (index % 2) * 4
        line(atlas, ox + base_x, 55, top_x, top_y, (54, 92, 57, 230), width=2)
        ellipse(atlas, top_x, top_y - 3, 2, 6, (121, 101, 58, 235))
    for base_x in range(16, 51, 7):
        line(atlas, ox + base_x, 56, ox + base_x - 4, 35, (75, 118, 72, 190), width=1)
        line(atlas, ox + base_x, 56, ox + base_x + 5, 38, (50, 86, 55, 170), width=1)


def draw_ruin_frame(atlas: Image.Image, frame: int) -> None:
    ox = frame * CELL
    rect(atlas, ox + 16, 42, 14, 12, (91, 88, 76, 255))
    rect(atlas, ox + 29, 35, 16, 19, (108, 105, 91, 255))
    rect(atlas, ox + 43, 44, 9, 10, (79, 78, 70, 255))
    rect(atlas, ox + 21, 53, 29, 5, (66, 65, 58, 255))
    rect(atlas, ox + 18, 40, 10, 3, (166, 155, 116, 110))
    line(atlas, ox + 16, 42, ox + 52, 54, (28, 29, 25, 120), width=1)
    line(atlas, ox + 30, 35, ox + 44, 54, (32, 33, 29, 130), width=1)


def update_manifest(image_hash: str, source_hash: str) -> None:
    manifest = read_json(MANIFEST_PATH)
    sheet = next((candidate for candidate in manifest["sheets"] if candidate["id"] == DETAIL_SHEET["id"]), None)
    if sheet is None:
        sheet = DETAIL_SHEET.copy()
        manifest["sheets"].insert(7, sheet)
    else:
        sheet.update({key: value for key, value in DETAIL_SHEET.items() if key not in {"provenance", "approval"}})
        sheet.setdefault("provenance", {}).update(DETAIL_SHEET["provenance"])
        sheet.setdefault("approval", {}).update(DETAIL_SHEET["approval"])
    sheet["imageSha256"] = image_hash
    sheet["provenance"]["sourceHash"] = source_hash
    write_json(MANIFEST_PATH, manifest)


if __name__ == "__main__":
    main()
