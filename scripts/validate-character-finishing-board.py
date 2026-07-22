#!/usr/bin/env python3
"""Validate and normalize a controlled 8x4 character img2img finishing proof."""

from __future__ import annotations

import argparse
import json
import math
from collections import deque
from pathlib import Path

from PIL import Image

from asset_pipeline_utils import sha256_file, source_hash, write_json


ROOT = Path(__file__).resolve().parents[1]
ALPHA_THRESHOLD = 24
MINIMUM_COMPONENT_AREA = 32
MINIMUM_IOU = 0.46
MAXIMUM_CENTER_DRIFT = 10.0
MAXIMUM_BASELINE_DRIFT = 10
MAXIMUM_REGISTRATION_SHIFT = 18
MINIMUM_SCALE_RATIO = 0.84
MAXIMUM_SCALE_RATIO = 1.18


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    base = ROOT / "assets/sprites/candidates/blender-locomotion-v2/finishing-proof-v1"
    parser.add_argument("--control", type=Path, default=base / "control-manifest.json")
    parser.add_argument("--request", type=Path, default=base / "img2img-request.json")
    parser.add_argument(
        "--board",
        type=Path,
        default=base / "character-finishing-openai-v1-alpha-contracted.png",
    )
    parser.add_argument(
        "--raw-board",
        type=Path,
        default=base / "character-finishing-openai-v1.png",
    )
    parser.add_argument("--output-dir", type=Path, default=base)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    control_path = args.control.resolve()
    request_path = args.request.resolve()
    board_path = args.board.resolve()
    raw_board_path = args.raw_board.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    control = json.loads(control_path.read_text(encoding="utf-8"))
    request = json.loads(request_path.read_text(encoding="utf-8"))
    source_board_path = control_path.parent / control["board"]["path"]
    source_sheet_path = ROOT / control["source"]["sheet"]
    errors = []

    verify_hash(source_board_path, control["board"]["sha256"], "control board", errors)
    verify_hash(source_sheet_path, control["source"]["sheetSha256"], "source sheet", errors)
    verify_hash(source_board_path, request["inputSha256"], "request input", errors)
    if not raw_board_path.is_file():
        errors.append(f"raw generated board is missing: {raw_board_path}")

    source_board = Image.open(source_board_path).convert("RGB")
    finished_board = Image.open(board_path).convert("RGBA")
    columns = int(control["board"]["columns"])
    rows = int(control["board"]["rows"])
    cell_width = int(control["board"]["cell"]["width"])
    cell_height = int(control["board"]["cell"]["height"])
    expected_size = (columns * cell_width, rows * cell_height)
    if source_board.size != expected_size:
        errors.append(f"control board is {source_board.size}, expected {expected_size}")
    if finished_board.size != expected_size:
        errors.append(f"finished board is {finished_board.size}, expected {expected_size}")

    normalized = Image.new("RGBA", (columns * 128, rows * 160), (0, 0, 0, 0))
    frames = []
    for item in control["frames"]:
        row = int(item["boardRow"])
        column = int(item["boardColumn"])
        box = (
            column * cell_width,
            row * cell_height,
            (column + 1) * cell_width,
            (row + 1) * cell_height,
        )
        source_cell = source_board.crop(box)
        output_cell = finished_board.crop(box)
        source_mask = source_chroma_mask(source_cell)
        raw_output_mask = alpha_mask(output_cell)
        source_metrics = mask_metrics(source_mask, cell_width, cell_height)
        raw_output_metrics = mask_metrics(raw_output_mask, cell_width, cell_height)
        correction_x = round(source_metrics["centerX"] - raw_output_metrics["centerX"])
        correction_y = source_metrics["baseline"] - raw_output_metrics["baseline"]
        registered_cell = translate(output_cell, correction_x, correction_y)
        registered_mask = alpha_mask(registered_cell)
        registered_metrics = mask_metrics(registered_mask, cell_width, cell_height)
        label = f"{item['pose']}:{item['direction']}"
        frame_errors = validate_frame(
            label,
            source_metrics,
            raw_output_metrics,
            registered_metrics,
            source_mask,
            registered_mask,
            correction_x,
            correction_y,
        )
        errors.extend(frame_errors)
        frames.append(
            {
                **item,
                "source": source_metrics,
                "rawFinished": raw_output_metrics,
                "registration": {"translateX": correction_x, "translateY": correction_y},
                "finished": registered_metrics,
                "silhouetteIou": round(mask_iou(source_mask, registered_mask), 4),
                "errors": frame_errors,
            },
        )
        # The control board maps a 128x160 source frame to 192x240 at y=8.
        # Inverting that exact transform preserves every original frame anchor.
        restored = registered_cell.crop((0, 8, cell_width, 248)).resize(
            (128, 160),
            Image.Resampling.LANCZOS,
        )
        normalized.alpha_composite(restored, (column * 128, row * 160))

    normalized_path = output_dir / "character-finishing-openai-v1-8x4.png"
    normalized.save(normalized_path, optimize=True)
    manifest = {
        "schemaVersion": "duskfell-character-finishing-proof-v1",
        "approval": {"state": "review" if not errors else "rejected"},
        "projection": "military-plan-oblique",
        "validation": {
            "ok": not errors,
            "errors": errors,
            "thresholds": {
                "alpha": ALPHA_THRESHOLD,
                "minimumComponentArea": MINIMUM_COMPONENT_AREA,
                "minimumSilhouetteIou": MINIMUM_IOU,
                "maximumCenterDrift": MAXIMUM_CENTER_DRIFT,
                "maximumBaselineDrift": MAXIMUM_BASELINE_DRIFT,
                "maximumRegistrationShift": MAXIMUM_REGISTRATION_SHIFT,
                "scaleRatio": [MINIMUM_SCALE_RATIO, MAXIMUM_SCALE_RATIO],
            },
        },
        "frames": frames,
        "artifacts": {
            "control": {"path": source_board_path.name, "sha256": sha256_file(source_board_path)},
            "rawGenerated": {
                "path": raw_board_path.name,
                "sha256": sha256_file(raw_board_path) if raw_board_path.is_file() else None,
            },
            "matte": {"path": board_path.name, "sha256": sha256_file(board_path)},
            "normalized": {"path": normalized_path.name, "sha256": sha256_file(normalized_path)},
        },
        "provenance": {
            "cleanRoom": True,
            "model": request.get("model"),
            "method": "Blender structure plus controlled OpenAI img2img surface finishing",
            "geometryAuthority": control["source"]["metadata"],
            "animationAuthority": "Blender source frame mapping in control manifest",
            "finishingAuthority": "none; proof remains review-only",
            "controlManifestSha256": sha256_file(control_path),
            "requestSha256": sha256_file(request_path),
            "sourceHash": source_hash(
                Path(__file__),
                control_path,
                request_path,
                raw_board_path,
                board_path,
            ),
            "externalAssets": [],
        },
    }
    manifest_path = output_dir / "finished-proof-manifest.json"
    write_json(manifest_path, manifest)
    print(json.dumps(manifest["validation"], indent=2))
    print(f"DUSKFELL_CHARACTER_FINISHING_MANIFEST={manifest_path}")
    print(f"DUSKFELL_CHARACTER_FINISHING_SHEET={normalized_path}")
    return 0 if not errors else 1


def verify_hash(path: Path, expected: str, label: str, errors: list[str]) -> None:
    if not path.is_file():
        errors.append(f"{label} is missing: {path}")
    elif sha256_file(path) != expected:
        errors.append(f"{label} SHA-256 does not match its manifest")


def source_chroma_mask(image: Image.Image) -> list[bool]:
    return [
        math.dist(pixel, (255, 0, 255)) >= 28
        for pixel in image.getdata()
    ]


def alpha_mask(image: Image.Image) -> list[bool]:
    return [value >= ALPHA_THRESHOLD for value in image.getchannel("A").getdata()]


def mask_metrics(mask: list[bool], width: int, height: int) -> dict:
    occupied = [(index % width, index // width) for index, value in enumerate(mask) if value]
    if not occupied:
        return {
            "empty": True,
            "bbox": None,
            "width": 0,
            "height": 0,
            "centerX": 0,
            "centerY": 0,
            "baseline": 0,
            "components": 0,
            "touchesCellBorder": False,
        }
    xs = [point[0] for point in occupied]
    ys = [point[1] for point in occupied]
    bbox = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
    return {
        "empty": False,
        "bbox": list(bbox),
        "width": bbox[2] - bbox[0],
        "height": bbox[3] - bbox[1],
        "centerX": round((bbox[0] + bbox[2]) / 2, 3),
        "centerY": round((bbox[1] + bbox[3]) / 2, 3),
        "baseline": bbox[3],
        "components": component_count(mask, width, height),
        "touchesCellBorder": bbox[0] == 0 or bbox[1] == 0 or bbox[2] == width or bbox[3] == height,
    }


def component_count(mask: list[bool], width: int, height: int) -> int:
    seen = set()
    count = 0
    for index, value in enumerate(mask):
        if not value:
            continue
        start = (index % width, index // width)
        if start in seen:
            continue
        queue = deque([start])
        seen.add(start)
        area = 0
        while queue:
            x, y = queue.popleft()
            area += 1
            for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                point = (next_x, next_y)
                if not (0 <= next_x < width and 0 <= next_y < height):
                    continue
                if point in seen or not mask[next_y * width + next_x]:
                    continue
                seen.add(point)
                queue.append(point)
        if area >= MINIMUM_COMPONENT_AREA:
            count += 1
    return count


def mask_iou(left: list[bool], right: list[bool]) -> float:
    intersection = sum(a and b for a, b in zip(left, right))
    union = sum(a or b for a, b in zip(left, right))
    return intersection / union if union else 0.0


def translate(image: Image.Image, dx: int, dy: int) -> Image.Image:
    translated = Image.new("RGBA", image.size, (0, 0, 0, 0))
    translated.alpha_composite(image, (dx, dy))
    return translated


def validate_frame(
    label: str,
    source: dict,
    raw_finished: dict,
    finished: dict,
    source_mask: list[bool],
    output_mask: list[bool],
    correction_x: int,
    correction_y: int,
) -> list[str]:
    errors = []
    if raw_finished["empty"]:
        return [f"{label} is empty"]
    if raw_finished["components"] != 1:
        errors.append(f"{label} has {raw_finished['components']} meaningful components")
    if raw_finished["touchesCellBorder"]:
        errors.append(f"{label} touches its board-cell border")
    if abs(correction_x) > MAXIMUM_REGISTRATION_SHIFT or abs(correction_y) > MAXIMUM_REGISTRATION_SHIFT:
        errors.append(
            f"{label} registration ({correction_x},{correction_y}) exceeds "
            f"{MAXIMUM_REGISTRATION_SHIFT}px",
        )
    if finished["components"] != 1:
        errors.append(f"{label} has {finished['components']} components after registration")
    if finished["touchesCellBorder"]:
        errors.append(f"{label} touches its board-cell border after registration")
    iou = mask_iou(source_mask, output_mask)
    if iou < MINIMUM_IOU:
        errors.append(f"{label} silhouette IoU {iou:.3f} is below {MINIMUM_IOU:.3f}")
    center_drift = abs(source["centerX"] - finished["centerX"])
    if center_drift > MAXIMUM_CENTER_DRIFT:
        errors.append(
            f"{label} horizontal center drift {center_drift:.2f}px exceeds "
            f"{MAXIMUM_CENTER_DRIFT:.2f}px",
        )
    baseline_drift = abs(source["baseline"] - finished["baseline"])
    if baseline_drift > MAXIMUM_BASELINE_DRIFT:
        errors.append(f"{label} baseline drift {baseline_drift}px exceeds {MAXIMUM_BASELINE_DRIFT}px")
    for dimension in ("width", "height"):
        ratio = finished[dimension] / source[dimension] if source[dimension] else 0.0
        if not MINIMUM_SCALE_RATIO <= ratio <= MAXIMUM_SCALE_RATIO:
            errors.append(
                f"{label} {dimension} ratio {ratio:.3f} is outside "
                f"{MINIMUM_SCALE_RATIO:.2f}-{MAXIMUM_SCALE_RATIO:.2f}",
            )
    return errors


if __name__ == "__main__":
    raise SystemExit(main())
