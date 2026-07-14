#!/usr/bin/env python3
"""Full world bake: terrain-diffusion region -> Duskfell world.

Fetches elevation+climate for a region window, derives tile semantics
(water from flow accumulation + sea level, fords, rock/dirt/grass from
slope+climate, a flattened settlement disc at the map centre), and writes:

  - world.json patch: materialGrid (base-36), vertexHeights (ints), spawn
  - assets/terrain/world-bundle.json: float heights, heath weights,
    vegetation — the client's WorldData source

Usage:
  python3 generate-world.py --api http://HOST:8000 --offset 4000:0 \
      --world path/to/world.json --bundle path/to/world-bundle.json
"""
import argparse
import json
import urllib.request

import numpy as np

SUPER = 2
TILES_X, TILES_Y = 96, 64  # overridden by --tiles
MATERIALS = ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"]


def fetch_region(api, offset):
    oi, oj = offset
    w, h = TILES_X * SUPER + 1, TILES_Y * SUPER + 1
    url = f"{api}/terrain?i1={oi}&j1={oj}&i2={oi + h}&j2={oj + w}&scale=1"
    resp = urllib.request.urlopen(url, timeout=1800)
    hh, ww = int(resp.headers["X-Height"]), int(resp.headers["X-Width"])
    raw = resp.read()
    elev = np.frombuffer(raw[: hh * ww * 2], dtype="<i2").reshape(hh, ww).astype(np.float32)
    climate = np.frombuffer(raw[hh * ww * 2:], dtype="<f4").reshape(hh, ww, 4)
    return elev, climate


def flow_accumulation(elev):
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", required=True)
    parser.add_argument("--offset", required=True)
    parser.add_argument("--world", required=True)
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--tiles", default="96x64", help="WxH in tiles")
    args = parser.parse_args()
    global TILES_X, TILES_Y
    TILES_X, TILES_Y = [int(v) for v in args.tiles.split("x")]
    oi, oj = [int(v) for v in args.offset.split(":")]

    elev, climate = fetch_region(args.api, (oi, oj))

    # --- settlement: flatten a disc at the map centre before deriving ---
    cy, cx = elev.shape[0] // 2, elev.shape[1] // 2
    yy, xx = np.mgrid[0 : elev.shape[0], 0 : elev.shape[1]]
    centre_dist = np.hypot(yy - cy, xx - cx)
    disc = centre_dist < 9 * SUPER
    plateau = float(np.median(elev[centre_dist < 12 * SUPER]))
    blend = np.clip((centre_dist / (9.0 * SUPER)), 0, 1) ** 2
    elev = np.where(disc, plateau * (1 - blend) + elev * blend, elev)

    # --- water: rivers + sea ---
    acc = flow_accumulation(elev)
    river = acc > np.percentile(acc, 99.0)
    sea_level = np.percentile(elev, 6)
    sea = elev <= sea_level
    water_hi = river | sea
    water_hi[disc] = False  # keep the settlement dry

    # --- per-tile downsample helpers ---
    def tile_reduce(field, fn):
        # (129,193) -> tile grid (64,96) using SUPERxSUPER blocks
        cropped = field[: TILES_Y * SUPER, : TILES_X * SUPER]
        blocks = cropped.reshape(TILES_Y, SUPER, TILES_X, SUPER)
        return fn(blocks, axis=(1, 3))

    tile_water = tile_reduce(water_hi.astype(np.float32), np.mean) > 0.3
    tile_elev = tile_reduce(elev, np.mean)
    gy, gx = np.gradient(elev)
    tile_slope = tile_reduce(np.hypot(gx, gy), np.mean)
    temp = tile_reduce(climate[..., 0], np.mean)
    precip = tile_reduce(climate[..., 2], np.mean)

    land = ~tile_water
    e_lo, e_hi = np.percentile(tile_elev[land], 8), np.percentile(tile_elev[land], 88)
    elev_n = np.clip((tile_elev - e_lo) / max(1e-6, e_hi - e_lo), 0, 1)
    slope_n = np.clip(tile_slope / max(1e-6, np.percentile(tile_slope, 96)), 0, 1)
    tn = (temp - temp.min()) / max(1e-6, temp.max() - temp.min())
    pn = (precip - precip.min()) / max(1e-6, precip.max() - precip.min())

    # --- materials ---
    materials = np.full((TILES_Y, TILES_X), "grass", dtype=object)
    materials[tile_water] = "water"
    materials[land & (slope_n > 0.72) & (elev_n > 0.45)] = "rock"
    # the terraced high country IS mountain: rock body, not farmland at
    # altitude (tile is highland when its mean elevation crosses the
    # terrace threshold used for vertex snapping)
    materials[land & (elev_n > 0.62)] = "rock"
    materials[land & (materials == "grass") & ((pn < 0.22) | (slope_n > 0.5))] = "dirt"
    # settlement disc (tile space)
    ty, tx = np.mgrid[0:TILES_Y, 0:TILES_X]
    t_centre = np.hypot(ty - TILES_Y / 2, tx - TILES_X / 2)
    materials[t_centre < 3.2] = "settlement"
    ring = (t_centre >= 3.2) & (t_centre < 4.6)
    materials[ring & ~tile_water] = "dirt"
    # fords: flat river tiles roughly every 10 tiles along the channel
    river_tiles = np.argwhere(tile_water)
    last_ford = None
    for y, x in river_tiles:
        if slope_n[y, x] > 0.35:
            continue
        if last_ford is not None and abs(int(y) - last_ford[0]) + abs(int(x) - last_ford[1]) < 10:
            continue
        materials[y, x] = "shore"
        last_ford = (int(y), int(x))

    # --- heights ---
    # vertex lattice from the supersampled elevation; ints for the server
    # authority, floats for the client bundle
    vy = np.clip(np.arange(TILES_Y + 1) * SUPER, 0, elev.shape[0] - 1)
    vx = np.clip(np.arange(TILES_X + 1) * SUPER, 0, elev.shape[1] - 1)
    vertex_elev = elev[np.ix_(vy, vx)]
    # TERRACED mountains: real terrain slopes quantize into polite 1-step
    # staircases (fully climbable, visually mild), so instead: highlands
    # snap to the height cap, lowlands compress to 0..2, and the boundary
    # becomes a genuine 2+ step wall the server refuses. A handful of
    # passes are carved back so the high country stays reachable.
    vertex_norm = np.clip((vertex_elev - e_lo) / max(1e-6, e_hi - e_lo), 0, 2)
    highland = vertex_norm > 0.62
    low_f = np.clip(vertex_norm * 3.2, 0, 2.0)
    heights_i = np.where(highland, 4, np.round(low_f)).astype(int)
    heights_i = np.where(vertex_elev <= sea_level, -1, heights_i)

    # carve passes: lowest points of the highland boundary become 3-high
    # saddles ramped from a 2-high approach (1-step chain: 2 -> 3 -> 4)
    boundary = highland & (
        ~np.roll(highland, 1, 0) | ~np.roll(highland, -1, 0)
        | ~np.roll(highland, 1, 1) | ~np.roll(highland, -1, 1)
    )
    by, bx = np.where(boundary)
    if len(by) > 0:
        order = np.argsort(vertex_elev[by, bx])
        passes = []
        for idx in order:
            py, px = int(by[idx]), int(bx[idx])
            if all(abs(py - qy) + abs(px - qx) > 22 for qy, qx in passes):
                passes.append((py, px))
            if len(passes) >= 6:
                break
        vy2, vx2 = np.mgrid[0 : heights_i.shape[0], 0 : heights_i.shape[1]]
        for py, px in passes:
            d = np.hypot(vy2 - py, vx2 - px)
            heights_i = np.where((d <= 1.6) & (heights_i == 4), 3, heights_i)
            heights_i = np.where((d > 1.6) & (d <= 3.4) & (heights_i >= 3) & (heights_i < 4), 3, heights_i)
            heights_i = np.where((d > 1.6) & (d <= 3.4) & (heights_i < 3) & (heights_i >= 0), 2, heights_i)
        print(f"passes carved at: {passes}")

    # PEAK SCULPT: rock is impassable by material on the server, so the
    # massif interior height is pure visuals — BFS depth from the rim lifts
    # interior vertices into terraced peaks with hashed jitter for a jagged
    # skyline (rim stays at the terrace height so lowland tiles don't tilt)
    from collections import deque
    def _vhash01(x, y):
        v = ((x + 37) * 374761393 ^ (y + 91) * 668265263) & 0xffffffff
        v = ((v ^ (v >> 13)) * 1274126177) & 0xffffffff
        return (v % 1000) / 1000
    # drown tarns fully enclosed by the massif — teal water stickers at
    # altitude read as broken graphics, not mountain lakes
    for wy in range(TILES_Y):
        for wx in range(TILES_X):
            if materials[wy, wx] != "water":
                continue
            y0, y1 = max(0, wy - 2), min(TILES_Y, wy + 3)
            x0, x1 = max(0, wx - 2), min(TILES_X, wx + 3)
            box = materials[y0:y1, x0:x1]
            if np.all((box == "water") | (box == "rock") | (box == "stone")):
                materials[wy, wx] = "rock"
    # water stranded above the terrace line reads as teal glitches on the
    # mountainside — no water above height 3
    high_vertex = heights_i >= 3
    high_tile = high_vertex[:-1, :-1] & high_vertex[:-1, 1:] & high_vertex[1:, :-1] & high_vertex[1:, 1:]
    materials[(materials == "water") & high_tile] = "rock"
    # single pass: water crowded by rock (4+ of 8 real neighbours) is a
    # glitchy sliver against a cliff, not a stream — no fixpoint iteration
    # and no off-map counting, which would eat the sea from the coast in
    squeezed = []
    for wy in range(TILES_Y):
        for wx in range(TILES_X):
            if materials[wy, wx] != "water":
                continue
            rocky = sum(
                1
                for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                if (dx or dy)
                and 0 <= wx + dx < TILES_X and 0 <= wy + dy < TILES_Y
                and materials[wy + dy, wx + dx] in ("rock", "stone")
            )
            if rocky >= 4:
                squeezed.append((wx, wy))
    for wx, wy in squeezed:
        materials[wy, wx] = "rock"
    # finally, kill orphan water bodies under 8 tiles — leftover slivers of
    # rerouted streams read as teal glitches, real lakes are far larger
    seen = set()
    from collections import deque as _dq
    for wy in range(TILES_Y):
        for wx in range(TILES_X):
            if materials[wy, wx] != "water" or (wx, wy) in seen:
                continue
            comp = [(wx, wy)]; seen.add((wx, wy)); bfs = _dq([(wx, wy)])
            while bfs:
                cx, cy = bfs.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < TILES_X and 0 <= ny < TILES_Y and materials[ny, nx] == "water" and (nx, ny) not in seen:
                        seen.add((nx, ny)); comp.append((nx, ny)); bfs.append((nx, ny))
            if len(comp) < 8:
                for cx, cy in comp:
                    materials[cy, cx] = "rock"
    rock_tile = (materials == "rock") | (materials == "stone")
    def _is_rock(x, y):
        if x < 0 or y < 0 or x >= TILES_X or y >= TILES_Y:
            return True
        return bool(rock_tile[y, x])
    depth = np.full((TILES_Y + 1, TILES_X + 1), -1, np.int32)
    queue = deque()
    for vy in range(TILES_Y + 1):
        for vx in range(TILES_X + 1):
            if not all(_is_rock(ax, ay) for ax, ay in ((vx-1,vy-1),(vx,vy-1),(vx-1,vy),(vx,vy))):
                depth[vy, vx] = 0
                queue.append((vx, vy))
    while queue:
        x, y = queue.popleft()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x+dx, y+dy
            if 0 <= nx <= TILES_X and 0 <= ny <= TILES_Y and depth[ny, nx] == -1:
                depth[ny, nx] = depth[y, x] + 1
                queue.append((nx, ny))
    for vy in range(TILES_Y + 1):
        for vx in range(TILES_X + 1):
            d = depth[vy, vx]
            if d > 0 and heights_i[vy, vx] >= 4:
                # two rings per bench: wide flat terraces read as coherent
                # cliff bands instead of per-tile salt-and-pepper steps
                heights_i[vy, vx] = min(9, 4 + min((d + 1) // 2, 5))

    # client floats mirror the terraces with a whisper of residual relief
    residual = np.clip(vertex_norm * 3.2 - np.round(np.clip(vertex_norm * 3.2, 0, 2)), -0.4, 0.4)
    heights_f = heights_i.astype(np.float32) + residual * 0.3
    heights_f = np.where(heights_i == -1, -1.0, heights_f)

    heath_v = np.clip(1.2 - (tn * 0.6 + pn * 0.9), 0, 1)
    # vegetation: warm+wet, none in settlement, thin on rock
    vegetation = np.clip(0.25 + pn * 0.6 + tn * 0.25 - slope_n * 0.4, 0, 1)
    vegetation[materials == "settlement"] = 0.0
    vegetation[materials == "rock"] = np.minimum(vegetation[materials == "rock"], 0.12)
    vegetation[t_centre < 5] *= 0.25
    vegetation[tile_water] = 0.0

    # heath weights on the vertex lattice (bilinear-safe)
    heath_vertex = np.zeros((TILES_Y + 1, TILES_X + 1), np.float32)
    heath_vertex[:TILES_Y, :TILES_X] = heath_v
    heath_vertex[TILES_Y, :TILES_X] = heath_v[-1]
    heath_vertex[:TILES_Y, TILES_X] = heath_v[:, -1]
    heath_vertex[TILES_Y, TILES_X] = heath_v[-1, -1]

    # --- write world.json patch ---
    world = json.load(open(args.world))
    legend = world["map"]["terrain"]["materials"]
    grid_rows = []
    for y in range(TILES_Y):
        grid_rows.append("".join(np.base_repr(legend.index(materials[y, x]), 36).lower() for x in range(TILES_X)))
    world["map"]["terrain"]["materialGrid"] = grid_rows
    world["map"]["terrain"]["vertexHeights"] = heights_i.tolist()
    world["map"]["terrain"]["maxElevation"] = int(heights_i.max())
    world["map"]["width"] = TILES_X * 64
    world["map"]["height"] = TILES_Y * 64
    world["spawn"] = {"x": (TILES_X / 2) * 64, "y": (TILES_Y / 2) * 64}
    for obj in world.get("objects", []):
        if obj["kind"] == "registrar":
            obj["x"], obj["y"] = (TILES_X / 2 - 1.5) * 64, (TILES_Y / 2) * 64
        if obj["kind"] == "forge":
            obj["x"], obj["y"] = (TILES_X / 2 + 1.5) * 64, (TILES_Y / 2) * 64
    json.dump(world, open(args.world, "w"), indent=2)

    # --- client bundle ---
    bundle = {
        "version": "duskfell-world-bundle-v1",
        "cols": TILES_X,
        "rows": TILES_Y,
        "materialGrid": grid_rows,
        "heights": [[round(float(v), 2) for v in row] for row in heights_f],
        "heathWeights": [[round(float(v), 3) for v in row] for row in heath_vertex],
        "vegetation": [[round(float(v), 3) for v in row] for row in vegetation],
    }
    json.dump(bundle, open(args.bundle, "w"))
    counts = {}
    for y in range(TILES_Y):
        for x in range(TILES_X):
            counts[materials[y, x]] = counts.get(materials[y, x], 0) + 1
    print("baked:", counts)


if __name__ == "__main__":
    main()
