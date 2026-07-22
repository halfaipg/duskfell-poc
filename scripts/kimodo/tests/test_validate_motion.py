from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).resolve().parents[1] / "validate_motion.py"
SPEC = importlib.util.spec_from_file_location("duskfell_kimodo_validate", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ValidateMotionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write_motion(self, **overrides: np.ndarray) -> Path:
        frames = 12
        joints = 30
        values = {
            "posed_joints": np.zeros((frames, joints, 3), dtype=np.float32),
            "global_rot_mats": np.broadcast_to(
                np.eye(3, dtype=np.float32), (frames, joints, 3, 3)
            ).copy(),
            "foot_contacts": np.zeros((frames, 4), dtype=bool),
        }
        values.update(overrides)
        path = self.root / "motion.npz"
        np.savez_compressed(path, **values)
        return path

    def test_accepts_safe_soma30_motion(self) -> None:
        receipt = MODULE.validate_motion(self.write_motion())
        self.assertEqual(receipt["skeleton"], "somaskel30")
        self.assertEqual(receipt["frames"], 12)
        self.assertEqual(receipt["fps"], 30)
        self.assertEqual(len(receipt["sha256"]), 64)

    def test_accepts_current_soma77_motion(self) -> None:
        frames = 12
        joints = 77
        rotations = np.broadcast_to(
            np.eye(3, dtype=np.float32), (frames, joints, 3, 3)
        ).copy()
        receipt = MODULE.validate_motion(
            self.write_motion(
                posed_joints=np.zeros((frames, joints, 3), dtype=np.float32),
                global_rot_mats=rotations,
                local_rot_mats=rotations,
                root_positions=np.zeros((frames, 3), dtype=np.float32),
                foot_contacts=np.zeros((frames, 6), dtype=bool),
            )
        )
        self.assertEqual(receipt["skeleton"], "somaskel77")
        self.assertEqual(receipt["jointCount"], joints)
        self.assertIn("local_rot_mats", receipt["keys"])

    def test_rejects_missing_required_array(self) -> None:
        path = self.root / "missing.npz"
        np.savez_compressed(path, posed_joints=np.zeros((12, 30, 3), dtype=np.float32))
        with self.assertRaisesRegex(MODULE.MotionValidationError, "missing required arrays"):
            MODULE.validate_motion(path)

    def test_rejects_non_rotation_matrix(self) -> None:
        rotations = np.zeros((12, 30, 3, 3), dtype=np.float32)
        with self.assertRaisesRegex(MODULE.MotionValidationError, "orthogonality error"):
            MODULE.validate_motion(self.write_motion(global_rot_mats=rotations))

    def test_rejects_nan(self) -> None:
        joints = np.zeros((12, 30, 3), dtype=np.float32)
        joints[3, 2, 1] = np.nan
        with self.assertRaisesRegex(MODULE.MotionValidationError, "NaN or infinite"):
            MODULE.validate_motion(self.write_motion(posed_joints=joints))

    def test_rejects_unknown_joint_count(self) -> None:
        with self.assertRaisesRegex(MODULE.MotionValidationError, "joint count 31"):
            MODULE.validate_motion(
                self.write_motion(
                    posed_joints=np.zeros((12, 31, 3), dtype=np.float32),
                    global_rot_mats=np.broadcast_to(
                        np.eye(3, dtype=np.float32), (12, 31, 3, 3)
                    ).copy(),
                )
            )

    def test_rejects_unknown_array(self) -> None:
        with self.assertRaisesRegex(MODULE.MotionValidationError, "unknown array"):
            MODULE.validate_motion(
                self.write_motion(debug_payload=np.zeros((2,), dtype=np.float32))
            )


if __name__ == "__main__":
    unittest.main()
