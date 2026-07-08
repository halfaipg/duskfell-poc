"""Configuration for generated actor sprite-sheet normalization."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "assets" / "sprites" / "duskfell-wayfarer-source.png"
OUTPUT_PATH = ROOT / "assets" / "sprites" / "duskfell-wayfarer.png"
MANIFEST_PATH = ROOT / "assets" / "sprites" / "manifest.json"

CELL = 128
COLUMNS = 8
ROWS = 4
SOURCE_COLUMNS = 8
SOURCE_ROWS = 4

VARIANTS = {
    "duskfell-ranger": {
        "path": ROOT / "assets" / "sprites" / "duskfell-ranger.png",
        "role": "ranger",
        "cloak": (47, 92, 65),
        "leather": (91, 78, 49),
        "metal": (104, 122, 108),
    },
    "duskfell-warden": {
        "path": ROOT / "assets" / "sprites" / "duskfell-warden.png",
        "role": "warden",
        "cloak": (43, 62, 86),
        "leather": (79, 76, 69),
        "metal": (117, 128, 135),
    },
    "duskfell-brigand": {
        "path": ROOT / "assets" / "sprites" / "duskfell-brigand.png",
        "role": "brigand",
        "cloak": (92, 48, 44),
        "leather": (76, 51, 34),
        "metal": (93, 93, 91),
    },
}
