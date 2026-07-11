"""Render quick previews of downloaded third-party human model candidates."""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CANDIDATES = [
    {
        "slug": "oga-base-char",
        "label": "OpenGameArt base-char rigged CC0",
        "path": ROOT / "var" / "third-party-model-candidates" / "opengameart" / "base-char" / "base-char.blend",
        "hide": ["char-highpoly", "metarig"],
    },
    {
        "slug": "oga-human-male",
        "label": "OpenGameArt low-poly human male",
        "path": ROOT / "var" / "third-party-model-candidates" / "opengameart" / "human_male.blend",
        "hide": [],
    },
]


def main() -> None:
    outputs = []
    for candidate in CANDIDATES:
        render_candidate(candidate)
        outputs.append(f"assets/sprites/player-cards/candidates/duskfell-model-candidate-{candidate['slug']}.png")
    write_manifest(outputs)


def render_candidate(candidate) -> None:
    bpy.ops.wm.open_mainfile(filepath=str(candidate["path"]))
    remove_existing_cameras_and_lights()
    for name in candidate["hide"]:
        obj = bpy.data.objects.get(name)
        if obj:
            obj.hide_render = True
            obj.hide_viewport = True
    normalize_visible_meshes()
    stylize_materials()
    setup_camera_and_lights()
    path = OUT_DIR / f"duskfell-model-candidate-{candidate['slug']}.png"
    bpy.context.scene.render.resolution_x = 240
    bpy.context.scene.render.resolution_y = 340
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(path)


def remove_existing_cameras_and_lights() -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)


def normalize_visible_meshes() -> None:
    meshes = visible_meshes()
    min_v, max_v = bounds(meshes)
    height = max_v.z - min_v.z
    if height <= 0:
        return
    scale = 2.45 / height
    center = (min_v + max_v) / 2
    root = bpy.data.objects.new("candidate_root", None)
    bpy.context.collection.objects.link(root)
    for obj in list(bpy.context.scene.objects):
        if obj.name == root.name or obj.parent is not None:
            continue
        if obj.type in {"MESH", "ARMATURE"}:
            obj.parent = root
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    min_v, max_v = bounds(visible_meshes())
    center = (min_v + max_v) / 2
    root.location.x += -center.x
    root.location.y += -center.y
    root.location.z += -min_v.z


def visible_meshes():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.hide_render]


def bounds(meshes):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        for corner in evaluated.bound_box:
            v = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, v.x)
            mins.y = min(mins.y, v.y)
            mins.z = min(mins.z, v.z)
            maxs.x = max(maxs.x, v.x)
            maxs.y = max(maxs.y, v.y)
            maxs.z = max(maxs.z, v.z)
    return mins, maxs


def stylize_materials() -> None:
    for obj in visible_meshes():
        if not obj.material_slots:
            obj.data.materials.append(material("candidate muted skin", (0.58, 0.42, 0.31, 1)))
        for slot in obj.material_slots:
            if not slot.material:
                slot.material = material("candidate muted skin", (0.58, 0.42, 0.31, 1))
            slot.material.diffuse_color = tuple(min(1.0, c * 0.9) for c in slot.material.diffuse_color[:3]) + (slot.material.diffuse_color[3],)
            if slot.material.use_nodes:
                bsdf = slot.material.node_tree.nodes.get("Principled BSDF")
                if bsdf:
                    bsdf.inputs["Roughness"].default_value = 0.9


def material(name, rgba):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.9
    return mat


def setup_camera_and_lights() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 64
    scene.world = bpy.data.worlds.new("candidate world")
    scene.world.color = (0.03, 0.027, 0.03)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.location = Vector((0, -7.0, 1.45))
    target = Vector((0, 0, 1.22))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.85

    key_data = bpy.data.lights.new("Key", "AREA")
    key = bpy.data.objects.new("Key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (-2.8, -4.0, 4.8)
    key.data.energy = 620
    key.data.size = 4.0

    fill_data = bpy.data.lights.new("Fill", "POINT")
    fill = bpy.data.objects.new("Fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (2.4, -2.0, 2.6)
    fill.data.energy = 45
    fill.data.color = (0.6, 0.68, 0.72)


def write_manifest(outputs) -> None:
    manifest = {
        "schemaVersion": "duskfell-model-candidate-preview-v1",
        "note": "Visual comparison renders for third-party human model candidates. Prototype only.",
        "candidates": CANDIDATES,
        "outputs": outputs,
    }
    serializable = json.loads(json.dumps(manifest, default=str))
    (OUT_DIR / "duskfell-model-candidate-preview-manifest.json").write_text(json.dumps(serializable, indent=2) + "\n")


if __name__ == "__main__":
    main()
