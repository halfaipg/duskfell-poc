"""Headless Blender proof for deterministic 3D-to-2D Duskfell sprites.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender-paperdoll-prototype.py

This is prototype art only. It demonstrates the production idea: render the same
rig, equipment, and ghost state from stable camera/direction/frame settings so
paperdoll layers share anchors automatically.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
FRAME_DIR = ROOT / "var" / "blender-paperdoll-prototype" / "frames"
OUT_DIR.mkdir(parents=True, exist_ok=True)
FRAME_DIR.mkdir(parents=True, exist_ok=True)

LOW_W = 96
LOW_H = 128
DIRECTIONS = ["south", "east", "north", "west"]
FRAMES = 4


def main() -> None:
    setup_scene()
    outputs = []
    for variant in ["base", "equipped", "ghost"]:
        for direction in DIRECTIONS:
            for frame in range(FRAMES):
                reset_scene_objects()
                build_character(frame, variant)
                set_direction(direction)
                path = FRAME_DIR / f"{variant}-{direction}-{frame}.png"
                render_to(path, LOW_W, LOW_H)
        outputs.extend(
            str((FRAME_DIR / f"{variant}-{direction}-{frame}.png").relative_to(ROOT))
            for direction in DIRECTIONS
            for frame in range(FRAMES)
        )
    write_manifest(outputs)
    for output in outputs:
        print(output)


def setup_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 16
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.world = bpy.data.worlds.new("Duskfell World")
    scene.world.color = (0.03, 0.025, 0.03)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.location = (0, -7.0, 1.75)
    camera.rotation_euler = (math.radians(82), 0, 0)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 3.5

    light_data = bpy.data.lights.new("Key", "AREA")
    light = bpy.data.objects.new("Key", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (-2.5, -4.0, 5.0)
    light.data.energy = 450
    light.data.size = 3.0


def reset_scene_objects() -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.name not in {"Camera", "Key"}:
            bpy.data.objects.remove(obj, do_unlink=True)


def build_character(frame: int, variant: str) -> None:
    root = bpy.data.objects.new("RigRoot", None)
    bpy.context.collection.objects.link(root)
    swing = [0.0, 0.18, 0.0, -0.18][frame]
    ghost = variant == "ghost"
    equipped = variant == "equipped"

    skin = mat("skin", (0.72, 0.48, 0.36, 1))
    skin_dark = mat("skin_dark", (0.45, 0.29, 0.23, 1))
    linen = mat("linen", (0.55, 0.49, 0.35, 1))
    leather = mat("leather", (0.22, 0.15, 0.1, 1))
    cloth = mat("cloth_green", (0.18, 0.29, 0.21, 1))
    metal = mat("iron", (0.55, 0.58, 0.55, 1))
    spectral = mat("spectral", (0.36, 0.48, 0.58, 0.74), alpha=True)
    spectral_light = mat("spectral_light", (0.62, 0.72, 0.76, 0.58), alpha=True)

    if ghost:
        add_body(root, spectral_light, spectral, ghost=True, swing=swing)
        add_ghost_shroud(root, spectral, spectral_light)
        return

    add_body(root, skin, skin_dark, ghost=False, swing=swing)
    add_base_wrap(root, linen)
    if equipped:
        add_tunic(root, cloth, leather)
        add_shield(root, leather, metal)
        add_spear(root, metal, leather)


def add_body(root, skin, skin_dark, *, ghost: bool, swing: float) -> None:
    add_ellipsoid("torso", (0, 0, 1.55), (0.38, 0.22, 0.6), skin, root)
    add_ellipsoid("head", (0, -0.02, 2.38), (0.22, 0.19, 0.24), skin, root)
    add_ellipsoid("hair", (0, -0.015, 2.49), (0.24, 0.2, 0.08), mat("hair", (0.12, 0.09, 0.065, 1)), root)
    add_limb("left_upper_arm", (-0.34, 0, 1.95), (-0.72, -0.05, 1.55), 0.07, skin, root)
    add_limb("right_upper_arm", (0.34, 0, 1.95), (0.72, -0.05, 1.55), 0.07, skin, root)
    add_limb("left_forearm", (-0.72, -0.05, 1.55), (-0.86, -0.34, 1.28), 0.065, skin, root)
    add_limb("right_forearm", (0.72, -0.05, 1.55), (0.86, -0.34, 1.28), 0.065, skin, root)
    add_ellipsoid("left_hand_anchor", (-0.89, -0.35, 1.25), (0.08, 0.05, 0.07), skin_dark, root)
    add_ellipsoid("right_hand_anchor", (0.89, -0.35, 1.25), (0.08, 0.05, 0.07), skin_dark, root)
    add_limb("left_thigh", (-0.2, 0, 1.05), (-0.28, -swing, 0.55), 0.095, skin, root)
    add_limb("right_thigh", (0.2, 0, 1.05), (0.28, swing, 0.55), 0.095, skin, root)
    add_limb("left_shin", (-0.28, -swing, 0.55), (-0.32, swing * 0.5, 0.1), 0.08, skin, root)
    add_limb("right_shin", (0.28, swing, 0.55), (0.32, -swing * 0.5, 0.1), 0.08, skin, root)
    add_ellipsoid("left_foot_anchor", (-0.34, swing * 0.5 - 0.03, 0.05), (0.15, 0.25, 0.045), skin_dark, root)
    add_ellipsoid("right_foot_anchor", (0.34, -swing * 0.5 - 0.03, 0.05), (0.15, 0.25, 0.045), skin_dark, root)


def add_base_wrap(root, linen) -> None:
    add_ellipsoid("chest_wrap", (0, -0.015, 1.75), (0.42, 0.235, 0.16), linen, root)
    add_ellipsoid("short_wrap", (0, -0.02, 1.03), (0.44, 0.24, 0.18), linen, root)


def add_tunic(root, cloth, leather) -> None:
    add_ellipsoid("padded_jack", (0, -0.02, 1.55), (0.44, 0.26, 0.5), cloth, root)
    add_limb("strap", (-0.31, -0.27, 1.9), (0.32, -0.29, 1.2), 0.035, leather, root)


def add_shield(root, leather, metal) -> None:
    add_ellipsoid("shield", (-0.95, -0.5, 1.2), (0.22, 0.04, 0.32), leather, root)
    add_ellipsoid("shield_boss", (-0.95, -0.55, 1.2), (0.065, 0.02, 0.065), metal, root)


def add_spear(root, metal, leather) -> None:
    add_limb("spear_shaft", (0.92, -0.42, 1.18), (1.12, -0.55, 2.55), 0.025, leather, root)
    add_ellipsoid("spear_tip", (1.16, -0.57, 2.68), (0.055, 0.035, 0.16), metal, root)


def add_ghost_shroud(root, spectral, spectral_light) -> None:
    add_ellipsoid("ghost_robe", (0, 0, 1.18), (0.55, 0.28, 1.05), spectral, root)
    add_ellipsoid("ghost_hood", (0, -0.02, 2.28), (0.36, 0.24, 0.38), spectral_light, root)
    add_ellipsoid("ghost_void", (0, -0.22, 2.25), (0.2, 0.04, 0.18), mat("void", (0.025, 0.025, 0.035, 1)), root)
    add_ellipsoid("ghost_mist", (0, -0.08, 0.05), (0.75, 0.35, 0.12), mat("mist", (0.45, 0.55, 0.62, 0.32), alpha=True), root)


def add_ellipsoid(name, location, scale, material, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def add_limb(name, start, end, radius, material, parent):
    start_v = Vector(start)
    end_v = Vector(end)
    mid = (start_v + end_v) / 2
    length = (end_v - start_v).length
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=length, location=mid)
    obj = bpy.context.object
    obj.name = name
    direction = end_v - start_v
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def mat(name, rgba, *, alpha=False):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    material = bpy.data.materials.new(name)
    material.diffuse_color = rgba
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = 0.82
    if alpha:
        bsdf.inputs["Alpha"].default_value = rgba[3]
        material.blend_method = "BLEND"
        material.use_screen_refraction = False
    return material


def set_direction(direction: str) -> None:
    root = bpy.data.objects["RigRoot"]
    angles = {"south": 0, "east": math.radians(90), "north": math.radians(180), "west": math.radians(270)}
    root.rotation_euler = (0, 0, angles[direction])


def render_to(path: Path, width: int, height: int) -> None:
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def write_manifest(outputs) -> None:
    manifest = {
        "schemaVersion": "duskfell-blender-prototype-v1",
        "note": "Prototype only. Deterministic Blender 3D-to-2D render showing stable body/equipment/ghost anchors.",
        "blenderVersion": bpy.app.version_string,
        "cell": {"width": LOW_W, "height": LOW_H, "displayScale": 3},
        "directions": DIRECTIONS,
        "frames": FRAMES,
        "frameOutputs": outputs,
        "assemblyCommand": "python3 scripts/assemble-blender-paperdoll-prototype.py",
    }
    (OUT_DIR / "duskfell-blender-prototype-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
