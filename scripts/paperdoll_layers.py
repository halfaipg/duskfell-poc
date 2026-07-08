"""Deterministic equipment layer drawing for paperdoll demo sheets."""

from __future__ import annotations

from PIL import Image, ImageDraw

from paperdoll_demo_config import CELL, COLUMNS, FRAME_COUNT, ROWS


def frame_boxes(sheet: Image.Image) -> list[tuple[int, int, int, int]]:
    boxes = []
    for frame in range(FRAME_COUNT):
        x = (frame % COLUMNS) * CELL
        y = (frame // COLUMNS) * CELL
        alpha = sheet.crop((x, y, x + CELL, y + CELL)).getchannel("A")
        boxes.append(alpha.getbbox() or (42, 20, 86, 116))
    return boxes


def make_layer(draw_fn) -> Image.Image:
    image = Image.new("RGBA", (CELL * COLUMNS, CELL * ROWS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    for frame in range(FRAME_COUNT):
        offset = ((frame % COLUMNS) * CELL, (frame // COLUMNS) * CELL)
        draw_fn(draw, frame, offset)
    return image


def make_legs_layer(boxes, palette) -> Image.Image:
    def draw_frame(draw, frame, offset):
        left, top, right, bottom = boxes[frame]
        ox, oy = offset
        width = right - left
        hips = oy + top + (bottom - top) * 0.54
        knee = oy + top + (bottom - top) * 0.76
        foot = oy + bottom - 4
        phase = ((frame % COLUMNS) - 3.5) / 3.5
        color = palette["legs"]
        for side, stride in ((-1, phase), (1, -phase)):
            x = ox + (left + right) / 2 + side * width * 0.12
            draw.line(
                [
                    (x, hips),
                    (x + stride * 6, knee),
                    (x + stride * 9 + side * 2, foot),
                ],
                fill=color,
                width=7,
            )

    return make_layer(draw_frame)


def make_boots_layer(boxes, palette) -> Image.Image:
    def draw_frame(draw, frame, offset):
        left, top, right, bottom = boxes[frame]
        ox, oy = offset
        center = ox + (left + right) / 2
        phase = ((frame % COLUMNS) - 3.5) / 3.5
        for side, stride in ((-1, phase), (1, -phase)):
            x = center + side * (right - left) * 0.12 + stride * 9
            y = oy + bottom - 7
            draw.rounded_rectangle((x - 7, y - 5, x + 7, y + 3), radius=2, fill=palette["boots"])

    return make_layer(draw_frame)


def make_armor_layer(boxes, palette) -> Image.Image:
    def draw_frame(draw, frame, offset):
        left, top, right, bottom = boxes[frame]
        ox, oy = offset
        cx = ox + (left + right) / 2
        h = bottom - top
        y1 = oy + top + h * 0.23
        y2 = oy + top + h * 0.57
        w1 = (right - left) * 0.32
        w2 = (right - left) * 0.22
        draw.polygon(
            [(cx - w1, y1), (cx + w1, y1), (cx + w2, y2), (cx - w2, y2)],
            fill=palette["armor"],
            outline=(23, 22, 20, 185),
        )
        draw.line([(cx - w1 * 0.8, y1 + 5), (cx + w1 * 0.8, y1 + 5)], fill=palette["trim"], width=2)
        draw.line([(cx - w2, y2 - 3), (cx + w2, y2 - 3)], fill=palette["trim"], width=3)
        draw.ellipse((cx - w1 - 5, y1 + 2, cx - w1 + 6, y1 + 13), fill=palette["armor"])
        draw.ellipse((cx + w1 - 6, y1 + 2, cx + w1 + 5, y1 + 13), fill=palette["armor"])
        for rivet in (-0.45, -0.15, 0.15, 0.45):
            draw.ellipse((cx + rivet * w1 - 1, y1 + 12, cx + rivet * w1 + 1, y1 + 14), fill=palette["trim"])

    return make_layer(draw_frame)


def make_cloak_layer(boxes, palette) -> Image.Image:
    def draw_frame(draw, frame, offset):
        left, top, right, bottom = boxes[frame]
        ox, oy = offset
        row = frame // COLUMNS
        cx = ox + (left + right) / 2
        h = bottom - top
        shoulder = oy + top + h * 0.21
        hem = oy + bottom - 8
        sway = ((frame % COLUMNS) - 3.5) * 0.75
        width = (right - left) * (0.36 if row in (0, 2) else 0.28)
        if row == 1:
            x_bias = -width * 0.35
        elif row == 3:
            x_bias = width * 0.35
        else:
            x_bias = 0
        points = [
            (cx - width + x_bias, shoulder),
            (cx + width + x_bias, shoulder + 2),
            (cx + width * 0.72 + x_bias + sway, hem),
            (cx + x_bias + sway * 0.4, hem - 5),
            (cx - width * 0.72 + x_bias + sway, hem),
        ]
        draw.polygon(points, fill=palette["cloak"], outline=(8, 10, 12, 135))
        draw.line([(cx - width * 0.7 + x_bias, shoulder + 5), (cx - width * 0.5 + x_bias + sway, hem - 4)], fill=(7, 9, 11, 120), width=1)
        draw.line([(cx + width * 0.7 + x_bias, shoulder + 5), (cx + width * 0.5 + x_bias + sway, hem - 4)], fill=(7, 9, 11, 120), width=1)

    return make_layer(draw_frame)


def make_weapon_layer(boxes, palette, variant_id: str) -> Image.Image:
    def draw_frame(draw, frame, offset):
        left, top, right, bottom = boxes[frame]
        ox, oy = offset
        row = frame // COLUMNS
        cx = ox + (left + right) / 2
        h = bottom - top
        hand_y = oy + top + h * 0.47
        color = palette["weapon"]
        outline = (38, 31, 24, 210)
        if variant_id == "ranger":
            x = cx + (right - left) * (0.38 if row != 3 else -0.38)
            draw.arc((x - 12, hand_y - 31, x + 12, hand_y + 31), 260, 100, fill=color, width=3)
            draw.line([(x, hand_y - 27), (x, hand_y + 27)], fill=(215, 204, 160, 150), width=1)
            return
        if variant_id == "warden":
            start = (cx + 21, hand_y + 24)
            end = (cx + 3, hand_y - 30)
            draw.line([start, end], fill=outline, width=5)
            draw.line([start, end], fill=color, width=3)
            draw.rounded_rectangle((end[0] - 8, end[1] - 7, end[0] + 8, end[1] + 4), radius=2, fill=palette["trim"])
            return
        if variant_id == "brigand":
            start = (cx + 18, hand_y + 10)
            end = (cx + 35, hand_y - 13)
            draw.line([start, end], fill=outline, width=5)
            draw.line([start, end], fill=color, width=3)
            draw.polygon([(end[0] - 2, end[1] - 8), (end[0] + 10, end[1] - 3), (end[0] + 1, end[1] + 5)], fill=palette["trim"])
            return
        start = (cx + 22, hand_y + 25)
        end = (cx + 5, hand_y - 38)
        draw.line([start, end], fill=outline, width=5)
        draw.line([start, end], fill=color, width=3)
        draw.polygon([(end[0], end[1] - 11), (end[0] + 7, end[1] + 1), (end[0], end[1] + 8), (end[0] - 7, end[1] + 1)], fill=palette["trim"])

    return make_layer(draw_frame)
