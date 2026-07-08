"""Manifest metadata for the generated landscape detail sprite sheet."""

from __future__ import annotations


CELL = 64
SOURCE_COLUMNS = 8
COLUMNS = 23
ROWS = 1
STATIC_FRAME_START = SOURCE_COLUMNS

DETAIL_SHEET = {
    "id": "duskfell-details",
    "image": "duskfell-details.png",
    "imageSha256": "",
    "frameGrid": {
        "cellWidth": CELL,
        "cellHeight": CELL,
        "columns": COLUMNS,
        "rows": ROWS,
        "frameCount": COLUMNS * ROWS,
    },
    "anchor": {
        "kind": "foot",
        "x": 32,
        "y": 54,
    },
    "footprint": {
        "kind": "diamond",
        "widthTiles": 0.75,
        "heightTiles": 0.75,
    },
    "render": {
        "layer": "terrain",
        "sort": "footprint-y",
        "zBias": -4,
        "scale": 0.72,
        "shadow": {
            "kind": "ellipse",
            "x": 32,
            "y": 56,
            "width": 30,
            "height": 8,
            "opacity": 0.18,
        },
    },
    "directions": [
        {
            "name": "neutral",
            "startFrame": 0,
            "frameCount": COLUMNS * ROWS,
        }
    ],
    "provenance": {
        "cleanRoom": True,
        "source": "generated concept sheet normalized from assets/sprites/duskfell-details-source.png",
        "createdAt": "2026-07-07",
        "license": "project-original-ai-assisted-review",
        "reviewer": "codex",
        "prompt": (
            "original clean-room military-plan-oblique dark fantasy terrain detail sheet with rock cluster, "
            "pebbles, grass tuft, wildflowers, scrub bush, fallen log, stump, mushrooms, and locally authored "
            "four sapling tree variants, four mature tree variants, four ancient tree variants, boulder, reeds, and ruined-stone static frames"
        ),
        "negativePrompt": "no text, no logos, no watermark, no copied commercial game assets, not 2:1 isometric",
        "method": "ai-generated",
        "tool": "OpenAI built-in image generation plus local chroma-key sprite-sheet normalization",
        "toolVersion": "built-in image generation 2026-07-07",
        "sourceHash": "",
        "termsSnapshot": "OpenAI service terms reviewed 2026-07-07 for internal PoC asset review",
        "model": "built-in image generation",
        "modelVersion": "2026-07-07",
        "seed": "unavailable-built-in-generation",
        "toolReview": {
            "status": "approved-internal",
            "reviewedAt": "2026-07-07",
            "reviewer": "codex",
            "sourceUrl": "https://openai.com/policies/service-terms",
            "risk": "internal PoC detail sheet from clean-room prompt; human art review still required before production approval",
        },
    },
    "approval": {
        "state": "review",
    },
}
