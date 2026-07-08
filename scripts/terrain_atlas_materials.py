"""Material catalog for the generated runtime terrain atlas."""

from __future__ import annotations


ATLAS_ROWS = 12
CELL = 64
MATERIALS = ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"]
SOURCE_MATERIALS = ["grass", "field", "dirt", "stone", "water", "settlement"]
MATERIAL_SOURCE_ALIASES = {
    "cobble": "settlement",
    "rock": "stone",
    "ruin": "stone",
    "shore": "water",
}
MATERIAL_SOURCE_COLUMNS = {material: index for index, material in enumerate(SOURCE_MATERIALS)}
SOURCE_COLUMNS = len(MATERIALS)
EDGE_MASKS = ["north", "east", "south", "west"]
CORNER_MASKS = ["northEast", "southEast", "southWest", "northWest"]
PAIR_TRANSITIONS = [
    ("dirt", "grass"),
    ("rock", "dirt"),
    ("water", "shore"),
    ("shore", "grass"),
    ("dirt", "settlement"),
    ("settlement", "cobble"),
    ("cobble", "dirt"),
    ("ruin", "cobble"),
    ("rock", "grass"),
    ("shore", "dirt"),
]
MATERIAL_PALETTES = {
    "grass": {
        "base": (57, 91, 43),
        "dark": (31, 55, 34),
        "mid": (78, 121, 54),
        "light": (126, 151, 72),
        "accent": (202, 184, 76),
    },
    "field": {
        "base": (93, 105, 58),
        "dark": (55, 68, 43),
        "mid": (126, 133, 73),
        "light": (177, 166, 91),
        "accent": (108, 72, 42),
    },
    "dirt": {
        "base": (107, 72, 45),
        "dark": (62, 44, 33),
        "mid": (143, 96, 57),
        "light": (184, 131, 77),
        "accent": (82, 74, 60),
    },
    "stone": {
        "base": (91, 95, 89),
        "dark": (49, 56, 53),
        "mid": (120, 124, 112),
        "light": (159, 156, 133),
        "accent": (69, 74, 70),
    },
    "water": {
        "base": (35, 83, 92),
        "dark": (18, 49, 62),
        "mid": (52, 115, 121),
        "light": (100, 157, 151),
        "accent": (157, 147, 92),
    },
    "settlement": {
        "base": (156, 149, 119),
        "dark": (90, 82, 65),
        "mid": (187, 177, 139),
        "light": (218, 205, 158),
        "accent": (103, 112, 92),
    },
    "cobble": {
        "base": (118, 111, 100),
        "dark": (62, 58, 54),
        "mid": (146, 137, 121),
        "light": (190, 179, 151),
        "accent": (77, 92, 72),
    },
    "rock": {
        "base": (72, 76, 73),
        "dark": (34, 39, 38),
        "mid": (103, 108, 101),
        "light": (146, 146, 128),
        "accent": (88, 74, 53),
    },
    "ruin": {
        "base": (104, 94, 80),
        "dark": (50, 46, 43),
        "mid": (137, 124, 100),
        "light": (181, 164, 126),
        "accent": (54, 79, 57),
    },
    "shore": {
        "base": (87, 92, 68),
        "dark": (43, 56, 47),
        "mid": (119, 120, 79),
        "light": (164, 157, 101),
        "accent": (65, 111, 107),
    },
}
