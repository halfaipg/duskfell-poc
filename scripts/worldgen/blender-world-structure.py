"""Render a Duskfell world bundle as an aspect-correct 3D img2img control."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--samples-per-tile", type=int, default=4)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for datablock in list(collection):
            collection.remove(datablock)


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def fade(value: float) -> float:
    return value * value * (3.0 - 2.0 * value)


def hash01(x: int, y: int, seed: int) -> float:
    value = (x * 374761393 + y * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    value = ((value ^ (value >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((value ^ (value >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF


def value_noise(x: float, y: float, seed: int) -> float:
    x0 = math.floor(x)
    y0 = math.floor(y)
    fx = fade(x - x0)
    fy = fade(y - y0)
    north = hash01(x0, y0, seed) * (1.0 - fx) + hash01(x0 + 1, y0, seed) * fx
    south = hash01(x0, y0 + 1, seed) * (1.0 - fx) + hash01(x0 + 1, y0 + 1, seed) * fx
    return north * (1.0 - fy) + south * fy


def fbm(x: float, y: float, seed: int) -> float:
    total = 0.0
    amplitude = 0.55
    frequency = 0.9
    normalization = 0.0
    for octave in range(4):
        total += (value_noise(x * frequency, y * frequency, seed + octave * 977) - 0.5) * amplitude
        normalization += amplitude
        frequency *= 2.03
        amplitude *= 0.5
    return total / normalization


def bilinear(grid: list[list[float]], x: float, y: float) -> float:
    rows = len(grid)
    cols = len(grid[0])
    x = clamp(x, 0.0, cols - 1.000001)
    y = clamp(y, 0.0, rows - 1.000001)
    x0 = int(math.floor(x))
    y0 = int(math.floor(y))
    x1 = min(cols - 1, x0 + 1)
    y1 = min(rows - 1, y0 + 1)
    tx = x - x0
    ty = y - y0
    north = grid[y0][x0] * (1.0 - tx) + grid[y0][x1] * tx
    south = grid[y1][x0] * (1.0 - tx) + grid[y1][x1] * tx
    return north * (1.0 - ty) + south * ty


def parse_color(value: str) -> tuple[float, float, float]:
    return tuple(int(value[offset : offset + 2], 16) / 255.0 for offset in (1, 3, 5))


def surface_color(bundle: dict, recipe: dict, x: float, y: float) -> tuple[float, float, float, float]:
    color = [0.0, 0.0, 0.0]
    terrestrial = ("meadow", "loam", "rock", "wetland")
    weights = {biome: bilinear(bundle["biomeWeights"][biome], x, y) for biome in terrestrial}
    total = sum(weights.values()) or 1.0
    for biome in terrestrial:
        weight = weights[biome] / total
        source = parse_color(recipe["palette"][biome])
        for channel in range(3):
            color[channel] += source[channel] * weight
    trail = bilinear(bundle["fields"].get("trail", [[0.0]]), x, y)
    settlement = bilinear(bundle["fields"].get("settlement", [[0.0]]), x, y)
    loam = parse_color(recipe["palette"]["loam"])
    rock = parse_color(recipe["palette"]["rock"])
    for channel in range(3):
        color[channel] = color[channel] * (1.0 - trail * 0.55) + loam[channel] * trail * 0.55
        color[channel] = color[channel] * (1.0 - settlement * 0.58) + rock[channel] * settlement * 0.58
    return (*color, 1.0)


def terrain_height(bundle: dict, x: float, y: float, seed: int) -> float:
    canonical = bundle.get("authority")
    if canonical:
        authority = bilinear(canonical["elevation"], x * canonical["samplesPerTile"], y * canonical["samplesPerTile"])
    else:
        authority = bilinear(bundle["heights"], x, y)
    rock = bilinear(bundle["fields"]["rockiness"], x, y)
    water = bilinear(bundle["fields"]["water"], x, y)
    detail = fbm(x * 1.7, y * 1.7, seed + 1907) * (0.018 + rock * 0.052) * (1.0 - water)
    return authority * 5.2 + detail


def authority_water(bundle: dict, x: float, y: float) -> float:
    canonical = bundle.get("authority")
    if canonical:
        return bilinear(canonical["water"], x * canonical["samplesPerTile"], y * canonical["samplesPerTile"])
    return bilinear(bundle["fields"]["water"], x, y)


def terrain_material() -> bpy.types.Material:
    material = bpy.data.materials.new("DuskfellTerrainControl")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    vertex = nodes.new("ShaderNodeVertexColor")
    vertex.layer_name = "BiomeColor"
    geometry = nodes.new("ShaderNodeNewGeometry")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.4
    noise.inputs["Detail"].default_value = 5.0
    noise.inputs["Roughness"].default_value = 0.72
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.2
    ramp.color_ramp.elements[0].color = (0.68, 0.70, 0.63, 1.0)
    ramp.color_ramp.elements[1].position = 0.82
    ramp.color_ramp.elements[1].color = (1.03, 1.01, 0.92, 1.0)
    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 0.3
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.18
    bump.inputs["Distance"].default_value = 0.09
    shader.inputs["Roughness"].default_value = 0.9
    links.new(geometry.outputs["Position"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(vertex.outputs["Color"], mix.inputs[1])
    links.new(ramp.outputs["Color"], mix.inputs[2])
    links.new(mix.outputs["Color"], shader.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def build_control_heightfield(bundle: dict, recipe: dict, samples: int) -> list[list[float]]:
    cols = bundle["dimensions"]["cols"]
    rows = bundle["dimensions"]["rows"]
    width = cols * samples
    height = rows * samples
    values = [
        [terrain_height(bundle, column / samples, row / samples, recipe["seed"]) for column in range(width + 1)]
        for row in range(height + 1)
    ]
    for _ in range(32):
        source = values
        values = [row[:] for row in source]
        for row in range(1, height):
            for column in range(1, width):
                values[row][column] = (
                    source[row][column] * 4.0
                    + source[row - 1][column] * 2.0
                    + source[row + 1][column] * 2.0
                    + source[row][column - 1] * 2.0
                    + source[row][column + 1] * 2.0
                    + source[row - 1][column - 1]
                    + source[row - 1][column + 1]
                    + source[row + 1][column - 1]
                    + source[row + 1][column + 1]
                ) / 16.0
    return values


def build_control_colorfield(bundle: dict, recipe: dict, samples: int) -> list[list[tuple[float, float, float, float]]]:
    cols = bundle["dimensions"]["cols"]
    rows = bundle["dimensions"]["rows"]
    width = cols * samples
    height = rows * samples
    values = [
        [surface_color(bundle, recipe, min(cols - 1e-6, column / samples), min(rows - 1e-6, row / samples)) for column in range(width + 1)]
        for row in range(height + 1)
    ]
    for _ in range(8):
        source = values
        values = [row[:] for row in source]
        for row in range(1, height):
            for column in range(1, width):
                samples_3x3 = (
                    (source[row][column], 4.0),
                    (source[row - 1][column], 2.0),
                    (source[row + 1][column], 2.0),
                    (source[row][column - 1], 2.0),
                    (source[row][column + 1], 2.0),
                    (source[row - 1][column - 1], 1.0),
                    (source[row - 1][column + 1], 1.0),
                    (source[row + 1][column - 1], 1.0),
                    (source[row + 1][column + 1], 1.0),
                )
                values[row][column] = tuple(sum(color[channel] * weight for color, weight in samples_3x3) / 16.0 for channel in range(4))
    return values


def build_terrain(
    bundle: dict,
    recipe: dict,
    samples: int,
    heights: list[list[float]],
    surface_colors: list[list[tuple[float, float, float, float]]],
) -> None:
    cols = bundle["dimensions"]["cols"]
    rows = bundle["dimensions"]["rows"]
    width = cols * samples
    height = rows * samples
    vertices = []
    colors = []
    for row in range(height + 1):
        source_y = row / samples
        world_y = rows - source_y
        for column in range(width + 1):
            source_x = column / samples
            vertices.append((source_x, world_y, heights[row][column]))
            colors.append(surface_colors[row][column])
    faces = []
    for row in range(height):
        for column in range(width):
            first = row * (width + 1) + column
            faces.append((first, first + 1, first + width + 2, first + width + 1))
    mesh = bpy.data.meshes.new("DuskfellWorldHeightfield")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    color_layer = mesh.color_attributes.new(name="BiomeColor", type="FLOAT_COLOR", domain="CORNER")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            color_layer.data[loop_index].color = colors[mesh.loops[loop_index].vertex_index]
        polygon.use_smooth = True
    terrain = bpy.data.objects.new("DuskfellWorldHeightfield", mesh)
    bpy.context.collection.objects.link(terrain)
    terrain.data.materials.append(terrain_material())


def build_water(bundle: dict, recipe: dict, samples: int, heights: list[list[float]]) -> None:
    cols = bundle["dimensions"]["cols"]
    rows = bundle["dimensions"]["rows"]
    width = cols * samples
    height = rows * samples
    vertices = []
    for row in range(height + 1):
        source_y = row / samples
        for column in range(width + 1):
            source_x = column / samples
            level = heights[row][column] + 0.11
            vertices.append((source_x, rows - source_y, level))
    faces = []
    for row in range(height):
        y0 = row / samples
        y1 = (row + 1) / samples
        for column in range(width):
            x0 = column / samples
            x1 = (column + 1) / samples
            center_x = (x0 + x1) * 0.5
            center_y = (y0 + y1) * 0.5
            if authority_water(bundle, center_x, center_y) <= 0.28:
                continue
            first = row * (width + 1) + column
            faces.append((first, first + 1, first + width + 2, first + width + 1))
    mesh = bpy.data.meshes.new("DuskfellAuthorityWater")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    water = bpy.data.objects.new("DuskfellAuthorityWater", mesh)
    bpy.context.collection.objects.link(water)
    material = bpy.data.materials.new("DuskfellWaterControl")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*parse_color(recipe["palette"]["water"]), 1.0)
    shader.inputs["Roughness"].default_value = 0.24
    shader.inputs["Metallic"].default_value = 0.08
    water.data.materials.append(material)


def configure_scene(bundle: dict, args: argparse.Namespace, output: Path) -> None:
    cols = bundle["dimensions"]["cols"]
    rows = bundle["dimensions"]["rows"]
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = str(output)
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.08, 0.085, 0.07, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.62

    camera_data = bpy.data.cameras.new("WorldStructureCamera")
    camera = bpy.data.objects.new("WorldStructureCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (cols / 2.0, rows / 2.0, 100.0)
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = Vector((0.0, 0.0, -1.0)).to_track_quat("-Z", "Y")
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = rows
    scene.camera = camera

    sun_data = bpy.data.lights.new("WorldSun", "SUN")
    sun = bpy.data.objects.new("WorldSun", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(28), math.radians(-24), math.radians(-38))
    sun.data.energy = 2.2
    sun.data.angle = math.radians(18)
    fill_data = bpy.data.lights.new("WorldFill", "AREA")
    fill = bpy.data.objects.new("WorldFill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (cols * 0.72, rows * 0.3, 30.0)
    fill.data.energy = 500.0
    fill.data.shape = "DISK"
    fill.data.size = max(cols, rows) * 0.7


def main() -> None:
    args = parse_args()
    bundle_path = Path(args.bundle).resolve()
    recipe_path = Path(args.recipe).resolve()
    output = Path(args.output).resolve()
    metadata = Path(args.metadata).resolve()
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    output.parent.mkdir(parents=True, exist_ok=True)
    reset_scene()
    heights = build_control_heightfield(bundle, recipe, args.samples_per_tile)
    surface_colors = build_control_colorfield(bundle, recipe, args.samples_per_tile)
    build_terrain(bundle, recipe, args.samples_per_tile, heights, surface_colors)
    configure_scene(bundle, args, output)
    bpy.ops.render.render(write_still=True)
    metadata.write_text(json.dumps({
        "schema": "duskfell-blender-world-structure-v1",
        "renderer": "blender-heightfield-v1",
        "bundle": bundle_path.name,
        "bundleSha256": hashlib.sha256(bundle_path.read_bytes()).hexdigest(),
        "recipe": recipe_path.name,
        "output": output.name,
        "width": args.width,
        "height": args.height,
        "samplesPerTile": args.samples_per_tile,
        "heightScale": 5.2,
        "controlHeightSmoothing": {"kernel": "gaussian-3x3", "passes": 32},
        "controlColorSmoothing": {"kernel": "gaussian-3x3", "passes": 8},
        "semanticSurfaces": "authority-composite-after-render",
        "projection": "orthographic-plan-control-for-military-plan-oblique-runtime",
    }, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
