"""Small RGBA drawing primitives shared by generated asset scripts."""

from __future__ import annotations

from PIL import Image


def shade(color: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(channel * factor))) for channel in color)


def mix(left: tuple[int, int, int], right: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(left[index] * (1 - amount) + right[index] * amount) for index in range(3))


def rect(image: Image.Image, x: int, y: int, width: int, height: int, color: tuple[int, int, int, int]) -> None:
    for py in range(y, y + height):
        for px in range(x, x + width):
            put_pixel(image, px, py, color)


def ellipse(image: Image.Image, cx: int, cy: int, rx: int, ry: int, color: tuple[int, int, int, int]) -> None:
    for py in range(cy - ry, cy + ry + 1):
        for px in range(cx - rx, cx + rx + 1):
            nx = (px - cx) / max(1, rx)
            ny = (py - cy) / max(1, ry)
            if nx * nx + ny * ny <= 1:
                put_pixel(image, px, py, color)


def polygon(image: Image.Image, points: list[tuple[int, int]], color: tuple[int, int, int, int]) -> None:
    if not points:
        return
    min_x = min(x for x, _ in points)
    max_x = max(x for x, _ in points)
    min_y = min(y for _, y in points)
    max_y = max(y for _, y in points)
    for py in range(min_y, max_y + 1):
        for px in range(min_x, max_x + 1):
            if point_in_polygon(px + 0.5, py + 0.5, points):
                put_pixel(image, px, py, color)


def point_in_polygon(x: float, y: float, points: list[tuple[int, int]]) -> bool:
    inside = False
    j = len(points) - 1
    for i, point in enumerate(points):
        xi, yi = point
        xj, yj = points[j]
        if (yi > y) != (yj > y):
            intersect = (xj - xi) * (y - yi) / max(0.0001, yj - yi) + xi
            if x < intersect:
                inside = not inside
        j = i
    return inside


def line(
    image: Image.Image,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: tuple[int, int, int, int],
    width: int = 1,
) -> None:
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    x = x0
    y = y0
    while True:
        for py in range(y - width // 2, y + width // 2 + 1):
            for px in range(x - width // 2, x + width // 2 + 1):
                put_pixel(image, px, py, color)
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy


def draw_leaf_chip(
    image: Image.Image,
    x: int,
    y: int,
    width: int,
    height: int,
    color: tuple[int, int, int, int],
    seed: int,
) -> None:
    points = [
        (x, y + height // 2),
        (x + width // 3, y),
        (x + width, y + (seed % 3)),
        (x + width - 1, y + height),
        (x + width // 4, y + height + ((seed // 3) % 2)),
    ]
    polygon(image, points, color)


def put_pixel(image: Image.Image, x: int, y: int, color: tuple[int, int, int, int]) -> None:
    if x < 0 or y < 0 or x >= image.width or y >= image.height:
        return
    src_r, src_g, src_b, src_a = color
    if src_a >= 255:
        image.putpixel((x, y), color)
        return
    dst_r, dst_g, dst_b, dst_a = image.getpixel((x, y))
    alpha = src_a / 255
    out_a = src_a + dst_a * (1 - alpha)
    if out_a <= 0:
        image.putpixel((x, y), (0, 0, 0, 0))
        return
    out = (
        round((src_r * src_a + dst_r * dst_a * (1 - alpha)) / out_a),
        round((src_g * src_a + dst_g * dst_a * (1 - alpha)) / out_a),
        round((src_b * src_a + dst_b * dst_a * (1 - alpha)) / out_a),
        round(out_a),
    )
    image.putpixel((x, y), out)
