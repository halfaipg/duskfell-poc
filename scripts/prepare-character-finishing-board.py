#!/usr/bin/env python3
"""Build a hash-bound 8-direction character board for controlled img2img review."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

from asset_pipeline_utils import sha256_file, source_hash, write_json


ROOT = Path(__file__).resolve().parents[1]
BOARD_CELL = (192, 256)
BOARD_COLUMNS = 8
BOARD_ROWS = 4
CHROMA = (255, 0, 255, 255)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--metadata",
        type=Path,
        default=ROOT
        / "assets/sprites/candidates/blender-locomotion-v2/duskfell-locomotion-v2.json",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "assets/sprites/candidates/blender-locomotion-v2/finishing-proof-v1",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    metadata_path = args.metadata.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    sheet_path = ROOT / metadata["sheet"]
    if sha256_file(sheet_path) != metadata["sheetSha256"]:
        raise SystemExit("source locomotion sheet does not match its pinned SHA-256")

    source = Image.open(sheet_path).convert("RGBA")
    cell_width = int(metadata["cell"]["width"])
    cell_height = int(metadata["cell"]["height"])
    idle_frames = int(metadata["idleFrames"])
    selections = (
        ("idle-a", 0),
        ("idle-b", idle_frames // 2),
        ("walk-contact-a", idle_frames + 4),
        ("walk-contact-b", idle_frames + 14),
    )
    board = Image.new(
        "RGBA",
        (BOARD_COLUMNS * BOARD_CELL[0], BOARD_ROWS * BOARD_CELL[1]),
        CHROMA,
    )
    frames = []
    for row, (pose, column) in enumerate(selections):
        for direction_index, direction in enumerate(metadata["directions"]):
            frame = source.crop(
                (
                    column * cell_width,
                    direction_index * cell_height,
                    (column + 1) * cell_width,
                    (direction_index + 1) * cell_height,
                ),
            )
            scaled = frame.resize((192, 240), Image.Resampling.NEAREST)
            board.alpha_composite(scaled, (direction_index * BOARD_CELL[0], row * BOARD_CELL[1] + 8))
            frames.append(
                {
                    "boardRow": row,
                    "boardColumn": direction_index,
                    "pose": pose,
                    "direction": direction,
                    "sourceColumn": column,
                    "sourceRow": direction_index,
                },
            )

    board_path = output_dir / "character-finishing-control-v1.png"
    board.convert("RGB").save(board_path, optimize=True)
    request_path = output_dir / "img2img-request.json"
    request = {
        "schemaVersion": "duskfell-character-img2img-request-v1",
        "createdAt": "2026-07-22",
        "model": "OpenAI built-in image generation",
        "mode": "edit",
        "input": board_path.name,
        "inputSha256": sha256_file(board_path),
        "output": "character-finishing-openai-v1.png",
        "background": "#ff00ff chroma-key",
        "prompt": (
            "Edit the supplied deterministic 8-column by 4-row character pose board. "
            "Preserve exactly 32 adult human figures in the same cells, row order, facing "
            "directions, limb silhouettes, stride phases, body proportions, and foot "
            "registration. Change only the low-poly surface treatment into original "
            "clean-room hand-painted dark-age fantasy game sprite art: lanky readable "
            "anatomy, simplified expressive planes, restrained earthy skin and cloth, "
            "crisp painterly edges, and coherent plan-oblique lighting. Keep the figure "
            "bald and minimally clothed in a plain dark loincloth so later paperdoll "
            "equipment can register. Use one perfectly flat #ff00ff background with no "
            "floor or shadows. No armor, shirt, boots, hair, weapons, added props, missing "
            "figures, merged figures, photorealism, vector art, text, logos, or watermark."
        ),
        "immutable": [
            "8x4 order",
            "figure count",
            "direction rows",
            "limb silhouettes",
            "stride phases",
            "body proportions",
            "foot registration",
        ],
        "approval": {"state": "review"},
    }
    write_json(request_path, request)
    write_json(
        output_dir / "control-manifest.json",
        {
            "schemaVersion": "duskfell-character-finishing-control-v1",
            "approval": {"state": "review"},
            "projection": "military-plan-oblique",
            "source": {
                "metadata": str(metadata_path.relative_to(ROOT)),
                "metadataSha256": sha256_file(metadata_path),
                "sheet": str(sheet_path.relative_to(ROOT)),
                "sheetSha256": sha256_file(sheet_path),
            },
            "board": {
                "path": board_path.name,
                "sha256": sha256_file(board_path),
                "columns": BOARD_COLUMNS,
                "rows": BOARD_ROWS,
                "cell": {"width": BOARD_CELL[0], "height": BOARD_CELL[1]},
                "chroma": "#ff00ff",
            },
            "frames": frames,
            "provenance": {
                "cleanRoom": True,
                "geometryAuthority": str(metadata_path.relative_to(ROOT)),
                "animationAuthority": "Blender action and sampled source columns",
                "finishingAuthority": "none; review-only img2img input",
                "sourceHash": source_hash(Path(__file__), metadata_path, sheet_path, request_path),
                "externalAssets": [],
            },
        },
    )
    print(f"DUSKFELL_CHARACTER_FINISHING_BOARD={board_path}")
    print(f"DUSKFELL_CHARACTER_FINISHING_REQUEST={request_path}")


if __name__ == "__main__":
    main()
