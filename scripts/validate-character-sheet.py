#!/usr/bin/env python3
"""Fail closed on structural defects in a Duskfell character review sheet."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("--alpha-threshold", type=int, default=24)
    parser.add_argument("--minimum-component-area", type=int, default=8)
    parser.add_argument("--minimum-mean-pose-diff", type=float, default=0.025)
    parser.add_argument("--minimum-foot-spread-range", type=float, default=6.0)
    parser.add_argument("--maximum-idle-height-range", type=float, default=24.0)
    parser.add_argument("--minimum-locomotion-height-ratio", type=float, default=0.82)
    parser.add_argument("--maximum-locomotion-width-to-height", type=float, default=0.78)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    metadata_path = args.metadata.resolve()
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    sheet_path = ROOT / metadata["sheet"]
    image = Image.open(sheet_path).convert("RGBA")
    columns = int(metadata["columns"])
    rows = len(metadata["directions"])
    width = int(metadata["cell"]["width"])
    height = int(metadata["cell"]["height"])
    idle_count = int(metadata["idleFrames"])
    walk_count = int(metadata["walkFrames"])
    failures = []

    expected_size = (columns * width, rows * height)
    if image.size != expected_size:
        failures.append(f"sheet is {image.size}, expected {expected_size}")
    if idle_count + walk_count != columns:
        failures.append("idleFrames + walkFrames does not equal columns")
    actual_sha = sha256(sheet_path)
    if actual_sha != metadata.get("sheetSha256"):
        failures.append("sheet SHA-256 does not match metadata")

    frames = []
    border_contacts = []
    disconnected = []
    empty = []
    for row in range(rows):
        row_frames = []
        for column in range(columns):
            frame = image.crop(
                (column * width, row * height, (column + 1) * width, (row + 1) * height),
            )
            analysis = analyze_frame(
                frame,
                args.alpha_threshold,
                args.minimum_component_area,
            )
            row_frames.append(analysis)
            label = f"row {row} column {column}"
            if analysis["empty"]:
                empty.append(label)
            if analysis["touchesBorder"]:
                border_contacts.append(label)
            if analysis["componentCount"] > 1:
                disconnected.append(f"{label} has {analysis['componentCount']} components")
        frames.append(row_frames)

    if empty:
        failures.append(f"empty frames: {', '.join(empty[:8])}")
    if border_contacts:
        failures.append(f"alpha touches a cell border: {', '.join(border_contacts[:8])}")
    if disconnected:
        failures.append(f"disconnected subject pixels: {', '.join(disconnected[:8])}")

    rows_report = []
    idle_heights = []
    for row, row_frames in enumerate(frames):
        idle = row_frames[:idle_count]
        walk = row_frames[idle_count:]
        idle_height = median([frame["height"] for frame in idle if not frame["empty"]])
        idle_heights.append(idle_height)
        pose_diffs = [
            mask_diff(walk[index]["mask"], walk[(index + 1) % len(walk)]["mask"])
            for index in range(len(walk))
        ]
        foot_spreads = [frame["footSpread"] for frame in walk if not frame["empty"]]
        walk_heights = [frame["height"] for frame in walk if not frame["empty"]]
        walk_widths = [frame["width"] for frame in walk if not frame["empty"]]
        idle_width = median([frame["width"] for frame in idle if not frame["empty"]])
        mean_pose_diff = mean(pose_diffs)
        foot_spread_range = value_range(foot_spreads)
        minimum_height_ratio = min(walk_heights) / idle_height if idle_height else 0.0
        maximum_width_ratio = max(walk_widths) / idle_width if idle_width else 0.0
        maximum_width_to_height = max(walk_widths) / idle_height if idle_height else 0.0
        if mean_pose_diff < args.minimum_mean_pose_diff:
            failures.append(
                f"row {row} mean locomotion pose diff {mean_pose_diff:.3f} is below "
                f"{args.minimum_mean_pose_diff:.3f}",
            )
        if foot_spread_range < args.minimum_foot_spread_range:
            failures.append(
                f"row {row} foot-spread range {foot_spread_range:.1f}px is below "
                f"{args.minimum_foot_spread_range:.1f}px",
            )
        if minimum_height_ratio < args.minimum_locomotion_height_ratio:
            failures.append(
                f"row {row} minimum locomotion height ratio {minimum_height_ratio:.3f} is below "
                f"{args.minimum_locomotion_height_ratio:.3f}",
            )
        if maximum_width_to_height > args.maximum_locomotion_width_to_height:
            failures.append(
                f"row {row} maximum locomotion width-to-height {maximum_width_to_height:.3f} "
                f"exceeds {args.maximum_locomotion_width_to_height:.3f}",
            )
        rows_report.append(
            {
                "row": row,
                "direction": metadata["directions"][row],
                "idleHeight": idle_height,
                "meanLocomotionPoseDiff": round(mean_pose_diff, 4),
                "footSpreadRange": round(foot_spread_range, 2),
                "minimumLocomotionHeightRatio": round(minimum_height_ratio, 4),
                "maximumLocomotionWidthRatio": round(maximum_width_ratio, 4),
                "maximumLocomotionWidthToHeight": round(maximum_width_to_height, 4),
                "baselineRange": round(
                    value_range([frame["baseline"] for frame in walk if not frame["empty"]]),
                    2,
                ),
            },
        )

    idle_height_range = value_range(idle_heights)
    if idle_height_range > args.maximum_idle_height_range:
        failures.append(
            f"idle height range across directions {idle_height_range:.1f}px exceeds "
            f"{args.maximum_idle_height_range:.1f}px",
        )

    report = {
        "schemaVersion": "duskfell-character-sheet-validation-v1",
        "ok": not failures,
        "metadata": str(metadata_path),
        "sheet": str(sheet_path),
        "sheetSha256": actual_sha,
        "layout": {"columns": columns, "rows": rows, "cellWidth": width, "cellHeight": height},
        "anchor": metadata.get("anchor"),
        "idleHeightRange": round(idle_height_range, 2),
        "rows": rows_report,
        "failures": failures,
    }
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


def analyze_frame(frame: Image.Image, threshold: int, minimum_component_area: int) -> dict[str, object]:
    width, height = frame.size
    alpha = frame.getchannel("A")
    pixels = alpha.load()
    mask = [pixels[x, y] > threshold for y in range(height) for x in range(width)]
    occupied = [(x, y) for y in range(height) for x in range(width) if pixels[x, y] > threshold]
    if not occupied:
        return {
            "empty": True,
            "mask": mask,
            "height": 0,
            "width": 0,
            "baseline": 0,
            "footSpread": 0,
            "touchesBorder": False,
            "componentCount": 0,
        }
    xs = [point[0] for point in occupied]
    ys = [point[1] for point in occupied]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    lower_cutoff = min_y + (max_y - min_y) * 0.68
    foot_xs = [x for x, y in occupied if y >= lower_cutoff]
    return {
        "empty": False,
        "mask": mask,
        "height": max_y - min_y + 1,
        "width": max_x - min_x + 1,
        "baseline": max_y,
        "footSpread": max(foot_xs) - min(foot_xs) if foot_xs else 0,
        "touchesBorder": min_x == 0 or min_y == 0 or max_x == width - 1 or max_y == height - 1,
        "componentCount": component_count(alpha, threshold, minimum_component_area),
    }


def component_count(alpha, threshold: int, minimum_area: int) -> int:
    width, height = alpha.size
    pixels = alpha.load()
    seen = set()
    count = 0
    for y in range(height):
        for x in range(width):
            if pixels[x, y] <= threshold or (x, y) in seen:
                continue
            queue = deque([(x, y)])
            seen.add((x, y))
            area = 0
            while queue:
                current_x, current_y = queue.popleft()
                area += 1
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if (
                        0 <= next_x < width
                        and 0 <= next_y < height
                        and pixels[next_x, next_y] > threshold
                        and (next_x, next_y) not in seen
                    ):
                        seen.add((next_x, next_y))
                        queue.append((next_x, next_y))
            if area >= minimum_area:
                count += 1
    return count


def mask_diff(left: list[bool], right: list[bool]) -> float:
    changes = sum(a != b for a, b in zip(left, right))
    occupied = sum(left) + sum(right)
    return changes / occupied if occupied else 0.0


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def median(values: list[float]) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def value_range(values: list[float]) -> float:
    return max(values) - min(values) if values else 0.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
