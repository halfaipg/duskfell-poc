"""Bake a registered eight-direction Duskfell locomotion sprite candidate.

The source motion is the CC0 Quaternius armature embedded in the checked
``wretch-factory.blend``. Blender owns pose, timing, camera, and registration;
the resulting sheet remains a review candidate until the image and browser
gates pass.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FACTORY = ROOT / "var" / "blender" / "wretch-factory.blend"
DEFAULT_OUTPUT = ROOT / "assets" / "sprites" / "candidates" / "blender-locomotion-v2"
FPS = 30
CELL_WIDTH = 128
CELL_HEIGHT = 160
RENDER_SCALE = 2
ANCHOR = (64, 110)
DIRECTIONS = (
    ("south", -45),
    ("southeast", 0),
    ("east", 45),
    ("northeast", 90),
    ("north", 135),
    ("northwest", 180),
    ("west", -135),
    ("southwest", -90),
)
MAPPING = (
    ("Abdomen", "spine01"),
    ("Torso", "spine03"),
    ("Head", "head"),
    ("UpperArm.L", "upperarm01.L"),
    ("LowerArm.L", "lowerarm01.L"),
    ("UpperArm.R", "upperarm01.R"),
    ("LowerArm.R", "lowerarm01.R"),
    ("UpperLeg.L", "upperleg01.L"),
    ("LowerLeg.L", "lowerleg01.L"),
    ("Foot.L", "foot.L"),
    ("UpperLeg.R", "upperleg01.R"),
    ("LowerLeg.R", "lowerleg01.R"),
    ("Foot.R", "foot.R"),
)
CLIPS = {
    "idle": {
        "source": "CharacterArmature|Idle",
        "render_frames": 16,
        "damping": {
            **{source_name: 0.0 for source_name, _ in MAPPING},
            "Abdomen": 0.18,
            "Torso": 0.15,
            "Head": 0.10,
            "UpperLeg.L": 0.12,
            "UpperLeg.R": 0.12,
            "LowerLeg.L": 0.12,
            "LowerLeg.R": 0.12,
        },
    },
    "walk": {
        "source": "CharacterArmature|Walk",
        "render_frames": 20,
        "damping": {
            "Abdomen": 0.68,
            "Torso": 0.62,
            "Head": 0.35,
            "UpperArm.L": 0.0,
            "UpperArm.R": 0.0,
            "LowerArm.L": 0.0,
            "LowerArm.R": 0.0,
            "UpperLeg.L": 0.52,
            "UpperLeg.R": 0.52,
            "LowerLeg.L": 0.68,
            "LowerLeg.R": 0.68,
            "Foot.L": 0.32,
            "Foot.R": 0.32,
        },
    },
}


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--factory", type=Path, default=DEFAULT_FACTORY)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--name", default="duskfell-locomotion-v2")
    parser.add_argument("--preview", action="store_true", help="Render one frame per clip and direction")
    return parser.parse_args(values)


def main() -> None:
    args = parse_args()
    factory = args.factory.resolve()
    output = args.output.resolve()
    if not factory.is_file():
        raise FileNotFoundError(factory)
    output.mkdir(parents=True, exist_ok=True)
    frame_dir = output / "frames"
    frame_dir.mkdir(exist_ok=True)
    for path in frame_dir.glob("*.png"):
        path.unlink()

    if Path(bpy.data.filepath).resolve() != factory:
        bpy.ops.wm.open_mainfile(filepath=str(factory))

    source_scene = require_scene("mocap_source")
    target_scene = require_scene("Scene")
    source = require_object("CharacterArmature", "ARMATURE")
    target = require_object("uo_wretch.rig", "ARMATURE")
    root = require_object("wretch_root")
    meshes, hidden_meshes = isolate_character(target_scene, target, root)
    normalize_character(target_scene, root, target, meshes)

    target_reference = target_reference_rotations(target_scene, target, root)
    actions = {}
    source_ranges = {}
    for clip_name, config in CLIPS.items():
        source_action = bpy.data.actions.get(config["source"])
        if source_action is None:
            raise RuntimeError(f"factory is missing action {config['source']}")
        actions[clip_name] = bake_clip(
            source_scene,
            target_scene,
            source,
            target,
            root,
            meshes,
            source_action,
            source_action_reference_rotations(source_scene, source, source_action),
            target_reference,
            config["damping"],
            f"Duskfell|LocomotionV2|{clip_name}",
            procedural_arm_swing=clip_name == "walk",
        )
        source_ranges[clip_name] = [int(source_action.frame_range[0]), int(source_action.frame_range[1])]

    setup_render(target_scene)
    selected = {
        name: sample_action_frames(actions[name], 1 if args.preview else config["render_frames"])
        for name, config in CLIPS.items()
    }
    sheet = output / f"{safe_name(args.name)}-8x{sum(len(v) for v in selected.values())}.png"
    render_sheet(target_scene, root, target, meshes, actions, selected, frame_dir, sheet)

    root.rotation_euler[2] = 0
    target.animation_data.action = actions["idle"]
    target_scene.frame_set(1)
    blend = ROOT / "var" / "blender" / f"{safe_name(args.name)}.blend"
    blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.window.scene = target_scene
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), check_existing=False)

    idle_count = len(selected["idle"])
    walk_count = len(selected["walk"])
    metadata = {
        "schemaVersion": "duskfell-blender-locomotion-v2",
        "approvalState": "review",
        "method": (
            "CC0 Quaternius action-neutral quaternion motion retarget onto the "
            "Duskfell wretch rig with bounded gait and arm correction"
        ),
        "source": {
            "factory": str(factory.relative_to(ROOT)),
            "factorySha256": sha256(factory),
            "author": "Quaternius",
            "license": "CC0",
            "actions": {name: CLIPS[name]["source"] for name in CLIPS},
            "actionFrameRanges": source_ranges,
        },
        "blend": str(blend.relative_to(ROOT)),
        "sheet": str(sheet.relative_to(ROOT)),
        "sheetSha256": sha256(sheet),
        "fps": FPS,
        "cell": {"width": CELL_WIDTH, "height": CELL_HEIGHT},
        "anchor": {"x": ANCHOR[0], "y": ANCHOR[1], "kind": "footprint"},
        "directions": [name for name, _ in DIRECTIONS],
        "rootYawDegrees": [yaw for _, yaw in DIRECTIONS],
        "idleFrames": idle_count,
        "walkFrames": walk_count,
        "columns": idle_count + walk_count,
        "sampledActionFrames": selected,
        "hiddenMeshes": hidden_meshes,
        "runtimeInference": False,
    }
    metadata_path = output / f"{safe_name(args.name)}.json"
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"DUSKFELL_LOCOMOTION_SHEET={sheet}")
    print(f"DUSKFELL_LOCOMOTION_METADATA={metadata_path}")
    print(f"DUSKFELL_LOCOMOTION_BLEND={blend}")


def require_scene(name: str):
    scene = bpy.data.scenes.get(name)
    if scene is None:
        raise RuntimeError(f"factory is missing scene {name}")
    return scene


def require_object(name: str, object_type: str | None = None):
    obj = bpy.data.objects.get(name)
    if obj is None or (object_type and obj.type != object_type):
        raise RuntimeError(f"factory is missing {object_type or 'object'} {name}")
    return obj


def is_descendant(obj, ancestor) -> bool:
    current = obj
    while current is not None:
        if current == ancestor:
            return True
        current = current.parent
    return False


def isolate_character(scene, armature, root) -> tuple[list[object], list[str]]:
    meshes = []
    hidden = []
    for obj in scene.objects:
        uses_rig = any(
            modifier.type == "ARMATURE" and modifier.object == armature
            for modifier in getattr(obj, "modifiers", ())
        )
        belongs = uses_rig or is_descendant(obj, root)
        if obj.type == "MESH" and belongs:
            if "hair" in obj.name.lower():
                obj.hide_render = True
                hidden.append(obj.name)
            else:
                obj.hide_render = False
                meshes.append(obj)
        elif obj not in {armature, root}:
            obj.hide_render = True
    for obj in list(scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    return meshes, hidden


def clear_pose(armature) -> None:
    armature.animation_data_create()
    armature.animation_data.action = None
    for bone in armature.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
        bone.rotation_mode = "QUATERNION"


def normalize_character(scene, root, armature, meshes) -> None:
    bpy.context.window.scene = scene
    clear_pose(armature)
    scene.frame_set(0)
    root.rotation_mode = "XYZ"
    root.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(meshes)
    height = maximum.z - minimum.z
    if height <= 0:
        raise RuntimeError("target has no measurable height")
    scale = 2.15 / height
    root.scale = tuple(value * scale for value in root.scale)
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(meshes)
    center = (minimum + maximum) * 0.5
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= minimum.z
    bpy.context.view_layer.update()


def world_bounds(meshes) -> tuple[Vector, Vector]:
    minimum = Vector((1e9, 1e9, 1e9))
    maximum = Vector((-1e9, -1e9, -1e9))
    for obj in meshes:
        if obj.hide_render:
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], point[axis])
                maximum[axis] = max(maximum[axis], point[axis])
    return minimum, maximum


def source_action_reference_rotations(scene, armature, action) -> dict[str, Quaternion]:
    """Return one neutral world rotation per bone for an imported action.

    Imported clips include a large static correction from their authored rig
    space. Averaging the looping action removes that correction while retaining
    the actual motion around its center pose.
    """
    bpy.context.window.scene = scene
    armature.animation_data_create()
    armature.animation_data.action = action
    start = int(action.frame_range[0])
    end = int(action.frame_range[1])
    rotations = {source_name: [] for source_name, _ in MAPPING}
    for frame in range(start, end):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        for source_name in rotations:
            rotations[source_name].append(
                (armature.matrix_world @ armature.pose.bones[source_name].matrix).to_quaternion(),
            )
    return {name: average_quaternion(values) for name, values in rotations.items()}


def average_quaternion(values: list[Quaternion]) -> Quaternion:
    if not values:
        return Quaternion()
    reference = values[0]
    aligned = [
        value if value.dot(reference) >= 0 else Quaternion((-value.w, -value.x, -value.y, -value.z))
        for value in values
    ]
    return Quaternion(
        tuple(sum(value[index] for value in aligned) for index in range(4)),
    ).normalized()


def target_reference_rotations(scene, armature, root) -> dict[str, Quaternion]:
    bpy.context.window.scene = scene
    clear_pose(armature)
    root.rotation_euler = (0, 0, 0)
    scene.frame_set(0)
    bpy.context.view_layer.update()
    relaxed_arm_directions = {
        "upperarm01.L": Vector((0.25, -0.05, -0.967)).normalized(),
        "lowerarm01.L": Vector((0.10, -0.30, -0.949)).normalized(),
        "upperarm01.R": Vector((-0.25, -0.05, -0.967)).normalized(),
        "lowerarm01.R": Vector((-0.10, -0.30, -0.949)).normalized(),
    }
    references = {}
    for _, target_name in MAPPING:
        bone = armature.pose.bones.get(target_name)
        if bone is None:
            raise RuntimeError(f"target is missing mapped bone {target_name}")
        desired_direction = relaxed_arm_directions.get(target_name)
        if desired_direction is not None:
            current_world = (armature.matrix_world @ bone.matrix).to_quaternion()
            current_direction = current_world @ Vector((0, 1, 0))
            assign_world_rotation(
                armature,
                bone,
                current_direction.rotation_difference(desired_direction) @ current_world,
            )
            bpy.context.view_layer.update()
        references[target_name] = (armature.matrix_world @ bone.matrix).to_quaternion()
    return references


def assign_world_rotation(armature, bone, world_rotation: Quaternion) -> None:
    armature_rotation = armature.matrix_world.to_quaternion().inverted() @ world_rotation
    matrix = armature_rotation.to_matrix().to_4x4()
    matrix.translation = bone.matrix.translation
    bone.matrix = matrix


def source_frame_rotations(scene, armature, action, frame: int) -> dict[str, Quaternion]:
    bpy.context.window.scene = scene
    armature.animation_data.action = action
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    return {
        source_name: (armature.matrix_world @ armature.pose.bones[source_name].matrix).to_quaternion()
        for source_name, _ in MAPPING
    }


def bake_clip(
    source_scene,
    target_scene,
    source,
    target,
    root,
    meshes,
    source_action,
    source_reference,
    target_reference,
    damping,
    action_name,
    procedural_arm_swing: bool = False,
):
    action = bpy.data.actions.new(action_name)
    target.animation_data_create()
    target.animation_data.action = action
    start = int(source_action.frame_range[0])
    end = int(source_action.frame_range[1])
    root_base = root.location.copy()
    for output_frame, source_frame in enumerate(range(start, end + 1), start=1):
        rotations = source_frame_rotations(source_scene, source, source_action, source_frame)
        bpy.context.window.scene = target_scene
        target_scene.frame_set(output_frame)
        root.location = root_base
        root.rotation_euler = (0, 0, 0)
        clear_pose(target)
        target.animation_data.action = action
        for source_name, target_name in MAPPING:
            delta = rotations[source_name] @ source_reference[source_name].inverted()
            strength = damping.get(source_name, 1.0)
            if strength != 1.0:
                delta = Quaternion().slerp(delta, strength)
            assign_world_rotation(target, target.pose.bones[target_name], delta @ target_reference[target_name])
            bpy.context.view_layer.update()
        if procedural_arm_swing:
            progress = (source_frame - start) / max(1, end - start)
            apply_walk_arm_swing(target, progress)
        minimum, _ = world_bounds(meshes)
        root.location.z -= minimum.z
        bpy.context.view_layer.update()
        for _, target_name in MAPPING:
            bone = target.pose.bones[target_name]
            bone.keyframe_insert(data_path="rotation_quaternion", frame=output_frame, group=target_name)
            bone.keyframe_insert(data_path="location", frame=output_frame, group=target_name)
        root.keyframe_insert(data_path="location", frame=output_frame, group="grounded root")
    action_frame_count = end - start + 1
    action["duskfell_source_action"] = source_action.name
    action["duskfell_source_frame_start"] = start
    action["duskfell_source_frame_end"] = end
    action["duskfell_fps"] = FPS
    target_scene.frame_start = 1
    target_scene.frame_end = action_frame_count
    return action


def apply_walk_arm_swing(armature, progress: float) -> None:
    """Layer a compact opposing arm swing over the accepted mocap leg cycle.

    The embedded source clip was authored for a T-pose low-poly body; direct
    upper-arm deltas fold the MPFB target behind its torso. This bounded
    direction pass keeps hands readable without changing lower-body timing.
    """
    swing = math.sin(progress * math.tau) * 0.42
    directions = (
        ("upperarm01.L", Vector((0.16, -swing, -0.92)).normalized()),
        ("lowerarm01.L", Vector((0.07, -0.24 - swing * 0.34, -0.96)).normalized()),
        ("upperarm01.R", Vector((-0.16, swing, -0.92)).normalized()),
        ("lowerarm01.R", Vector((-0.07, -0.24 + swing * 0.34, -0.96)).normalized()),
    )
    for bone_name, desired_direction in directions:
        bone = armature.pose.bones[bone_name]
        current_world = (armature.matrix_world @ bone.matrix).to_quaternion()
        current_direction = current_world @ Vector((0, 1, 0))
        assign_world_rotation(
            armature,
            bone,
            current_direction.rotation_difference(desired_direction) @ current_world,
        )
        bpy.context.view_layer.update()


def sample_action_frames(action, count: int) -> list[int]:
    start = int(action.frame_range[0])
    end = int(action.frame_range[1])
    available = end - start + 1
    if count < 1 or count > available:
        raise ValueError(f"cannot sample {count} frames from {action.name} ({available} available)")
    # Looping source clips repeat the first pose at their last key. Excluding the
    # endpoint prevents a visible pause while preserving the authored cadence.
    span = max(1, available - 1)
    frames = [start + int(math.floor(index * span / count)) for index in range(count)]
    if len(set(frames)) != count:
        raise RuntimeError(f"sampling {action.name} produced duplicate frames: {frames}")
    return frames


def setup_render(scene) -> None:
    bpy.context.window.scene = scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_x = CELL_WIDTH * RENDER_SCALE
    scene.render.resolution_y = CELL_HEIGHT * RENDER_SCALE
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.world = bpy.data.worlds.new("Duskfell locomotion proof world")
    scene.world.color = (0.018, 0.020, 0.022)
    camera_data = bpy.data.cameras.new("Duskfell plan-oblique camera")
    camera = bpy.data.objects.new("Duskfell plan-oblique camera", camera_data)
    scene.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.63
    camera_data.shift_y = 0.02
    camera.location = (0, -7.0, 12.0)
    aim(camera, Vector((0, 0, 1.04)))
    scene.camera = camera
    add_light(scene, "Locomotion Key", (-3.5, -4.0, 7.0), 760, 4.0, (1.0, 0.83, 0.67))
    add_light(scene, "Locomotion Fill", (3.8, -2.0, 6.0), 320, 5.0, (0.50, 0.64, 0.80))
    add_light(scene, "Locomotion Rim", (0.5, 4.0, 6.5), 440, 3.0, (0.68, 0.75, 0.86))


def add_light(scene, name, location, energy, size, color) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = location
    aim(light, Vector((0, 0, 1.0)))


def aim(obj, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_sheet(scene, root, target, meshes, actions, selected, frame_dir: Path, sheet: Path) -> None:
    magick = shutil.which("magick")
    if not magick:
        raise RuntimeError("ImageMagick 'magick' is required")
    render_order = [(name, frame) for name in ("idle", "walk") for frame in selected[name]]
    for row, (direction, yaw) in enumerate(DIRECTIONS):
        root.rotation_euler[2] = math.radians(yaw)
        for column, (clip_name, frame) in enumerate(render_order):
            target.animation_data.action = actions[clip_name]
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            output = frame_dir / f"{row:02d}-{column:02d}-{direction}-{clip_name}.png"
            scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            subprocess.run(
                [
                    magick,
                    str(output),
                    "-filter",
                    "Lanczos",
                    "-resize",
                    f"{CELL_WIDTH}x{CELL_HEIGHT}!",
                    "-colors",
                    "224",
                    "PNG32:" + str(output),
                ],
                check=True,
            )
    frames = [str(path) for path in sorted(frame_dir.glob("*.png"))]
    expected = len(DIRECTIONS) * len(render_order)
    if len(frames) != expected:
        raise RuntimeError(f"expected {expected} frames, found {len(frames)}")
    subprocess.run(
        [
            magick,
            "montage",
            *frames,
            "-tile",
            f"{len(render_order)}x{len(DIRECTIONS)}",
            "-geometry",
            f"{CELL_WIDTH}x{CELL_HEIGHT}+0+0",
            "-background",
            "none",
            "PNG32:" + str(sheet),
        ],
        check=True,
    )


def safe_name(value: str) -> str:
    cleaned = "".join(c.lower() if c.isascii() and c.isalnum() else "-" for c in value)
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    if not cleaned:
        raise ValueError("name must contain an ASCII letter or number")
    return cleaned[:80]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    main()
