from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "generate_motion_batch.py"
SCRIPT_DIR = str(MODULE_PATH.parent)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)
SPEC = importlib.util.spec_from_file_location("duskfell_kimodo_generate", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class GenerateMotionBatchTests(unittest.TestCase):
    def test_checked_plan_builds_six_current_model_jobs(self) -> None:
        plan = MODULE.load_plan(MODULE.DEFAULT_PLAN)
        batch = MODULE.run_batch(plan, Path("/tmp/duskfell-kimodo"), "kimodo_gen", False)
        self.assertFalse(batch["executed"])
        self.assertEqual(len(batch["jobs"]), 6)
        for job in batch["jobs"]:
            command = job["command"]
            self.assertIn("Kimodo-SOMA-RP-v1.1", command)
            self.assertIn("100", command)
            self.assertNotIn("--no-postprocess", command)

    def test_current_output_gate_rejects_legacy_soma30(self) -> None:
        plan = MODULE.load_plan(MODULE.DEFAULT_PLAN)
        with self.assertRaisesRegex(MODULE.MotionValidationError, "somaskel30"):
            MODULE.require_current_output(
                {"skeleton": "somaskel30", "keys": plan["requiredArrays"]}, plan
            )

    def test_cuda_gate_checks_single_visible_device_uuid(self) -> None:
        class Properties:
            name = "NVIDIA GeForce RTX 3090"
            uuid = "477cc122-0e94-216c-b3c5-cf0ea1770809"

        class Cuda:
            @staticmethod
            def is_available() -> bool:
                return True

            @staticmethod
            def device_count() -> int:
                return 1

            @staticmethod
            def get_device_properties(_index: int) -> Properties:
                return Properties()

        class Torch:
            cuda = Cuda()

        with patch.dict(sys.modules, {"torch": Torch()}):
            receipt = MODULE.verify_cuda_device(
                "GPU-477cc122-0e94-216c-b3c5-cf0ea1770809"
            )
        self.assertEqual(receipt["name"], "NVIDIA GeForce RTX 3090")

    def test_cuda_gate_rejects_wrong_visible_device(self) -> None:
        class Properties:
            name = "NVIDIA GeForce RTX 5090"
            uuid = "156d644b-6276-32cf-700c-0ef7ae88937b"

        class Cuda:
            is_available = staticmethod(lambda: True)
            device_count = staticmethod(lambda: 1)
            get_device_properties = staticmethod(lambda _index: Properties())

        class Torch:
            cuda = Cuda()

        with patch.dict(sys.modules, {"torch": Torch()}):
            with self.assertRaisesRegex(SystemExit, "RTX 5090"):
                MODULE.verify_cuda_device(
                    "GPU-477cc122-0e94-216c-b3c5-cf0ea1770809"
                )


if __name__ == "__main__":
    unittest.main()
