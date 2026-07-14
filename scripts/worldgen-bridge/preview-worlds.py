#!/usr/bin/env python3
"""Candidate world previews from the terrain-diffusion API.

For each seed: POST /seed, fetch an elevation+climate region, derive a
Duskfell-style read (hillshade, river from flow accumulation, heath/meadow
tint from climate), and render a preview board. The full bake
(generate-world.py) shares this derivation.

Usage:
  python3 preview-worlds.py --api http://192.168.66.52:8000 \
      --seeds 11,12,13,14,15,16 --out /tmp/world-previews
"""
import argparse
import io
import json
import os
import urllib.request

import numpy as np
from PIL import Image

TILES_X, TILES_Y = 96, 64
SUPER = 2  # samples per tile


def fetch_region(api, offset):
    """One candidate = one far-apart window of the infinite world."""
    oi, oj = offset
    w, h = TILES_X * SUPER + 1, TILES_Y * SUPER + 1
    url = f"{api}/terrain?i1={oi}&j1={oj}&i2={oi + h}&j2={oj + w}&scale=1"
    resp = urllib.request.urlopen(url, timeout=1800)
    hh = int(resp.headers["X-Height"])
    ww = int(resp.headers["X-Width"])
    raw = resp.read()
    elev = np.frombuffer(raw[: hh * ww * 2], dtype="<i2").reshape(hh, ww).astype(np.float32)
    climate = np.frombuffer(raw[hh * ww * 2:], dtype="<f4").reshape(hh, ww, 4)
    return elev, climate


def flow_accumulation(elev):
    """Cheap D8 flow accumulation for river derivation."""
    h, w = elev.shape
    order = np.dstack(np.unravel_index(np.argsort(elev, axis=None)[::-1], elev.shape))[0]
    acc = np.ones_like(elev)
    for y, x in order:
        best, bx, by = 0, -1, -1
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w:
                    drop = elev[y, x] - elev[ny, nx]
                    if drop > best:
                        best, bx, by = drop, nx, ny
        if bx >= 0:
            acc[by, bx] += acc[y, x]
    return acc


def derive(elev, climate):
    acc = flow_accumulation(elev)
    river = acc > np.percentile(acc, 99.2)
    sea = elev <= np.percentile(elev, 6)
    water = river | sea
    temp = climate[..., 0]
    precip = climate[..., 2]
    # heath: colder / drier end of the local climate spread
    tn = (temp - temp.min()) / max(1e-6, temp.max() - temp.min())
    pn = (precip - precip.min()) / max(1e-6, precip.max() - precip.min())
    heath = np.clip(1.2 - (tn * 0.6 + pn * 0.9), 0, 1)
    return water, heath


def hillshade(elev, az=315, alt=45):
    gy, gx = np.gradient(elev)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy) * 0.05)
    aspect = np.arctan2(-gx, gy)
    azr, altr = np.radians(az), np.radians(alt)
    shade = np.sin(altr) * np.sin(slope) + np.cos(altr) * np.cos(slope) * np.cos(azr - aspect)
    return np.clip((shade + 1) / 2, 0, 1)


def render(elev, water, heath, seed):
    shade = hillshade(elev)
    meadow = np.array([106, 124, 78], np.float32)
    heathc = np.array([86, 82, 96], np.float32)
    rgb = (meadow[None, None] * (1 - heath[..., None]) + heathc[None, None] * heath[..., None])
    rgb *= (0.45 + shade[..., None] * 0.75)
    rgb[water] = np.array([52, 78, 92], np.float32) * (0.6 + shade[water, None] * 0.5)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    img = img.resize((img.width * 3, img.height * 3), Image.NEAREST)
    return img


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", required=True)
    parser.add_argument("--offsets", required=True, help="i:j,i:j,…")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for label, pair in enumerate([p.split(":") for p in args.offsets.split(",")], start=1):
        offset = (int(pair[0]), int(pair[1]))
        print(f"candidate {label} @ {offset}: fetching…", flush=True)
        elev, climate = fetch_region(args.api, offset)
        water, heath = derive(elev, climate)
        img = render(elev, water, heath, label)
        path = os.path.join(args.out, f"world-{label}.png")
        img.save(path)
        print(f"candidate {label}: {path} | elev {elev.min():.0f}..{elev.max():.0f}m | water {water.mean()*100:.1f}%", flush=True)


if __name__ == "__main__":
    main()
