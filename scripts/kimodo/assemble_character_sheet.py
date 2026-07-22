"""Combine matching idle and locomotion sheets into one runtime candidate."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import subprocess
from pathlib import Path


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--idle-sheet", type=Path, required=True)
    parser.add_argument("--idle-frames", type=int, required=True)
    parser.add_argument("--run-sheet", type=Path, required=True)
    parser.add_argument("--run-frames", type=int, required=True)
    parser.add_argument("--rows", type=int, default=8)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    return parser.parse_args()


def png_dimensions(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    if len(header) != 24 or header[:8] != PNG_SIGNATURE or header[12:16] != b"IHDR":
        raise ValueError(f"{path} is not a valid PNG")
    return struct.unpack(">II", header[16:24])


def sheet_layout(
    idle_size: tuple[int, int],
    idle_frames: int,
    run_size: tuple[int, int],
    run_frames: int,
    rows: int,
) -> dict[str, int]:
    if min(idle_frames, run_frames, rows) < 1:
        raise ValueError("frame and row counts must be positive")
    idle_width, idle_height = idle_size
    run_width, run_height = run_size
    if idle_height != run_height or idle_height % rows != 0:
        raise ValueError("idle and run sheets must have the same row-aligned height")
    if idle_width % idle_frames != 0 or run_width % run_frames != 0:
        raise ValueError("sheet widths must divide evenly into their declared frame counts")
    cell_width = idle_width // idle_frames
    cell_height = idle_height // rows
    if run_width // run_frames != cell_width or run_height // rows != cell_height:
        raise ValueError("idle and run sheets must use identical frame cells")
    return {
        "rows": rows,
        "idleFrames": idle_frames,
        "runFrames": run_frames,
        "columns": idle_frames + run_frames,
        "cellWidth": cell_width,
        "cellHeight": cell_height,
        "width": idle_width + run_width,
        "height": idle_height,
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    layout = sheet_layout(
        png_dimensions(args.idle_sheet),
        args.idle_frames,
        png_dimensions(args.run_sheet),
        args.run_frames,
        args.rows,
    )
    magick = shutil.which("magick")
    if not magick:
        raise RuntimeError("ImageMagick 'magick' is required")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [magick, str(args.idle_sheet), str(args.run_sheet), "+append", "PNG32:" + str(args.output)],
        check=True,
    )
    if png_dimensions(args.output) != (layout["width"], layout["height"]):
        raise RuntimeError("assembled sheet dimensions do not match the declared layout")
    receipt = {
        "schemaVersion": "duskfell-kimodo-character-sheet-v1",
        "approvalState": "review",
        "idleSheet": str(args.idle_sheet),
        "runSheet": str(args.run_sheet),
        "sheet": str(args.output),
        "sheetSha256": sha256(args.output),
        **layout,
        "idleFrameRange": [0, args.idle_frames - 1],
        "runFrameRange": [args.idle_frames, args.idle_frames + args.run_frames - 1],
    }
    args.metadata.parent.mkdir(parents=True, exist_ok=True)
    args.metadata.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
