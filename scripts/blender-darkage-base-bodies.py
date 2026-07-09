"""Render dark-age base body prototypes: male/female, lean/heavy, in tattered rags.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender-darkage-base-bodies.py

Bodies come from the Blender Studio Human Base Meshes bundle (CC0):
var/third-party-model-candidates/blender-studio-human-base/

The bundle meshes are unrigged A-pose sculpting bases, so body types are made
with radial vertex displacement (belly/hip bulge for heavy, core slimming for
lean) and the tattered cloth is procedural jagged flap geometry fitted to the
measured silhouette.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BUNDLE_BLEND = (
    ROOT
    / "var"
    / "third-party-model-candidates"
    / "blender-studio-human-base"
    / "human-base-meshes-bundle-v1.4.1"
    / "human_base_meshes_bundle.blend"
)
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CHARACTER_HEIGHT = 2.45

MALE_OBJECTS = ["GEO-body_male_realistic", "GEO-body_male_realistic.eye.L", "GEO-body_male_realistic.eye.R"]
FEMALE_OBJECTS = ["GEO-body_female_realistic", "GEO-body_female_realistic.eye.L", "GEO-body_female_realistic.eye.R"]

VARIANTS = [
    {
        "slug": "male-lean",
        "label": "Male / lean",
        "objects": MALE_OBJECTS,
        "skin": (0.62, 0.47, 0.36, 1.0),
        "shape": {"belly": -0.35, "hips": -0.15, "core_slim": 0.10},
        "rags": {"loincloth": True, "chest_wrap": False, "shoulder_rag": True},
        "rag_color": (0.16, 0.13, 0.10, 1.0),
        "seed": 11,
    },
    {
        "slug": "male-heavy",
        "label": "Male / heavy",
        "objects": MALE_OBJECTS,
        "skin": (0.60, 0.44, 0.33, 1.0),
        "shape": {"belly": 1.0, "hips": 0.45, "core_slim": 0.0},
        "rags": {"loincloth": True, "chest_wrap": False, "shoulder_rag": False},
        "rag_color": (0.14, 0.12, 0.09, 1.0),
        "seed": 23,
    },
    {
        "slug": "female-lean",
        "label": "Female / lean",
        "objects": FEMALE_OBJECTS,
        "skin": (0.66, 0.50, 0.40, 1.0),
        "shape": {"belly": -0.25, "hips": -0.10, "core_slim": 0.08},
        "rags": {"loincloth": True, "chest_wrap": True, "shoulder_rag": False},
        "rag_color": (0.15, 0.13, 0.11, 1.0),
        "seed": 37,
    },
    {
        "slug": "female-heavy",
        "label": "Female / heavy",
        "objects": FEMALE_OBJECTS,
        "skin": (0.63, 0.47, 0.37, 1.0),
        "shape": {"belly": 0.85, "hips": 0.55, "core_slim": 0.0},
        "rags": {"loincloth": True, "chest_wrap": True, "shoulder_rag": False},
        "rag_color": (0.17, 0.14, 0.10, 1.0),
        "seed": 53,
    },
]


def main() -> None:
    if not BUNDLE_BLEND.exists():
        raise FileNotFoundError(f"Missing bundle blend: {BUNDLE_BLEND}")
    setup_scene()
    render_lineup()
    render_game_angle_strip()
    write_manifest()


def setup_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 64
        if hasattr(scene.eevee, "use_gtao"):
            scene.eevee.use_gtao = True
            scene.eevee.gtao_distance = 3
            scene.eevee.gtao_factor = 1.3

    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.world = bpy.data.worlds.new("Duskfell darkage world")
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
    slots = [-2.05, -0.7, 0.7, 2.05]
    for variant, x in zip(VARIANTS, slots):
        build_variant(variant, x=x)
    aim_camera(location=(0, -8.4, 1.42), target=(0, 0, 1.2), ortho=6.0)
    render_to(OUT_DIR / "duskfell-darkage-base-bodies-lineup.png", 1440, 640)


def render_game_angle_strip() -> None:
    for variant in VARIANTS:
        reset_scene_keep_camera_lights()
        root = build_variant(variant, x=0)
        root.rotation_euler = (0, 0, math.radians(30))
        aim_camera(location=(0, -6.4, 5.2), target=(0, 0, 1.05), ortho=3.1)
        render_to(OUT_DIR / f"duskfell-darkage-{variant['slug']}-game-angle.png", 288, 384)


def reset_scene_keep_camera_lights() -> None:
    keep = {"Camera", "Key", "Fill"}
    for obj in list(bpy.context.scene.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def build_variant(variant, *, x: float):
    rng = random.Random(variant["seed"])
    root = bpy.data.objects.new(f"{variant['slug']}_root", None)
    bpy.context.collection.objects.link(root)

    imported = append_objects(variant["objects"])
    for obj in imported:
        obj.parent = root

    body = next(obj for obj in imported if obj.name.startswith("GEO-body") and "eye" not in obj.name)
    shape_body(body, variant["shape"])
    apply_skin(imported, variant["skin"])
    fit_root_to_height(root, target_height=CHARACTER_HEIGHT)
    move_root_to_ground(root, x=x)
    add_rags(root, variant, rng)
    return root


def append_objects(names):
    imported = []
    for name in names:
        before = set(bpy.data.objects)
        bpy.ops.wm.append(
            filepath=str(BUNDLE_BLEND / "Object" / name),
            directory=str(BUNDLE_BLEND) + "/Object/",
            filename=name,
            link=False,
        )
        added = [obj for obj in bpy.data.objects if obj not in before]
        for obj in added:
            if obj.name not in {o.name for o in bpy.context.scene.objects}:
                bpy.context.collection.objects.link(obj)
            obj.parent = None
        imported.extend(added)
    return imported


def shape_body(body, shape) -> None:
    """Body types via radial displacement from the vertical centerline."""
    mesh = body.data
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    min_z, max_z = min(zs), max(zs)
    height = max_z - min_z
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    core_radius = 0.17 * height

    # front bias sign: toes stick out toward the face direction
    foot_verts = [v.co.y for v in mesh.vertices if v.co.z < min_z + 0.04 * height]
    front_sign = -1.0 if (sum(foot_verts) / max(1, len(foot_verts))) < cy else 1.0

    belly_c = min_z + 0.56 * height
    belly_sigma = 0.085 * height
    hips_c = min_z + 0.47 * height
    hips_sigma = 0.06 * height
    slim_c = min_z + 0.55 * height
    slim_sigma = 0.14 * height

    belly_amp = shape.get("belly", 0.0) * 0.045 * height
    hips_amp = shape.get("hips", 0.0) * 0.03 * height
    slim = shape.get("core_slim", 0.0)

    for vert in mesh.vertices:
        dx = vert.co.x - cx
        dy = vert.co.y - cy
        r = math.hypot(dx, dy)
        if r > core_radius or r < 1e-6:
            continue
        ux, uy = dx / r, dy / r
        z = vert.co.z
        bulge = belly_amp * math.exp(-(((z - belly_c) / belly_sigma) ** 2))
        bulge += hips_amp * math.exp(-(((z - hips_c) / hips_sigma) ** 2))
        # weight bulge by how central the vert is so the back bulges less than belly
        frontness = 0.5 + 0.5 * (uy * front_sign)
        bulge *= 0.45 + 0.75 * frontness
        if slim:
            shrink = slim * math.exp(-(((z - slim_c) / slim_sigma) ** 2))
            vert.co.x = cx + dx * (1.0 - shrink)
            vert.co.y = cy + dy * (1.0 - shrink)
            dx = vert.co.x - cx
            dy = vert.co.y - cy
        vert.co.x += ux * bulge
        vert.co.y += uy * bulge
    mesh.update()


def apply_skin(objects, rgba) -> None:
    skin = material(f"duskfell skin {rgba}", rgba)
    eye = material("duskfell eye", (0.08, 0.07, 0.06, 1.0))
    for obj in objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        obj.data.materials.append(eye if "eye" in obj.name else skin)


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
            mins = Vector((min(mins.x, v.x), min(mins.y, v.y), min(mins.z, v.z)))
            maxs = Vector((max(maxs.x, v.x), max(maxs.y, v.y), max(maxs.z, v.z)))
    if not found:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    return mins, maxs


def body_extents_at(root, z_center: float, z_half_band: float, core_limit_frac: float = 0.12):
    """Core-torso extents in a z band, ignoring arms.

    Returns (half_width, y_radius, y_center_offset): the torso is not centered
    on the body centerline (chest/belly reach further forward than the back),
    so cloth ellipses need both a y radius and a forward offset.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    min_v, max_v = bounds(root)
    center_x = (min_v.x + max_v.x) / 2
    center_y = (min_v.y + max_v.y) / 2
    core_limit = (max_v.z - min_v.z) * core_limit_frac
    best_x = 0.0
    max_pos_y = 0.0
    max_neg_y = 0.0
    for obj in root.children_recursive:
        if obj.type != "MESH" or "eye" in obj.name.lower():
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        matrix = evaluated.matrix_world
        for vert in mesh.vertices:
            v = matrix @ vert.co
            if abs(v.z - z_center) <= z_half_band:
                dx = v.x - center_x
                dy = v.y - center_y
                if math.hypot(dx, dy) < core_limit:
                    best_x = max(best_x, abs(dx))
                    if dy >= 0:
                        max_pos_y = max(max_pos_y, dy)
                    else:
                        max_neg_y = max(max_neg_y, -dy)
        evaluated.to_mesh_clear()
    return best_x, (max_pos_y + max_neg_y) / 2, (max_pos_y - max_neg_y) / 2


def add_rags(root, variant, rng) -> None:
    min_v, max_v = bounds(root)
    height = max_v.z - min_v.z
    center = ((min_v.x + max_v.x) / 2, (min_v.y + max_v.y) / 2)
    rag_mat = material(f"duskfell rag {variant['slug']}", variant["rag_color"])
    dark_rgb = tuple(c * 0.7 for c in variant["rag_color"][:3]) + (1.0,)
    dark_mat = material(f"duskfell rag dark {variant['slug']}", dark_rgb)

    rags = variant["rags"]
    if rags.get("loincloth"):
        waist_z = min_v.z + height * 0.535
        wx, wy, woff = body_extents_at(root, waist_z, height * 0.03)
        hx, hy, hoff = body_extents_at(root, min_v.z + height * 0.465, height * 0.03)
        gx, gy, goff = body_extents_at(root, min_v.z + height * 0.44, height * 0.025)
        hx, hy = max(hx, gx), max(hy, gy)
        waist_center = (center[0], center[1] + (woff + hoff) / 2)
        top_r = (wx * 1.05 + 0.007, wy * 1.05 + 0.007)
        hip_r = (max(wx, hx) * 1.07 + 0.008, max(wy, hy) * 1.07 + 0.008)
        add_cloth_band(
            "loincloth_under", root, waist_center, top_z=waist_z, radius_top=top_r,
            radius_bottom=hip_r, length=height * 0.105,
            jag=height * 0.012, segments=18, mat=rag_mat, rng=rng,
        )
        add_jagged_skirt(
            "loincloth_flaps", root, waist_center, top_z=waist_z - height * 0.048,
            radius=hip_r, length=height * 0.095,
            jag=height * 0.03, segments=13, mat=dark_mat, rng=rng, flare=1.03,
        )
        add_cloth_band(
            "belt_rope", root, waist_center, top_z=waist_z + height * 0.012,
            radius_top=(top_r[0] * 1.01, top_r[1] * 1.01),
            radius_bottom=(top_r[0] * 1.015, top_r[1] * 1.015),
            length=height * 0.022, jag=0.0, segments=18, mat=dark_mat, rng=rng,
        )
    if rags.get("chest_wrap"):
        top_z = min_v.z + height * 0.745
        band_length = height * 0.085
        mid_z = top_z - band_length / 2
        bx, by, boff = body_extents_at(root, mid_z, band_length / 2, core_limit_frac=0.115)
        wrap_center = (center[0], center[1] + boff)
        wrap_r = (bx * 1.06 + 0.005, by * 1.08 + 0.006)
        add_cloth_band(
            "chest_wrap", root, wrap_center, top_z=top_z,
            radius_top=wrap_r, radius_bottom=wrap_r,
            length=band_length, jag=height * 0.008, segments=18, mat=rag_mat, rng=rng,
        )


def add_jagged_skirt(name, root, center, *, top_z, radius, length, jag, segments, mat, rng, flare=1.1) -> None:
    """A cone of tattered cloth flaps: shared top ring, per-segment ragged points."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    top_ring = []
    for i in range(segments):
        angle = 2 * math.pi * i / segments
        top_ring.append(bm.verts.new((
            center[0] + radius[0] * math.cos(angle),
            center[1] + radius[1] * math.sin(angle),
            top_z,
        )))
    for i in range(segments):
        a = top_ring[i]
        b = top_ring[(i + 1) % segments]
        angle = 2 * math.pi * (i + 0.5) / segments
        tip_flare = flare + rng.uniform(-0.02, 0.04)
        drop = length + rng.uniform(-jag, jag)
        tip = bm.verts.new((
            center[0] + radius[0] * tip_flare * math.cos(angle),
            center[1] + radius[1] * tip_flare * math.sin(angle),
            top_z - drop,
        ))
        bm.faces.new((a, b, tip))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    parent_keep_transform(obj, root)


def add_cloth_band(name, root, center, *, top_z, radius_top, radius_bottom, length, jag, segments, mat, rng) -> None:
    """A snug closed conical strip of cloth with a slightly ragged bottom hem."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    top_ring = []
    bottom_ring = []
    for i in range(segments):
        angle = 2 * math.pi * i / segments
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        top_ring.append(bm.verts.new((
            center[0] + radius_top[0] * cos_a,
            center[1] + radius_top[1] * sin_a,
            top_z,
        )))
        bottom_ring.append(bm.verts.new((
            center[0] + radius_bottom[0] * cos_a,
            center[1] + radius_bottom[1] * sin_a,
            top_z - length + rng.uniform(-jag, jag),
        )))
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((top_ring[i], top_ring[j], bottom_ring[j], bottom_ring[i]))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    parent_keep_transform(obj, root)


def add_band(name, root, center, *, z, radius, thickness, mat) -> None:
    bpy.ops.mesh.primitive_torus_add(
        location=(center[0], center[1], z),
        major_radius=radius,
        minor_radius=thickness,
        major_segments=24,
        minor_segments=8,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    parent_keep_transform(obj, root)


def parent_keep_transform(obj, root) -> None:
    obj.parent = root
    obj.matrix_parent_inverse = root.matrix_world.inverted()


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
        "schemaVersion": "duskfell-darkage-base-bodies-prototype-v1",
        "note": "Dark-age base body prototypes: male/female, lean/heavy, procedural tattered rags.",
        "sourceBundle": str(BUNDLE_BLEND),
        "license": "CC0, Blender Studio Human Base Meshes bundle.",
        "outputs": [
            "assets/sprites/player-cards/candidates/duskfell-darkage-base-bodies-lineup.png",
            *[
                f"assets/sprites/player-cards/candidates/duskfell-darkage-{variant['slug']}-game-angle.png"
                for variant in VARIANTS
            ],
        ],
    }
    (OUT_DIR / "duskfell-darkage-base-bodies-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
