"""Render a bespoke painted Duskfell paperdoll built directly in Blender."""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)

DIRECTIONS = {
    "south": 0,
    "east": math.radians(90),
    "north": math.radians(180),
    "west": math.radians(270),
}


def main() -> None:
    setup_scene()
    render_paperdoll()
    render_directions()
    write_manifest()


def setup_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 192
        if hasattr(scene.eevee, "use_gtao"):
            scene.eevee.use_gtao = True
            scene.eevee.gtao_distance = 3
            scene.eevee.gtao_factor = 1.45
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.world = bpy.data.worlds.new("Duskfell painted paperdoll world")
    scene.world.color = (0.026, 0.024, 0.026)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"

    key_data = bpy.data.lights.new("Key", "AREA")
    key = bpy.data.objects.new("Key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (-3.2, -5.0, 5.6)
    key.data.energy = 720
    key.data.size = 4.8

    fill_data = bpy.data.lights.new("Warm fill", "POINT")
    fill = bpy.data.objects.new("Warm fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (2.0, -2.9, 2.3)
    fill.data.energy = 44
    fill.data.color = (0.74, 0.55, 0.38)

    rim_data = bpy.data.lights.new("Cool rim", "POINT")
    rim = bpy.data.objects.new("Cool rim", rim_data)
    bpy.context.collection.objects.link(rim)
    rim.location = (2.4, 1.7, 3.0)
    rim.data.energy = 62
    rim.data.color = (0.42, 0.48, 0.52)


def render_paperdoll() -> None:
    reset_scene()
    root = build_character("paperdoll")
    root.rotation_euler = (0, 0, math.radians(2))
    aim_camera((0, -7.4, 1.34), (0, 0, 1.08), 2.58)
    render_to(OUT_DIR / "duskfell-painted-paperdoll.png", 420, 560)


def render_directions() -> None:
    for direction, angle in DIRECTIONS.items():
        reset_scene()
        root = build_character(direction)
        root.rotation_euler = (0, 0, angle)
        aim_camera((0, -7.4, 1.34), (0, 0, 1.08), 2.70)
        render_to(OUT_DIR / f"duskfell-painted-{direction}.png", 280, 380)


def reset_scene() -> None:
    keep = {"Camera", "Key", "Warm fill", "Cool rim"}
    for obj in list(bpy.context.scene.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def build_character(pose: str):
    root = bpy.data.objects.new(f"duskfell_painted_{pose}", None)
    bpy.context.collection.objects.link(root)

    skin = material("skin warm muted", (0.48, 0.32, 0.22, 1))
    skin_shadow = material("skin shadow", (0.32, 0.19, 0.13, 1))
    hair = material("weathered brown hair", (0.10, 0.073, 0.048, 1))
    tunic = material("deep green wool tunic", (0.055, 0.090, 0.074, 1))
    tunic_light = material("worn green cloth planes", (0.13, 0.20, 0.16, 1))
    tunic_dark = material("tunic shadow", (0.025, 0.033, 0.031, 1))
    leather = material("dark oiled leather", (0.16, 0.095, 0.055, 1))
    leather_light = material("scuffed leather edge", (0.33, 0.22, 0.13, 1))
    trouser = material("earth brown trousers", (0.25, 0.19, 0.12, 1))
    boot = material("blackened boots", (0.045, 0.039, 0.034, 1))
    linen = material("aged linen", (0.60, 0.53, 0.40, 1))
    iron = material("dull iron", (0.38, 0.38, 0.34, 1), metallic=0.08)

    body(root, skin, skin_shadow, hair, tunic, tunic_light, tunic_dark, leather, leather_light, trouser, boot, linen, iron)
    return root


def body(root, skin, skin_shadow, hair, tunic, tunic_light, tunic_dark, leather, leather_light, trouser, boot, linen, iron) -> None:
    # Feet and legs first so upper body draws over them from the camera angle.
    add_limb("left_thigh", (-0.125, -0.005, 0.95), (-0.165, -0.010, 0.54), 0.055, trouser, root)
    add_limb("right_thigh", (0.125, -0.005, 0.95), (0.165, -0.010, 0.54), 0.055, trouser, root)
    add_limb("left_shin", (-0.165, -0.010, 0.55), (-0.180, -0.015, 0.22), 0.050, trouser, root)
    add_limb("right_shin", (0.165, -0.010, 0.55), (0.180, -0.015, 0.22), 0.050, trouser, root)
    add_ellipsoid("left_boot", (-0.180, -0.060, 0.115), (0.078, 0.125, 0.040), boot, root)
    add_ellipsoid("right_boot", (0.180, -0.060, 0.115), (0.078, 0.125, 0.040), boot, root)
    add_box("left_boot_top", (-0.180, -0.010, 0.250), (0.055, 0.042, 0.075), boot, root)
    add_box("right_boot_top", (0.180, -0.010, 0.250), (0.055, 0.042, 0.075), boot, root)

    add_ellipsoid("hips", (0, 0.000, 1.00), (0.205, 0.105, 0.105), trouser, root)
    add_ellipsoid("torso_under", (0, -0.005, 1.34), (0.185, 0.090, 0.360), tunic, root)
    add_box("front_tabard", (0, -0.084, 1.18), (0.135, 0.015, 0.355), tunic_light, root)
    add_box("lower_tabard", (0, -0.086, 0.90), (0.118, 0.014, 0.205), tunic_dark, root)
    add_box("belt", (0, -0.110, 1.04), (0.235, 0.017, 0.027), leather, root)
    add_ellipsoid("belt_buckle", (0, -0.128, 1.045), (0.025, 0.006, 0.018), iron, root)
    add_box("left_belt_pouch", (-0.180, -0.070, 0.93), (0.034, 0.026, 0.068), leather_light, root)
    add_box("right_belt_pouch", (0.180, -0.070, 0.93), (0.034, 0.026, 0.068), leather_light, root)

    add_ellipsoid("left_shoulder", (-0.210, -0.012, 1.55), (0.066, 0.055, 0.052), tunic_dark, root)
    add_ellipsoid("right_shoulder", (0.210, -0.012, 1.55), (0.066, 0.055, 0.052), tunic_dark, root)
    add_limb("left_upper_arm", (-0.240, -0.010, 1.49), (-0.285, -0.020, 1.18), 0.035, skin, root)
    add_limb("right_upper_arm", (0.240, -0.010, 1.49), (0.285, -0.020, 1.18), 0.035, skin, root)
    add_limb("left_forearm", (-0.285, -0.020, 1.18), (-0.305, -0.040, 0.92), 0.030, skin, root)
    add_limb("right_forearm", (0.285, -0.020, 1.18), (0.305, -0.040, 0.92), 0.030, skin, root)
    add_box("left_bracer", (-0.302, -0.058, 1.04), (0.032, 0.020, 0.068), leather, root)
    add_box("right_bracer", (0.302, -0.058, 1.04), (0.032, 0.020, 0.068), leather, root)
    add_ellipsoid("left_hand", (-0.310, -0.046, 0.84), (0.026, 0.020, 0.045), skin, root)
    add_ellipsoid("right_hand", (0.310, -0.046, 0.84), (0.026, 0.020, 0.045), skin, root)

    add_limb("neck", (0, -0.006, 1.66), (0, -0.006, 1.78), 0.045, skin_shadow, root)
    add_ellipsoid("head", (0, -0.022, 1.88), (0.104, 0.080, 0.142), skin, root)
    add_ellipsoid("nose", (0, -0.105, 1.875), (0.018, 0.026, 0.035), skin_shadow, root)
    add_ellipsoid("left_eye", (-0.040, -0.108, 1.905), (0.010, 0.006, 0.008), material("dark eyes", (0.020, 0.018, 0.014, 1)), root)
    add_ellipsoid("right_eye", (0.040, -0.108, 1.905), (0.010, 0.006, 0.008), material("dark eyes", (0.020, 0.018, 0.014, 1)), root)
    add_box("brow_shadow", (0, -0.111, 1.930), (0.075, 0.006, 0.008), hair, root)
    add_box("mouth_shadow", (0, -0.112, 1.825), (0.050, 0.005, 0.006), material("mouth shadow", (0.16, 0.075, 0.060, 1)), root)

    add_ellipsoid("hair_mass", (0.010, 0.010, 1.970), (0.112, 0.085, 0.066), hair, root)
    add_ellipsoid("left_hair_fall", (-0.082, -0.015, 1.875), (0.027, 0.021, 0.094), hair, root)
    add_ellipsoid("right_hair_fall", (0.076, -0.005, 1.885), (0.024, 0.020, 0.078), hair, root)

    add_limb("spear_shaft", (0.388, -0.045, 0.60), (0.438, -0.050, 1.98), 0.0075, leather_light, root)
    add_ellipsoid("spear_tip", (0.444, -0.052, 2.055), (0.023, 0.010, 0.058), iron, root)
    add_ellipsoid("small_round_shield", (-0.358, -0.070, 1.15), (0.075, 0.018, 0.118), leather, root)
    add_ellipsoid("shield_boss", (-0.358, -0.092, 1.15), (0.020, 0.006, 0.020), iron, root)

    add_box("linen_collar", (0, -0.112, 1.595), (0.105, 0.012, 0.030), linen, root)
    add_box("left_cloak_fall", (-0.140, 0.040, 1.12), (0.040, 0.020, 0.420), tunic_dark, root)
    add_box("right_cloak_fall", (0.140, 0.040, 1.12), (0.040, 0.020, 0.420), tunic_dark, root)


def add_box(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    obj.parent = parent
    bevel = obj.modifiers.new(name=f"{name}_soft_edges", type="BEVEL")
    bevel.width = 0.012
    bevel.segments = 2
    obj.modifiers.new(name=f"{name}_weighted_normals", type="WEIGHTED_NORMAL")
    return obj


def add_ellipsoid(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    obj.parent = parent
    bpy.ops.object.shade_smooth()
    return obj


def add_limb(name, start, end, radius, mat, parent):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    mid = (start_v + end_v) / 2
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=direction.length, location=mid)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    obj.parent = parent
    bpy.ops.object.shade_smooth()
    return obj


def material(name, rgba, *, metallic=0.0):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.94
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def aim_camera(location, target, ortho) -> None:
    camera = bpy.data.objects["Camera"]
    camera.location = Vector(location)
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = ortho


def render_to(path: Path, width: int, height: int) -> None:
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def write_manifest() -> None:
    outputs = ["assets/sprites/player-cards/candidates/duskfell-painted-paperdoll.png"]
    outputs.extend(f"assets/sprites/player-cards/candidates/duskfell-painted-{direction}.png" for direction in DIRECTIONS)
    manifest = {
        "schemaVersion": "duskfell-painted-paperdoll-v1",
        "note": "Bespoke Blender-built UO-esque paperdoll made from controlled rounded forms and cloth pieces.",
        "outputs": outputs,
    }
    (OUT_DIR / "duskfell-painted-paperdoll-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
