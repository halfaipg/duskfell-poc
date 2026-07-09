"""Render a painterly Duskfell wayfarer variant from the rigged Adventurer mesh."""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites" / "player-cards" / "candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)
BASE_SCRIPT = ROOT / "scripts" / "blender-duskfell-wayfarer-character.py"

DIRECTIONS = {
    "south": 0,
    "east": math.radians(90),
    "north": math.radians(180),
    "west": math.radians(270),
}


def main() -> None:
    base = load_base()
    base.setup_scene()
    render_paperdoll(base)
    render_directions(base)
    write_manifest()


def load_base():
    spec = importlib.util.spec_from_file_location("duskfell_wayfarer_base", BASE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {BASE_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def render_paperdoll(base) -> None:
    base.reset_scene()
    character = base.build_character()
    upgrade_character(base, character)
    character.rotation_euler = (0, 0, math.radians(2))
    base.aim_camera((0, -7.2, 1.42), (0, 0, 1.10), 2.76)
    base.render_to(OUT_DIR / "duskfell-painterly-wayfarer-paperdoll.png", 384, 528)


def render_directions(base) -> None:
    for direction, angle in DIRECTIONS.items():
        base.reset_scene()
        character = base.build_character()
        upgrade_character(base, character)
        character.rotation_euler = (0, 0, angle)
        base.aim_camera((0, -7.2, 1.42), (0, 0, 1.10), 2.76)
        base.render_to(OUT_DIR / f"duskfell-painterly-wayfarer-{direction}.png", 256, 360)


def upgrade_character(base, root) -> None:
    apply_painterly_palette()
    add_surcoat(base, root)
    add_cowl_and_hair_shadow(base, root)
    add_small_gear(base, root)
    bpy.context.view_layer.update()


def apply_painterly_palette() -> None:
    replacements = {
        "Green": (0.040, 0.060, 0.050, 1),
        "LightGreen": (0.105, 0.150, 0.120, 1),
        "LightBlue": (0.050, 0.070, 0.065, 1),
        "Brown": (0.170, 0.105, 0.060, 1),
        "Brown2": (0.245, 0.170, 0.095, 1),
        "Material": (0.390, 0.270, 0.175, 1),
        "Skin": (0.480, 0.330, 0.225, 1),
        "Hair": (0.095, 0.070, 0.050, 1),
        "Grey": (0.280, 0.280, 0.250, 1),
        "Black": (0.020, 0.022, 0.022, 1),
    }
    for mat in bpy.data.materials:
        if mat.name in replacements:
            mat.diffuse_color = replacements[mat.name]
        if mat.use_nodes:
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Base Color"].default_value = mat.diffuse_color
                bsdf.inputs["Roughness"].default_value = 0.98
                bsdf.inputs["Metallic"].default_value = 0


def add_surcoat(base, root) -> None:
    dark = base.material("painterly deep wool surcoat", (0.030, 0.047, 0.041, 1))
    mid = base.material("painterly worn green cloth", (0.090, 0.135, 0.108, 1))
    trim = base.material("painterly weathered trim", (0.37, 0.30, 0.20, 1))
    leather = base.material("painterly leather belt", (0.145, 0.085, 0.045, 1))
    brass = base.material("painterly dull brass", (0.43, 0.33, 0.17, 1), metallic=0.08)

    base.add_box("painterly_surcoat_front", (0, -0.067, 1.205), (0.185, 0.020, 0.390), mid, root)
    base.add_box("painterly_surcoat_shadow", (0, -0.070, 0.905), (0.155, 0.017, 0.205), dark, root)
    base.add_box("painterly_surcoat_left_trim", (-0.096, -0.082, 1.185), (0.010, 0.007, 0.365), trim, root)
    base.add_box("painterly_surcoat_right_trim", (0.096, -0.082, 1.185), (0.010, 0.007, 0.365), trim, root)
    base.add_box("painterly_belt", (0, -0.097, 1.035), (0.238, 0.012, 0.024), leather, root)
    base.add_ellipsoid("painterly_buckle", (0, -0.111, 1.037), (0.024, 0.005, 0.017), brass, root)


def add_cowl_and_hair_shadow(base, root) -> None:
    cowl = base.material("painterly charcoal shoulder cowl", (0.023, 0.029, 0.029, 1))
    hair_shadow = base.material("painterly hair shadow", (0.055, 0.040, 0.030, 1))
    base.add_box("painterly_left_cowl_fall", (-0.145, 0.060, 1.235), (0.040, 0.016, 0.330), cowl, root)
    base.add_box("painterly_right_cowl_fall", (0.145, 0.060, 1.235), (0.040, 0.016, 0.330), cowl, root)
    base.add_ellipsoid("painterly_left_cowl_cap", (-0.180, -0.025, 1.555), (0.065, 0.046, 0.045), cowl, root)
    base.add_ellipsoid("painterly_right_cowl_cap", (0.180, -0.025, 1.555), (0.065, 0.046, 0.045), cowl, root)
    base.add_box("painterly_beard_shadow", (0.000, -0.104, 1.805), (0.055, 0.006, 0.022), hair_shadow, root)


def add_small_gear(base, root) -> None:
    leather = base.material("painterly dark shield leather", (0.125, 0.075, 0.045, 1))
    iron = base.material("painterly worn iron", (0.360, 0.355, 0.320, 1), metallic=0.06)
    wood = base.material("painterly ash shaft", (0.235, 0.150, 0.080, 1))
    base.add_limb("painterly_staff", (0.405, -0.045, 0.58), (0.470, -0.050, 1.98), 0.0075, wood, root)
    base.add_ellipsoid("painterly_staff_tip", (0.478, -0.052, 2.055), (0.024, 0.010, 0.055), iron, root)
    base.add_ellipsoid("painterly_shield", (-0.365, -0.072, 1.145), (0.072, 0.018, 0.112), leather, root)
    base.add_ellipsoid("painterly_shield_boss", (-0.365, -0.093, 1.145), (0.018, 0.005, 0.018), iron, root)


def write_manifest() -> None:
    outputs = ["assets/sprites/player-cards/candidates/duskfell-painterly-wayfarer-paperdoll.png"]
    outputs.extend(f"assets/sprites/player-cards/candidates/duskfell-painterly-wayfarer-{direction}.png" for direction in DIRECTIONS)
    manifest = {
        "schemaVersion": "duskfell-painterly-wayfarer-v1",
        "note": "Painterly rigged-human variant: Adventurer mesh anatomy with darker Blender-rendered surcoat, cowl, shield, and staff layers.",
        "baseScript": str(BASE_SCRIPT),
        "outputs": outputs,
    }
    (OUT_DIR / "duskfell-painterly-wayfarer-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
