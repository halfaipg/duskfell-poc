"""Retarget a validated Kimodo SOMA motion and render a Duskfell sprite proof.

Run through Blender, not the system Python. Arguments follow Blender's `--`.
The script saves a retargeted blend under ignored `var/kimodo/` and a review
sheet under `assets/sprites/candidates/kimodo/`.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from validate_motion import validate_motion  # noqa: E402


DEFAULT_PACK = Path("/Users/j/Downloads/Universal Base Characters[Standard]")
DEFAULT_UNIVERSAL = DEFAULT_PACK / "Base Characters" / "Godot - UE" / "Superhero_Male_FullBody.gltf"
DEFAULT_WRETCH = ROOT / "var" / "blender" / "wretch-factory.blend"
DEFAULT_OUT = ROOT / "assets" / "sprites" / "candidates" / "kimodo"
DEFAULT_KIMODO_REPO = Path("/Users/j/src/aipg-all-repos/nv-tlabs-kimodo")
REST_ROTATION_RELATIVE_PATH = Path(
    "kimodo/assets/skeletons/somaskel77/standard_t_pose_global_offsets_rots.p"
)
REST_ROTATION_SHA256 = "464a8a95159d5e26ad24a702107aec86698935deeb034e02c9fe51e55472d75b"
FPS = 30
CELL_WIDTH = 128
CELL_HEIGHT = 160
RENDER_SCALE = 2
SAMPLE_COUNT = 12
DIRECTIONS = (
    ("south", -45),
    ("south-east", 0),
    ("east", 45),
    ("north-east", 90),
    ("north", 135),
    ("north-west", 180),
    ("west", -135),
    ("south-west", -90),
)
SOMA30_NAMES = (
    "Hips", "Spine1", "Spine2", "Chest", "Neck1", "Neck2", "Head", "Jaw",
    "LeftEye", "RightEye", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "LeftHandThumbEnd", "LeftHandMiddleEnd", "RightShoulder", "RightArm",
    "RightForeArm", "RightHand", "RightHandThumbEnd", "RightHandMiddleEnd", "LeftLeg",
    "LeftShin", "LeftFoot", "LeftToeBase", "RightLeg", "RightShin", "RightFoot",
    "RightToeBase",
)
SOMA77_NAMES = (
    "Hips", "Spine1", "Spine2", "Chest", "Neck1", "Neck2", "Head", "HeadEnd", "Jaw",
    "LeftEye", "RightEye", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "LeftHandThumb1", "LeftHandThumb2", "LeftHandThumb3", "LeftHandThumbEnd",
    "LeftHandIndex1", "LeftHandIndex2", "LeftHandIndex3", "LeftHandIndex4", "LeftHandIndexEnd",
    "LeftHandMiddle1", "LeftHandMiddle2", "LeftHandMiddle3", "LeftHandMiddle4", "LeftHandMiddleEnd",
    "LeftHandRing1", "LeftHandRing2", "LeftHandRing3", "LeftHandRing4", "LeftHandRingEnd",
    "LeftHandPinky1", "LeftHandPinky2", "LeftHandPinky3", "LeftHandPinky4", "LeftHandPinkyEnd",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand", "RightHandThumb1",
    "RightHandThumb2", "RightHandThumb3", "RightHandThumbEnd", "RightHandIndex1",
    "RightHandIndex2", "RightHandIndex3", "RightHandIndex4", "RightHandIndexEnd",
    "RightHandMiddle1", "RightHandMiddle2", "RightHandMiddle3", "RightHandMiddle4",
    "RightHandMiddleEnd", "RightHandRing1", "RightHandRing2", "RightHandRing3",
    "RightHandRing4", "RightHandRingEnd", "RightHandPinky1", "RightHandPinky2",
    "RightHandPinky3", "RightHandPinky4", "RightHandPinkyEnd", "LeftLeg", "LeftShin",
    "LeftFoot", "LeftToeBase", "LeftToeEnd", "RightLeg", "RightShin", "RightFoot",
    "RightToeBase", "RightToeEnd",
)

TARGET_MAPS = {
    "universal": (
        ("Spine1", "spine_01"), ("Spine2", "spine_02"), ("Chest", "spine_03"),
        ("Neck1", "neck_01"), ("Head", "Head"),
        ("LeftShoulder", "clavicle_l"), ("LeftArm", "upperarm_l"),
        ("LeftForeArm", "lowerarm_l"), ("LeftHand", "hand_l"),
        ("RightShoulder", "clavicle_r"), ("RightArm", "upperarm_r"),
        ("RightForeArm", "lowerarm_r"), ("RightHand", "hand_r"),
        ("LeftLeg", "thigh_l"), ("LeftShin", "calf_l"), ("LeftFoot", "foot_l"),
        ("RightLeg", "thigh_r"), ("RightShin", "calf_r"), ("RightFoot", "foot_r"),
    ),
    "wretch": (
        ("Spine1", "spine01"), ("Chest", "spine03"), ("Neck1", "neck01"),
        ("Head", "head"), ("LeftArm", "upperarm01.L"),
        ("LeftForeArm", "lowerarm01.L"), ("LeftHand", "wrist.L"),
        ("RightArm", "upperarm01.R"), ("RightForeArm", "lowerarm01.R"),
        ("RightHand", "wrist.R"), ("LeftLeg", "upperleg01.L"),
        ("LeftShin", "lowerleg01.L"), ("LeftFoot", "foot.L"),
        ("RightLeg", "upperleg01.R"), ("RightShin", "lowerleg01.R"),
        ("RightFoot", "foot.R"),
    ),
}

SOURCE_REST_DIRECTIONS = {
    "Spine1": Vector((0, 0, 1)), "Spine2": Vector((0, 0, 1)),
    "Chest": Vector((0, 0, 1)), "Neck1": Vector((0, 0, 1)),
    "Head": Vector((0, 0, 1)), "LeftShoulder": Vector((1, 0, 0)),
    "LeftArm": Vector((1, 0, 0)), "LeftForeArm": Vector((1, 0, 0)),
    "LeftHand": Vector((1, 0, 0)), "RightShoulder": Vector((-1, 0, 0)),
    "RightArm": Vector((-1, 0, 0)), "RightForeArm": Vector((-1, 0, 0)),
    "RightHand": Vector((-1, 0, 0)), "LeftLeg": Vector((0, 0, -1)),
    "LeftShin": Vector((0, 0, -1)), "LeftFoot": Vector((0, -1, 0)),
    "RightLeg": Vector((0, 0, -1)), "RightShin": Vector((0, 0, -1)),
    "RightFoot": Vector((0, -1, 0)),
}
SOURCE_DIRECTION_CHILDREN = {
    "Spine1": "Spine2", "Spine2": "Chest", "Chest": "Neck1", "Neck1": "Neck2",
    "Head": "Head", "LeftShoulder": "LeftArm", "LeftArm": "LeftForeArm",
    "LeftForeArm": "LeftHand", "LeftHand": "LeftHandMiddleEnd",
    "RightShoulder": "RightArm", "RightArm": "RightForeArm",
    "RightForeArm": "RightHand", "RightHand": "RightHandMiddleEnd",
    "LeftLeg": "LeftShin", "LeftShin": "LeftFoot", "LeftFoot": "LeftToeBase",
    "RightLeg": "RightShin", "RightShin": "RightFoot", "RightFoot": "RightToeBase",
}
COORDINATE_CONVERSION = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("motion", type=Path)
    parser.add_argument("--target", choices=sorted(TARGET_MAPS), default="wretch")
    parser.add_argument("--target-file", type=Path)
    parser.add_argument("--kimodo-repo", type=Path, default=DEFAULT_KIMODO_REPO)
    parser.add_argument("--name", default="kimodo-motion")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--start-frame", type=int, help="First source frame, 1-based inclusive")
    parser.add_argument("--end-frame", type=int, help="Last source frame, 1-based inclusive")
    parser.add_argument(
        "--motion-style",
        choices=("source", "breathe"),
        default="source",
        help="Render the source motion or derive a seamless breathing idle from its first pose",
    )
    parser.add_argument(
        "--breath-frames",
        type=int,
        default=60,
        help="Frames in a procedural breathing cycle (default: 60 at 30 fps)",
    )
    parser.add_argument(
        "--keep-hair",
        action="store_true",
        help="Keep detachable target hair meshes; hidden by default because they may not follow the retargeted head",
    )
    parser.add_argument(
        "--upright-locomotion",
        action="store_true",
        help="Blend the axial chain toward the calibrated upright reference while preserving limb motion",
    )
    parser.add_argument(
        "--retarget-mode",
        choices=("auto", "global-rotations", "position-directions"),
        default="auto",
        help="Override the checked retarget path for diagnosis or review",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=SAMPLE_COUNT,
        help="Evenly sampled review frames per direction (default: 12)",
    )
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--no-render", action="store_true")
    return parser.parse_args(values)


def main() -> None:
    args = parse_args()
    receipt = validate_motion(args.motion)
    motion = load_motion(
        args.motion,
        receipt["jointCount"],
        args.kimodo_repo,
        args.retarget_mode,
    )
    motion = trim_motion(motion, args.start_frame, args.end_frame)
    motion = prepare_motion_style(motion, args.motion_style, args.breath_frames)
    motion["uprightLocomotion"] = args.upright_locomotion
    output_dir = args.out_dir.resolve() / safe_name(args.name)
    frame_dir = output_dir / "frames"
    output_dir.mkdir(parents=True, exist_ok=True)
    frame_dir.mkdir(parents=True, exist_ok=True)
    clear_old_frames(frame_dir)

    root, armature, meshes, hidden_meshes = load_target(args)
    normalize_character(root, meshes)
    setup_render()
    reference = build_reference_pose(armature, TARGET_MAPS[args.target])
    action = build_action(root, armature, motion, reference, TARGET_MAPS[args.target], args.name)

    blend_path = ROOT / "var" / "kimodo" / f"{safe_name(args.name)}-{args.target}.blend"
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)

    sample_count = 1 if args.preview else args.samples
    sampled_frames = sample_frames(motion["frames"], sample_count)
    sheet_path = output_dir / f"{safe_name(args.name)}-{args.target}-8x{sample_count}.png"
    if not args.no_render:
        render_sheet(root, meshes, sampled_frames, frame_dir, sheet_path)
    metadata = {
        "schemaVersion": "duskfell-kimodo-retarget-proof-v1",
        "approvalState": "review",
        "motion": receipt,
        "target": args.target,
        "targetFile": str(resolve_target_file(args)),
        "action": action.name,
        "actionFrames": motion["frames"],
        "sourceFrameRange": motion["sourceFrameRange"],
        "fps": FPS,
        "sampledFrames": sampled_frames,
        "directions": [name for name, _ in DIRECTIONS],
        "rootYawDegrees": [angle for _, angle in DIRECTIONS],
        "cell": {"width": CELL_WIDTH, "height": CELL_HEIGHT},
        "coordinateConversion": "Kimodo +X right/+Y up/+Z forward to Blender +X right/+Z up/-Y forward",
        "retargetMode": motion["retargetMode"],
        "motionStyle": motion["motionStyle"],
        "uprightLocomotion": motion["uprightLocomotion"],
        "hiddenMeshes": hidden_meshes,
        "rootMotion": "horizontal trajectory removed; vertical hip motion retained in the authored action",
        "blend": str(blend_path.relative_to(ROOT)),
        "sheet": str(sheet_path.relative_to(ROOT)) if sheet_path.exists() else None,
        "sheetSha256": hashlib_file(sheet_path) if sheet_path.exists() else None,
    }
    metadata_path = output_dir / f"{safe_name(args.name)}-{args.target}.json"
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"DUSKFELL_KIMODO_BLEND={blend_path}")
    print(f"DUSKFELL_KIMODO_SHEET={sheet_path if sheet_path.exists() else 'not-rendered'}")
    print(f"DUSKFELL_KIMODO_METADATA={metadata_path}")


def safe_name(value: str) -> str:
    cleaned = "".join(
        character.lower() if character.isascii() and character.isalnum() else "-"
        for character in value
    )
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    if not cleaned:
        raise ValueError("name must include an ASCII letter or number")
    return cleaned[:80]


def resolve_target_file(args: argparse.Namespace) -> Path:
    if args.target_file:
        return args.target_file.resolve()
    return DEFAULT_WRETCH if args.target == "wretch" else DEFAULT_UNIVERSAL


def load_motion(
    path: Path,
    joint_count: int,
    kimodo_repo: Path,
    requested_retarget_mode: str = "auto",
) -> dict[str, object]:
    names = SOMA77_NAMES if joint_count == 77 else SOMA30_NAMES
    with np.load(path.resolve(), allow_pickle=False) as archive:
        rotations = archive["global_rot_mats"].astype(np.float64)
        posed_joints = archive["posed_joints"].astype(np.float64)
        positions = archive["root_positions"].astype(np.float64) if "root_positions" in archive else archive["posed_joints"][:, 0, :].astype(np.float64)
    standard_rest_77 = load_standard_rest_rotations(kimodo_repo)
    rest_indices = [SOMA77_NAMES.index(name) for name in names]
    default_retarget_mode = (
        "global-rotation-deltas" if joint_count == 77 else "position-directions-legacy-soma30"
    )
    if requested_retarget_mode == "global-rotations":
        if joint_count != 77:
            raise ValueError("global rotation retargeting requires a current SOMA77 motion")
        retarget_mode = "global-rotation-deltas"
    elif requested_retarget_mode == "position-directions":
        retarget_mode = "position-directions-soma77-review"
    else:
        retarget_mode = default_retarget_mode
    return {
        "frames": rotations.shape[0],
        "rotations": rotations,
        "posedJoints": posed_joints,
        "rootPositions": positions,
        "jointIndices": {name: index for index, name in enumerate(names)},
        "restRotations": standard_rest_77[rest_indices],
        "retargetMode": retarget_mode,
        "sourceFrameRange": [1, rotations.shape[0]],
    }


def trim_motion(motion: dict[str, object], start_frame: int | None, end_frame: int | None):
    total_frames = int(motion["frames"])
    start = 1 if start_frame is None else start_frame
    end = total_frames if end_frame is None else end_frame
    if start < 1 or end < start or end > total_frames:
        raise ValueError(
            f"source frame range must satisfy 1 <= start <= end <= {total_frames}, "
            f"got {start}..{end}"
        )
    first = start - 1
    trimmed = dict(motion)
    trimmed["frames"] = end - start + 1
    trimmed["rotations"] = motion["rotations"][first:end]
    trimmed["posedJoints"] = motion["posedJoints"][first:end]
    trimmed["rootPositions"] = motion["rootPositions"][first:end]
    trimmed["sourceFrameRange"] = [start, end]
    return trimmed


def prepare_motion_style(motion: dict[str, object], style: str, breath_frames: int):
    prepared = dict(motion)
    prepared["motionStyle"] = style
    if style == "source":
        return prepared
    if breath_frames < 24 or breath_frames > 300:
        raise ValueError(f"breath frame count must be within 24..300, got {breath_frames}")
    prepared["frames"] = breath_frames
    for key in ("rotations", "posedJoints", "rootPositions"):
        prepared[key] = np.repeat(motion[key][:1], breath_frames, axis=0)
    prepared["motionStyle"] = "kimodo-pose-procedural-breathe"
    return prepared


def load_standard_rest_rotations(kimodo_repo: Path) -> np.ndarray:
    """Read the pinned tensor's raw float storage without importing torch or pickle."""
    path = kimodo_repo.resolve() / REST_ROTATION_RELATIVE_PATH
    if not path.is_file():
        raise FileNotFoundError(
            f"Kimodo standard T-pose rotations not found at {path}; clone the pinned upstream repo"
        )
    digest = hashlib_file(path)
    if digest != REST_ROTATION_SHA256:
        raise RuntimeError(
            f"Kimodo rest-rotation asset hash mismatch: expected {REST_ROTATION_SHA256}, got {digest}"
        )
    with zipfile.ZipFile(path) as archive:
        storage_names = [name for name in archive.namelist() if name.endswith("/data/0")]
        if len(storage_names) != 1:
            raise RuntimeError(f"expected one tensor storage in {path}, found {len(storage_names)}")
        raw = archive.read(storage_names[0])
    expected_bytes = len(SOMA77_NAMES) * 3 * 3 * np.dtype("<f4").itemsize
    if len(raw) != expected_bytes:
        raise RuntimeError(f"unexpected rest-rotation storage size {len(raw)} != {expected_bytes}")
    rotations = np.frombuffer(raw, dtype="<f4").astype(np.float64).reshape(len(SOMA77_NAMES), 3, 3)
    identity = np.eye(3)
    error = float(np.max(np.abs(rotations @ np.swapaxes(rotations, -1, -2) - identity)))
    if not np.isfinite(rotations).all() or error > 0.002:
        raise RuntimeError(f"invalid standard rest rotations; orthogonality error {error}")
    return rotations


def hashlib_file(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_target(args: argparse.Namespace):
    target_file = resolve_target_file(args)
    if not target_file.is_file():
        raise FileNotFoundError(target_file)
    if args.target == "wretch":
        bpy.ops.wm.open_mainfile(filepath=str(target_file))
        scene = bpy.data.scenes.get("Scene")
        if scene is None:
            raise RuntimeError("wretch factory has no Scene")
        bpy.context.window.scene = scene
        armature = scene.objects.get("uo_wretch.rig")
        root = scene.objects.get("wretch_root")
        if armature is None or root is None:
            raise RuntimeError("wretch factory is missing uo_wretch.rig or wretch_root")
        keep = {root, armature}
        meshes = []
        hidden_meshes = []
        for obj in scene.objects:
            uses_rig = any(modifier.type == "ARMATURE" and modifier.object == armature for modifier in getattr(obj, "modifiers", ()))
            under_root = is_descendant(obj, root)
            if obj.type == "MESH" and (uses_rig or under_root):
                if not args.keep_hair and "hair" in obj.name.lower():
                    obj.hide_render = True
                    hidden_meshes.append(obj.name)
                    continue
                obj.hide_render = False
                keep.add(obj)
                meshes.append(obj)
            elif obj not in keep:
                obj.hide_render = True
        remove_cameras_and_lights(scene)
        return root, armature, meshes, hidden_meshes

    clear_scene()
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(target_file))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    armatures = [obj for obj in imported if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"expected one target armature, found {len(armatures)}")
    armature = armatures[0]
    root = armature
    while root.parent is not None and root.parent in imported:
        root = root.parent
    return root, armature, [obj for obj in imported if obj.type == "MESH"], []


def is_descendant(obj, ancestor) -> bool:
    current = obj
    while current is not None:
        if current == ancestor:
            return True
        current = current.parent
    return False


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def remove_cameras_and_lights(scene) -> None:
    for obj in list(scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)


def normalize_character(root, meshes) -> None:
    clear_animation(root, meshes)
    minimum, maximum = world_bounds(meshes)
    height = maximum.z - minimum.z
    if height <= 0:
        raise RuntimeError("target meshes have no measurable height")
    scale = 2.15 / height
    root.scale = tuple(value * scale for value in root.scale)
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(meshes)
    center = (minimum + maximum) * 0.5
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= minimum.z
    root.rotation_mode = "XYZ"
    bpy.context.view_layer.update()


def clear_animation(root, meshes) -> None:
    objects = {root}
    for mesh in meshes:
        current = mesh
        while current is not None:
            objects.add(current)
            current = current.parent
    for obj in objects:
        if obj.animation_data:
            obj.animation_data.action = None
    for obj in objects:
        if obj.type == "ARMATURE":
            for bone in obj.pose.bones:
                bone.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(0)
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


def build_reference_pose(armature, mapping) -> dict[str, Quaternion]:
    armature.animation_data_create()
    armature.animation_data.action = None
    for bone in armature.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
        bone.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()
    references = {}
    for source_name, target_name in mapping:
        pose_bone = armature.pose.bones.get(target_name)
        if pose_bone is None:
            raise RuntimeError(f"target rig is missing mapped bone {target_name}")
        current_world = (armature.matrix_world @ pose_bone.matrix).to_quaternion()
        current_direction = current_world @ Vector((0, 1, 0))
        desired_direction = SOURCE_REST_DIRECTIONS[source_name]
        aligned_world = current_direction.rotation_difference(desired_direction) @ current_world
        assign_world_rotation(armature, pose_bone, aligned_world)
        bpy.context.view_layer.update()
        references[target_name] = (armature.matrix_world @ pose_bone.matrix).to_quaternion()
    return references


def assign_world_rotation(armature, pose_bone, world_rotation: Quaternion) -> None:
    armature_rotation = armature.matrix_world.to_quaternion().inverted() @ world_rotation
    matrix = armature_rotation.to_matrix().to_4x4()
    matrix.translation = pose_bone.matrix.translation
    pose_bone.matrix = matrix


def converted_rotation(values: np.ndarray) -> Quaternion:
    source = Matrix(tuple(tuple(float(cell) for cell in row) for row in values))
    converted = COORDINATE_CONVERSION @ source @ COORDINATE_CONVERSION.transposed()
    return converted.to_quaternion()


def converted_direction(values: np.ndarray) -> Vector:
    source = Vector(tuple(float(value) for value in values))
    converted = COORDINATE_CONVERSION @ source
    if converted.length < 1e-7:
        raise RuntimeError("Kimodo motion contains a zero-length mapped bone")
    return converted.normalized()


def apply_motion_frame(armature, motion, reference, mapping, frame_index: int) -> None:
    rotations = motion["rotations"]
    rest_rotations = motion["restRotations"]
    posed_joints = motion["posedJoints"]
    indices = motion["jointIndices"]
    for source_name, target_name in mapping:
        pose_bone = armature.pose.bones[target_name]
        source_index = indices[source_name]
        if motion["retargetMode"] == "global-rotation-deltas":
            source_delta = rotations[frame_index, source_index] @ rest_rotations[source_index].T
            delta = converted_rotation(source_delta)
        else:
            child_name = SOURCE_DIRECTION_CHILDREN[source_name]
            direction_start = indices["Neck2"] if source_name == "Head" else source_index
            frame_direction = converted_direction(
                posed_joints[frame_index, indices[child_name]] - posed_joints[frame_index, direction_start]
            )
            delta = SOURCE_REST_DIRECTIONS[source_name].rotation_difference(frame_direction)
        assign_world_rotation(armature, pose_bone, delta @ reference[target_name])
        bpy.context.view_layer.update()


def build_action(root, armature, motion, reference, mapping, name: str):
    action = bpy.data.actions.new(f"Duskfell|Kimodo|{safe_name(name)}")
    armature.animation_data_create()
    armature.animation_data.action = action
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = motion["frames"]
    root_positions = motion["rootPositions"]
    vertical_center = float(np.median(root_positions[:, 1]))
    base_root_z = root.location.z
    for frame_index in range(motion["frames"]):
        frame = frame_index + 1
        scene.frame_set(frame)
        apply_motion_frame(armature, motion, reference, mapping, frame_index)
        if motion["motionStyle"] == "kimodo-pose-procedural-breathe":
            apply_breathing_pose(armature, reference, mapping, frame_index, motion["frames"])
        elif motion["uprightLocomotion"]:
            apply_upright_locomotion_pose(armature, reference, mapping)
        for _, target_name in mapping:
            pose_bone = armature.pose.bones[target_name]
            pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=target_name)
            pose_bone.keyframe_insert(data_path="location", frame=frame, group=target_name)
        breath_lift = 0.0
        if motion["motionStyle"] == "kimodo-pose-procedural-breathe":
            phase = frame_index / motion["frames"] * math.tau
            breath_lift = (0.5 - 0.5 * math.cos(phase)) * 0.008
        root.location.z = base_root_z + float(root_positions[frame_index, 1] - vertical_center) + breath_lift
        root.keyframe_insert(data_path="location", frame=frame, group="Kimodo root vertical")
    scene.frame_set(1)
    root.rotation_euler[2] = 0
    return action


def apply_breathing_pose(armature, reference, mapping, frame_index: int, frame_count: int) -> None:
    targets = dict(mapping)
    # A locomotion clip's first frame can still contain anticipation lean. Restore
    # the axial chain to the calibrated rig reference before layering idle motion.
    for source_name in ("Spine1", "Chest", "Neck1", "Head"):
        target_name = targets.get(source_name)
        pose_bone = armature.pose.bones.get(target_name) if target_name else None
        if pose_bone is None:
            continue
        assign_world_rotation(armature, pose_bone, reference[target_name])
        bpy.context.view_layer.update()
    phase = frame_index / frame_count * math.tau
    inhale = 0.5 - 0.5 * math.cos(phase)
    weight_shift = math.sin(phase)
    adjustments = (
        ("Chest", (1, 0, 0), math.radians(0.8) * inhale),
        ("Spine1", (0, 1, 0), math.radians(0.22) * weight_shift),
        ("Neck1", (1, 0, 0), math.radians(-0.42) * inhale),
        ("LeftArm", (0, 0, 1), math.radians(0.34) * inhale),
        ("RightArm", (0, 0, 1), math.radians(-0.34) * inhale),
    )
    for source_name, axis, angle in adjustments:
        target_name = targets.get(source_name)
        pose_bone = armature.pose.bones.get(target_name) if target_name else None
        if pose_bone is None:
            continue
        pose_bone.rotation_quaternion = pose_bone.rotation_quaternion @ Quaternion(axis, angle)
    bpy.context.view_layer.update()


def apply_upright_locomotion_pose(armature, reference, mapping) -> None:
    targets = dict(mapping)
    strengths = {
        "Spine1": 0.72,
        "Chest": 0.58,
        "Neck1": 0.66,
        "Head": 0.72,
    }
    for source_name, strength in strengths.items():
        target_name = targets.get(source_name)
        pose_bone = armature.pose.bones.get(target_name) if target_name else None
        if pose_bone is None:
            continue
        current_world = (armature.matrix_world @ pose_bone.matrix).to_quaternion()
        corrected_world = current_world.slerp(reference[target_name], strength)
        assign_world_rotation(armature, pose_bone, corrected_world)
        bpy.context.view_layer.update()


def setup_render() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_x = CELL_WIDTH * RENDER_SCALE
    scene.render.resolution_y = CELL_HEIGHT * RENDER_SCALE
    scene.render.resolution_percentage = 100
    look_items = scene.view_settings.bl_rna.properties["look"].enum_items
    available_looks = {item.identifier for item in look_items}
    for candidate in (
        "AgX - Medium High Contrast",
        "Medium High Contrast",
        "AgX - High Contrast",
        "High Contrast",
        "None",
    ):
        if candidate in available_looks:
            scene.view_settings.look = candidate
            break
    world = bpy.data.worlds.new("Duskfell Kimodo proof world")
    world.color = (0.02, 0.022, 0.024)
    scene.world = world
    camera_data = bpy.data.cameras.new("Duskfell Kimodo plan-oblique camera")
    camera = bpy.data.objects.new("Duskfell Kimodo plan-oblique camera", camera_data)
    scene.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.63
    camera_data.shift_y = 0.135
    camera.location = (0, -7.0, 12.0)
    aim(camera, Vector((0, 0, 1.04)))
    scene.camera = camera
    add_light(scene, "Kimodo Key", (-3.5, -4.0, 7.0), 760, 4.0, (1.0, 0.83, 0.67))
    add_light(scene, "Kimodo Fill", (3.8, -2.0, 6.0), 320, 5.0, (0.50, 0.64, 0.80))
    add_light(scene, "Kimodo Rim", (0.5, 4.0, 6.5), 440, 3.0, (0.68, 0.75, 0.86))


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


def sample_frames(frame_count: int, count: int) -> list[int]:
    if count < 1 or count > frame_count:
        raise ValueError(f"sample count must be within 1..{frame_count}, got {count}")
    frames = sorted({int(round(value)) + 1 for value in np.linspace(0, frame_count - 1, count)})
    if len(frames) != count:
        raise RuntimeError(f"expected {count} unique samples, got {len(frames)}")
    return frames


def clear_old_frames(frame_dir: Path) -> None:
    for path in frame_dir.glob("*.png"):
        path.unlink()


def render_sheet(root, meshes, sampled_frames, frame_dir: Path, sheet_path: Path) -> None:
    magick = shutil.which("magick")
    if not magick:
        raise RuntimeError("ImageMagick 'magick' is required to assemble the sprite proof")
    scene = bpy.context.scene
    for row, (direction, degrees) in enumerate(DIRECTIONS):
        root.rotation_euler[2] = math.radians(degrees)
        for column, frame in enumerate(sampled_frames):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            grounded_z = root.location.z
            minimum, _ = world_bounds(meshes)
            root.location.z -= minimum.z
            bpy.context.view_layer.update()
            output = frame_dir / f"{row:02d}-{column:02d}-{direction}.png"
            scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            subprocess.run(
                [magick, str(output), "-filter", "Lanczos", "-resize",
                 f"{CELL_WIDTH}x{CELL_HEIGHT}!", "-colors", "224", "PNG32:" + str(output)],
                check=True,
            )
            root.location.z = grounded_z
    frames = [str(path) for path in sorted(frame_dir.glob("*.png"))]
    expected = len(DIRECTIONS) * len(sampled_frames)
    if len(frames) != expected:
        raise RuntimeError(f"expected {expected} rendered frames, found {len(frames)}")
    subprocess.run(
        [magick, "montage", *frames, "-tile", f"{len(sampled_frames)}x{len(DIRECTIONS)}",
         "-geometry", f"{CELL_WIDTH}x{CELL_HEIGHT}+0+0", "-background", "none",
         "PNG32:" + str(sheet_path)],
        check=True,
    )
    root.rotation_euler[2] = 0
    scene.frame_set(1)


if __name__ == "__main__":
    main()
