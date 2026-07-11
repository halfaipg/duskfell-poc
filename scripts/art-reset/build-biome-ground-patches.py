#!/usr/bin/env python3
"""Build asymmetric 2048px runtime biome patches from reviewed candidates."""

import hashlib
import json
import os
import tempfile
from pathlib import Path

import numpy as np

from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "assets" / "terrain" / "ground-patches"
MANIFEST = ROOT / "assets" / "terrain" / "manifest.json"
SOURCE_SIZE = 1024
PATCH_SIZE = 2048

SOURCES = {
    "meadow": "meadow-a.png",
    "heath": "heath-a.png",
    "chalk": "stone-a.png",
    "frost": "worn-a.png",
    "fen": "dirt-a.png",
    "moor": "dirt-a.png",
    "ash": "rock-a.png",
    "blight": "ruin-a.png",
}

TONES = {
    "meadow": (0.96, 1.00, 1.03),
    "heath": (0.84, 0.93, 1.06),
    "chalk": (0.72, 1.03, 1.05),
    "frost": (0.48, 1.22, 1.04),
    "fen": (0.72, 0.76, 1.08),
    "moor": (0.48, 0.58, 1.16),
    "ash": (0.34, 0.72, 1.18),
    "blight": (0.68, 0.72, 1.16),
}


def terrain_crop(image: Image.Image, biome: str) -> Image.Image:
    width, height = image.size
    crop_size = min(width, height, SOURCE_SIZE)
    left = max(0, (width - crop_size) // 2)
    top = max(0, (height - crop_size) // 2)
    crop = image.crop((left, top, left + crop_size, top + crop_size))
    crop = crop.resize((PATCH_SIZE, PATCH_SIZE), Image.Resampling.LANCZOS)
    color, brightness, contrast = TONES[biome]
    crop = ImageEnhance.Color(crop).enhance(color)
    crop = ImageEnhance.Brightness(crop).enhance(brightness)
    crop = ImageEnhance.Contrast(crop).enhance(contrast)
    crop = crop.filter(ImageFilter.UnsharpMask(radius=1.2, percent=72, threshold=3))
    return feather_tile_edges(add_microvariation(crop, biome))


def add_microvariation(image: Image.Image, biome: str) -> Image.Image:
    seed = int.from_bytes(hashlib.sha256(f"duskfell:{biome}:ground-v2".encode()).digest()[:8], "big")
    rng = np.random.default_rng(seed)
    coarse = rng.normal(0, 1, (192, 192)).astype(np.float32)
    coarse -= coarse.mean()
    coarse /= max(coarse.std(), 0.0001)
    coarse_image = Image.fromarray(np.uint8(np.clip(coarse * 24 + 128, 0, 255)), mode="L")
    coarse_image = coarse_image.resize(image.size, Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(3.2))
    coarse_full = (np.asarray(coarse_image, dtype=np.float32) - 128) / 24
    fine = rng.normal(0, 1, (PATCH_SIZE, PATCH_SIZE)).astype(np.float32)
    variation = 1 + coarse_full * 0.018 + fine * 0.004
    pixels = np.asarray(image, dtype=np.float32) * variation[..., None]
    return Image.fromarray(np.uint8(np.clip(pixels, 0, 255)), mode="RGB")


def feather_tile_edges(image: Image.Image) -> Image.Image:
    """Make opposite edges meet without mirroring the authored center."""
    pixels = np.asarray(image, dtype=np.float32).copy()
    blend = PATCH_SIZE // 6
    weight = ((blend - 1 - np.arange(blend, dtype=np.float32)) / (blend - 1)) ** 2

    left = pixels[:, :blend].copy()
    right_facing = pixels[:, -blend:][:, ::-1].copy()
    average = (left + right_facing) * 0.5
    horizontal_weight = weight[None, :, None]
    pixels[:, :blend] = left * (1 - horizontal_weight) + average * horizontal_weight
    right_blend = right_facing * (1 - horizontal_weight) + average * horizontal_weight
    pixels[:, -blend:] = right_blend[:, ::-1]

    top = pixels[:blend].copy()
    bottom_facing = pixels[-blend:][::-1].copy()
    average = (top + bottom_facing) * 0.5
    vertical_weight = weight[:, None, None]
    pixels[:blend] = top * (1 - vertical_weight) + average * vertical_weight
    bottom_blend = bottom_facing * (1 - vertical_weight) + average * vertical_weight
    pixels[-blend:] = bottom_blend[::-1]
    return Image.fromarray(np.uint8(np.clip(pixels, 0, 255)), mode="RGB")


def symmetry_scores(image: Image.Image) -> tuple[float, float]:
    pixels = np.asarray(image, dtype=np.int16)
    horizontal = float(np.mean(np.abs(pixels - pixels[:, ::-1]))) / 255
    vertical = float(np.mean(np.abs(pixels - pixels[::-1, :]))) / 255
    return horizontal, vertical


def update_manifest(hashes: dict[str, str]) -> None:
    manifest = json.loads(MANIFEST.read_text())
    for patch in manifest["groundPatches"]:
        patch["sha256"] = hashes[patch["biome"]]
        patch["width"] = PATCH_SIZE
        patch["height"] = PATCH_SIZE
    manifest["provenance"]["method"] = "ai-assisted-source-plus-deterministic-asymmetric-upscale"
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    hashes = {}
    staged = {}
    with tempfile.TemporaryDirectory(prefix="duskfell-ground-", dir=OUTPUT) as temporary:
        temporary_dir = Path(temporary)
        for biome, filename in SOURCES.items():
            source = Image.open(OUTPUT / filename).convert("RGB")
            patch = terrain_crop(source, biome)
            horizontal, vertical = symmetry_scores(patch)
            if min(horizontal, vertical) < 0.02:
                raise RuntimeError(
                    f"{biome} patch is too mirror-symmetric: horizontal={horizontal:.4f}, vertical={vertical:.4f}"
                )
            staged_destination = temporary_dir / f"biome-{biome}.webp"
            patch.save(staged_destination, format="WEBP", quality=94, method=6)
            hashes[biome] = hashlib.sha256(staged_destination.read_bytes()).hexdigest()
            staged[biome] = staged_destination
            print(
                (OUTPUT / staged_destination.name).relative_to(ROOT),
                patch.size,
                f"symmetry=({horizontal:.4f},{vertical:.4f})",
            )
        for biome, staged_destination in staged.items():
            os.replace(staged_destination, OUTPUT / f"biome-{biome}.webp")
        update_manifest(hashes)


if __name__ == "__main__":
    main()
