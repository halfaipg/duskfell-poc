"""Generated body-sheet cleanup for paperdoll demo assets."""

from __future__ import annotations

from PIL import Image

from paperdoll_demo_config import ANCHOR, CELL, COLUMNS, ROWS


def normalize_body_sheet(source: Image.Image) -> Image.Image:
    sheet = Image.new("RGBA", (CELL * COLUMNS, CELL * ROWS), (0, 0, 0, 0))
    source_cell_width = source.width / COLUMNS
    source_cell_height = source.height / ROWS

    for row in range(ROWS):
        for column in range(COLUMNS):
            box = (
                round(column * source_cell_width),
                round(row * source_cell_height),
                round((column + 1) * source_cell_width),
                round((row + 1) * source_cell_height),
            )
            frame = source.crop(box)
            frame = remove_green_screen(frame)
            frame = remove_detached_artifacts(frame)
            frame = trim_and_fit(frame)
            sheet.alpha_composite(frame, (column * CELL, row * CELL))
    return sheet


def remove_green_screen(image: Image.Image) -> Image.Image:
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pixels = []
    for r, g, b, a in image.getdata():
        key_score = g - max(r, b) * 0.55
        if key_score >= 90:
            alpha = 0
        elif key_score <= 42:
            alpha = a
        else:
            alpha = round(a * (90 - key_score) / 48)
        if alpha <= 4:
            pixels.append((0, 0, 0, 0))
        else:
            pixels.append((r, min(g, max(r, b) + 18), b, alpha))
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
                if visited[neighbor] or alpha.getpixel((nx, ny)) <= 8:
                    continue
                visited[neighbor] = 1
                stack.append(neighbor)
        components.append(component)

    if not components:
        return image

    largest = max(len(component) for component in components)
    keep = {index for component in components if len(component) >= max(80, largest * 0.04) for index in component}
    pixels = [pixel if index in keep else (0, 0, 0, 0) for index, pixel in enumerate(image.getdata())]
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.putdata(pixels)
    return out


def trim_and_fit(frame: Image.Image) -> Image.Image:
    bbox = frame.getchannel("A").getbbox()
    if bbox is None:
        return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    trimmed = frame.crop(expand_box(bbox, frame.size, 6))
    scale = min(78 / trimmed.width, 118 / trimmed.height, 1.0)
    size = (max(1, round(trimmed.width * scale)), max(1, round(trimmed.height * scale)))
    resized = trimmed.resize(size, Image.Resampling.LANCZOS)
    output = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    output.alpha_composite(resized, (round((CELL - size[0]) / 2), ANCHOR["y"] - size[1]))
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
