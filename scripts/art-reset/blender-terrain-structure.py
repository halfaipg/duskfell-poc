"""Render a deterministic terrain structure pass for img2img enrichment.

Run with Blender, for example:
  blender --background --python scripts/art-reset/blender-terrain-structure.py -- \
    --output assets/terrain/candidates/proof-structure.png --seed 7341 --size 1024
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--metadata")
    parser.add_argument("--seed", type=int, default=7341)
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--grid", type=int, default=128)
    parser.add_argument("--extent", type=float, default=16.0)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def fade(value: float) -> float:
    return value * value * (3.0 - 2.0 * value)


def hash01(x: int, y: int, seed: int) -> float:
    value = (x * 374761393 + y * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    value = ((value ^ (value >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((value ^ (value >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF


def value_noise(x: float, y: float, seed: int) -> float:
    x0 = math.floor(x)
    y0 = math.floor(y)
    fx = fade(x - x0)
    fy = fade(y - y0)
    north = hash01(x0, y0, seed) * (1.0 - fx) + hash01(x0 + 1, y0, seed) * fx
    south = hash01(x0, y0 + 1, seed) * (1.0 - fx) + hash01(x0 + 1, y0 + 1, seed) * fx
    return (north * (1.0 - fy) + south * fy) * 2.0 - 1.0


def fbm(x: float, y: float, seed: int) -> float:
    total = 0.0
    amplitude = 0.58
    frequency = 0.34
    for octave in range(5):
        total += value_noise(x * frequency, y * frequency, seed + octave * 977) * amplitude
        frequency *= 2.03
        amplitude *= 0.48
    return total


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 0.0
    normalized = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return normalized * normalized * (3.0 - 2.0 * normalized)


def terrain_sample(x: float, y: float, seed: int) -> dict[str, float]:
    phase = (seed % 1009) / 1009.0 * math.tau
    river_center = -0.9 + math.sin(y * 0.38 + phase) * 1.85 + math.sin(y * 0.91 - phase * 0.7) * 0.42
    river_width = 0.72 + (value_noise(y * 0.27, 2.7, seed + 211) + 1.0) * 0.18
    river_distance = abs(x - river_center)
    channel = 1.0 - smoothstep(river_width * 0.72, river_width * 1.44, river_distance)
    bank = 1.0 - smoothstep(river_width * 1.05, river_width * 2.05, river_distance)

    broad = fbm(x * 0.62 + 8.3, y * 0.62 - 3.1, seed)
    detail = fbm(x * 1.74 - 9.0, y * 1.74 + 4.0, seed + 409)
    ridge_gate = smoothstep(0.8, 5.8, x + broad * 1.4)
    ridge = ridge_gate * (0.35 + max(0.0, broad + 0.12) * 1.05)
    height = 0.48 + broad * 0.18 + detail * 0.045 + ridge - channel * 1.08 - bank * 0.08

    heath = smoothstep(-0.18, 0.34, fbm(x * 0.48 - 15.0, y * 0.48 + 12.0, seed + 907))
    rock = smoothstep(0.78, 1.28, height + broad * 0.42)
    shore = max(0.0, bank - channel)
    return {
        "height": height,
        "channel": channel,
        "shore": shore,
        "rock": rock,
        "heath": heath,
    }


def make_material(name: str, color: tuple[float, float, float, float], roughness: float = 0.88) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    return material


def build_terrain(args: argparse.Namespace) -> bpy.types.Object:
    grid = args.grid
    extent = args.extent
    step = extent / grid
    half = extent / 2.0
    vertices = []
    samples = []
    for row in range(grid + 1):
        y = -half + row * step
        for column in range(grid + 1):
            x = -half + column * step
            sample = terrain_sample(x, y, args.seed)
            vertices.append((x, y, sample["height"]))
            samples.append(sample)

    faces = []
    for row in range(grid):
        for column in range(grid):
            first = row * (grid + 1) + column
            faces.append((first, first + 1, first + grid + 2, first + grid + 1))

    mesh = bpy.data.meshes.new("DuskfellTerrainStructure")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    terrain = bpy.data.objects.new("DuskfellTerrainStructure", mesh)
    bpy.context.collection.objects.link(terrain)

    materials = [
        make_material("Meadow", (0.20, 0.31, 0.10, 1.0)),
        make_material("Heath", (0.29, 0.25, 0.13, 1.0)),
        make_material("Shore", (0.31, 0.28, 0.20, 1.0)),
        make_material("Rock", (0.29, 0.31, 0.30, 1.0)),
        make_material("Mud", (0.19, 0.16, 0.10, 1.0)),
    ]
    for material in materials:
        terrain.data.materials.append(material)

    for face_index, polygon in enumerate(mesh.polygons):
        row = face_index // grid
        column = face_index % grid
        indices = [
            row * (grid + 1) + column,
            row * (grid + 1) + column + 1,
            (row + 1) * (grid + 1) + column,
            (row + 1) * (grid + 1) + column + 1,
        ]
        sample = {key: sum(samples[index][key] for index in indices) / 4.0 for key in samples[0]}
        if sample["channel"] > 0.52:
            polygon.material_index = 4
        elif sample["rock"] > 0.48:
            polygon.material_index = 3
        elif sample["shore"] > 0.26:
            polygon.material_index = 2
        elif sample["heath"] > 0.55:
            polygon.material_index = 1
        else:
            polygon.material_index = 0

    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return terrain


def add_water(args: argparse.Namespace) -> None:
    bpy.ops.mesh.primitive_plane_add(size=args.extent * 1.25, location=(0.0, 0.0, -0.04))
    water = bpy.context.object
    water.name = "WaterIntersectionPlane"
    material = make_material("Water", (0.055, 0.22, 0.25, 1.0), 0.32)
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Metallic"].default_value = 0.08
    water.data.materials.append(material)


def add_scattered_stones(args: argparse.Namespace) -> None:
    rng = random.Random(args.seed + 1201)
    stone_material = make_material("LooseStone", (0.25, 0.27, 0.26, 1.0))
    for index in range(90):
        x = rng.uniform(-args.extent * 0.48, args.extent * 0.48)
        y = rng.uniform(-args.extent * 0.48, args.extent * 0.48)
        sample = terrain_sample(x, y, args.seed)
        if sample["channel"] > 0.12 or sample["rock"] < 0.18:
            continue
        radius = rng.uniform(0.035, 0.12)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=(x, y, sample["height"] + radius * 0.35))
        stone = bpy.context.object
        stone.name = f"LooseStone-{index:03d}"
        stone.scale = (rng.uniform(1.0, 2.0), rng.uniform(0.65, 1.25), rng.uniform(0.25, 0.55))
        stone.rotation_euler[2] = rng.uniform(0.0, math.tau)
        stone.data.materials.append(stone_material)


def configure_render(args: argparse.Namespace, output: Path) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.size
    scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(output)
    scene.render.film_transparent = False
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("DuskfellWorld") if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.06, 0.065, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.58

    camera_data = bpy.data.cameras.new("StructureCamera")
    camera = bpy.data.objects.new("StructureCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0.0, 0.0, 20.0)
    camera.rotation_euler = (0.0, 0.0, 0.0)
    camera.rotation_euler[0] = 0.0
    camera.rotation_euler[1] = 0.0
    camera.rotation_euler[2] = 0.0
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = Vector((0.0, 0.0, -1.0)).to_track_quat("-Z", "Y")
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = args.extent
    scene.camera = camera

    light_data = bpy.data.lights.new("Softbox", "AREA")
    light = bpy.data.objects.new("Softbox", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (-6.0, -8.0, 14.0)
    light.data.energy = 1250.0
    light.data.shape = "DISK"
    light.data.size = 12.0

    fill_data = bpy.data.lights.new("Fill", "AREA")
    fill = bpy.data.objects.new("Fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (8.0, 5.0, 9.0)
    fill.data.energy = 420.0
    fill.data.size = 10.0


def main() -> None:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    reset_scene()
    build_terrain(args)
    add_water(args)
    add_scattered_stones(args)
    configure_render(args, output)
    bpy.ops.wm.save_as_mainfile(filepath=str(output.with_suffix(".blend")))
    bpy.ops.render.render(write_still=True)

    metadata_path = Path(args.metadata).expanduser().resolve() if args.metadata else output.with_suffix(".json")
    metadata_path.write_text(
        json.dumps(
            {
                "schemaVersion": "duskfell-terrain-structure-proof-v1",
                "output": output.name,
                "blend": output.with_suffix(".blend").name,
                "seed": args.seed,
                "size": args.size,
                "grid": args.grid,
                "extent": args.extent,
                "projection": "orthographic-plan",
                "purpose": "deterministic structure input for whole-patch img2img enrichment",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
