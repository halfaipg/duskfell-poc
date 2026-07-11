#!/usr/bin/env python3
"""Render a tiny deterministic Duskfell paperdoll/actor prototype.

This is not production art. It is a local proof of the render-from-rig idea:
one body pose model emits repeatable frames, and equipment/ghost layers attach to
the same hand/foot anchors instead of being separately generated.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import math

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)

LOW_W = 72
LOW_H = 96
SCALE = 3
CELL_W = LOW_W * SCALE
CELL_H = LOW_H * SCALE
DIRECTIONS = ["south", "east", "north", "west"]
FRAMES = 4


@dataclass(frozen=True)
class Pose:
    head: tuple[int, int]
    neck: tuple[int, int]
    hip: tuple[int, int]
    left_hand: tuple[int, int]
    right_hand: tuple[int, int]
    left_foot: tuple[int, int]
    right_foot: tuple[int, int]
    left_knee: tuple[int, int]
    right_knee: tuple[int, int]
    facing: str


def main() -> None:
    male = render_sheet("male-base", equipment=False, ghost=False)
    equipped = render_sheet("equipped", equipment=True, ghost=False)
    ghost = render_sheet("ghost", equipment=False, ghost=True)
    card = render_card_triptych()
    write_manifest([male, equipped, ghost, card])
    print(f"wrote {male}")
    print(f"wrote {equipped}")
    print(f"wrote {ghost}")
    print(f"wrote {card}")


def render_sheet(name: str, *, equipment: bool, ghost: bool) -> Path:
    sheet = Image.new("RGBA", (CELL_W * FRAMES, CELL_H * len(DIRECTIONS)), (0, 0, 0, 0))
    for row, direction in enumerate(DIRECTIONS):
        for frame in range(FRAMES):
            sprite = render_actor(direction, frame, equipment=equipment, ghost=ghost)
            sheet.alpha_composite(sprite, (frame * CELL_W, row * CELL_H))
    out = OUT_DIR / f"duskfell-prototype-{name}-rig-render.png"
    sheet.save(out)
    return out


def render_card_triptych() -> Path:
    cards = [
        render_card("base", "south", 1, equipment=False, ghost=False),
        render_card("equipped", "south", 1, equipment=True, ghost=False),
        render_card("ghost", "south", 1, equipment=False, ghost=True),
    ]
    gap = 18
    out = Image.new("RGBA", (cards[0].width * 3 + gap * 2, cards[0].height), (25, 25, 27, 255))
    x = 0
    for card in cards:
        out.alpha_composite(card, (x, 0))
        x += card.width + gap
    path = OUT_DIR / "duskfell-prototype-player-card-rig-render.png"
    out.save(path)
    return path


def render_card(label: str, direction: str, frame: int, *, equipment: bool, ghost: bool) -> Image.Image:
    card = Image.new("RGBA", (220, 320), (24, 24, 27, 255))
    draw = ImageDraw.Draw(card, "RGBA")
    draw.rounded_rectangle((8, 8, 212, 312), radius=10, fill=(48, 20, 26, 255), outline=(8, 8, 9, 255), width=4)
    draw.rectangle((20, 22, 200, 294), fill=(58, 25, 31, 255))
    actor = render_actor(direction, frame, equipment=equipment, ghost=ghost, card_scale=True)
    card.alpha_composite(actor, ((card.width - actor.width) // 2, 34))
    draw.rectangle((20, 260, 200, 294), fill=(14, 10, 11, 80))
    return card


def render_actor(
    direction: str,
    frame: int,
    *,
    equipment: bool,
    ghost: bool,
    card_scale: bool = False,
) -> Image.Image:
    pose = pose_for(direction, frame)
    img = Image.new("RGBA", (LOW_W, LOW_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")

    draw.ellipse((22, 84, 50, 91), fill=(0, 0, 0, 70))
    if ghost:
        draw_ghost(draw, pose)
    else:
        draw_body(draw, pose)
        draw_modest_base(draw, pose)
    if equipment:
        draw_equipment(draw, pose)
    draw_anchor_pixels(draw, pose)

    scale = 4 if card_scale else SCALE
    resampling = Image.Resampling.NEAREST
    return img.resize((LOW_W * scale, LOW_H * scale), resampling)


def pose_for(direction: str, frame: int) -> Pose:
    phase = [0, 1, 0, -1][frame % 4]
    lateral = {"south": 0, "north": 0, "east": 4, "west": -4}[direction]
    depth = {"south": 2, "north": -2, "east": 0, "west": 0}[direction]
    step = phase * 2
    return Pose(
        head=(36 + lateral // 2, 19 + depth),
        neck=(36 + lateral // 2, 31 + depth),
        hip=(36, 55),
        left_hand=(18 + lateral, 49 - step),
        right_hand=(54 + lateral, 49 + step),
        left_foot=(28 - step, 82),
        right_foot=(44 + step, 82),
        left_knee=(30 - step, 68),
        right_knee=(42 + step, 68),
        facing=direction,
    )


def draw_body(draw: ImageDraw.ImageDraw, pose: Pose) -> None:
    skin = (180, 128, 99, 255)
    skin_dark = (115, 74, 61, 255)
    outline = (20, 18, 18, 255)
    neck = pose.neck
    hip = pose.hip

    draw.line((neck, pose.left_hand), fill=outline, width=7)
    draw.line((neck, pose.right_hand), fill=outline, width=7)
    draw.line((neck, pose.left_hand), fill=skin, width=5)
    draw.line((neck, pose.right_hand), fill=skin, width=5)
    draw.line((hip, pose.left_knee, pose.left_foot), fill=outline, width=8)
    draw.line((hip, pose.right_knee, pose.right_foot), fill=outline, width=8)
    draw.line((hip, pose.left_knee, pose.left_foot), fill=skin, width=6)
    draw.line((hip, pose.right_knee, pose.right_foot), fill=skin, width=6)
    draw.polygon([(27, 31), (45, 31), (48, 56), (24, 56)], fill=outline)
    draw.polygon([(29, 32), (43, 32), (45, 55), (27, 55)], fill=skin)
    draw.ellipse((25, 10, 47, 32), fill=outline)
    draw.ellipse((27, 12, 45, 30), fill=skin)
    draw.rectangle((27, 10, 45, 18), fill=(48, 39, 31, 255))
    eye_y = 20 if pose.facing != "north" else 18
    if pose.facing != "north":
        draw.rectangle((31, eye_y, 33, eye_y + 1), fill=(14, 14, 14, 255))
        draw.rectangle((39, eye_y, 41, eye_y + 1), fill=(14, 14, 14, 255))
    draw.line((31, 58, 30, 72), fill=skin_dark, width=1)
    draw.line((43, 58, 44, 72), fill=skin_dark, width=1)


def draw_modest_base(draw: ImageDraw.ImageDraw, pose: Pose) -> None:
    cloth = (151, 134, 95, 255)
    cloth_dark = (89, 79, 58, 255)
    outline = (20, 18, 18, 255)
    draw.polygon([(28, 33), (44, 33), (45, 40), (27, 40)], fill=outline)
    draw.polygon([(29, 34), (43, 34), (44, 39), (28, 39)], fill=cloth)
    draw.polygon([(24, 53), (48, 53), (45, 66), (35, 63), (27, 66)], fill=outline)
    draw.polygon([(26, 54), (46, 54), (43, 64), (35, 61), (29, 64)], fill=cloth)
    draw.line((27, 55, 46, 55), fill=cloth_dark, width=1)


def draw_equipment(draw: ImageDraw.ImageDraw, pose: Pose) -> None:
    leather = (67, 47, 35, 255)
    metal = (142, 147, 138, 255)
    outline = (12, 12, 12, 255)
    cloth = (52, 74, 57, 255)
    draw.polygon([(27, 31), (45, 31), (47, 55), (25, 55)], fill=outline)
    draw.polygon([(29, 32), (43, 32), (44, 54), (28, 54)], fill=cloth)
    draw.line((28, 37, 44, 51), fill=leather, width=3)
    draw.line((pose.right_hand[0] + 1, pose.right_hand[1], pose.right_hand[0] + 17, pose.right_hand[1] - 30), fill=outline, width=3)
    draw.line((pose.right_hand[0] + 1, pose.right_hand[1], pose.right_hand[0] + 17, pose.right_hand[1] - 30), fill=metal, width=1)
    shield_x, shield_y = pose.left_hand
    draw.ellipse((shield_x - 10, shield_y - 9, shield_x + 7, shield_y + 10), fill=outline)
    draw.ellipse((shield_x - 8, shield_y - 7, shield_x + 5, shield_y + 8), fill=(83, 60, 42, 255))
    draw.ellipse((shield_x - 2, shield_y - 1, shield_x + 2, shield_y + 3), fill=metal)
    draw.rectangle((27, 68, 33, 84), fill=(42, 34, 27, 255))
    draw.rectangle((39, 68, 45, 84), fill=(42, 34, 27, 255))


def draw_ghost(draw: ImageDraw.ImageDraw, pose: Pose) -> None:
    outline = (9, 12, 18, 230)
    robe = (84, 101, 116, 210)
    robe_light = (126, 143, 153, 210)
    draw.line((pose.neck, pose.left_hand), fill=outline, width=10)
    draw.line((pose.neck, pose.right_hand), fill=outline, width=10)
    draw.line((pose.neck, pose.left_hand), fill=robe, width=8)
    draw.line((pose.neck, pose.right_hand), fill=robe, width=8)
    draw.polygon([(22, 31), (50, 31), (56, 87), (46, 82), (38, 89), (30, 82), (20, 87)], fill=outline)
    draw.polygon([(24, 32), (48, 32), (53, 84), (45, 80), (38, 86), (31, 80), (23, 84)], fill=robe)
    draw.ellipse((24, 8, 48, 34), fill=outline)
    draw.pieslice((26, 10, 46, 36), start=180, end=360, fill=robe_light)
    draw.rectangle((30, 20, 42, 31), fill=(39, 39, 43, 230))
    draw.rectangle((33, 23, 34, 25), fill=(154, 180, 190, 255))
    draw.rectangle((39, 23, 40, 25), fill=(154, 180, 190, 255))
    for i in range(4):
        x = 20 + i * 9
        draw.ellipse((x, 82, x + 18, 92), fill=(89, 103, 118, 55))


def draw_anchor_pixels(draw: ImageDraw.ImageDraw, pose: Pose) -> None:
    # Tiny debug pixels prove stable overlay anchors without dominating the art.
    for point, color in [
        (pose.left_hand, (80, 150, 255, 180)),
        (pose.right_hand, (255, 170, 80, 180)),
        ((36, 84), (255, 80, 120, 180)),
    ]:
        x, y = point
        draw.point((x, y), fill=color)


def write_manifest(paths: list[Path]) -> None:
    manifest = {
        "schemaVersion": "duskfell-prototype-rig-render-v1",
        "note": "Prototype only. Demonstrates deterministic rig-to-sprite/card output and stable equipment anchors.",
        "cell": {"width": CELL_W, "height": CELL_H, "lowWidth": LOW_W, "lowHeight": LOW_H, "scale": SCALE},
        "directions": DIRECTIONS,
        "frames": FRAMES,
        "anchors": {
            "leftHand": "blue debug pixel per frame",
            "rightHand": "orange debug pixel per frame",
            "foot": "pink debug pixel per frame",
        },
        "outputs": [str(path.relative_to(ROOT)) for path in paths],
    }
    (OUT_DIR / "duskfell-prototype-rig-render-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
