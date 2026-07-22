"""Normalize Blender tree renders into review and runtime-compatible sheets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from asset_pipeline_utils import sha256_file, source_hash, write_json


CELL = 192
ANCHOR = (96, 176)
TREE_FRAME_START = 8
STAGES = ("sapling", "mature", "ancient")


def main() -> None:
    args = parse_args()
    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    structure = json.loads((source_dir / "structure-manifest.json").read_text(encoding="utf-8"))
    normalized_dir = output_dir / "structure-frames"
    normalized_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for item in structure["frames"]:
        source = Image.open(source_dir / item["path"]).convert("RGBA")
        normalized = normalize_frame(source)
        frame_path = normalized_dir / Path(item["path"]).name
        normalized.save(frame_path, optimize=True)
        frames.append(
            {
                **item,
                "normalizedPath": frame_path.relative_to(output_dir).as_posix(),
                "sha256": sha256_file(frame_path),
            }
        )

    strip_path = output_dir / "tree-family-strip-v1.png"
    strip = Image.new("RGBA", (CELL * len(frames), CELL), (0, 0, 0, 0))
    for index, item in enumerate(frames):
        strip.alpha_composite(Image.open(output_dir / item["normalizedPath"]).convert("RGBA"), (index * CELL, 0))
    strip.save(strip_path, optimize=True)

    detail_sheet_path = output_dir / "duskfell-details-blender-tree-v1.png"
    detail_sheet = Image.open(args.base_sheet).convert("RGBA")
    if detail_sheet.size != (CELL * 31, CELL):
        raise SystemExit(f"base detail sheet must be {CELL * 31}x{CELL}, got {detail_sheet.size}")
    for index, item in enumerate(frames):
        detail_sheet.paste(
            Image.open(output_dir / item["normalizedPath"]).convert("RGBA"),
            ((TREE_FRAME_START + index) * CELL, 0),
        )
    detail_sheet.save(detail_sheet_path, optimize=True)

    board_path = output_dir / "tree-family-review-board-v1.png"
    build_review_board(frames, output_dir).save(board_path, optimize=True)

    write_json(
        output_dir / "candidate-manifest.json",
        {
            "schemaVersion": "duskfell-blender-tree-candidate-v1",
            "approval": {"state": "review"},
            "projection": "military-plan-oblique",
            "cell": {"width": CELL, "height": CELL, "anchor": {"x": ANCHOR[0], "y": ANCHOR[1]}},
            "runtimeMapping": {
                "sheet": detail_sheet_path.name,
                "treeFrames": {
                    "sapling": [8, 9, 10, 11],
                    "mature": [12, 13, 14, 15],
                    "ancient": [16, 17, 18, 19],
                },
            },
            "artifacts": {
                "strip": {"path": strip_path.name, "sha256": sha256_file(strip_path)},
                "detailSheet": {"path": detail_sheet_path.name, "sha256": sha256_file(detail_sheet_path)},
                "reviewBoard": {"path": board_path.name, "sha256": sha256_file(board_path)},
            },
            "frames": frames,
            "provenance": {
                "cleanRoom": True,
                "method": "deterministic Blender structure render plus local anchor normalization",
                "seed": structure["seed"],
                "camera": structure["camera"],
                "sourceHash": source_hash(
                    Path(__file__),
                    Path(__file__).with_name("blender-duskfell-tree-family.py"),
                    source_dir / "structure-manifest.json",
                ),
                "externalAssets": [],
                "img2img": None,
                "note": "Blender owns silhouette and registration. Any later img2img candidate must preserve alpha, anchor, stage scale, and frame identity.",
            },
        },
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-sheet", type=Path, required=True)
    return parser.parse_args()


def normalize_frame(source: Image.Image) -> Image.Image:
    resized = source.resize((CELL, CELL), Image.Resampling.LANCZOS)
    alpha = resized.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        raise SystemExit("Blender frame has no visible pixels")
    center_x = (bbox[0] + bbox[2]) / 2
    bottom = bbox[3]
    dx = round(ANCHOR[0] - center_x)
    dy = round(ANCHOR[1] - bottom)
    aligned = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    aligned.alpha_composite(resized, (dx, dy))
    return pixel_finish(aligned)


def pixel_finish(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    rgb = image.convert("RGB").quantize(colors=96, method=Image.Quantize.MEDIANCUT).convert("RGB")
    finished = rgb.convert("RGBA")
    finished.putalpha(alpha.point(lambda value: 0 if value < 8 else value))
    return finished


def build_review_board(frames: list[dict], output_dir: Path) -> Image.Image:
    margin = 28
    label_h = 34
    board = Image.new("RGB", (margin * 2 + CELL * 4, margin * 2 + (CELL + label_h) * 3), (24, 25, 23))
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default(size=16)
    for index, item in enumerate(frames):
        col = index % 4
        row = index // 4
        x = margin + col * CELL
        y = margin + row * (CELL + label_h)
        checker(draw, x, y, CELL, CELL)
        frame = Image.open(output_dir / item["normalizedPath"]).convert("RGBA")
        board.paste(frame, (x, y), frame)
        label = f"{item['stage']} / {item['species']}"
        draw.text((x + 8, y + CELL + 8), label, font=font, fill=(224, 220, 204))
    return board


def checker(draw: ImageDraw.ImageDraw, x: int, y: int, width: int, height: int) -> None:
    size = 16
    colors = ((50, 52, 48), (63, 65, 59))
    for py in range(y, y + height, size):
        for px in range(x, x + width, size):
            draw.rectangle((px, py, min(x + width, px + size), min(y + height, py + size)), fill=colors[((px - x) // size + (py - y) // size) % 2])


if __name__ == "__main__":
    main()
