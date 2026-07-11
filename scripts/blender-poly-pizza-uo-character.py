"""Render a cleaner UO-esque Duskfell character from a clothed CC0 rigged GLB."""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE_GLB = ROOT / "var" / "third-party-model-candidates" / "poly-pizza" / "quaternius-character-animated.glb"
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)

DIRECTIONS = {
    "south": 0,
    "east": math.radians(90),
    "north": math.radians(180),
    "west": math.radians(270),
}


def main() -> None:
    if not SOURCE_GLB.exists():
        raise FileNotFoundError(SOURCE_GLB)
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
        scene.eevee.taa_render_samples = 96
        if hasattr(scene.eevee, "use_gtao"):
            scene.eevee.use_gtao = True
            scene.eevee.gtao_distance = 3
            scene.eevee.gtao_factor = 1.45
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.world = bpy.data.worlds.new("Duskfell character world")
    scene.world.color = (0.026, 0.023, 0.026)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"

    key_data = bpy.data.lights.new("Key", "AREA")
    key = bpy.data.objects.new("Key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (-2.9, -4.4, 5.2)
    key.data.energy = 650
    key.data.size = 4.0

    rim_data = bpy.data.lights.new("Rim", "POINT")
    rim = bpy.data.objects.new("Rim", rim_data)
    bpy.context.collection.objects.link(rim)
    rim.location = (2.2, 1.8, 2.8)
    rim.data.energy = 45
    rim.data.color = (0.55, 0.62, 0.67)


def render_paperdoll() -> None:
    reset_scene()
    character = build_character()
    character.rotation_euler = (0, 0, math.radians(3))
    aim_camera((0, -7.0, 1.40), (0, 0, 1.10), 2.85)
    render_to(OUT_DIR / "duskfell-poly-pizza-uo-character-paperdoll.png", 320, 440)


def render_directions() -> None:
    for direction, angle in DIRECTIONS.items():
        reset_scene()
        character = build_character()
        character.rotation_euler = (0, 0, angle)
        aim_camera((0, -7.0, 1.40), (0, 0, 1.10), 2.85)
        render_to(OUT_DIR / f"duskfell-poly-pizza-uo-character-{direction}.png", 224, 320)


def reset_scene() -> None:
    keep = {"Camera", "Key", "Rim"}
    for obj in list(bpy.context.scene.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def build_character():
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE_GLB))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    for obj in imported:
        if obj.name in {"Cube", "Light", "Camera", "Icosphere"}:
            bpy.data.objects.remove(obj, do_unlink=True)

    root = bpy.data.objects.new("duskfell_poly_pizza_character", None)
    bpy.context.collection.objects.link(root)
    for obj in list(bpy.context.scene.objects):
        if obj.name in {"Camera", "Key", "Rim", root.name}:
            continue
        if obj.parent is None:
            obj.parent = root

    pose_idle(root)
    normalize(root, target_height=2.25)
    adultize_proportions(root)
    apply_duskfell_palette()
    add_old_world_gear(root)
    return root


def pose_idle(root) -> None:
    armatures = [obj for obj in root.children_recursive if obj.type == "ARMATURE"]
    if not armatures:
        return
    armature = armatures[0]
    action = bpy.data.actions.get("Idle") or bpy.data.actions.get("CharacterArmature|Idle")
    if action:
        armature.animation_data_create()
        armature.animation_data.action = action
        bpy.context.scene.frame_set(8)
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
    head = armature.pose.bones.get("Head")
    if head:
        head.scale = (0.68, 0.68, 0.68)
    neck = armature.pose.bones.get("Neck")
    if neck:
        neck.scale = (0.82, 0.82, 0.92)
    bpy.context.view_layer.update()


def normalize(root, *, target_height: float) -> None:
    min_v, max_v = bounds(root)
    height = max_v.z - min_v.z
    if height > 0:
        scale = target_height / height
        root.scale = (scale * 0.93, scale * 0.93, scale)
    bpy.context.view_layer.update()
    min_v, max_v = bounds(root)
    center = (min_v + max_v) / 2
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= min_v.z
    bpy.context.view_layer.update()


def adultize_proportions(root) -> None:
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        if obj.name.startswith("NurbsPath"):
            continue
        elif obj.name == "Rogue":
            obj.scale.x *= 0.90
            obj.scale.y *= 0.92
            obj.scale.z *= 1.08
        elif obj.name == "Rogue.001":
            obj.scale.x *= 0.90
            obj.scale.y *= 0.92
            obj.scale.z *= 1.03
    bpy.context.view_layer.update()
    min_v, max_v = bounds(root)
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


def apply_duskfell_palette() -> None:
    replacements = {
        "Shirt": (0.10, 0.16, 0.145, 1),
        "UnderShirt": (0.36, 0.34, 0.24, 1),
        "Pants": (0.075, 0.075, 0.065, 1),
        "Boots": (0.055, 0.040, 0.030, 1),
        "Hair": (0.13, 0.11, 0.08, 1),
        "Material.006": (0.30, 0.13, 0.08, 1),
        "Detail": (0.34, 0.29, 0.20, 1),
        "Skin": (0.46, 0.32, 0.21, 1),
        "White": (0.55, 0.52, 0.43, 1),
    }
    for mat in bpy.data.materials:
        if mat.name in replacements:
            mat.diffuse_color = replacements[mat.name]
        if mat.use_nodes:
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Base Color"].default_value = mat.diffuse_color
                bsdf.inputs["Roughness"].default_value = 0.92
                bsdf.inputs["Metallic"].default_value = 0


def add_old_world_gear(root) -> None:
    leather = material("duskfell shield leather", (0.18, 0.11, 0.065, 1))
    iron = material("duskfell dim iron", (0.42, 0.42, 0.38, 1), metallic=0.12)
    wood = material("duskfell spear shaft", (0.20, 0.13, 0.075, 1))
    cloak = material("duskfell short cloak", (0.030, 0.035, 0.037, 1))

    add_box("short_cloak", (0, 0.095, 1.23), (0.30, 0.028, 0.56), cloak, root)
    add_limb("spear_shaft", (0.50, -0.20, 0.40), (0.62, -0.25, 2.16), 0.012, wood, root)
    add_ellipsoid("spear_tip", (0.64, -0.255, 2.26), (0.036, 0.020, 0.09), iron, root)
    add_ellipsoid("round_shield", (-0.40, -0.18, 1.02), (0.118, 0.026, 0.18), leather, root)
    add_ellipsoid("shield_boss", (-0.40, -0.205, 1.02), (0.032, 0.010, 0.032), iron, root)


def add_box(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    obj.parent = parent
    bevel = obj.modifiers.new(name=f"{name}_soft_edges", type="BEVEL")
    bevel.width = 0.016
    bevel.segments = 2
    obj.modifiers.new(name=f"{name}_weighted_normals", type="WEIGHTED_NORMAL")
    return obj


def add_ellipsoid(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=22, ring_count=10, location=location)
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
        "schemaVersion": "duskfell-poly-pizza-uo-character-v1",
        "note": "UO-esque clothed character prototype from Quaternius Character Animated CC0 GLB.",
        "source": str(SOURCE_GLB),
        "outputs": [
            "assets/sprites/player-cards/candidates/duskfell-poly-pizza-uo-character-paperdoll.png",
            "assets/sprites/player-cards/candidates/duskfell-poly-pizza-uo-character-direction-strip.png",
            "assets/sprites/player-cards/candidates/duskfell-poly-pizza-uo-character-card.png",
        ],
    }
    (OUT_DIR / "duskfell-poly-pizza-uo-character-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
