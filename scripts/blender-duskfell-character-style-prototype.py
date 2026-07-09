"""Render a more art-directed Duskfell paperdoll/sprite prototype in Blender.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender-duskfell-character-style-prototype.py

This is still prototype art. The point is to test a production-shaped pipeline:
one stylized body, shared equipment anchors, stable camera, and deterministic
walk frames that can be assembled into paperdoll cards and sprite sheets.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
FRAME_DIR = ROOT / "var" / "blender-duskfell-style-prototype" / "frames"
OUT_DIR.mkdir(parents=True, exist_ok=True)
FRAME_DIR.mkdir(parents=True, exist_ok=True)

LOW_W = 128
LOW_H = 160
DIRECTIONS = ["south", "east", "north", "west"]
FRAMES = 8
VARIANTS = ["base", "leather", "hooded", "ghost"]


def main() -> None:
    setup_scene()
    outputs = []
    for variant in VARIANTS:
        for direction in DIRECTIONS:
            for frame in range(FRAMES):
                reset_scene_objects()
                build_character(frame, variant)
                set_direction(direction)
                path = FRAME_DIR / f"{variant}-{direction}-{frame}.png"
                render_to(path)
                outputs.append(str(path.relative_to(ROOT)))
    write_manifest(outputs)
    for output in outputs:
        print(output)


def setup_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 32
        if hasattr(scene.eevee, "use_gtao"):
            scene.eevee.use_gtao = True
            scene.eevee.gtao_distance = 3
            scene.eevee.gtao_factor = 1.4

    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.1
    scene.view_settings.gamma = 1.0
    scene.world = bpy.data.worlds.new("Duskfell style world")
    scene.world.color = (0.028, 0.024, 0.027)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.location = (0, -6.8, 1.55)
    camera.rotation_euler = (math.radians(81), 0, 0)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 3.35

    key_data = bpy.data.lights.new("Key", "AREA")
    key = bpy.data.objects.new("Key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (-2.8, -4.2, 4.8)
    key.data.energy = 560
    key.data.size = 3.2

    rim_data = bpy.data.lights.new("Rim", "POINT")
    rim = bpy.data.objects.new("Rim", rim_data)
    bpy.context.collection.objects.link(rim)
    rim.location = (2.3, 1.8, 2.5)
    rim.data.energy = 55
    rim.data.color = (0.54, 0.63, 0.68)


def reset_scene_objects() -> None:
    keep = {"Camera", "Key", "Rim"}
    for obj in list(bpy.context.scene.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def build_character(frame: int, variant: str) -> None:
    root = bpy.data.objects.new("RigRoot", None)
    bpy.context.collection.objects.link(root)

    phase = (frame / FRAMES) * math.tau
    stride = math.sin(phase) * 0.28
    lift_left = max(0, math.sin(phase)) * 0.13
    lift_right = max(0, -math.sin(phase)) * 0.13
    arm_swing = -stride * 0.55

    skin = material("skin olive", (0.62, 0.47, 0.36, 1))
    shadow_skin = material("skin shadow", (0.38, 0.27, 0.22, 1))
    hair = material("iron black hair", (0.07, 0.062, 0.055, 1))
    linen = material("aged linen", (0.62, 0.58, 0.47, 1))
    leather = material("blackened leather", (0.12, 0.095, 0.07, 1))
    leather_hi = material("worn leather edge", (0.33, 0.23, 0.15, 1))
    wool = material("dusk wool", (0.13, 0.17, 0.16, 1))
    cloak = material("coal cloak", (0.045, 0.048, 0.052, 1))
    iron = material("dim iron", (0.47, 0.49, 0.47, 1), metallic=0.15)
    spectral = material("gravewash spectral", (0.38, 0.51, 0.56, 0.68), alpha=True)
    spectral_hi = material("gravewash highlight", (0.72, 0.82, 0.82, 0.52), alpha=True)

    if variant == "ghost":
        build_ghost(root, phase, spectral, spectral_hi)
        return

    anchors = build_base_body(root, skin, shadow_skin, hair, stride, lift_left, lift_right, arm_swing)
    add_minimal_covering(root, linen, anchors)

    if variant in {"leather", "hooded"}:
        add_leather_armor(root, wool, leather, leather_hi, iron, anchors)

    if variant == "hooded":
        add_hood_and_cloak(root, cloak, leather, anchors)
        add_spear(root, leather, iron, anchors["right_hand"])
        add_round_shield(root, leather, leather_hi, iron, anchors["left_hand"])


def build_base_body(root, skin, shadow_skin, hair, stride, lift_left, lift_right, arm_swing):
    anchors = {}

    add_tapered_ellipsoid("hips", (0, -0.005, 1.02), (0.30, 0.18, 0.20), shadow_skin, root)
    add_tapered_ellipsoid("ribcage", (0, -0.015, 1.55), (0.33, 0.20, 0.43), skin, root)
    add_tapered_ellipsoid("neck", (0, -0.012, 2.03), (0.11, 0.09, 0.12), skin, root)
    add_tapered_ellipsoid("head", (0, -0.018, 2.28), (0.19, 0.155, 0.23), skin, root)
    add_tapered_ellipsoid("brow_shadow", (0, -0.157, 2.31), (0.145, 0.018, 0.035), shadow_skin, root)
    add_tapered_ellipsoid("hair_cap", (0, -0.01, 2.43), (0.215, 0.165, 0.075), hair, root)
    add_tapered_ellipsoid("hair_tail", (0, 0.045, 2.18), (0.12, 0.08, 0.28), hair, root)

    left_shoulder = Vector((-0.28, -0.01, 1.88))
    right_shoulder = Vector((0.28, -0.01, 1.88))
    left_elbow = Vector((-0.54, -0.03 + arm_swing, 1.42))
    right_elbow = Vector((0.54, -0.03 - arm_swing, 1.42))
    left_hand = Vector((-0.63, -0.30 + arm_swing, 1.08))
    right_hand = Vector((0.63, -0.30 - arm_swing, 1.08))

    limb("left_upper_arm", left_shoulder, left_elbow, 0.06, skin, root)
    limb("right_upper_arm", right_shoulder, right_elbow, 0.06, skin, root)
    limb("left_forearm", left_elbow, left_hand, 0.052, skin, root)
    limb("right_forearm", right_elbow, right_hand, 0.052, skin, root)
    add_tapered_ellipsoid("left_hand", left_hand, (0.07, 0.045, 0.06), shadow_skin, root)
    add_tapered_ellipsoid("right_hand", right_hand, (0.07, 0.045, 0.06), shadow_skin, root)

    left_knee = Vector((-0.16, -stride, 0.58 + lift_left))
    right_knee = Vector((0.16, stride, 0.58 + lift_right))
    left_foot = Vector((-0.18, stride * 0.45 - 0.06, 0.08 + lift_left * 0.35))
    right_foot = Vector((0.18, -stride * 0.45 - 0.06, 0.08 + lift_right * 0.35))

    limb("left_thigh", Vector((-0.16, -0.005, 0.94)), left_knee, 0.078, skin, root)
    limb("right_thigh", Vector((0.16, -0.005, 0.94)), right_knee, 0.078, skin, root)
    limb("left_shin", left_knee, left_foot + Vector((0, 0, 0.11)), 0.064, skin, root)
    limb("right_shin", right_knee, right_foot + Vector((0, 0, 0.11)), 0.064, skin, root)
    add_tapered_ellipsoid("left_foot", left_foot, (0.145, 0.24, 0.04), shadow_skin, root)
    add_tapered_ellipsoid("right_foot", right_foot, (0.145, 0.24, 0.04), shadow_skin, root)

    anchors["left_hand"] = left_hand
    anchors["right_hand"] = right_hand
    anchors["chest"] = Vector((0, -0.03, 1.58))
    anchors["head"] = Vector((0, -0.02, 2.28))
    anchors["hips"] = Vector((0, -0.02, 1.03))
    return anchors


def add_minimal_covering(root, linen, anchors) -> None:
    add_tapered_ellipsoid("chest_bandage", anchors["chest"] + Vector((0, -0.03, 0.10)), (0.36, 0.22, 0.08), linen, root)
    add_tapered_ellipsoid("waist_wrap", anchors["hips"] + Vector((0, -0.02, 0.05)), (0.35, 0.22, 0.12), linen, root)
    add_tapered_ellipsoid("front_linen_fall", anchors["hips"] + Vector((0, -0.12, -0.13)), (0.17, 0.05, 0.25), linen, root)


def add_leather_armor(root, wool, leather, leather_hi, iron, anchors) -> None:
    add_tapered_ellipsoid("quilted_tunic", anchors["chest"] + Vector((0, -0.025, -0.03)), (0.38, 0.235, 0.42), wool, root)
    add_tapered_ellipsoid("belt", anchors["hips"] + Vector((0, -0.04, 0.03)), (0.39, 0.22, 0.055), leather_hi, root)
    limb("cross_strap_a", Vector((-0.27, -0.235, 1.88)), Vector((0.24, -0.25, 1.18)), 0.028, leather, root)
    limb("cross_strap_b", Vector((0.27, -0.232, 1.84)), Vector((-0.18, -0.25, 1.17)), 0.023, leather, root)
    add_tapered_ellipsoid("left_boot", (-0.18, -0.03, 0.23), (0.11, 0.12, 0.16), leather, root)
    add_tapered_ellipsoid("right_boot", (0.18, -0.03, 0.23), (0.11, 0.12, 0.16), leather, root)
    add_tapered_ellipsoid("buckle", (0.0, -0.255, 1.08), (0.055, 0.018, 0.04), iron, root)


def add_hood_and_cloak(root, cloak, leather, anchors) -> None:
    add_tapered_ellipsoid("hood", anchors["head"] + Vector((0, 0.02, 0.00)), (0.28, 0.21, 0.31), cloak, root)
    add_tapered_ellipsoid("hood_void", anchors["head"] + Vector((0, -0.16, 0.0)), (0.145, 0.035, 0.15), material("hood void", (0.012, 0.013, 0.015, 1)), root)
    add_tapered_ellipsoid("cloak_mass", (0, 0.13, 1.20), (0.48, 0.18, 0.82), cloak, root)
    limb("cloak_left_fold", Vector((-0.34, 0.03, 1.72)), Vector((-0.42, 0.10, 0.45)), 0.05, leather, root)
    limb("cloak_right_fold", Vector((0.34, 0.03, 1.72)), Vector((0.42, 0.10, 0.45)), 0.05, leather, root)


def add_round_shield(root, leather, leather_hi, iron, hand: Vector) -> None:
    add_tapered_ellipsoid("shield_round", hand + Vector((-0.10, -0.09, 0.08)), (0.20, 0.045, 0.30), leather, root)
    add_tapered_ellipsoid("shield_rim", hand + Vector((-0.10, -0.105, 0.08)), (0.225, 0.024, 0.325), leather_hi, root)
    add_tapered_ellipsoid("shield_boss", hand + Vector((-0.10, -0.13, 0.08)), (0.060, 0.020, 0.060), iron, root)


def add_spear(root, leather, iron, hand: Vector) -> None:
    limb("spear_shaft", hand + Vector((0.08, -0.05, -0.20)), hand + Vector((0.26, -0.17, 1.45)), 0.020, leather, root)
    add_tapered_ellipsoid("spear_tip", hand + Vector((0.28, -0.18, 1.62)), (0.050, 0.030, 0.155), iron, root)


def build_ghost(root, phase, spectral, spectral_hi) -> None:
    sway = math.sin(phase) * 0.035
    add_tapered_ellipsoid("ghost_core", (sway, 0, 1.35), (0.34, 0.18, 0.72), spectral_hi, root)
    add_tapered_ellipsoid("ghost_shroud", (sway, 0.02, 1.04), (0.48, 0.24, 0.93), spectral, root)
    add_tapered_ellipsoid("ghost_hood", (sway, -0.015, 2.08), (0.30, 0.21, 0.31), spectral_hi, root)
    add_tapered_ellipsoid("ghost_face_void", (sway, -0.15, 2.08), (0.15, 0.035, 0.13), material("ghost void", (0.013, 0.016, 0.02, 1)), root)
    limb("ghost_left_sleeve", Vector((-0.22 + sway, -0.02, 1.56)), Vector((-0.55 + sway, -0.15, 1.22)), 0.07, spectral_hi, root)
    limb("ghost_right_sleeve", Vector((0.22 + sway, -0.02, 1.56)), Vector((0.55 + sway, -0.15, 1.22)), 0.07, spectral_hi, root)
    add_tapered_ellipsoid("ghost_mist", (sway, -0.04, 0.15), (0.64, 0.31, 0.11), material("ghost mist", (0.48, 0.60, 0.63, 0.30), alpha=True), root)


def add_tapered_ellipsoid(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    obj.parent = parent
    bpy.ops.object.shade_smooth()
    return obj


def limb(name, start, end, radius, mat, parent):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    mid = (start_v + end_v) / 2
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=direction.length, location=mid)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    obj.parent = parent
    bpy.ops.object.shade_smooth()
    add_tapered_ellipsoid(f"{name}_joint_a", start_v, (radius * 1.08, radius * 1.08, radius * 1.08), mat, parent)
    add_tapered_ellipsoid(f"{name}_joint_b", end_v, (radius * 1.08, radius * 1.08, radius * 1.08), mat, parent)
    return obj


def material(name, rgba, *, alpha=False, metallic=0.0):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = 0.88
    bsdf.inputs["Metallic"].default_value = metallic
    if alpha:
        bsdf.inputs["Alpha"].default_value = rgba[3]
        mat.blend_method = "BLEND"
        mat.use_screen_refraction = False
        mat.show_transparent_back = False
    return mat


def set_direction(direction: str) -> None:
    root = bpy.data.objects["RigRoot"]
    angles = {
        "south": 0,
        "east": math.radians(90),
        "north": math.radians(180),
        "west": math.radians(270),
    }
    root.rotation_euler = (0, 0, angles[direction])


def render_to(path: Path) -> None:
    scene = bpy.context.scene
    scene.render.resolution_x = LOW_W
    scene.render.resolution_y = LOW_H
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def write_manifest(outputs) -> None:
    manifest = {
        "schemaVersion": "duskfell-character-style-prototype-v1",
        "note": "Art-direction prototype for deterministic Blender character sprites. Prototype only.",
        "blenderVersion": bpy.app.version_string,
        "cell": {"width": LOW_W, "height": LOW_H, "displayScale": 3},
        "directions": DIRECTIONS,
        "frames": FRAMES,
        "variants": VARIANTS,
        "frameOutputs": outputs,
        "assemblyCommand": "python3 scripts/assemble-duskfell-character-style-prototype.py",
    }
    (OUT_DIR / "duskfell-character-style-prototype-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
