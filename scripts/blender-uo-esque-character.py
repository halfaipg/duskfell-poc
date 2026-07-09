"""Render a clothed UO-esque Duskfell character from a real Blender-imported body.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender-uo-esque-character.py

This is a visual prototype, not a final rig. It uses the downloaded Quaternius
CC0 base as anatomical scaffolding, then hides the superhero body under
old-world clothing and Duskfell render rules.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
PACK_ROOT = Path(os.environ.get("DUSKFELL_QUATERNIUS_PACK", "/Users/j/Downloads/Universal Base Characters[Standard]"))
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MALE_GLTF = PACK_ROOT / "Base Characters" / "Godot - UE" / "Superhero_Male_FullBody.gltf"
HAIR_PARTED = PACK_ROOT / "Hairstyles" / "Origin at 0" / "glTF (Godot)" / "Hair_SimpleParted.gltf"
HAIR_BEARD = PACK_ROOT / "Hairstyles" / "Origin at 0" / "glTF (Godot)" / "Hair_Beard.gltf"

DIRECTIONS = {
    "south": 0,
    "east": math.radians(90),
    "north": math.radians(180),
    "west": math.radians(270),
}


def main() -> None:
    assert_sources()
    ensure_texture_aliases()
    setup_scene()
    render_card()
    render_direction_strip()
    write_manifest()


def assert_sources() -> None:
    missing = [path for path in [MALE_GLTF, HAIR_PARTED, HAIR_BEARD] if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing source files:\n" + "\n".join(str(path) for path in missing))


def ensure_texture_aliases() -> None:
    aliases = {
        PACK_ROOT / "Base Characters" / "Godot - UE" / "T_Hair_1_Normal_png.png": PACK_ROOT
        / "Base Characters"
        / "Godot - UE"
        / "T_Hair_1_Normal.png",
        PACK_ROOT / "Base Characters" / "Godot - UE" / "T_Eye_Normal_png.png": PACK_ROOT
        / "Base Characters"
        / "Godot - UE"
        / "T_Eye_Normal.png",
    }
    for alias, source in aliases.items():
        if alias.exists() or not source.exists():
            continue
        try:
            alias.symlink_to(source.name)
        except OSError:
            alias.write_bytes(source.read_bytes())


def setup_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 96
        if hasattr(scene.eevee, "use_gtao"):
            scene.eevee.use_gtao = True
            scene.eevee.gtao_distance = 3
            scene.eevee.gtao_factor = 1.6
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.world = bpy.data.worlds.new("Duskfell old-world")
    scene.world.color = (0.025, 0.023, 0.025)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"

    key_data = bpy.data.lights.new("Key", "AREA")
    key = bpy.data.objects.new("Key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (-2.8, -4.4, 5.2)
    key.data.energy = 720
    key.data.size = 4.3

    rim_data = bpy.data.lights.new("Rim", "POINT")
    rim = bpy.data.objects.new("Rim", rim_data)
    bpy.context.collection.objects.link(rim)
    rim.location = (2.4, 1.5, 2.9)
    rim.data.energy = 60
    rim.data.color = (0.55, 0.63, 0.68)


def render_card() -> None:
    reset_scene()
    root = build_character()
    root.rotation_euler = (0, 0, math.radians(2))
    aim_camera(location=(0, -7.1, 1.42), target=(0, 0, 1.20), ortho=2.85)
    render_to(OUT_DIR / "duskfell-uo-esque-character-paperdoll.png", 320, 440)


def render_direction_strip() -> None:
    paths = []
    for direction, angle in DIRECTIONS.items():
        reset_scene()
        root = build_character()
        root.rotation_euler = (0, 0, angle)
        aim_camera(location=(0, -7.1, 1.42), target=(0, 0, 1.20), ortho=2.85)
        path = OUT_DIR / f"duskfell-uo-esque-character-{direction}.png"
        render_to(path, 224, 320)
        paths.append(path)


def reset_scene() -> None:
    keep = {"Camera", "Key", "Rim"}
    for obj in list(bpy.context.scene.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def build_character():
    root = bpy.data.objects.new("uo_esque_wayfarer_root", None)
    body_root = bpy.data.objects.new("body_scaffold_root", None)
    bpy.context.collection.objects.link(root)
    bpy.context.collection.objects.link(body_root)
    body_root.parent = root
    imported = []
    for path in [MALE_GLTF, HAIR_PARTED, HAIR_BEARD]:
        imported.extend(import_gltf(path))
    for obj in imported:
        obj.parent = body_root
    pose_wayfarer(body_root)
    fit_root_to_height(body_root, target_height=2.45)
    move_root_to_ground(body_root)
    mute_body_materials(body_root)
    hide_superhero_body(body_root)
    body_root.location.z -= 0.38
    add_costume(root)
    return root


def import_gltf(path: Path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def pose_wayfarer(root) -> None:
    armatures = [obj for obj in root.children_recursive if obj.type == "ARMATURE"]
    if not armatures:
        return
    armature = armatures[0]
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"

    rotations = {
        "spine_01": (math.radians(-1), 0, 0),
        "spine_02": (math.radians(-1), 0, 0),
        "neck_01": (math.radians(2), 0, 0),
        "clavicle_l": (0, 0, math.radians(-7)),
        "clavicle_r": (0, 0, math.radians(7)),
        "upperarm_l": (math.radians(6), math.radians(4), math.radians(-74)),
        "upperarm_r": (math.radians(6), math.radians(-4), math.radians(74)),
        "lowerarm_l": (math.radians(1), math.radians(-7), math.radians(-16)),
        "lowerarm_r": (math.radians(1), math.radians(7), math.radians(16)),
        "hand_l": (0, math.radians(4), math.radians(8)),
        "hand_r": (0, math.radians(-4), math.radians(-8)),
        "thigh_l": (math.radians(2), 0, math.radians(2)),
        "thigh_r": (math.radians(2), 0, math.radians(-2)),
        "calf_l": (math.radians(-3), 0, 0),
        "calf_r": (math.radians(-3), 0, 0),
    }
    for name, rotation in rotations.items():
        bone = armature.pose.bones.get(name)
        if bone:
            bone.rotation_euler = rotation
    bpy.context.view_layer.update()


def fit_root_to_height(root, *, target_height: float) -> None:
    min_v, max_v = bounds(root)
    height = max_v.z - min_v.z
    if height > 0:
        scale = target_height / height
        root.scale = (scale * 0.92, scale * 0.88, scale)
    bpy.context.view_layer.update()


def move_root_to_ground(root) -> None:
    min_v, max_v = bounds(root)
    center = (min_v + max_v) / 2
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= min_v.z
    bpy.context.view_layer.update()


def bounds(root):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    found = False
    for obj in root.children_recursive:
        if obj.type != "MESH" or obj.hide_render:
            continue
        found = True
        evaluated = obj.evaluated_get(depsgraph)
        for corner in evaluated.bound_box:
            v = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, v.x)
            mins.y = min(mins.y, v.y)
            mins.z = min(mins.z, v.z)
            maxs.x = max(maxs.x, v.x)
            maxs.y = max(maxs.y, v.y)
            maxs.z = max(maxs.z, v.z)
    if not found:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    return mins, maxs


def mute_body_materials(root) -> None:
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        lower = obj.name.lower()
        for slot in obj.material_slots:
            mat = slot.material
            if not mat:
                continue
            if "face" in lower or "hair" in lower or "beard" in lower:
                tweak_material(mat, roughness=0.92, multiplier=0.82)
            else:
                tweak_material(mat, roughness=0.96, multiplier=0.72)


def hide_superhero_body(root) -> None:
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        lower = obj.name.lower()
        if "face" not in lower and "hair" not in lower and "beard" not in lower:
            obj.hide_render = True
            obj.hide_viewport = True


def tweak_material(mat, *, roughness: float, multiplier: float) -> None:
    mat.diffuse_color = tuple(min(1.0, c * multiplier) for c in mat.diffuse_color[:3]) + (mat.diffuse_color[3],)
    if mat.use_nodes:
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Roughness"].default_value = roughness
            bsdf.inputs["Metallic"].default_value = 0


def add_costume(root) -> None:
    dark_cloth = material("coal hood cloth", (0.028, 0.032, 0.034, 1))
    cloak_edge = material("worn cloak edge", (0.10, 0.105, 0.095, 1))
    tunic = material("faded green wool", (0.105, 0.145, 0.125, 1))
    leather = material("black brown leather", (0.08, 0.055, 0.035, 1))
    leather_hi = material("worn leather highlight", (0.23, 0.15, 0.09, 1))
    linen = material("aged linen", (0.50, 0.45, 0.33, 1))
    iron = material("dark iron", (0.36, 0.37, 0.34, 1), metallic=0.12)
    wood = material("dark ash wood", (0.18, 0.12, 0.075, 1))

    z0 = 0.08
    add_ellipsoid("small_hood_back", (0, 0.045, 2.02), (0.18, 0.07, 0.16), dark_cloth, root)
    add_ellipsoid("collar_shadow", (0, -0.08, 1.91), (0.18, 0.035, 0.07), dark_cloth, root)
    add_box("cloak_back_panel", (0, 0.10, 1.18), (0.36, 0.032, 0.78), dark_cloth, root)
    add_limb("cloak_trim_left", (-0.31, 0.010, 1.68), (-0.35, -0.005, 0.54), 0.016, cloak_edge, root)
    add_limb("cloak_trim_right", (0.31, 0.010, 1.68), (0.35, -0.005, 0.54), 0.016, cloak_edge, root)

    add_box("padded_tunic_upper", (0, -0.155, 1.48), (0.27, 0.035, 0.32), tunic, root)
    add_box("padded_tunic_lower", (0, -0.155, 1.08), (0.25, 0.035, 0.30), tunic, root)
    add_box("linen_hem", (0, -0.18, 0.78), (0.23, 0.025, 0.060), linen, root)
    add_box("belt", (0, -0.195, 1.19), (0.29, 0.020, 0.040), leather_hi, root)
    add_limb("chest_strap", (-0.18, -0.205, 1.77), (0.17, -0.205, 1.18), 0.018, leather, root)
    add_box("belt_buckle", (0.03, -0.22, 1.19), (0.040, 0.010, 0.030), iron, root)

    add_limb("left_sleeve", (-0.24, -0.04, 1.72), (-0.42, -0.12, 1.05), 0.052, tunic, root)
    add_limb("right_sleeve", (0.24, -0.04, 1.72), (0.42, -0.12, 1.05), 0.052, tunic, root)
    add_ellipsoid("left_hand_glove", (-0.44, -0.13, 1.00), (0.052, 0.035, 0.060), leather_hi, root)
    add_ellipsoid("right_hand_glove", (0.44, -0.13, 1.00), (0.052, 0.035, 0.060), leather_hi, root)

    add_limb("left_trouser", (-0.13, -0.04, 0.83), (-0.16, -0.04, 0.28), 0.062, dark_cloth, root)
    add_limb("right_trouser", (0.13, -0.04, 0.83), (0.16, -0.04, 0.28), 0.062, dark_cloth, root)
    add_ellipsoid("left_boot", (-0.16, -0.055, 0.24), (0.070, 0.055, 0.15), leather, root)
    add_ellipsoid("right_boot", (0.16, -0.055, 0.24), (0.070, 0.055, 0.15), leather, root)
    add_ellipsoid("left_boot_toe", (-0.16, -0.14, z0), (0.075, 0.075, 0.030), leather_hi, root)
    add_ellipsoid("right_boot_toe", (0.16, -0.14, z0), (0.075, 0.075, 0.030), leather_hi, root)

    add_limb("spear_shaft", (0.55, -0.20, 0.50), (0.70, -0.25, 2.28), 0.016, wood, root)
    add_ellipsoid("spear_tip", (0.72, -0.255, 2.40), (0.044, 0.024, 0.115), iron, root)
    add_ellipsoid("small_round_shield", (-0.50, -0.20, 1.05), (0.14, 0.030, 0.21), leather, root)
    add_ellipsoid("small_round_shield_rim", (-0.50, -0.218, 1.05), (0.16, 0.014, 0.235), leather_hi, root)
    add_ellipsoid("small_round_shield_boss", (-0.50, -0.235, 1.05), (0.040, 0.012, 0.040), iron, root)


def add_ellipsoid(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    obj.parent = parent
    bpy.ops.object.shade_smooth()
    return obj


def add_box(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    obj.parent = parent
    bevel = obj.modifiers.new(name=f"{name}_soft_edges", type="BEVEL")
    bevel.width = 0.018
    bevel.segments = 2
    obj.modifiers.new(name=f"{name}_weighted_normals", type="WEIGHTED_NORMAL")
    return obj


def add_limb(name, start, end, radius, mat, parent):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    mid = (start_v + end_v) / 2
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=radius, depth=direction.length, location=mid)
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
        bsdf.inputs["Roughness"].default_value = 0.92
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
    manifest = {
        "schemaVersion": "duskfell-uo-esque-character-v1",
        "note": "Clothed UO-esque Blender character prototype using Quaternius CC0 body as hidden anatomical scaffold.",
        "sourcePack": str(PACK_ROOT),
        "sourceFiles": [str(MALE_GLTF), str(HAIR_PARTED), str(HAIR_BEARD)],
        "outputs": [
            "assets/sprites/player-cards/candidates/duskfell-uo-esque-character-paperdoll.png",
            "assets/sprites/player-cards/candidates/duskfell-uo-esque-character-card.png",
            "assets/sprites/player-cards/candidates/duskfell-uo-esque-character-direction-strip.png",
        ],
    }
    (OUT_DIR / "duskfell-uo-esque-character-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
