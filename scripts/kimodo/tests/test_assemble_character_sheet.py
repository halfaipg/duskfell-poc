from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "assemble_character_sheet.py"
SPEC = importlib.util.spec_from_file_location("duskfell_kimodo_assemble", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class AssembleCharacterSheetTests(unittest.TestCase):
    def test_combines_matching_direction_rows(self) -> None:
        layout = MODULE.sheet_layout((2048, 1280), 16, (2688, 1280), 21, 8)
        self.assertEqual(layout["columns"], 37)
        self.assertEqual(layout["cellWidth"], 128)
        self.assertEqual(layout["cellHeight"], 160)
        self.assertEqual(layout["width"], 4736)

    def test_rejects_mismatched_cells(self) -> None:
        with self.assertRaisesRegex(ValueError, "identical frame cells"):
            MODULE.sheet_layout((2048, 1280), 16, (1344, 1280), 21, 8)


if __name__ == "__main__":
    unittest.main()
