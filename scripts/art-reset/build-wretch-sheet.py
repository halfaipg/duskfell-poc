#!/usr/bin/env python3
"""Assemble the engine-format wretch sheet (8x4 grid of 128px cells) and
register it in assets/sprites/manifest.json."""
import os, json, hashlib
from PIL import Image, ImageEnhance

ROOT = "/Users/j/Documents/New project/uo-chain-sandbox-poc"
SRC = "/tmp/wretch-sheet"
OUT = os.path.join(ROOT, "assets/sprites/duskfell-wretch.png")
MANIFEST = os.path.join(ROOT, "assets/sprites/manifest.json")

CELL = 128
# camera: ortho_scale 2.4m over 512px -> 213.33 px/m; target 112px per 1.8m -> 62.22 px/m
SCALE = (112 / 1.8) / (512 / 2.4)
RS = int(round(512 * SCALE))  # resized render size
# feet (world z=0) row in render: center 256 + 0.88m * 213.33 = 443.7
FEET_Y = 443.7 * SCALE
OFF_X = int(round(64 - 256 * SCALE))
OFF_Y = int(round(116 - FEET_Y))

DIRS = ["south", "east", "north", "west"]
sheet = Image.new("RGBA", (CELL * 8, CELL * 4), (0, 0, 0, 0))
for r, d in enumerate(DIRS):
    for f in range(8):
        im = Image.open(f"{SRC}/{d}_{f}.png").convert("RGBA")
        im = im.resize((RS, RS), Image.LANCZOS)
        rgb = ImageEnhance.Color(im.convert("RGB")).enhance(0.78)
        cr, cg, cb = rgb.split()
        cr = cr.point(lambda v: int(v * 0.92))
        cb = cb.point(lambda v: min(255, int(v * 1.04)))
        im = Image.merge("RGBA", (cr, cg, cb, im.getchannel("A")))
        cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cell.alpha_composite(im, (OFF_X, OFF_Y))
        sheet.alpha_composite(cell, (f * CELL, r * CELL))
sheet.save(OUT)
sha = hashlib.sha256(open(OUT, "rb").read()).hexdigest()
print("sheet saved", sheet.size, "sha", sha[:16], "scale px:", RS, "offsets:", OFF_X, OFF_Y)

m = json.load(open(MANIFEST))
m["sheets"] = [s for s in m["sheets"] if s["id"] != "duskfell-wretch"]
base = next(s for s in m["sheets"] if s["id"] == "duskfell-body-base")
block = json.loads(json.dumps(base))  # deep copy for structure
block.update({
    "id": "duskfell-wretch",
    "image": "duskfell-wretch.png",
    "imageSha256": sha,
})
block["render"]["scale"] = 0.9
block["provenance"] = {
    **base.get("provenance", {}),
    "cleanRoom": True,
    "source": "Blender world-kit render of MPFB2 parametric human (CC0) with procedural tattered shorts; deterministic pose script",
    "createdAt": "2026-07-09",
    "license": "project-original-cc0-derived",
    "reviewer": "claude",
    "prompt": "n/a - deterministic 3D render, no AI image generation",
    "negativePrompt": "n/a",
    "method": "3d-render",
    "tool": "Blender 5.1 + MPFB2 20260613",
    "toolVersion": "Blender 5.1.2",
    "sourceHash": base.get("provenance", {}).get("sourceHash", ""),
    "model": "n/a",
    "modelVersion": "n/a",
    "seed": "deterministic-pose-script",
}
m["sheets"].append(block)
json.dump(m, open(MANIFEST, "w"), indent=2)
print("manifest updated with duskfell-wretch")
