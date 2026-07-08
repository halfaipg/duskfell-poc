#!/usr/bin/env python3
"""Report walk-cycle motion quality for a transparent actor sprite sheet."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image


def main() -> None:
    args = parse_args()
    image = Image.open(args.image).convert("RGBA")
    expected_size = (args.cell * args.columns, args.cell * args.rows)
    if image.size != expected_size:
        raise SystemExit(
            f"{args.image} is {image.size[0]}x{image.size[1]}, expected {expected_size[0]}x{expected_size[1]}",
        )

    frames = []
    for row in range(args.rows):
        row_frames = []
        for column in range(args.columns):
            box = (
                column * args.cell,
                row * args.cell,
                (column + 1) * args.cell,
                (row + 1) * args.cell,
            )
            row_frames.append(analyze_frame(image.crop(box), args.alpha_threshold))
        frames.append(row_frames)

    report = analyze_rows(frames, args)
    output = json.dumps(report, indent=2)
    print(output)

    if args.fail_on_warning and report["warnings"]:
        raise SystemExit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--cell", type=int, default=128)
    parser.add_argument("--columns", type=int, default=8)
    parser.add_argument("--rows", type=int, default=4)
    parser.add_argument("--alpha-threshold", type=int, default=24)
    parser.add_argument("--min-pose-diff", type=float, default=0.028)
    parser.add_argument("--min-foot-spread-range", type=float, default=7.0)
    parser.add_argument("--max-baseline-jitter", type=float, default=7.5)
    parser.add_argument("--fail-on-warning", action="store_true")
    return parser.parse_args()


def analyze_frame(frame: Image.Image, alpha_threshold: int) -> dict[str, object]:
    width, height = frame.size
    alpha = frame.getchannel("A")
    pixels = alpha.load()
    xs: list[int] = []
    ys: list[int] = []
    mask: list[bool] = []
    for y in range(height):
        for x in range(width):
            occupied = pixels[x, y] > alpha_threshold
            mask.append(occupied)
            if occupied:
                xs.append(x)
                ys.append(y)

    if not xs:
        return {
            "empty": True,
            "bbox": None,
            "centerX": None,
            "centerY": None,
            "baselineY": None,
            "footSpread": 0,
            "mask": mask,
        }

    min_x = min(xs)
    max_x = max(xs)
    min_y = min(ys)
    max_y = max(ys)
    lower_cutoff = min_y + (max_y - min_y) * 0.68
    foot_xs = [x for x, y in zip(xs, ys) if y >= lower_cutoff]
    return {
        "empty": False,
        "bbox": [min_x, min_y, max_x + 1, max_y + 1],
        "centerX": sum(xs) / len(xs),
        "centerY": sum(ys) / len(ys),
        "baselineY": max_y,
        "footSpread": (max(foot_xs) - min(foot_xs)) if foot_xs else 0,
        "mask": mask,
    }


def analyze_rows(frames: list[list[dict[str, object]]], args: argparse.Namespace) -> dict[str, object]:
    rows = []
    warnings = []
    for row_index, row_frames in enumerate(frames):
        row = analyze_row(row_frames, row_index)
        rows.append(row)
        if row["emptyFrames"] > 0:
            warnings.append(f"row {row_index} has {row['emptyFrames']} empty frames")
        if row["meanPoseDiff"] < args.min_pose_diff:
            warnings.append(
                f"row {row_index} mean pose diff {row['meanPoseDiff']:.3f} below {args.min_pose_diff:.3f}",
            )
        if row["footSpreadRange"] < args.min_foot_spread_range:
            warnings.append(
                f"row {row_index} foot spread range {row['footSpreadRange']:.1f}px below {args.min_foot_spread_range:.1f}px",
            )
        if row["baselineJitter"] > args.max_baseline_jitter:
            warnings.append(
                f"row {row_index} baseline jitter {row['baselineJitter']:.1f}px above {args.max_baseline_jitter:.1f}px",
            )

    return {
        "image": str(args.image),
        "cell": args.cell,
        "columns": args.columns,
        "rows": rows,
        "thresholds": {
            "minPoseDiff": args.min_pose_diff,
            "minFootSpreadRange": args.min_foot_spread_range,
            "maxBaselineJitter": args.max_baseline_jitter,
        },
        "warnings": warnings,
        "ok": len(warnings) == 0,
    }


def analyze_row(row_frames: list[dict[str, object]], row_index: int) -> dict[str, object]:
    valid = [frame for frame in row_frames if not frame["empty"]]
    pose_diffs = [
        mask_diff(row_frames[index]["mask"], row_frames[(index + 1) % len(row_frames)]["mask"])
        for index in range(len(row_frames))
    ]
    foot_spreads = [float(frame["footSpread"]) for frame in valid]
    baselines = [float(frame["baselineY"]) for frame in valid if frame["baselineY"] is not None]
    centers = [float(frame["centerX"]) for frame in valid if frame["centerX"] is not None]
    return {
        "row": row_index,
        "emptyFrames": len(row_frames) - len(valid),
        "meanPoseDiff": mean(pose_diffs),
        "minPoseDiff": min(pose_diffs) if pose_diffs else 0,
        "footSpreadRange": value_range(foot_spreads),
        "centerXRange": value_range(centers),
        "baselineJitter": value_range(baselines),
        "frameSummaries": [
            {
                "bbox": frame["bbox"],
                "centerX": round(frame["centerX"], 2) if frame["centerX"] is not None else None,
                "baselineY": frame["baselineY"],
                "footSpread": frame["footSpread"],
            }
            for frame in row_frames
        ],
    }


def mask_diff(a: list[bool], b: list[bool]) -> float:
    if len(a) != len(b) or not a:
        return 0
    changes = sum(1 for left, right in zip(a, b) if left != right)
    occupied = sum(1 for value in a if value) + sum(1 for value in b if value)
    if occupied == 0:
        return 0
    return changes / occupied


def mean(values: list[float]) -> float:
    if not values:
        return 0
    return sum(values) / len(values)


def value_range(values: list[float]) -> float:
    if not values:
        return 0
    return max(values) - min(values)


if __name__ == "__main__":
    main()
