"""Source cleanup and grid fitting for generated actor sheets."""

from __future__ import annotations

from PIL import Image

from actor_sheet_config import CELL


GREEN_WEIGHT = 1.0
RED_BLUE_WEIGHT = 0.62
KEY_THRESHOLD = 54
OPAQUE_THRESHOLD = 90


def remove_green_screen(image: Image.Image) -> Image.Image:
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pixels = []
    for r, g, b, a in image.getdata():
        key_score = g * GREEN_WEIGHT - max(r, b) * RED_BLUE_WEIGHT
        if key_score >= OPAQUE_THRESHOLD:
            alpha = 0
        elif key_score <= KEY_THRESHOLD:
            alpha = a
        else:
            alpha = round(a * (OPAQUE_THRESHOLD - key_score) / (OPAQUE_THRESHOLD - KEY_THRESHOLD))
        if alpha <= 3:
            pixels.append((0, 0, 0, 0))
        else:
            # Despill the green matte without flattening the warm leather highlights.
            green_cap = max(r, b) + 22
            pixels.append((r, min(g, green_cap), b, alpha))
    out.putdata(pixels)
    return out


def remove_detached_artifacts(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    width, height = image.size
    visited = bytearray(width * height)
    components: list[list[int]] = []

    for index, value in enumerate(alpha.getdata()):
        if value <= 8 or visited[index]:
            continue
        stack = [index]
        visited[index] = 1
        component = []
        while stack:
            current = stack.pop()
            component.append(current)
            x = current % width
            y = current // width
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= width or ny >= height:
                    continue
                neighbor = ny * width + nx
                if visited[neighbor]:
                    continue
                if alpha.getpixel((nx, ny)) <= 8:
                    continue
                visited[neighbor] = 1
                stack.append(neighbor)
        components.append(component)

    if not components:
        return image

    largest = max(len(component) for component in components)
    keep = {index for component in components if len(component) >= max(90, largest * 0.035) for index in component}
    pixels = list(image.getdata())
    cleaned = []
    for index, pixel in enumerate(pixels):
        cleaned.append(pixel if index in keep else (0, 0, 0, 0))
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.putdata(cleaned)
    return out


def trim_and_fit(frame: Image.Image) -> Image.Image:
    alpha = frame.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))

    trimmed = frame.crop(expand_box(bbox, frame.size, 6))
    scale = min(98 / trimmed.width, 108 / trimmed.height, 1.0)
    target_size = (
        max(1, round(trimmed.width * scale)),
        max(1, round(trimmed.height * scale)),
    )
    resized = trimmed.resize(target_size, Image.Resampling.LANCZOS)

    output = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    x = round((CELL - resized.width) / 2)
    y = CELL - 12 - resized.height
    output.alpha_composite(resized, (x, y))
    return output


def expand_box(box: tuple[int, int, int, int], size: tuple[int, int], padding: int) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    width, height = size
    return (
        max(0, left - padding),
        max(0, top - padding),
        min(width, right + padding),
        min(height, bottom + padding),
    )
