"""Extract and validate a controlled img2img tree-family finishing board."""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from asset_pipeline_utils import sha256_file, source_hash, write_json


CELL = 192
ANCHOR = (96, 176)
TREE_FRAME_START = 8
STAGES = ("sapling", "mature", "ancient")
SILHOUETTE_ALPHA = 24


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    board = Image.open(args.board).convert("RGBA")
    structure = json.loads(args.structure_manifest.read_text(encoding="utf-8"))
    request = json.loads(args.request.read_text(encoding="utf-8"))
    if len(structure.get("frames", [])) != 12:
        raise SystemExit("structure manifest must declare exactly twelve frames")

    row_cuts = board_row_cuts(board)
    source_canvas = max(board.width / 4, board.height / 3)
    frames = []
    for index, item in enumerate(structure["frames"]):
        cell = board_cell(board, index, row_cuts)
        normalized = normalize_cell(cell, source_canvas)
        path = output_dir / f"finished-tree-{item['stage']}-{item['variant']:02d}.png"
        normalized.save(path, optimize=True)
        frames.append({**item, "path": path.name, "sha256": sha256_file(path), "metrics": frame_metrics(normalized)})

    validation = validate_frames(frames)
    if validation["errors"]:
        raise SystemExit("finished tree board failed validation: " + "; ".join(validation["errors"]))

    strip_path = output_dir / "tree-family-finished-strip-v1.png"
    strip = Image.new("RGBA", (CELL * 12, CELL), (0, 0, 0, 0))
    for index, item in enumerate(frames):
        strip.alpha_composite(Image.open(output_dir / item["path"]).convert("RGBA"), (index * CELL, 0))
    strip.save(strip_path, optimize=True)

    detail_sheet_path = output_dir / "duskfell-details-blender-img2img-v1.png"
    detail_sheet = Image.open(args.base_sheet).convert("RGBA")
    if detail_sheet.size != (CELL * 31, CELL):
        raise SystemExit(f"base detail sheet must be {CELL * 31}x{CELL}, got {detail_sheet.size}")
    for index, item in enumerate(frames):
        detail_sheet.paste(Image.open(output_dir / item["path"]).convert("RGBA"), ((TREE_FRAME_START + index) * CELL, 0))
    detail_sheet.save(detail_sheet_path, optimize=True)

    review_path = output_dir / "tree-family-finished-review-v1.png"
    review_board(frames, output_dir).save(review_path, optimize=True)
    write_json(
        output_dir / "finished-candidate-manifest.json",
        {
            "schemaVersion": "duskfell-finished-tree-candidate-v1",
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
            "validation": validation,
            "extraction": {
                "rowCuts": list(row_cuts),
                "sourceCanvas": round(source_canvas, 3),
                "visibleAlphaThreshold": SILHOUETTE_ALPHA,
            },
            "frames": frames,
            "artifacts": {
                "sourceBoard": {"path": args.board.name, "sha256": sha256_file(args.board)},
                "strip": {"path": strip_path.name, "sha256": sha256_file(strip_path)},
                "detailSheet": {"path": detail_sheet_path.name, "sha256": sha256_file(detail_sheet_path)},
                "reviewBoard": {"path": review_path.name, "sha256": sha256_file(review_path)},
            },
            "provenance": {
                "cleanRoom": True,
                "structureManifestSha256": sha256_file(args.structure_manifest),
                "requestSha256": sha256_file(args.request),
                "model": request.get("model"),
                "method": "Blender structure plus controlled OpenAI img2img finishing and local chroma removal",
                "sourceHash": source_hash(Path(__file__), args.structure_manifest, args.request, args.board),
                "externalAssets": [],
                "geometryAuthority": "Blender structure manifest",
                "finishingAuthority": "none; review-only visual candidate",
            },
        },
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--board", type=Path, required=True)
    parser.add_argument("--structure-manifest", type=Path, required=True)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-sheet", type=Path, required=True)
    return parser.parse_args()


def board_row_cuts(board: Image.Image) -> tuple[int, int]:
    """Find transparent valleys between the three generated lifecycle rows."""
    alpha = board.getchannel("A")
    counts = []
    for y in range(board.height):
        row = alpha.crop((0, y, board.width, y + 1))
        counts.append(sum(value >= SILHOUETTE_ALPHA for value in row.getdata()))

    first = transparent_valley_center(counts, round(board.height * 0.22), round(board.height * 0.43))
    second = transparent_valley_center(counts, round(board.height * 0.54), round(board.height * 0.78))
    if not 0 < first < second < board.height:
        raise SystemExit(f"could not separate tree-board rows: {first}, {second}")
    return first, second


def transparent_valley_center(counts: list[int], start: int, stop: int) -> int:
    runs = []
    run_start = None
    for y in range(start, stop):
        if counts[y] == 0 and run_start is None:
            run_start = y
        elif counts[y] != 0 and run_start is not None:
            runs.append((run_start, y))
            run_start = None
    if run_start is not None:
        runs.append((run_start, stop))
    if runs:
        left, right = max(runs, key=lambda run: (run[1] - run[0], -run[0]))
        return (left + right) // 2
    return min(range(start, stop), key=lambda y: (counts[y], abs(y - (start + stop) / 2)))


def board_cell(board: Image.Image, index: int, row_cuts: tuple[int, int]) -> Image.Image:
    col = index % 4
    row = index // 4
    left = round(board.width * col / 4)
    right = round(board.width * (col + 1) / 4)
    rows = (0, row_cuts[0], row_cuts[1], board.height)
    top = rows[row]
    bottom = rows[row + 1]
    return board.crop((left, top, right, bottom))


def normalize_cell(cell: Image.Image, source_canvas: float) -> Image.Image:
    source_bbox = visible_bbox(cell)
    if not source_bbox:
        raise SystemExit("finished board cell contains no visible pixels")
    subject = cell.crop(source_bbox)
    scale = CELL / source_canvas
    size = (
        max(1, round(subject.width * scale)),
        max(1, round(subject.height * scale)),
    )
    resized = subject.resize(size, Image.Resampling.LANCZOS)
    bbox = visible_bbox(resized)
    if not bbox:
        raise SystemExit("finished board cell contains no visible pixels")
    dx = round(ANCHOR[0] - (bbox[0] + bbox[2]) / 2)
    dy = round(ANCHOR[1] - bbox[3])
    aligned = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    aligned.alpha_composite(resized, (dx, dy))
    return pixel_finish(aligned)


def pixel_finish(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    rgb = image.convert("RGB").quantize(colors=160, method=Image.Quantize.MEDIANCUT).convert("RGB")
    result = rgb.convert("RGBA")
    result.putalpha(alpha.point(lambda value: 0 if value < SILHOUETTE_ALPHA else value))
    return result


def visible_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Ignore low-alpha chroma-removal residue when registering silhouettes."""
    alpha = image.getchannel("A")
    visible = alpha.point(lambda value: 255 if value >= SILHOUETTE_ALPHA else 0)
    return visible.getbbox()


def frame_metrics(image: Image.Image) -> dict:
    alpha = image.getchannel("A")
    bbox = visible_bbox(image)
    assert bbox is not None
    opaque = sum(1 for value in alpha.getdata() if value >= 96)
    touches_border = bbox[0] <= 0 or bbox[1] <= 0 or bbox[2] >= CELL or bbox[3] >= CELL
    return {
        "bbox": list(bbox),
        "width": bbox[2] - bbox[0],
        "height": bbox[3] - bbox[1],
        "centerX": round((bbox[0] + bbox[2]) / 2, 3),
        "bottom": bbox[3],
        "opaqueCoverage": round(opaque / (CELL * CELL), 5),
        "touchesBorder": touches_border,
    }


def validate_frames(frames: list[dict]) -> dict:
    errors = []
    for item in frames:
        metrics = item["metrics"]
        if metrics["touchesBorder"]:
            errors.append(f"{item['stage']}:{item['variant']} touches a cell border")
        if not 0.003 <= metrics["opaqueCoverage"] <= 0.42:
            errors.append(f"{item['stage']}:{item['variant']} has implausible alpha coverage")
        if abs(metrics["centerX"] - ANCHOR[0]) > 1:
            errors.append(f"{item['stage']}:{item['variant']} is not centered on the anchor")
        if metrics["bottom"] != ANCHOR[1]:
            errors.append(f"{item['stage']}:{item['variant']} does not share the foot anchor")
    stage_heights = {
        stage: [item["metrics"]["height"] for item in frames if item["stage"] == stage]
        for stage in STAGES
    }
    medians = {stage: statistics.median(values) for stage, values in stage_heights.items()}
    if not medians["sapling"] < medians["mature"] < medians["ancient"]:
        errors.append("stage median heights are not strictly increasing")
    for stage, values in stage_heights.items():
        if max(values) - min(values) > medians[stage] * 0.34:
            errors.append(f"{stage} height variance exceeds 34 percent")
    return {
        "ok": not errors,
        "errors": errors,
        "stageMedianHeights": medians,
        "maxWithinStageVariance": 0.34,
        "anchor": {"x": ANCHOR[0], "y": ANCHOR[1]},
    }


def review_board(frames: list[dict], output_dir: Path) -> Image.Image:
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
        checker(draw, x, y)
        frame = Image.open(output_dir / item["path"]).convert("RGBA")
        board.paste(frame, (x, y), frame)
        draw.text((x + 8, y + CELL + 8), f"{item['stage']} / {item['species']}", font=font, fill=(224, 220, 204))
    return board


def checker(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    size = 16
    colors = ((50, 52, 48), (63, 65, 59))
    for py in range(y, y + CELL, size):
        for px in range(x, x + CELL, size):
            draw.rectangle((px, py, px + size, py + size), fill=colors[((px - x) // size + (py - y) // size) % 2])


if __name__ == "__main__":
    main()
