"""Render a deterministic Duskfell tree family from Blender structure.

Run with:
  Blender --background --python scripts/blender-duskfell-tree-family.py -- \
    --output-dir assets/sprites/candidates/blender-tree-family-v1
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


STAGES = {
    "sapling": {"height": 2.25, "radius": 0.105, "branches": 7, "crown": 0.72},
    "mature": {"height": 4.35, "radius": 0.25, "branches": 15, "crown": 1.0},
    "ancient": {"height": 5.55, "radius": 0.42, "branches": 22, "crown": 1.2},
}
SPECIES = (
    {"id": "greenwood", "kind": "broadleaf", "bark": (0.18, 0.085, 0.035, 1), "leaf": (0.075, 0.24, 0.075, 1)},
    {"id": "shadebark", "kind": "conifer", "bark": (0.105, 0.07, 0.045, 1), "leaf": (0.035, 0.13, 0.095, 1)},
    {"id": "ironleaf", "kind": "sparse", "bark": (0.22, 0.13, 0.065, 1), "leaf": (0.2, 0.31, 0.11, 1)},
    {"id": "paleoak", "kind": "broadleaf", "bark": (0.33, 0.27, 0.17, 1), "leaf": (0.28, 0.4, 0.16, 1)},
)
CAMERA = {
    "projection": "orthographic",
    "location": [7.4, -9.4, 7.1],
    "target": [0.0, 0.0, 2.45],
    "orthoScale": 7.35,
    "resolution": [640, 640],
    "anchor": [320, 574],
}


def parse_args() -> argparse.Namespace:
    raw = []
    if "--" in __import__("sys").argv:
        raw = __import__("sys").argv[__import__("sys").argv.index("--") + 1 :]
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--seed", type=int, default=7341)
    return parser.parse_args(raw)


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    setup_scene()
    frames = []
    frame = 0
    for stage_name, stage in STAGES.items():
        for variant, species in enumerate(SPECIES):
            clear_tree()
            rng = random.Random(args.seed + frame * 1009)
            build_tree(stage_name, stage, species, rng)
            path = raw_dir / f"tree-{stage_name}-{variant:02d}.png"
            render(path)
            frames.append(
                {
                    "frame": frame,
                    "stage": stage_name,
                    "variant": variant,
                    "species": species["id"],
                    "kind": species["kind"],
                    "path": path.relative_to(output_dir).as_posix(),
                }
            )
            frame += 1
    bpy.ops.wm.save_as_mainfile(filepath=str(output_dir / "tree-family-structure.blend"))
    (output_dir / "structure-manifest.json").write_text(
        json.dumps(
            {
                "schemaVersion": "duskfell-blender-tree-family-v1",
                "seed": args.seed,
                "camera": CAMERA,
                "frames": frames,
                "authority": {
                    "structure": "Blender trunk, root, branch, and canopy geometry",
                    "timing": "static lifecycle frames",
                    "finishing": "raw Blender render; optional controlled img2img remains review-only",
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def setup_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_x = CAMERA["resolution"][0]
    scene.render.resolution_y = CAMERA["resolution"][1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("DuskfellWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.045, 0.052, 0.043, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.34
    scene.world = world

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = CAMERA["orthoScale"]
    camera.location = Vector(CAMERA["location"])
    camera.rotation_euler = (Vector(CAMERA["target"]) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    add_area_light("Key", (-4.5, -6.0, 9.0), 1250, 5.0, (1.0, 0.79, 0.58))
    add_area_light("Fill", (6.0, 1.0, 6.5), 620, 4.0, (0.47, 0.62, 0.74))
    add_area_light("Rim", (0.0, 7.0, 8.0), 760, 3.0, (0.63, 0.72, 0.58))


def add_area_light(name: str, location, energy: float, size: float, color) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location


def clear_tree() -> None:
    for obj in list(bpy.data.objects):
        if obj.get("duskfell_tree"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for material in list(bpy.data.materials):
        if material.name.startswith("Tree-"):
            bpy.data.materials.remove(material)


def build_tree(stage_name: str, stage: dict, species: dict, rng: random.Random) -> None:
    bark = material("Tree-Bark", species["bark"], roughness=0.86)
    bark_light = material("Tree-Bark-Light", lighten(species["bark"], 1.45), roughness=0.8)
    leaf = material("Tree-Leaf", species["leaf"], roughness=0.92)
    leaf_light = material("Tree-Leaf-Light", lighten(species["leaf"], 1.5), roughness=0.88)
    moss = material("Tree-Moss", (0.16, 0.28, 0.09, 1), roughness=1.0)

    height = stage["height"]
    trunk_points = [Vector((0, 0, 0))]
    for index in range(1, 6):
        t = index / 5
        lean = (rng.uniform(-0.17, 0.17) * t, rng.uniform(-0.12, 0.12) * t, height * t)
        trunk_points.append(Vector(lean))
    for index in range(5):
        t = index / 5
        radius = stage["radius"] * (1 - t * 0.72)
        segment(trunk_points[index], trunk_points[index + 1], radius, radius * 0.78, bark, 8)

    root_count = 4 if stage_name == "sapling" else 7 if stage_name == "mature" else 10
    for index in range(root_count):
        angle = (math.tau * index / root_count) + rng.uniform(-0.2, 0.2)
        length = stage["radius"] * rng.uniform(2.4, 4.2)
        start = Vector((0, 0, stage["radius"] * 0.16))
        end = Vector((math.cos(angle) * length, math.sin(angle) * length, rng.uniform(-0.04, 0.08)))
        segment(start, end, stage["radius"] * 0.48, 0.025, bark, 7)

    tips = []
    for index in range(stage["branches"]):
        t = 0.34 + (index / max(1, stage["branches"] - 1)) * 0.58
        trunk = interpolate_polyline(trunk_points, t)
        angle = index * 2.399963 + rng.uniform(-0.36, 0.36)
        if species["kind"] == "conifer":
            length = stage["crown"] * (1.05 - t * 0.42) * rng.uniform(0.75, 1.05)
            rise = rng.uniform(-0.08, 0.2)
        else:
            length = stage["crown"] * rng.uniform(0.7, 1.3) * (0.7 + t * 0.42)
            rise = rng.uniform(0.16, 0.55)
        elbow = trunk + Vector((math.cos(angle) * length * 0.54, math.sin(angle) * length * 0.54, rise * 0.45))
        tip = trunk + Vector((math.cos(angle) * length, math.sin(angle) * length, rise))
        branch_radius = stage["radius"] * rng.uniform(0.13, 0.28) * (1.08 - t * 0.42)
        segment(trunk, elbow, branch_radius, branch_radius * 0.68, bark, 7)
        segment(elbow, tip, branch_radius * 0.68, 0.018, bark_light if index % 4 == 0 else bark, 6)
        tips.append((tip, angle, t))

    if species["kind"] == "conifer":
        build_conifer_canopy(tips, height, stage, leaf, leaf_light, rng)
    else:
        build_broad_canopy(tips, stage_name, stage, species["kind"], leaf, leaf_light, rng)

    if stage_name != "sapling":
        for index in range(2 if stage_name == "mature" else 5):
            point = interpolate_polyline(trunk_points, 0.12 + index * 0.09)
            moss_cluster(point + Vector((0.04, -0.08, 0)), stage["radius"] * (0.42 + index * 0.04), moss, rng)


def build_broad_canopy(tips, stage_name, stage, kind, leaf, leaf_light, rng) -> None:
    keep = 0.7 if kind == "sparse" else 1.0
    for index, (tip, angle, t) in enumerate(tips):
        if rng.random() > keep:
            continue
        count = 1 if stage_name == "sapling" else 2 if kind == "sparse" else 3
        for cluster in range(count):
            offset = Vector((
                math.cos(angle + cluster * 1.7) * rng.uniform(0.04, 0.25),
                math.sin(angle + cluster * 1.7) * rng.uniform(0.04, 0.25),
                rng.uniform(-0.08, 0.3),
            ))
            radius = stage["crown"] * rng.uniform(0.22, 0.4) * (0.8 + t * 0.25)
            foliage_cluster(tip + offset, radius, leaf_light if (index + cluster) % 5 == 0 else leaf, rng)


def build_conifer_canopy(tips, height, stage, leaf, leaf_light, rng) -> None:
    levels = 4 if stage["height"] < 3 else 7 if stage["height"] < 5 else 9
    for level in range(levels):
        t = 0.24 + level / max(1, levels - 1) * 0.7
        z = height * t
        radius = stage["crown"] * (1.15 - t * 0.82)
        cone(Vector((rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), z)), radius, radius * 0.72, leaf_light if level % 4 == 0 else leaf)


def foliage_cluster(location: Vector, radius: float, mat, rng: random.Random) -> None:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = "Tree-Foliage"
    obj.scale = (rng.uniform(0.75, 1.18), rng.uniform(0.72, 1.14), rng.uniform(0.62, 0.98))
    obj.rotation_euler = tuple(rng.uniform(-0.45, 0.45) for _ in range(3))
    obj.data.materials.append(mat)
    obj["duskfell_tree"] = True
    bevel_modifier(obj, radius * 0.04)


def moss_cluster(location: Vector, radius: float, mat, rng: random.Random) -> None:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = "Tree-Moss"
    obj.scale = (0.7, 0.32, rng.uniform(0.45, 0.7))
    obj.data.materials.append(mat)
    obj["duskfell_tree"] = True


def cone(location: Vector, radius: float, depth: float, mat) -> None:
    bpy.ops.mesh.primitive_cone_add(vertices=9, radius1=radius, radius2=0.04, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = "Tree-Needles"
    obj.data.materials.append(mat)
    obj["duskfell_tree"] = True


def segment(start: Vector, end: Vector, radius1: float, radius2: float, mat, vertices: int) -> None:
    direction = end - start
    if direction.length <= 1e-5:
        return
    midpoint = (start + end) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = "Tree-Branch"
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    obj["duskfell_tree"] = True
    bevel_modifier(obj, min(radius1, radius2) * 0.22)


def bevel_modifier(obj, width: float) -> None:
    if width <= 0.002:
        return
    modifier = obj.modifiers.new("SoftStructure", "BEVEL")
    modifier.width = width
    modifier.segments = 1


def interpolate_polyline(points, t: float) -> Vector:
    scaled = min(0.9999, max(0, t)) * (len(points) - 1)
    index = int(scaled)
    local = scaled - index
    return points[index].lerp(points[index + 1], local)


def material(name: str, color, roughness: float):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def lighten(color, amount: float):
    return tuple(min(1.0, channel * amount) for channel in color[:3]) + (color[3],)


def render(path: Path) -> None:
    scene = bpy.context.scene
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
