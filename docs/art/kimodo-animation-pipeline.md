# Kimodo Animation Pipeline

Status: **integrated for offline authoring and review**. Kimodo inference is not
part of the game runtime. The checked adapter accepts Kimodo motion NPZ files,
retargets them onto a Duskfell Blender rig, saves the full 30 fps Blender action,
and renders an eight-direction sprite-sheet candidate.

## Why This Boundary

Kimodo generates skeletal motion, not a character model. Duskfell keeps those
responsibilities separate:

```text
original text/constraints
  -> Kimodo-SOMA-RP-v1.1 on an NVIDIA GPU authoring host
  -> checked SOMA NPZ motion
  -> Duskfell Blender retarget (wretch or Universal rig)
  -> full 30 fps Blender action
  -> camera-correct 8-direction review sheet
  -> gait/anchor/provenance/live-browser review
  -> approved runtime sprite sheet
```

This keeps model latency, downloads, credentials, and nondeterministic generation
outside the server-authoritative game loop. The server moves the player. The
accepted sprite action only supplies visual motion.

## Pinned Upstream

- Code: `nv-tlabs/kimodo` at
  `1aece8c124d73d255ceff5086d983b844c9f4e94`, Apache-2.0.
- Model: `Kimodo-SOMA-RP-v1.1`, NVIDIA Open Model License.
- Skeleton: public `somaskel77`; the model operates internally on `somaskel30`.
- Motion rate: 30 fps; model-card maximum is 300 frames/10 seconds.
- Generation defaults: 100 diffusion steps, seed 42, postprocessing enabled.
- Local authoring hardware: Linux/Windows with a supported NVIDIA GPU. Full GPU
  use needs about 17 GB VRAM; `TEXT_ENCODER_DEVICE=cpu` reduces model VRAM below
  3 GB at the cost of speed.

The model card explicitly lists game/media animation and commercial use. The
SMPL-X checkpoint is not the Duskfell default because it uses the more restrictive
NVIDIA R&D Model License. Re-review model terms before a public commercial release.

## Install On A GPU Authoring Host

Keep Kimodo outside the Duskfell repository:

```bash
git clone https://github.com/nv-tlabs/kimodo.git ~/src/nv-tlabs-kimodo
git -C ~/src/nv-tlabs-kimodo checkout 1aece8c124d73d255ceff5086d983b844c9f4e94
cd ~/src/nv-tlabs-kimodo
conda create -n kimodo python=3.10
conda activate kimodo
# Install a PyTorch build matching the host CUDA version first.
pip install -e .
```

Generate a Duskfell-authored motion. Keep prompts physical and explicit:

```bash
TEXT_ENCODER_DEVICE=cpu kimodo_gen \
  "A tired traveler walks forward with a guarded, uneven stride, carrying weight in the right hand." \
  --model Kimodo-SOMA-RP-v1.1 \
  --duration 4.0 \
  --diffusion_steps 100 \
  --seed 42 \
  --output output/duskfell-tired-walk \
  --bvh --bvh_standard_tpose
```

Do not use protected game animation captures as constraints or training inputs.

For the player locomotion replacement, use the checked batch rather than an
ad-hoc prompt:

```bash
# Preview the six deterministic commands on any machine.
python3 scripts/kimodo/generate_motion_batch.py

# Run on a CUDA authoring host with kimodo_gen installed.
python3 scripts/kimodo/generate_motion_batch.py --execute \
  --expected-cuda-uuid GPU-UUID-FOR-THE-AUTHORING-DEVICE
```

`motion-generation-plan.json` produces three seeds each for a planted neutral
breathing idle and a restrained upright run. It pins SOMA-RP-v1.1, 100 diffusion
steps, separated CFG weights, and normal Kimodo postprocessing. Every generated
NPZ is passed through the normal hostile-input validator and then an additional
promotion gate requiring the current 77-joint skeleton plus local rotations,
global rotations, root positions, joints, and foot contacts. A legacy SOMA30
fixture cannot pass this batch boundary.

### Gorgadon Authoring Host

`gorgadon@192.168.66.52` owns an isolated Kimodo environment at
`~/.venvs/duskfell-kimodo`. Its RTX 3090 is the permitted authoring device. The
RTX 5090 is the live LTX-2 media worker and must never receive Kimodo work.
CUDA's numeric ordering on this machine differs from `nvidia-smi`, so always
bind and verify the immutable 3090 UUID:

```bash
export CUDA_DEVICE_ORDER=PCI_BUS_ID
export CUDA_VISIBLE_DEVICES=GPU-477cc122-0e94-216c-b3c5-cf0ea1770809
export TEXT_ENCODER_DEVICE=cpu

~/.venvs/duskfell-kimodo/bin/python \
  ~/duskfell-authoring/duskfell-pipeline/scripts/kimodo/generate_motion_batch.py \
  --execute \
  --executable ~/.venvs/duskfell-kimodo/bin/kimodo_gen \
  --expected-cuda-uuid GPU-477cc122-0e94-216c-b3c5-cf0ea1770809
```

Kimodo's LLM2Vec prompt encoder transitively requires access to the gated
`meta-llama/Meta-Llama-3-8B-Instruct` repository. Authenticate with
`hf auth login` on the authoring host and accept that model's Hugging Face terms
before the first generation. Keep the token in Hugging Face's normal credential
store; never put it in this repository or a command transcript.

## Validate Before Blender

Copy only the generated NPZ to the Duskfell authoring machine, then run:

```bash
python3 scripts/kimodo/validate_motion.py /path/to/duskfell-tired-walk.npz \
  --receipt var/kimodo/duskfell-tired-walk-receipt.json
npm run test:kimodo
```

The validator uses `allow_pickle=False`, inspects ZIP entry counts and declared
uncompressed bytes before NumPy allocation, and rejects unsafe paths, unknown
arrays, oversized archives, missing arrays, unsupported dtypes, NaN/infinite
values, wrong frame/joint shapes, unknown skeleton sizes, and invalid rotation
matrices. Its receipt pins the source SHA-256, byte count, shape, duration,
skeleton, root range, and numerical rotation checks.

## Retarget And Render

The production authoring target is the current wretch/player factory:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b \
  --python scripts/kimodo/blender_retarget_render.py -- \
  /path/to/duskfell-tired-walk.npz \
  --target wretch \
  --name tired-traveler-walk
```

Use `--preview` for one pose in all eight facings or `--no-render` to create only
the Blender action. Use `--target universal` to retarget onto the downloaded
Quaternius CC0 Universal base character. Override paths with `--target-file` and
`--kimodo-repo`. Use `--samples 48` to inspect a long four-second performance at
roughly 12 visual frames per second; a trimmed locomotion loop normally needs
only 12-16 consecutive frames. Use `--start-frame N --end-frame M` to isolate a
1-based inclusive action interval before action creation and sprite rendering.
The wretch target hides its detached hair mesh by default because that mesh does
not reliably inherit retargeted head motion; `--keep-hair` exists only for rig
debugging. Use `--motion-style breathe` to derive a subtle, seamless breathing
idle from a validated source pose on the same rig and camera.

Outputs:

- `var/kimodo/NAME-TARGET.blend`: ignored authoring file containing the complete
  30 fps action.
- `assets/sprites/candidates/kimodo/NAME/*.png`: review sheet; never runtime by
  implication.
- `assets/sprites/candidates/kimodo/NAME/*.json`: provenance and retarget receipt.
- `assets/sprites/candidates/kimodo/NAME/frames/`: ignored disposable renders.

The adapter converts Kimodo `+X right/+Y up/+Z forward` coordinates to Blender
`+X right/+Z up/-Y forward`, removes horizontal root motion for sprite loops,
retains vertical hip motion in the authored Blender action, renders the existing
35-degree plan-oblique camera, and rotates that one action through all eight
world facings. Direction yaw is calibrated to the game's projected world axes:
world southeast points straight down-screen, east points down-right, and south
points down-left. This is deliberately offset 45 degrees from a conventional
front-facing sprite-sheet setup.

## Rotation Modes And Legacy Fixtures

Current 77-joint outputs contain the exact global and local rotations needed for
a production retarget. The intended world-space rest-delta calculation is:

```text
delta = frame_global_rotation * inverse(standard_tpose_global_rotation)
target_world = converted(delta) * aligned_target_reference
```

The upstream T-pose tensor is read without pickle, checked against the pinned
SHA-256 in `scripts/kimodo/config.json`, shape-checked, and numerically validated.
However, the current `global-rotations` target-rest basis is not visually
correct: it produces severe shoulder and arm distortion on otherwise valid
SOMA77 motion. Do not promote output from that mode until its target basis is
fixed and compared against the source-joint visualization.

`--retarget-mode position-directions` is an explicit SOMA77 review adapter. It
uses the generated joint directions, preserves readable gait and posture, and
is sufficient for judging prompts, cycle intervals, framing, and cadence. It
does not transfer axial bone twist, so its metadata says
`position-directions-soma77-review`; it is not the final production retarget.

NVIDIA's bundled demo fixtures are older 30-joint archives without the current
`local_rot_mats` and `root_positions` fields. They remain useful for plumbing
tests, but use the adapter's explicitly labeled
`position-directions-legacy-soma30` fallback. That path transfers limb direction
but not twist. Do not judge final shoulder, wrist, or foot quality from it.

## Current Proof

The checked proof uses NVIDIA's bundled `08_stylized_text` fixture (a slow,
uneven zombie walk) and the real `uo_wretch.rig`:

- full action: 121 frames at 30 fps in
  `var/kimodo/zombie-gait-official-fixture-wretch.blend`;
- review sheet:
  `assets/sprites/candidates/kimodo/zombie-gait-official-fixture/zombie-gait-official-fixture-wretch-8x48.png`;
- browser review:
  `/assets/demos/kimodo-animation-proof.html`.
- in-world review:
  `/game.html?world=valley-v2&npcs=1&kimodo=1` (or `kimodo=run`) uses the
  combined 16-frame breathing idle and 21-frame human run for the local player;
  `kimodo=zombie` preserves the 48-frame lurch review;
  `/game.html?world=valley-v2&npcs=1&kimodo=generated` uses the current generated
  SOMA77 idle and run described below. The normal runtime roster and manifest
  remain unchanged.

This proves intake, retarget, action keying, eight-direction rendering, and
browser playback. It is not an approved runtime walk: the checked browser proof
still uses a bundled legacy SOMA30 fixture, whose position-direction fallback
cannot preserve full body twist or posture nuance. Several wide arm poses also
exceed normal locomotion framing. Do not judge current Kimodo-SOMA quality from
that compatibility proof or promote it into the normal sprite manifest.

The in-world locomotion review uses NVIDIA's bundled `01_single_text_prompt`
motion, whose full prompt runs and then leaps. Duskfell isolates source frames
31-51: frame 52 closely matches frame 31 in root-relative pose, foot contacts,
and hip height, so replacing frame 52 with frame 31 produces a 21-frame,
0.7-second loop at the native 30 fps without entering the leap. A 16-frame
procedural breathing loop starts from source frame 1. Both are rendered from the
same bald wretch rig, scale, camera, anchor, and corrected direction yaws, then
assembled by `scripts/kimodo/assemble_character_sheet.py` into
`assets/sprites/candidates/kimodo/human-locomotion-clean/human-locomotion-clean-wretch-8x37.png`.
The breathing motion is a deterministic Duskfell authoring adjustment, not
Kimodo-generated motion, and its metadata labels that distinction. Breathing
mode restores the axial chain to the calibrated upright reference before adding
subtle chest expansion and weight shift, so locomotion anticipation cannot leak
into the standing pose. The runtime foot anchor is the camera-projected ground
point at `(64, 128)`, not the bottom padding of the 128x160 cell.
The human run uses `--upright-locomotion`, which blends only the spine, chest,
neck, and head toward the calibrated vertical reference while retaining the
Kimodo-authored arm swing, leg motion, cadence, and contacts.

### Generated SOMA77 Review

The first fully generated Duskfell review batch ran on the permitted RTX 3090
with `Kimodo-SOMA-RP-v1.1`, 100 diffusion steps, normal postprocessing, and the
pinned prompts in `scripts/kimodo/motion-generation-plan.json`. Three seeds were
generated for each motion. Numeric cycle review selected:

- neutral breathing idle seed 91, source frames 10-87, sampled to 16 frames for
  a 2.6-second loop;
- restrained upright run seed 17, source frames 21-40, preserved as a 20-frame
  loop at the native 30 fps (0.667 seconds).

Both clips are rendered through `position-directions-soma77-review` on the same
bald wretch rig, plan-oblique camera, `128x160` cells, eight facings, and foot
anchor. `scripts/kimodo/assemble_character_sheet.py` combines them into:

```text
assets/sprites/candidates/kimodo/generated-human-locomotion/
  generated-human-locomotion-wretch-8x36.png
  generated-human-locomotion-wretch.json
```

The browser review pins the assembled sheet SHA-256 and gives idle and run
separate authored frame timings. This prevents the 16-frame breathing loop from
playing at the run's 30 fps cadence. The focused client tests and live browser
prove selection, hash pinning, independent timing, loading, grounding, and
playback. Approval remains blocked on the exact rotation retarget, sprite gait
review, and final minimally clothed paperdoll rig.

## Promotion Gate

Before a Kimodo action becomes player art:

1. Generate with `Kimodo-SOMA-RP-v1.1` as a current 77-joint output.
2. Choose a loop interval at full 30 fps; do not assume the whole prompt clip
   loops cleanly.
3. Render 12-16 evenly timed locomotion frames per facing without head/limb crop.
4. Solve bottom-center foot anchors independently for every direction.
5. Render the same action on the minimally clothed body and every equipment
   layer from the same rig/camera/frame list.
6. Run `npm run sprites:gait`, `npm run sprites:pipeline`,
   `npm run test:sprites`, and `npm run assets:verify`.
7. Review facing, cadence, foot skate, silhouettes, and equipment registration
   in the live browser at game scale before changing the sprite manifest.

Kimodo can author attacks, gathering, casting, hit reactions, deaths, gestures,
and NPC mannerisms through the same boundary. Each accepted motion still needs a
named gameplay animation contract and its own loop/non-loop metadata.
