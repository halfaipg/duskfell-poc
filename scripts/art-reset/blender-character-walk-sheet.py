"""Render a deterministic eight-direction walk sheet from a rigged Blender source.

The source model stays outside the shipped asset set. The output is a flattened,
transparent sprite sheet suitable for the clean-room asset intake pipeline.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "var" / "third-party-model-candidates" / "poly-pizza" / "quaternius-character-animated.glb"
SOURCE = Path(os.environ.get("DUSKFELL_CHARACTER_SOURCE", DEFAULT_SOURCE))
OUT_DIR = ROOT / "assets" / "sprites" / "candidates" / "rig-walk"
FRAME_DIR = OUT_DIR / "frames"

ACTION_NAME = os.environ.get("DUSKFELL_WALK_ACTION", "CharacterArmature|Walk")
PREVIEW_ONLY = os.environ.get("DUSKFELL_PREVIEW_ONLY", "0") == "1"
SHEET_PATH = OUT_DIR / ("rig-walk-facing-proof.png" if PREVIEW_ONLY else "duskfell-rig-walk-8x12.png")
CELL_WIDTH = 128
CELL_HEIGHT = 160
RENDER_SCALE = 2
SAMPLES = [0, 2, 5, 8, 10, 12, 15, 18, 20, 22, 25, 28]
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
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    clear_scene()
    imported = import_source()
    root, armature = find_character(imported)
    action = bpy.data.actions.get(ACTION_NAME)
    if action is None:
        raise RuntimeError(f"Walk action {ACTION_NAME!r} was not found")
    armature.animation_data_create()
    armature.animation_data.action = action
    normalize_character(root, imported)
    setup_render()
    render_frames(root)
    assemble_sheet()
    write_metadata()
    print(f"DUSKFELL_SHEET={SHEET_PATH}")


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_source() -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def find_character(imported: list[bpy.types.Object]) -> tuple[bpy.types.Object, bpy.types.Object]:
    armatures = [obj for obj in imported if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, found {len(armatures)}")
    armature = armatures[0]
    root = armature
    while root.parent is not None and root.parent in imported:
        root = root.parent
    return root, armature


def normalize_character(root: bpy.types.Object, imported: list[bpy.types.Object]) -> None:
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(imported)
    height = maximum.z - minimum.z
    scale = 2.15 / height
    root.scale = (scale * 0.86, scale * 0.92, scale * 1.08)
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(imported)
    center = (minimum + maximum) * 0.5
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= minimum.z


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
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
    scene.render.resolution_x = CELL_WIDTH * RENDER_SCALE
    scene.render.resolution_y = CELL_HEIGHT * RENDER_SCALE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("Duskfell character world")
    world.color = (0.025, 0.028, 0.03)
    scene.world = world

    camera_data = bpy.data.cameras.new("Duskfell plan-oblique camera")
    camera = bpy.data.objects.new("Duskfell plan-oblique camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.72
    camera.location = (0, -7.0, 12.0)
    aim(camera, Vector((0, 0, 1.02)))
    scene.camera = camera

    add_area_light("Key", (-3.2, -4.5, 7.0), 720, 4.5, (1.0, 0.86, 0.70))
    add_area_light("Sky fill", (3.8, -1.0, 5.4), 300, 5.0, (0.48, 0.62, 0.78))
    add_area_light("Rim", (1.0, 4.0, 5.8), 430, 3.0, (0.70, 0.78, 0.88))


def add_area_light(name: str, location, energy: float, size: float, color) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    aim(light, Vector((0, 0, 1.0)))


def aim(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_frames(root: bpy.types.Object) -> None:
    frames = [8] if PREVIEW_ONLY else SAMPLES
    for row, (direction, degrees) in enumerate(DIRECTIONS):
        root.rotation_euler[2] = math.radians(degrees)
        for column, action_frame in enumerate(frames):
            bpy.context.scene.frame_set(action_frame)
            bpy.context.view_layer.update()
            output = FRAME_DIR / f"{row:02d}-{column:02d}-{direction}.png"
            bpy.context.scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            pixel_style(output)


def pixel_style(path: Path) -> None:
    subprocess.run(
        [
            "/opt/homebrew/bin/magick",
            str(path),
            "-filter",
            "Lanczos",
            "-resize",
            f"{CELL_WIDTH}x{CELL_HEIGHT}!",
            "-colors",
            "192",
            "PNG32:" + str(path),
        ],
        check=True,
    )


def assemble_sheet() -> None:
    columns = 1 if PREVIEW_ONLY else len(SAMPLES)
    subprocess.run(
        [
            "/opt/homebrew/bin/magick",
            "montage",
            *[str(path) for path in sorted(FRAME_DIR.glob("*.png"))],
            "-tile",
            f"{columns}x{len(DIRECTIONS)}",
            "-geometry",
            f"{CELL_WIDTH}x{CELL_HEIGHT}+0+0",
            "-background",
            "none",
            "PNG32:" + str(SHEET_PATH),
        ],
        check=True,
    )


def write_metadata() -> None:
    payload = {
        "schemaVersion": "duskfell-rig-walk-proof-v1",
        "source": str(SOURCE),
        "action": ACTION_NAME,
        "directions": [direction for direction, _ in DIRECTIONS],
        "rootYawDegrees": [degrees for _, degrees in DIRECTIONS],
        "frames": [8] if PREVIEW_ONLY else SAMPLES,
        "cell": {"width": CELL_WIDTH, "height": CELL_HEIGHT},
        "camera": {"kind": "orthographic", "location": [0, -7, 12], "orthoScale": 2.72},
        "output": str(SHEET_PATH.relative_to(ROOT)),
    }
    SHEET_PATH.with_suffix(".json").write_text(json.dumps(payload, indent=2) + "\n")


if __name__ == "__main__":
    main()
