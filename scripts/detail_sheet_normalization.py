"""Sprite-sheet cleanup helpers for generated terrain detail art."""

from __future__ import annotations

from PIL import Image


def remove_magenta_screen(image: Image.Image) -> Image.Image:
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pixels = []
    for r, g, b, a in image.getdata():
        key_score = min(r, b) - g * 0.35
        if r > 150 and b > 135 and g < 80 and key_score > 112:
            alpha = 0
        elif r > 120 and b > 110 and g < 110 and key_score > 72:
            alpha = round(a * max(0, min(1, (112 - key_score) / 40)))
        else:
            alpha = a
        if alpha <= 3:
            pixels.append((0, 0, 0, 0))
        else:
            magenta_cap = max(g, min(r, b)) + 18
            pixels.append((min(r, magenta_cap), g, min(b, magenta_cap), alpha))
    out.putdata(pixels)
    return out


def sprite_boxes(image: Image.Image, source_columns: int) -> list[tuple[int, int, int, int]]:
    alpha = image.getchannel("A")
    column_counts = [
        sum(1 for y in range(image.height) if alpha.getpixel((x, y)) > 8)
        for x in range(image.width)
    ]
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x, count in enumerate(column_counts):
        if count > 4 and start is None:
            start = x
        elif count <= 4 and start is not None:
            if x - start > 8:
                runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, image.width))

    if len(runs) != source_columns:
        source_cell_width = image.width / source_columns
        return [
            (
                round(column * source_cell_width),
                0,
                round((column + 1) * source_cell_width),
                image.height,
            )
            for column in range(source_columns)
        ]

    boxes = []
    for left, right in runs:
        padded = (
            max(0, left - 22),
            0,
            min(image.width, right + 22),
            image.height,
        )
        crop_alpha = image.crop(padded).getchannel("A")
        bbox = crop_alpha.getbbox()
        if bbox is None:
            boxes.append(padded)
            continue
        boxes.append(
            (
                padded[0] + bbox[0],
                max(0, padded[1] + bbox[1] - 14),
                padded[0] + bbox[2],
                min(image.height, padded[1] + bbox[3] + 14),
            )
        )
    return boxes


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
                if visited[neighbor] or alpha.getpixel((nx, ny)) <= 8:
                    continue
                visited[neighbor] = 1
                stack.append(neighbor)
        components.append(component)

    if not components:
        return image

    largest = max(len(component) for component in components)
    keep = {
        index
        for component in components
        if len(component) >= max(12, largest * 0.012)
        for index in component
    }
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.putdata([pixel if index in keep else (0, 0, 0, 0) for index, pixel in enumerate(image.getdata())])
    return out


def trim_and_fit(frame: Image.Image, cell: int) -> Image.Image:
    bbox = frame.getchannel("A").getbbox()
    if bbox is None:
        return Image.new("RGBA", (cell, cell), (0, 0, 0, 0))

    trimmed = frame.crop(expand_box(bbox, frame.size, 8))
    scale = min(58 / trimmed.width, 54 / trimmed.height, 1.0)
    resized = trimmed.resize(
        (max(1, round(trimmed.width * scale)), max(1, round(trimmed.height * scale))),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    x = round((cell - resized.width) / 2)
    y = cell - 7 - resized.height
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
