"""Render Duskfell paperdoll prototypes from real Quaternius CC0 human models.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender-quaternius-paperdoll-prototype.py

The source pack is intentionally kept outside the repo by default:
  /Users/j/Downloads/Universal Base Characters[Standard]

These renders prove the next production direction: use a real rigged humanoid
as the body source, then layer Duskfell gear/styling/render rules on top.
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
FEMALE_GLTF = PACK_ROOT / "Base Characters" / "Godot - UE" / "Superhero_Female_FullBody.gltf"
HAIR_LONG = PACK_ROOT / "Hairstyles" / "Origin at 0" / "glTF (Godot)" / "Hair_Long.gltf"
HAIR_PARTED = PACK_ROOT / "Hairstyles" / "Origin at 0" / "glTF (Godot)" / "Hair_SimpleParted.gltf"
HAIR_BEARD = PACK_ROOT / "Hairstyles" / "Origin at 0" / "glTF (Godot)" / "Hair_Beard.gltf"

CARD_W = 224
CARD_H = 320


def main() -> None:
    assert_sources()
    ensure_texture_aliases()
    setup_scene()
    render_lineup()
    render_direction_sheet()
    write_manifest()


def assert_sources() -> None:
    missing = [path for path in [MALE_GLTF, FEMALE_GLTF, HAIR_LONG, HAIR_PARTED, HAIR_BEARD] if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing Quaternius source files:\n" + "\n".join(str(path) for path in missing))


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
        scene.eevee.taa_render_samples = 64
        if hasattr(scene.eevee, "use_gtao"):
            scene.eevee.use_gtao = True
            scene.eevee.gtao_distance = 3
            scene.eevee.gtao_factor = 1.3

    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.world = bpy.data.worlds.new("Duskfell paperdoll world")
    scene.world.color = (0.035, 0.03, 0.032)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"

    key_data = bpy.data.lights.new("Key", "AREA")
    key = bpy.data.objects.new("Key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (-3.2, -4.4, 5.0)
    key.data.energy = 620
    key.data.size = 4.0

    fill_data = bpy.data.lights.new("Fill", "POINT")
    fill = bpy.data.objects.new("Fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (2.3, -2.5, 2.3)
    fill.data.energy = 55
    fill.data.color = (0.65, 0.72, 0.78)


def render_lineup() -> None:
    reset_scene_keep_camera_lights()
    import_character("male", MALE_GLTF, [HAIR_PARTED, HAIR_BEARD], x=-0.82)
    import_character("female", FEMALE_GLTF, [HAIR_LONG], x=0.82)
    aim_camera(location=(0, -7.2, 1.42), target=(0, 0, 1.22), ortho=3.2)
    render_to(OUT_DIR / "duskfell-quaternius-realmodel-paperdoll-lineup.png", CARD_W * 2 + 80, CARD_H)


def render_direction_sheet() -> None:
    sheet_paths = []
    for direction, angle in {
        "south": 0,
        "east": math.radians(90),
        "north": math.radians(180),
        "west": math.radians(270),
    }.items():
        reset_scene_keep_camera_lights()
        male = import_character("male", MALE_GLTF, [HAIR_PARTED, HAIR_BEARD], x=0)
        male.rotation_euler = (0, 0, angle)
        aim_camera(location=(0, -7.2, 1.42), target=(0, 0, 1.24), ortho=2.65)
        path = OUT_DIR / f"duskfell-quaternius-realmodel-{direction}.png"
        render_to(path, CARD_W, CARD_H)
        sheet_paths.append(path)


def reset_scene_keep_camera_lights() -> None:
    keep = {"Camera", "Key", "Fill"}
    for obj in list(bpy.context.scene.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def import_character(name: str, body_path: Path, hair_paths: list[Path], *, x: float):
    root = bpy.data.objects.new(f"{name}_root", None)
    bpy.context.collection.objects.link(root)
    imported = []
    for path in [body_path, *hair_paths]:
        imported.extend(import_gltf(path))
    for obj in imported:
        obj.parent = root
    pose_paperdoll(root)
    fit_root_to_height(root, target_height=2.45)
    move_root_to_ground(root, x=x)
    stylize_imported_materials(root)
    return root


def import_gltf(path: Path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    return imported


def pose_paperdoll(root) -> None:
    armatures = [obj for obj in root.children_recursive if obj.type == "ARMATURE"]
    if not armatures:
        return
    armature = armatures[0]
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"

    rotations = {
        "clavicle_l": (0, 0, math.radians(-5)),
        "clavicle_r": (0, 0, math.radians(5)),
        "upperarm_l": (0, 0, math.radians(-68)),
        "upperarm_r": (0, 0, math.radians(68)),
        "lowerarm_l": (0, math.radians(-8), math.radians(-10)),
        "lowerarm_r": (0, math.radians(8), math.radians(10)),
        "hand_l": (0, 0, math.radians(8)),
        "hand_r": (0, 0, math.radians(-8)),
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
        root.scale = (scale, scale, scale)


def move_root_to_ground(root, *, x: float) -> None:
    bpy.context.view_layer.update()
    min_v, max_v = bounds(root)
    center = (min_v + max_v) / 2
    root.location.x += x - center.x
    root.location.y += -center.y
    root.location.z += -min_v.z


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


def stylize_imported_materials(root) -> None:
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        for slot in obj.material_slots:
            material = slot.material
            if not material:
                continue
            material.diffuse_color = tuple(min(1.0, c * 0.92) for c in material.diffuse_color[:3]) + (material.diffuse_color[3],)
            if material.use_nodes:
                bsdf = material.node_tree.nodes.get("Principled BSDF")
                if bsdf:
                    bsdf.inputs["Roughness"].default_value = 0.92
                    bsdf.inputs["Metallic"].default_value = 0.0


def add_duskfell_gear(root, *, side: int) -> None:
    min_v, max_v = bounds(root)
    center_x = (min_v.x + max_v.x) / 2
    front_y = min_v.y - 0.035
    height = max_v.z - min_v.z
    leather = material("duskfell blackened leather", (0.09, 0.075, 0.055, 1))
    wool = material("duskfell green wool", (0.12, 0.17, 0.145, 1))
    cloak = material("duskfell coal cloak", (0.035, 0.037, 0.04, 1))
    iron = material("duskfell dim iron", (0.44, 0.45, 0.42, 1), metallic=0.15)
    wood = material("duskfell spear ash", (0.23, 0.16, 0.10, 1))

    add_ellipsoid("padded_jack", (center_x, front_y, min_v.z + height * 0.57), (0.32, 0.06, 0.42), wool, root)
    add_ellipsoid("belt", (center_x, front_y - 0.005, min_v.z + height * 0.43), (0.34, 0.045, 0.045), leather, root)
    limb("cross_strap", (center_x - 0.22, front_y - 0.02, min_v.z + height * 0.73), (center_x + 0.21, front_y - 0.02, min_v.z + height * 0.44), 0.025, leather, root)
    add_ellipsoid("cloak_back", (center_x, max_v.y + 0.045, min_v.z + height * 0.48), (0.42, 0.06, 0.72), cloak, root)
    limb("spear", (center_x + side * 0.55, front_y - 0.05, min_v.z + height * 0.32), (center_x + side * 0.74, front_y - 0.14, min_v.z + height * 1.07), 0.018, wood, root)
    add_ellipsoid("spear_tip", (center_x + side * 0.76, front_y - 0.145, min_v.z + height * 1.12), (0.045, 0.026, 0.10), iron, root)
    add_ellipsoid("shield", (center_x - side * 0.48, front_y - 0.08, min_v.z + height * 0.49), (0.16, 0.035, 0.24), leather, root)
    add_ellipsoid("shield_boss", (center_x - side * 0.48, front_y - 0.11, min_v.z + height * 0.49), (0.050, 0.018, 0.050), iron, root)


def add_ellipsoid(name, location, scale, mat, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, location=location)
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
        bsdf.inputs["Roughness"].default_value = 0.9
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def aim_camera(location, target, ortho) -> None:
    camera = bpy.data.objects["Camera"]
    camera.location = Vector(location)
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = ortho


def render_to(path: Path, width: int, height: int) -> None:
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def write_manifest() -> None:
    manifest = {
        "schemaVersion": "duskfell-quaternius-realmodel-prototype-v1",
        "note": "Prototype render from real Quaternius Universal Base Characters Standard CC0 models.",
        "sourcePack": str(PACK_ROOT),
        "license": "CC0 1.0 Universal, per License_Standard.txt in downloaded pack.",
        "sourceFiles": [
            str(MALE_GLTF),
            str(FEMALE_GLTF),
            str(HAIR_LONG),
            str(HAIR_PARTED),
            str(HAIR_BEARD),
        ],
        "outputs": [
            "assets/sprites/player-cards/candidates/duskfell-quaternius-realmodel-paperdoll-lineup.png",
            "assets/sprites/player-cards/candidates/duskfell-quaternius-realmodel-south.png",
            "assets/sprites/player-cards/candidates/duskfell-quaternius-realmodel-east.png",
            "assets/sprites/player-cards/candidates/duskfell-quaternius-realmodel-north.png",
            "assets/sprites/player-cards/candidates/duskfell-quaternius-realmodel-west.png",
        ],
    }
    (OUT_DIR / "duskfell-quaternius-realmodel-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
