"""Render a camera-correct walk cycle on Duskfell's lean Universal base body.

This is a visual proof for the body/animation contract. Hair and equipment stay
out of the base render so later layers can share the exact same rig and camera.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[2]
PACK = Path(os.environ.get("DUSKFELL_UNIVERSAL_PACK", "/Users/j/Downloads/Universal Base Characters[Standard]"))
BODY_SOURCE = PACK / "Base Characters" / "Godot - UE" / "Superhero_Male_FullBody.gltf"
OUT_DIR = ROOT / "assets" / "sprites" / "candidates" / "universal-retarget"
FRAME_DIR = OUT_DIR / "frames"
PREVIEW_ONLY = os.environ.get("DUSKFELL_PREVIEW_ONLY", "0") == "1"
SHEET = OUT_DIR / ("universal-facing-proof.png" if PREVIEW_ONLY else "duskfell-universal-walk-8x12.png")

CELL_W = 128
CELL_H = 160
SAMPLE_FRAMES = [0, 2, 5, 8, 10, 12, 15, 18, 20, 22, 25, 28]
DIRECTIONS = [
    ("south", 0),
    ("south-east", -45),
    ("east", -90),
    ("north-east", -135),
    ("north", 180),
    ("north-west", 135),
    ("west", 90),
    ("south-west", 45),
]
def main() -> None:
    if not BODY_SOURCE.exists():
        raise FileNotFoundError(BODY_SOURCE)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    clear_scene()
    body_objects = import_gltf(BODY_SOURCE)
    body_armature = one_armature(body_objects, "body")
    body_root = top_root(body_armature, body_objects)
    normalize_body(body_root, body_objects)
    setup_render()
    render_frames(body_armature, body_root)
    assemble_sheet()
    write_metadata()
    print(f"DUSKFELL_SHEET={SHEET}")


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_gltf(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def one_armature(objects: list[bpy.types.Object], label: str) -> bpy.types.Object:
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one {label} armature, found {len(armatures)}")
    return armatures[0]


def top_root(obj: bpy.types.Object, imported: list[bpy.types.Object]) -> bpy.types.Object:
    imported_set = set(imported)
    while obj.parent is not None and obj.parent in imported_set:
        obj = obj.parent
    return obj


def normalize_body(root: bpy.types.Object, objects: list[bpy.types.Object]) -> None:
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    minimum, maximum = bounds(objects)
    height = maximum.z - minimum.z
    scale = 2.22 / height
    root.scale = (scale * 0.78, scale * 0.88, scale * 1.08)
    bpy.context.view_layer.update()
    minimum, maximum = bounds(objects)
    center = (minimum + maximum) * 0.5
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= minimum.z
    root.rotation_mode = "XYZ"


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((1e9, 1e9, 1e9))
    maximum = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, point.x)
            minimum.y = min(minimum.y, point.y)
            minimum.z = min(minimum.z, point.z)
            maximum.x = max(maximum.x, point.x)
            maximum.y = max(maximum.y, point.y)
            maximum.z = max(maximum.z, point.z)
    return minimum, maximum


def setup_render() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_x = CELL_W * 2
    scene.render.resolution_y = CELL_H * 2
    scene.render.resolution_percentage = 100
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("Duskfell character world")
    world.color = (0.02, 0.022, 0.024)
    scene.world = world

    camera_data = bpy.data.cameras.new("Duskfell plan-oblique camera")
    camera = bpy.data.objects.new("Duskfell plan-oblique camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.2
    camera.location = (0, -7.0, 12.0)
    aim(camera, Vector((0, 0, 1.04)))
    scene.camera = camera
    add_light("Key", (-3.5, -4.0, 7.0), 760, 4.0, (1.0, 0.83, 0.67))
    add_light("Fill", (3.8, -2.0, 6.0), 320, 5.0, (0.50, 0.64, 0.80))
    add_light("Rim", (0.5, 4.0, 6.5), 440, 3.0, (0.68, 0.75, 0.86))


def add_light(name: str, location, energy: float, size: float, color) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    aim(light, Vector((0, 0, 1.0)))


def aim(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_frames(body, body_root) -> None:
    frames = [8] if PREVIEW_ONLY else SAMPLE_FRAMES
    for row, (direction, degrees) in enumerate(DIRECTIONS):
        for column, action_frame in enumerate(frames):
            pose_walk(body, action_frame / 30 * math.tau)
            body_root.rotation_euler[2] = math.radians(degrees)
            bpy.context.view_layer.update()
            output = FRAME_DIR / f"{row:02d}-{column:02d}-{direction}.png"
            bpy.context.scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            pixel_style(output)


def pose_walk(body: bpy.types.Object, phase: float) -> None:
    for target in body.pose.bones:
        target.matrix_basis = Matrix.Identity(4)
        target.rotation_mode = "XYZ"

    stride = math.sin(phase)
    counter_stride = -stride
    double_step = math.cos(phase * 2)
    left_lift = max(0.0, -math.sin(phase))
    right_lift = max(0.0, math.sin(phase))
    rotations = {
        "pelvis": (math.radians(1.5 * double_step), 0, math.radians(3.2 * stride)),
        "spine_01": (math.radians(-1.5 * double_step), 0, math.radians(-2.0 * stride)),
        "spine_02": (0, 0, math.radians(-2.0 * stride)),
        "neck_01": (math.radians(2), 0, math.radians(0.8 * stride)),
        "clavicle_l": (0, 0, math.radians(-7)),
        "clavicle_r": (0, 0, math.radians(7)),
        "upperarm_l": (math.radians(-18 * stride), math.radians(3), math.radians(-72)),
        "upperarm_r": (math.radians(18 * stride), math.radians(-3), math.radians(72)),
        "lowerarm_l": (math.radians(2), math.radians(-6), math.radians(-14 - 7 * left_lift)),
        "lowerarm_r": (math.radians(2), math.radians(6), math.radians(14 + 7 * right_lift)),
        "thigh_l": (math.radians(28 * stride), 0, math.radians(2)),
        "thigh_r": (math.radians(28 * counter_stride), 0, math.radians(-2)),
        "calf_l": (math.radians(-8 - 32 * left_lift), 0, 0),
        "calf_r": (math.radians(-8 - 32 * right_lift), 0, 0),
        "foot_l": (math.radians(8 * stride + 10 * left_lift), 0, 0),
        "foot_r": (math.radians(-8 * stride + 10 * right_lift), 0, 0),
    }
    for name, rotation in rotations.items():
        bone = body.pose.bones.get(name)
        if bone is not None:
            bone.rotation_euler = rotation
    pelvis = body.pose.bones.get("pelvis")
    if pelvis is not None:
        pelvis.location.z = 0.015 * (1 - double_step)


def pixel_style(path: Path) -> None:
    subprocess.run(
        [
            "/opt/homebrew/bin/magick",
            str(path),
            "-filter",
            "Lanczos",
            "-resize",
            f"{CELL_W}x{CELL_H}!",
            "-colors",
            "224",
            "PNG32:" + str(path),
        ],
        check=True,
    )


def assemble_sheet() -> None:
    columns = 1 if PREVIEW_ONLY else len(SAMPLE_FRAMES)
    subprocess.run(
        [
            "/opt/homebrew/bin/magick",
            "montage",
            *[str(path) for path in sorted(FRAME_DIR.glob("*.png"))],
            "-tile",
            f"{columns}x{len(DIRECTIONS)}",
            "-geometry",
            f"{CELL_W}x{CELL_H}+0+0",
            "-background",
            "none",
            "PNG32:" + str(SHEET),
        ],
        check=True,
    )


def write_metadata() -> None:
    payload = {
        "schemaVersion": "duskfell-universal-walk-proof-v1",
        "bodySource": str(BODY_SOURCE),
        "animation": "deterministic twelve-phase contact-passing-toeoff gait",
        "directions": [direction for direction, _ in DIRECTIONS],
        "rootYawDegrees": [degrees for _, degrees in DIRECTIONS],
        "frames": [8] if PREVIEW_ONLY else SAMPLE_FRAMES,
        "cell": {"width": CELL_W, "height": CELL_H},
        "hairPolicy": "separate registered overlay",
        "output": str(SHEET.relative_to(ROOT)),
    }
    SHEET.with_suffix(".json").write_text(json.dumps(payload, indent=2) + "\n")


if __name__ == "__main__":
    main()
