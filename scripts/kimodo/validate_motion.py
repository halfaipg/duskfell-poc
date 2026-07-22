#!/usr/bin/env python3
"""Validate a Kimodo motion NPZ and emit a deterministic intake receipt."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "config.json"
REQUIRED_ARRAYS = ("posed_joints", "global_rot_mats", "foot_contacts")
OPTIONAL_ARRAYS = (
    "local_rot_mats",
    "smooth_root_pos",
    "root_positions",
    "global_root_heading",
)
ALLOWED_ARRAYS = frozenset(REQUIRED_ARRAYS + OPTIONAL_ARRAYS)


class MotionValidationError(ValueError):
    """Raised when a motion archive violates the Duskfell intake contract."""


@dataclass(frozen=True)
class IntakePolicy:
    maximum_compressed_bytes: int
    maximum_uncompressed_bytes: int
    maximum_arrays: int
    accepted_joint_counts: tuple[int, ...]
    maximum_frames: int
    rotation_tolerance: float
    determinant_tolerance: float
    fps: int


def load_policy(config_path: Path = DEFAULT_CONFIG) -> IntakePolicy:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    intake = config["intake"]
    return IntakePolicy(
        maximum_compressed_bytes=int(intake["maximumCompressedBytes"]),
        maximum_uncompressed_bytes=int(intake["maximumUncompressedBytes"]),
        maximum_arrays=int(intake["maximumArrays"]),
        accepted_joint_counts=tuple(int(value) for value in intake["acceptedJointCounts"]),
        maximum_frames=int(intake["maximumFrames"]),
        rotation_tolerance=float(intake["rotationTolerance"]),
        determinant_tolerance=float(intake["determinantTolerance"]),
        fps=int(config["model"]["fps"]),
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_numeric(name: str, value: np.ndarray) -> None:
    if value.dtype.kind not in "fbiu":
        raise MotionValidationError(f"{name} has unsupported dtype {value.dtype}")
    if value.dtype.kind == "f" and not np.isfinite(value).all():
        raise MotionValidationError(f"{name} contains NaN or infinite values")


def _validate_rotations(rotations: np.ndarray, policy: IntakePolicy) -> dict[str, float]:
    identity = np.eye(3, dtype=np.float64)
    products = rotations.astype(np.float64) @ np.swapaxes(rotations.astype(np.float64), -1, -2)
    orthogonality_error = float(np.max(np.abs(products - identity)))
    determinants = np.linalg.det(rotations.astype(np.float64))
    determinant_error = float(np.max(np.abs(determinants - 1.0)))
    if orthogonality_error > policy.rotation_tolerance:
        raise MotionValidationError(
            f"global_rot_mats orthogonality error {orthogonality_error:.6g} exceeds "
            f"{policy.rotation_tolerance}"
        )
    if determinant_error > policy.determinant_tolerance:
        raise MotionValidationError(
            f"global_rot_mats determinant error {determinant_error:.6g} exceeds "
            f"{policy.determinant_tolerance}"
        )
    return {
        "maximumOrthogonalityError": orthogonality_error,
        "maximumDeterminantError": determinant_error,
    }


def _inspect_npz_container(path: Path, policy: IntakePolicy) -> None:
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > policy.maximum_arrays:
                raise MotionValidationError(
                    f"motion archive entry count {len(entries)} is outside 1..{policy.maximum_arrays}"
                )
            total_uncompressed = 0
            names = set()
            for entry in entries:
                if entry.is_dir() or "/" in entry.filename or not entry.filename.endswith(".npy"):
                    raise MotionValidationError(f"motion archive has unsafe entry {entry.filename!r}")
                if entry.flag_bits & 0x1:
                    raise MotionValidationError("encrypted motion archives are not accepted")
                name = entry.filename[:-4]
                if name not in ALLOWED_ARRAYS:
                    raise MotionValidationError(f"motion archive has unknown array {name!r}")
                if name in names:
                    raise MotionValidationError(f"motion archive repeats array {name!r}")
                names.add(name)
                total_uncompressed += entry.file_size
            if total_uncompressed > policy.maximum_uncompressed_bytes:
                raise MotionValidationError(
                    f"motion archive expands to {total_uncompressed} bytes; limit is "
                    f"{policy.maximum_uncompressed_bytes}"
                )
    except zipfile.BadZipFile as error:
        raise MotionValidationError(f"motion is not a valid NPZ zip container: {error}") from error


def validate_motion(path: Path, policy: IntakePolicy | None = None) -> dict[str, Any]:
    policy = policy or load_policy()
    path = path.resolve()
    if not path.is_file():
        raise MotionValidationError(f"motion file does not exist: {path}")
    byte_count = path.stat().st_size
    if byte_count <= 0 or byte_count > policy.maximum_compressed_bytes:
        raise MotionValidationError(
            f"motion file size {byte_count} is outside 1..{policy.maximum_compressed_bytes} bytes"
        )
    _inspect_npz_container(path, policy)

    try:
        archive = np.load(path, allow_pickle=False)
    except Exception as error:
        raise MotionValidationError(f"motion is not a safe NPZ archive: {error}") from error

    with archive:
        missing = sorted(set(REQUIRED_ARRAYS) - set(archive.files))
        if missing:
            raise MotionValidationError(f"motion is missing required arrays: {', '.join(missing)}")

        arrays = {name: archive[name] for name in archive.files}
        for name, value in arrays.items():
            _require_numeric(name, value)

        joints = arrays["posed_joints"]
        rotations = arrays["global_rot_mats"]
        contacts = arrays["foot_contacts"]
        if joints.ndim != 3 or joints.shape[-1] != 3:
            raise MotionValidationError(f"posed_joints must have shape [T,J,3], got {joints.shape}")
        frame_count, joint_count, _ = joints.shape
        if frame_count < 2 or frame_count > policy.maximum_frames:
            raise MotionValidationError(
                f"frame count {frame_count} is outside 2..{policy.maximum_frames}"
            )
        if joint_count not in policy.accepted_joint_counts:
            raise MotionValidationError(
                f"joint count {joint_count} is not one of {policy.accepted_joint_counts}"
            )
        if rotations.shape != (frame_count, joint_count, 3, 3):
            raise MotionValidationError(
                "global_rot_mats must match posed_joints as [T,J,3,3], "
                f"got {rotations.shape}"
            )
        if contacts.shape[0] != frame_count or contacts.ndim != 2 or contacts.shape[1] not in (4, 6):
            raise MotionValidationError(
                f"foot_contacts must have shape [T,4] or [T,6], got {contacts.shape}"
            )
        if "local_rot_mats" in arrays and arrays["local_rot_mats"].shape != rotations.shape:
            raise MotionValidationError(
                f"local_rot_mats must have shape {rotations.shape}, got {arrays['local_rot_mats'].shape}"
            )
        if "root_positions" in arrays and arrays["root_positions"].shape != (frame_count, 3):
            raise MotionValidationError(
                f"root_positions must have shape {(frame_count, 3)}, got {arrays['root_positions'].shape}"
            )
        if "smooth_root_pos" in arrays and arrays["smooth_root_pos"].shape != (frame_count, 3):
            raise MotionValidationError(
                f"smooth_root_pos must have shape {(frame_count, 3)}, got {arrays['smooth_root_pos'].shape}"
            )
        if "global_root_heading" in arrays and arrays["global_root_heading"].shape != (frame_count, 2):
            raise MotionValidationError(
                "global_root_heading must have shape "
                f"{(frame_count, 2)}, got {arrays['global_root_heading'].shape}"
            )

        rotation_metrics = _validate_rotations(rotations, policy)
        root_positions = arrays.get("root_positions", joints[:, 0, :])
        root_range = np.ptp(root_positions.astype(np.float64), axis=0)
        skeleton = "somaskel77" if joint_count == 77 else "somaskel30"
        return {
            "schemaVersion": "duskfell-kimodo-motion-receipt-v1",
            "source": str(path),
            "sha256": sha256_file(path),
            "bytes": byte_count,
            "skeleton": skeleton,
            "fps": policy.fps,
            "frames": frame_count,
            "durationSeconds": frame_count / policy.fps,
            "jointCount": joint_count,
            "keys": sorted(arrays),
            "rootRangeMeters": [float(value) for value in root_range],
            "rotationChecks": rotation_metrics,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("motion", type=Path, help="Kimodo NPZ motion")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--receipt", type=Path, help="Optional JSON receipt path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        receipt = validate_motion(args.motion, load_policy(args.config))
    except (MotionValidationError, OSError, KeyError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        return 1
    rendered = json.dumps({"ok": True, **receipt}, indent=2) + "\n"
    if args.receipt:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
