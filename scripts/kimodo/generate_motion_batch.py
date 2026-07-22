#!/usr/bin/env python3
"""Run Duskfell's pinned Kimodo prompt batch on a CUDA authoring host."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Any

from validate_motion import MotionValidationError, validate_motion


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DEFAULT_PLAN = HERE / "motion-generation-plan.json"
DEFAULT_OUTPUT = ROOT / "var" / "kimodo" / "generated-v1"


class GenerationPlanError(ValueError):
    """Raised when a generation plan violates the authoring contract."""


def verify_cuda_device(expected_uuid: str) -> dict[str, str]:
    """Fail before model loading unless exactly the requested GPU is visible."""
    try:
        import torch
    except ImportError as error:
        raise SystemExit("PyTorch is required to verify the CUDA authoring device") from error

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable; refusing to start Kimodo generation")
    if torch.cuda.device_count() != 1:
        raise SystemExit(
            f"expected exactly one visible CUDA device, found {torch.cuda.device_count()}"
        )

    properties = torch.cuda.get_device_properties(0)
    actual_uuid = str(properties.uuid).lower().removeprefix("gpu-")
    normalized_expected = expected_uuid.lower().removeprefix("gpu-")
    if actual_uuid != normalized_expected:
        raise SystemExit(
            f"visible CUDA device {properties.name} has UUID {actual_uuid}; "
            f"expected {normalized_expected}"
        )
    return {"name": properties.name, "uuid": actual_uuid}


def load_plan(path: Path) -> dict[str, Any]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("schemaVersion") != "duskfell-kimodo-generation-plan-v1":
        raise GenerationPlanError("unsupported generation plan schema")
    if plan.get("requiredSkeleton") != "somaskel77":
        raise GenerationPlanError("generation plans must require somaskel77")
    if not isinstance(plan.get("motions"), list) or not plan["motions"]:
        raise GenerationPlanError("generation plan must contain motions")
    seen = set()
    for motion in plan["motions"]:
        motion_id = motion.get("id")
        if not isinstance(motion_id, str) or not motion_id or motion_id in seen:
            raise GenerationPlanError("motion ids must be unique non-empty strings")
        seen.add(motion_id)
        prompt = motion.get("prompt")
        if not isinstance(prompt, str) or not 20 <= len(prompt) <= 500:
            raise GenerationPlanError(f"{motion_id} prompt length is outside 20..500")
        duration = motion.get("durationSeconds")
        if not isinstance(duration, (int, float)) or not 1.0 <= duration <= 10.0:
            raise GenerationPlanError(f"{motion_id} duration is outside 1..10 seconds")
        seeds = motion.get("seeds")
        if not isinstance(seeds, list) or not seeds or any(
            not isinstance(seed, int) or seed < 0 for seed in seeds
        ):
            raise GenerationPlanError(f"{motion_id} seeds must be non-negative integers")
    return plan


def generation_command(
    executable: str,
    plan: dict[str, Any],
    motion: dict[str, Any],
    seed: int,
    output_stem: Path,
) -> list[str]:
    cfg = plan["cfg"]
    return [
        executable,
        motion["prompt"],
        "--model",
        plan["model"],
        "--duration",
        str(motion["durationSeconds"]),
        "--diffusion_steps",
        str(plan["diffusionSteps"]),
        "--num_samples",
        "1",
        "--seed",
        str(seed),
        "--cfg_type",
        cfg["type"],
        "--cfg_weight",
        str(cfg["textWeight"]),
        str(cfg["constraintWeight"]),
        "--output",
        str(output_stem),
        "--bvh",
        "--bvh_standard_tpose",
    ]


def require_current_output(receipt: dict[str, Any], plan: dict[str, Any]) -> None:
    if receipt["skeleton"] != plan["requiredSkeleton"]:
        raise MotionValidationError(
            f"generated motion is {receipt['skeleton']}; {plan['requiredSkeleton']} is required"
        )
    missing = sorted(set(plan["requiredArrays"]) - set(receipt["keys"]))
    if missing:
        raise MotionValidationError(
            f"generated motion is missing current SOMA arrays: {', '.join(missing)}"
        )


def run_batch(plan: dict[str, Any], output_dir: Path, executable: str, execute: bool) -> dict[str, Any]:
    jobs = []
    for motion in plan["motions"]:
        for seed in motion["seeds"]:
            stem = output_dir / motion["id"] / f"seed-{seed}"
            command = generation_command(executable, plan, motion, seed, stem)
            job = {
                "motion": motion["id"],
                "seed": seed,
                "command": command,
                "output": str(stem.with_suffix(".npz")),
            }
            jobs.append(job)
            if not execute:
                print(shlex.join(command))
                continue
            stem.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(command, check=True, env=os.environ.copy())
            receipt = validate_motion(stem.with_suffix(".npz"))
            require_current_output(receipt, plan)
            job["receipt"] = receipt

    batch = {
        "schemaVersion": "duskfell-kimodo-generation-batch-v1",
        "executed": execute,
        "model": plan["model"],
        "jobs": jobs,
    }
    if execute:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "batch-receipt.json").write_text(
            json.dumps(batch, indent=2) + "\n", encoding="utf-8"
        )
    return batch


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--executable", default="kimodo_gen")
    parser.add_argument(
        "--expected-cuda-uuid",
        help="Require exactly one visible CUDA device with this UUID before execution",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Run generation; without this flag the commands are printed only",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    plan = load_plan(args.plan)
    if args.execute and not shutil.which(args.executable):
        raise SystemExit(f"Kimodo executable not found: {args.executable}")
    if args.execute:
        if not args.expected_cuda_uuid:
            raise SystemExit("--expected-cuda-uuid is required with --execute")
        device = verify_cuda_device(args.expected_cuda_uuid)
        print(f"Verified CUDA authoring device: {device['name']} ({device['uuid']})")
    run_batch(plan, args.output_dir.resolve(), args.executable, args.execute)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
