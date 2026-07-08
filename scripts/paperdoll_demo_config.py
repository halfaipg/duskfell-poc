"""Configuration for review-only paperdoll demo sheet generation."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "sprites"
MANIFEST_PATH = ASSET_DIR / "manifest.json"
SOURCE_PATH = ASSET_DIR / "duskfell-paperdoll-body-source.png"

CELL = 128
COLUMNS = 8
ROWS = 4
FRAME_COUNT = COLUMNS * ROWS

ANCHOR = {"kind": "foot", "x": 64, "y": 116}
FOOTPRINT = {"kind": "diamond", "widthTiles": 1, "heightTiles": 1}
DIRECTIONS = [
    {"name": "south", "startFrame": 0, "frameCount": 8},
    {"name": "east", "startFrame": 8, "frameCount": 8},
    {"name": "north", "startFrame": 16, "frameCount": 8},
    {"name": "west", "startFrame": 24, "frameCount": 8},
]
ANIMATION = {
    "idleFrame": 0,
    "walkFrames": [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2],
}
BASE_RENDER = {
    "layer": "actor",
    "sort": "footprint-y",
    "zBias": 0,
    "scale": 0.9,
    "shadow": {
        "kind": "ellipse",
        "x": 64,
        "y": 119,
        "width": 44,
        "height": 12,
        "opacity": 0.3,
    },
}
EQUIPMENT_RENDER = {
    "layer": "equipment",
    "sort": "footprint-y",
    "zBias": 0,
    "scale": 0.9,
    "shadow": {"kind": "none"},
}

PROMPT = (
    "clean-room military-plan-oblique 1:1 oblique paperdoll body and equipment sprite "
    "prototype, four rows, eight walk frames, original dark medieval-fantasy character layers"
)
NEGATIVE_PROMPT = (
    "no copied commercial game pixels, no extracted client art, no screenshots, "
    "no 2:1 dimetric projection, no straight-only final-production cardinal sheet"
)

VARIANTS = {
    "wayfarer": {
        "label": "Wayfarer",
        "legs": (70, 62, 48, 210),
        "boots": (54, 39, 28, 225),
        "armor": (74, 66, 57, 218),
        "trim": (174, 151, 91, 220),
        "cloak": (23, 28, 32, 190),
        "weapon": (185, 166, 120, 235),
    },
    "ranger": {
        "label": "Ranger",
        "legs": (50, 73, 53, 210),
        "boots": (55, 45, 30, 225),
        "armor": (54, 85, 62, 218),
        "trim": (136, 160, 98, 220),
        "cloak": (31, 70, 45, 190),
        "weapon": (156, 124, 75, 235),
    },
    "warden": {
        "label": "Warden",
        "legs": (55, 61, 70, 210),
        "boots": (50, 45, 39, 225),
        "armor": (91, 101, 106, 220),
        "trim": (171, 181, 176, 225),
        "cloak": (35, 48, 74, 190),
        "weapon": (190, 194, 184, 235),
    },
    "brigand": {
        "label": "Brigand",
        "legs": (78, 48, 40, 210),
        "boots": (47, 34, 26, 225),
        "armor": (85, 57, 39, 218),
        "trim": (159, 98, 65, 220),
        "cloak": (84, 34, 33, 190),
        "weapon": (172, 146, 112, 235),
    },
}
