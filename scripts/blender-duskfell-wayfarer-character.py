"""Render a more dressed, UO-esque Duskfell wayfarer from a rigged Blender source."""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (
    ROOT
    / "var"
    / "third-party-model-candidates"
    / "quaternius-ultimate-modular-men"
    / "Individual Characters"
    / "glTF"
    / "Adventurer.gltf"
)
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)

DIRECTIONS = {
    "south": 0,
    "east": math.radians(90),
    "north": math.radians(180),
    "west": math.radians(270),
}


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
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
        scene.eevee.taa_render_samples = 160
        if hasattr(scene.eevee, "use_gtao"):
            scene.eevee.use_gtao = True
            scene.eevee.gtao_distance = 3
            scene.eevee.gtao_factor = 1.7
    scene.render.film_transparent = True
    scene.render.use_freestyle = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.world = bpy.data.worlds.new("Duskfell wayfarer world")
    scene.world.color = (0.024, 0.023, 0.025)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"

    key_data = bpy.data.lights.new("Key", "AREA")
    key = bpy.data.objects.new("Key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (-3.2, -4.6, 5.0)
    key.data.energy = 760
    key.data.size = 4.4

    fill_data = bpy.data.lights.new("Amber fill", "POINT")
    fill = bpy.data.objects.new("Amber fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (2.1, -2.8, 2.4)
    fill.data.energy = 42
    fill.data.color = (0.75, 0.58, 0.42)

    rim_data = bpy.data.lights.new("Cool rim", "POINT")
    rim = bpy.data.objects.new("Cool rim", rim_data)
    bpy.context.collection.objects.link(rim)
    rim.location = (2.3, 1.7, 3.1)
    rim.data.energy = 72
    rim.data.color = (0.45, 0.52, 0.58)


def render_paperdoll() -> None:
    reset_scene()
    character = build_character()
    character.rotation_euler = (0, 0, math.radians(2))
    aim_camera((0, -7.2, 1.42), (0, 0, 1.10), 2.76)
    render_to(OUT_DIR / "duskfell-wayfarer-paperdoll.png", 384, 528)


def render_directions() -> None:
    for direction, angle in DIRECTIONS.items():
        reset_scene()
        character = build_character()
        character.rotation_euler = (0, 0, angle)
        aim_camera((0, -7.2, 1.42), (0, 0, 1.10), 2.76)
        render_to(OUT_DIR / f"duskfell-wayfarer-{direction}.png", 256, 360)


def reset_scene() -> None:
    keep = {"Camera", "Key", "Amber fill", "Cool rim"}
    for obj in list(bpy.context.scene.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def build_character():
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    for obj in imported:
        if obj.name in {"Cube", "Light", "Camera", "Icosphere", "Backpack"}:
            bpy.data.objects.remove(obj, do_unlink=True)

    root = bpy.data.objects.new("duskfell_wayfarer_character", None)
    bpy.context.collection.objects.link(root)
    for obj in list(bpy.context.scene.objects):
        if obj.name in {"Camera", "Key", "Amber fill", "Cool rim", root.name}:
            continue
        if obj.parent is None:
            obj.parent = root

    pose_idle(root)
    normalize(root, target_height=2.38)
    stylize_body(root)
    apply_palette()
    add_wayfarer_layers(root)
    return root


def pose_idle(root) -> None:
    armatures = [obj for obj in root.children_recursive if obj.type == "ARMATURE"]
    if not armatures:
        return
    armature = armatures[0]
    action = bpy.data.actions.get("Idle_Neutral") or bpy.data.actions.get("Idle")
    if action:
        armature.animation_data_create()
        armature.animation_data.action = action
        bpy.context.scene.frame_set(10)
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
    for bone_name, scale in {
        "Chest": (0.90, 0.92, 1.03),
        "Torso": (0.90, 0.92, 1.03),
        "Abdomen": (0.94, 0.94, 1.02),
        "Wrist.L": (0.72, 0.72, 0.72),
        "Wrist.R": (0.72, 0.72, 0.72),
    }.items():
        bone = armature.pose.bones.get(bone_name)
        if bone:
            bone.scale = scale
    for bone in armature.pose.bones:
        if any(part in bone.name for part in ("Index", "Middle", "Ring", "Pinky", "Thumb")):
            bone.scale = (0.70, 0.70, 0.70)
    bpy.context.view_layer.update()


def normalize(root, *, target_height: float) -> None:
    min_v, max_v = bounds(root)
    height = max_v.z - min_v.z
    if height > 0:
        scale = target_height / height
        root.scale = (scale * 0.88, scale * 0.88, scale)
    bpy.context.view_layer.update()
    min_v, max_v = bounds(root)
    center = (min_v + max_v) / 2
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= min_v.z
    bpy.context.view_layer.update()


def stylize_body(root) -> None:
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        lower = obj.name.lower()
        shade_and_soften(obj)
        if "head" in lower:
            continue
        elif "body" in lower:
            obj.scale.x *= 0.82
            obj.scale.y *= 0.86
            obj.scale.z *= 1.05
        elif "pants" in lower:
            obj.scale.x *= 0.82
            obj.scale.y *= 0.88
            obj.scale.z *= 1.05
        elif "feet" in lower:
            obj.scale.x *= 0.84
            obj.scale.y *= 0.90
    bpy.context.view_layer.update()
    min_v, _ = bounds(root)
    root.location.z -= min_v.z
    bpy.context.view_layer.update()


def shade_and_soften(obj) -> None:
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    bevel = obj.modifiers.new(name=f"{obj.name}_painted_edge_soften", type="BEVEL")
    bevel.width = 0.006
    bevel.segments = 1
    obj.modifiers.new(name=f"{obj.name}_weighted_normals", type="WEIGHTED_NORMAL")


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


def apply_palette() -> None:
    palette = {
        "Beige": (0.46, 0.40, 0.28, 1),
        "Black": (0.028, 0.030, 0.030, 1),
        "Brown": (0.19, 0.12, 0.075, 1),
        "Brown2": (0.31, 0.23, 0.14, 1),
        "Dots Stroke": (0.06, 0.055, 0.05, 1),
        "Eye": (0.035, 0.032, 0.028, 1),
        "Eyebrows": (0.10, 0.075, 0.045, 1),
        "Gold": (0.42, 0.32, 0.16, 1),
        "Green": (0.055, 0.085, 0.070, 1),
        "Grey": (0.30, 0.30, 0.27, 1),
        "Hair": (0.11, 0.08, 0.055, 1),
        "LightBlue": (0.055, 0.085, 0.080, 1),
        "LightGreen": (0.15, 0.22, 0.18, 1),
        "Material": (0.45, 0.31, 0.20, 1),
        "Red": (0.25, 0.08, 0.07, 1),
        "Skin": (0.50, 0.34, 0.23, 1),
    }
    for mat in bpy.data.materials:
        if mat.name in palette:
            mat.diffuse_color = palette[mat.name]
        if mat.use_nodes:
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Base Color"].default_value = mat.diffuse_color
                bsdf.inputs["Roughness"].default_value = 0.96
                bsdf.inputs["Metallic"].default_value = 0


def add_wayfarer_layers(root) -> None:
    coat = material("duskfell green-black wool coat", (0.055, 0.085, 0.075, 1))
    coat_shadow = material("duskfell coat shadow", (0.025, 0.031, 0.030, 1))
    leather = material("duskfell cracked leather", (0.18, 0.105, 0.060, 1))
    brass = material("duskfell dull brass", (0.46, 0.35, 0.18, 1), metallic=0.10)

    add_box("wayfarer_front_tabard", (0, -0.055, 1.18), (0.205, 0.030, 0.36), coat, root)
    add_box("wayfarer_lower_tabard", (0, -0.056, 0.89), (0.190, 0.026, 0.17), coat_shadow, root)
    add_box("wayfarer_belt", (0, -0.086, 1.03), (0.245, 0.014, 0.026), leather, root)
    add_ellipsoid("wayfarer_buckle", (0.010, -0.103, 1.035), (0.027, 0.006, 0.019), brass, root)


def add_box(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.scale = scale
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new(name=f"{name}_soft_edges", type="BEVEL")
    bevel.width = 0.018
    bevel.segments = 2
    obj.modifiers.new(name=f"{name}_weighted_normals", type="WEIGHTED_NORMAL")
    return obj


def add_ellipsoid(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=22, ring_count=10, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.scale = scale
    obj.data.materials.append(mat)
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
        bsdf.inputs["Roughness"].default_value = 0.96
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
    outputs = ["assets/sprites/player-cards/candidates/duskfell-wayfarer-paperdoll.png"]
    outputs.extend(f"assets/sprites/player-cards/candidates/duskfell-wayfarer-{direction}.png" for direction in DIRECTIONS)
    manifest = {
        "schemaVersion": "duskfell-wayfarer-character-v1",
        "note": "Dressed UO-esque wayfarer rendered in Blender from the Quaternius Farmer rig.",
        "source": str(SOURCE),
        "outputs": outputs,
    }
    (OUT_DIR / "duskfell-wayfarer-character-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
