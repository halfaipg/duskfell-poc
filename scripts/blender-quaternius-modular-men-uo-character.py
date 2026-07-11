"""Render slimmer UO-esque Duskfell paperdoll candidates from Quaternius modular men."""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = (
    ROOT
    / "var"
    / "third-party-model-candidates"
    / "quaternius-ultimate-modular-men"
    / "Individual Characters"
    / "glTF"
)
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CANDIDATES = ["Beach", "Adventurer", "Farmer", "Worker", "King"]
DIRECTIONS = {
    "south": 0,
    "east": math.radians(90),
    "north": math.radians(180),
    "west": math.radians(270),
}


def main() -> None:
    setup_scene()
    for name in CANDIDATES:
        source = SOURCE_DIR / f"{name}.gltf"
        if not source.exists():
            raise FileNotFoundError(source)
        render_paperdoll(name, source)
    render_directions("Farmer", SOURCE_DIR / "Farmer.gltf")
    write_manifest()


def setup_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 128
        if hasattr(scene.eevee, "use_gtao"):
            scene.eevee.use_gtao = True
            scene.eevee.gtao_distance = 3
            scene.eevee.gtao_factor = 1.55
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.world = bpy.data.worlds.new("Duskfell modular men world")
    scene.world.color = (0.025, 0.023, 0.024)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"

    key_data = bpy.data.lights.new("Key", "AREA")
    key = bpy.data.objects.new("Key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (-2.8, -4.8, 5.4)
    key.data.energy = 720
    key.data.size = 4.5

    fill_data = bpy.data.lights.new("WarmFill", "POINT")
    fill = bpy.data.objects.new("WarmFill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (2.0, -2.5, 2.2)
    fill.data.energy = 36
    fill.data.color = (0.78, 0.58, 0.42)

    rim_data = bpy.data.lights.new("Rim", "POINT")
    rim = bpy.data.objects.new("Rim", rim_data)
    bpy.context.collection.objects.link(rim)
    rim.location = (2.3, 1.7, 3.0)
    rim.data.energy = 62
    rim.data.color = (0.46, 0.54, 0.62)


def render_paperdoll(name: str, source: Path) -> None:
    reset_scene()
    character = build_character(name, source)
    character.rotation_euler = (0, 0, math.radians(2))
    aim_camera((0, -7.0, 1.38), (0, 0, 1.08), 2.82)
    render_to(OUT_DIR / f"duskfell-quaternius-{slug(name)}-paperdoll.png", 320, 440)


def render_directions(name: str, source: Path) -> None:
    for direction, angle in DIRECTIONS.items():
        reset_scene()
        character = build_character(name, source)
        character.rotation_euler = (0, 0, angle)
        aim_camera((0, -7.0, 1.38), (0, 0, 1.08), 2.82)
        render_to(OUT_DIR / f"duskfell-quaternius-{slug(name)}-{direction}.png", 224, 320)


def reset_scene() -> None:
    keep = {"Camera", "Key", "WarmFill", "Rim"}
    for obj in list(bpy.context.scene.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def build_character(name: str, source: Path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    for obj in imported:
        if obj.name in {"Cube", "Light", "Camera", "Icosphere"}:
            bpy.data.objects.remove(obj, do_unlink=True)

    root = bpy.data.objects.new(f"duskfell_{slug(name)}_character", None)
    bpy.context.collection.objects.link(root)
    for obj in list(bpy.context.scene.objects):
        if obj.name in {"Camera", "Key", "WarmFill", "Rim", root.name}:
            continue
        if obj.parent is None:
            obj.parent = root

    pose_idle(root, name)
    normalize(root, target_height=2.32)
    slim_silhouette(root)
    apply_duskfell_palette(name)
    # Keep this pass as a clean body/paperdoll base. Equipment should be layered
    # from the same rig later, not baked into the base silhouette.
    return root


def pose_idle(root, character_name: str) -> None:
    armatures = [obj for obj in root.children_recursive if obj.type == "ARMATURE"]
    if not armatures:
        return
    armature = armatures[0]
    action = bpy.data.actions.get("Idle_Neutral") or bpy.data.actions.get("Idle") or bpy.data.actions.get("Walk")
    if action:
        armature.animation_data_create()
        armature.animation_data.action = action
        bpy.context.scene.frame_set(10)
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
    for bone_name, scale in {
        "Head": (0.84, 0.84, 0.88),
        "Neck": (0.94, 0.94, 0.98),
        "Spine": (0.92, 0.92, 1.05),
        "Spine1": (0.92, 0.92, 1.04),
    }.items():
        bone = armature.pose.bones.get(bone_name)
        if bone:
            bone.scale = scale
    bpy.context.view_layer.update()


def normalize(root, *, target_height: float) -> None:
    min_v, max_v = bounds(root)
    height = max_v.z - min_v.z
    if height > 0:
        scale = target_height / height
        root.scale = (scale * 0.90, scale * 0.90, scale)
    bpy.context.view_layer.update()
    min_v, max_v = bounds(root)
    center = (min_v + max_v) / 2
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= min_v.z
    bpy.context.view_layer.update()


def slim_silhouette(root) -> None:
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        if "head" in name:
            obj.scale.x *= 0.93
            obj.scale.y *= 0.93
            obj.scale.z *= 0.96
        elif "body" in name:
            obj.scale.x *= 0.82
            obj.scale.y *= 0.90
            obj.scale.z *= 1.06
        elif "legs" in name:
            obj.scale.x *= 0.86
            obj.scale.y *= 0.90
            obj.scale.z *= 1.07
        elif "feet" in name:
            obj.scale.x *= 0.86
            obj.scale.y *= 0.92
    bpy.context.view_layer.update()
    min_v, _ = bounds(root)
    root.location.z -= min_v.z
    bpy.context.view_layer.update()


def bounds(root):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    found = False
    for obj in root.children_recursive:
        if obj.type != "MESH":
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


def apply_duskfell_palette(character_name: str) -> None:
    palette = {
        "Black": (0.030, 0.031, 0.033, 1),
        "Brown": (0.22, 0.13, 0.075, 1),
        "Brown2": (0.31, 0.22, 0.13, 1),
        "Dots Stroke": (0.08, 0.07, 0.06, 1),
        "Eye": (0.045, 0.041, 0.036, 1),
        "Eyebrows": (0.085, 0.065, 0.045, 1),
        "Gold": (0.56, 0.45, 0.24, 1),
        "Green": (0.16, 0.24, 0.17, 1),
        "Grey": (0.34, 0.34, 0.31, 1),
        "Hair": (0.13, 0.10, 0.07, 1),
        "LightGreen": (0.28, 0.36, 0.25, 1),
        "Material": (0.48, 0.34, 0.23, 1),
        "Skin": (0.50, 0.34, 0.23, 1),
    }
    if character_name == "King":
        palette["Gold"] = (0.44, 0.35, 0.18, 1)
        palette["Green"] = (0.23, 0.12, 0.16, 1)
    for mat in bpy.data.materials:
        if mat.name in palette:
            mat.diffuse_color = palette[mat.name]
        if mat.use_nodes:
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Base Color"].default_value = mat.diffuse_color
                bsdf.inputs["Roughness"].default_value = 0.94
                bsdf.inputs["Metallic"].default_value = 0.02 if mat.name in {"Gold", "Grey"} else 0


def add_uo_readable_gear(root, character_name: str) -> None:
    iron = material("duskfell worn iron", (0.41, 0.40, 0.36, 1), metallic=0.10)
    leather = material("duskfell oiled leather", (0.16, 0.09, 0.052, 1))
    wood = material("duskfell aged wood", (0.21, 0.13, 0.075, 1))
    cloak_mat = material("duskfell charcoal cloak", (0.030, 0.035, 0.036, 1))

    if character_name in {"Worker", "Farmer"}:
        add_limb("walking_staff", (0.48, -0.18, 0.35), (0.58, -0.23, 1.92), 0.009, wood, root)
    if character_name in {"Adventurer", "King"}:
        add_ellipsoid("small_round_shield", (-0.39, -0.18, 1.03), (0.105, 0.024, 0.165), leather, root)
        add_ellipsoid("shield_boss", (-0.39, -0.205, 1.03), (0.028, 0.009, 0.028), iron, root)
    if character_name in {"Adventurer", "Punk"}:
        add_box("short_dark_cloak", (0, 0.11, 1.22), (0.27, 0.022, 0.50), cloak_mat, root)


def add_box(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    obj.parent = parent
    bevel = obj.modifiers.new(name=f"{name}_soft_edges", type="BEVEL")
    bevel.width = 0.014
    bevel.segments = 2
    obj.modifiers.new(name=f"{name}_weighted_normals", type="WEIGHTED_NORMAL")
    return obj


def add_ellipsoid(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, location=location)
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
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=direction.length, location=mid)
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
    outputs = [
        f"assets/sprites/player-cards/candidates/duskfell-quaternius-{slug(name)}-paperdoll.png"
        for name in CANDIDATES
    ]
    outputs.extend(
        f"assets/sprites/player-cards/candidates/duskfell-quaternius-farmer-{direction}.png"
        for direction in DIRECTIONS
    )
    manifest = {
        "schemaVersion": "duskfell-quaternius-modular-men-v1",
        "note": "Slimmer paperdoll and direction candidates rendered from Quaternius Ultimate Modular Men GLTF assets.",
        "sourceDirectory": str(SOURCE_DIR),
        "outputs": outputs,
    }
    (OUT_DIR / "duskfell-quaternius-modular-men-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def slug(value: str) -> str:
    return value.lower().replace("_", "-").replace(" ", "-")


if __name__ == "__main__":
    main()
