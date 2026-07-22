# Wretch Sprite Animation Pipeline

For generated motion beyond the original CC0 clip library, see
[`kimodo-animation-pipeline.md`](kimodo-animation-pipeline.md). Kimodo feeds this
same Blender/action/render/anchor path; it does not replace client playback or
server-authoritative movement.

How the player character goes from CC0 mocap to a smooth 8-direction sprite
sheet, and how the client plays it back without artifacts. This is the
definitive reference — every method here replaced an earlier one that failed,
and the failure catalog at the bottom explains why.

Shipped by commit `58ef7fc` (2026-07-11). Blend file: `var/blender/wretch-factory.blend`.

## Overview

```
Quaternius Rogue GLB (CC0 mocap, 31-bone rig, T-pose rest)
        │  sample world quaternions per clip frame   [mocap_source scene]
        ▼
/tmp/mocap-quats.json  { rest, walk14, idle, sway, pickup }
        │  DELTA-ROTATION RETARGET                   [Scene]
        ▼
uo_wretch.rig (MPFB2, A-pose rest) — action `wretch_gait_retarget`
   frames 1–14 walk · 30 idle · 40–47 sway · 50–57 pickup rummage
        │  render 8 yaws × 27 cells at 512², EEVEE   [sprite camera]
        ▼
/tmp/wsheet8/{direction}-{cell}.png
        │  assemble + anchor-solve per direction
        ▼
assets/sprites/duskfell-wretch.png  (27 cols × 8 rows, 128px cells)
        │  manifest frameGrid/directions/animation
        ▼
client playback (player-animation.js / player-render-state.js / player-sprite-draw.js)
```

## 1. Sampling the source mocap

Scene `mocap_source` holds `CharacterArmature` with the Quaternius actions
(`Walk` 30f, `Idle` 75f, `PickUp` 30f, `Run`, `Attacking_Idle`, ...).

Sample **world quaternions** — never directions — for the mapped bones:

```python
q = (src.matrix_world @ src.pose.bones[bn].matrix).to_quaternion()
```

- **Rest pose**: clear the action (`animation_data.action = None`) AND zero
  every pose bone (`pb.matrix_basis.identity()`) before sampling, or you
  record whatever pose the last playback left behind.
- Walk is sampled at 14 evenly spaced points: `[i*30/14 for i in range(14)]`.
- `_hips_z` is recorded per frame but ground contact is solved analytically
  later — don't try to transfer root motion.

Bone map (source → wretch), parents before children:

| source | wretch | | source | wretch |
|---|---|---|---|---|
| Abdomen | spine01 | | UpperLeg.L/R | upperleg01.L/R |
| Torso | spine03 | | LowerLeg.L/R | lowerleg01.L/R |
| Head | head | | Foot.L/R | foot.L/R |
| UpperArm.L/R | upperarm01.L/R | | LowerArm.L/R | lowerarm01.L/R |

## 2. Delta-rotation retargeting (THE method)

Per bone, per frame:

```
delta          = src_world_quat(frame) @ src_world_quat(rest)⁻¹   # world-space
desired_world  = delta @ TGT_REF[bone]
```

Assign by writing the pose-bone matrix (keeps translation, converts to local
automatically), **parents before children**, with `view_layer.update()`
between bones:

```python
desired_arm = (rig.matrix_world.to_quaternion().inverted() @ desired_world).to_matrix().to_4x4()
desired_arm.translation = pb.matrix.translation
pb.matrix = desired_arm
```

This transfers the **full rotation including roll and twist**. It is what
commercial retargeters (Rokoko, Auto-Rig Pro) do internally.

### Reference alignment — the step everyone forgets

`TGT_REF` is **not** the wretch's own rest pose. Quaternius rests in a
T-pose; the MPFB wretch rests in an A-pose. Raw rest-to-rest deltas leave a
constant arm offset (hands clasped at the chest — "T-rex arms").

Fix: first pose the wretch **into the source's rest body pose** using the
aim solver (its one remaining legitimate job — each bone's Y axis aimed at
`src_rest_quat @ (0,1,0)`), then capture those world quaternions as
`TGT_REF`. The wretch's actual rest pose becomes irrelevant because frames
are assigned as absolute matrices.

### Character shaping

Damp a bone by slerping its delta toward identity:

```python
delta = Quaternion().slerp(delta, DAMP[bone])
# shipped: spine01 0.8 · spine03 0.75 · head 0.5
```

This keeps the mocap's life but stands the wretch up from the source's deep
prowl. Amplification (`> 1` via lerp past the delta) works the same way if a
gait ever needs exaggerating — but prefer picking a better source clip.

### Ground snap

Direction/rotation transfer preserves wretch limb lengths, so bent-knee
frames float. After posing each frame, measure the lowest foot point and key
the root:

```python
mz = min world-z over foot.{L,R} × {head,tail}
root_pose_bone.location.z = (mz - ref_z) / 0.986   # ref_z = 0.0378 at wretch rest
```

`ref_z` must be measured at the **wretch's natural rest**, not the aligned
reference pose.

### Keying invariants

- **Zero `wretch_root` yaw before keying.** Keying while the root holds a
  leftover render yaw bakes that yaw into every pose — the walk leans and
  the legs scissor sideways ("mystery lean" bug, twice).
- Blender 5 slotted actions: fcurves live at
  `action.layers[*].strips[*].channelbag(action.slots[0]).fcurves`. Wipe
  before re-keying (all, or filter `keyframe_points` by frame range for a
  partial re-key).
- Keyed actions override live pose edits at render time — unassign the
  action (`rig.animation_data.action = None`) before posing anything
  manually (portrait poses etc.), restore after.

## 3. Rendering

- Sprite camera: ortho, `ortho_scale 2.63`, `shift_y 0.135`, the 35° game
  angle. These values give every pose ≥26px headroom at 512² — the previous
  2.35/0.11 framing cut heads off on north/west rows.
- 512² renders, `film_transparent`, EEVEE.
- Directions = **world-compass** yaws on `wretch_root`
  (character faces −Y at yaw 0):

  | south | east | north | west | SE | NE | NW | SW |
  |---|---|---|---|---|---|---|---|
  | −45° | 45° | 135° | −135° | 0° | 90° | 180° | −90° |

- Cell → action frame map (27 columns):
  `[30] + [1..14] + [50..57] + [40,42,44,46]`
  = idle · walk ×14 · rummage fidget ×8 · breathing ×4.
- Reset root yaw to 0 and save the blend after rendering.

## 4. Sheet assembly

- Scale: `0.2472 × (2.63/2.35)` (base calibration × camera-widen
  compensation) → subject ≈ same on-screen size at every framing change.
- **Per-direction anchor solve**: from each direction's idle render, place
  feet at y=116 and x-center at 64; apply that offset to all 27 cells of the
  row. Never reuse another row's offset — rotated bodies sit differently.
- Alpha threshold 28. Manifest gets `frameGrid {27×8, 216 frames}`,
  `directions[8]` at `startFrame = row*27`, and
  `animation { idleFrame: 0, walkFrames: [1..14], fidgetFrames: [15..22],
  idleFrames: [0,23,24,25,26,25,24,23] }` (breathing is a ping-pong).
- **Acceptance check every time**: idle-cell alpha bottom row per direction
  == manifest foot anchor y=116 (±2), and no cell may have alpha touching
  row 0 (head crop) — walk frames may legitimately touch row 127.

## 5. Client playback

`client/player-animation.js`, `client/player-render-state.js`,
`client/player-sprite-draw.js`, `client/sprite-assets/sheet.js`.

- **Walk phase accumulates incrementally** in motion state:
  `phase += dt × speed / PLAYER_WALK_FRAME_MS` (55ms shipped). Computing
  `total_elapsed × speed` instead rescales all accumulated phase whenever
  the measured speed wobbles and teleports the cycle several frames — this
  was the "jumbled/jittery frames" bug. The sampler accepts the accumulated
  `phaseFrames` and only falls back to elapsed-time math for tests.
- **8-way facing with hysteresis**: `directionFromWorldDelta` buckets the
  world heading into eight 45° sectors (+x = east, +y = south). Mid-walk, a
  new facing must persist `PLAYER_DIRECTION_COMMIT_MS` (90ms) before the
  row switches — tick noise at sector boundaries otherwise whips the sprite.
  The first step from standstill commits instantly (responsiveness).
- **Turn crossfade**: direction changes draw the previous facing fading out
  over `PLAYER_TURN_FADE_MS` (110ms).
- **Idle behavior**: breathing ping-pong (`idleFrames`, 340ms/frame,
  per-player stagger) runs whenever standing; the rummage fidget plays once
  per ~9.2s after 15s idle (`PLAYER_FIDGET_DELAY_MS`), staggered by player
  id so crowds don't sync.
- **4-direction sheets still work**: `selectDirection` falls back
  southeast→south, southwest→west, northeast→east, northwest→west's
  cardinal for sheets (paperdolls, placeholders) that lack diagonal rows.
- **Manifest animation passthrough**: `normalizeAnimation` must explicitly
  allow optional frame arrays (`fidgetFrames`, `idleFrames`). It silently
  stripped unknown keys once, and the fidget never played while all tests
  stayed green.

## Failure catalog (what NOT to do, learned the hard way)

| Symptom | Root cause | Fix |
|---|---|---|
| Limbs never quite right, knees/hips incoherent, tuning never converges | Direction-aim retargeting loses roll/twist | Delta-rotation retarget (§2) |
| Arms clasped at chest, "T-rex" | Rest-pose mismatch (T-pose source vs A-pose target) | Reference alignment (§2) |
| Walk leans sideways, legs scissor laterally | Keyed retarget while `wretch_root` held a render yaw | Zero root yaw before keying |
| Head-top cut off on north/west | Camera framing too tight for away-facing poses | ortho 2.63 / shift_y 0.135 + compensated assembly scale |
| Sprites float above shadows | Assembly offset calibrated against a stale sheet | Per-direction anchor solve + acceptance check (§4) |
| Animation frames "jumbled", jump mid-stride | Phase = total_elapsed × wobbling speed | Incremental phase accumulation (§5) |
| Sprite flickers between facings on diagonals | Sector flapping on tick noise | 90ms direction hysteresis (§5) |
| Fidget never plays, no errors anywhere | Manifest normalizer stripped unknown animation keys | Explicit optional-key passthrough |
| Legs churn like a cartoon | Cadence too fast for stride length | 55ms/frame; slow legs = slow cadence, but watch foot-skate |
| Head roll / "half-missing hair" (historical) | Shortest-arc head transfer leaves roll unconstrained | Delta method transfers head correctly; damp 0.5 |
| Hand-keyed walk cycles | Always worse than retargeted mocap | Don't. Retarget. |

## Rerunning the pipeline

1. Open `wretch-factory.blend` in Blender (MCP or GUI).
2. Sample: run the quaternion sampler against `mocap_source` (new clips:
   add to the `data` dict).
3. Retarget: run the delta retarget block (§2) — it wipes and re-keys
   `wretch_gait_retarget`.
4. Render 8 × 27 into `/tmp/wsheet8/` (§3), in two 4-direction batches.
5. Assemble + manifest + `npm run sprites:verify` (§4).
6. `npm run test:client`, restart `./target/debug/sundermere-server`.

## Locomotion V2 Structure Review

`scripts/blender-duskfell-locomotion.py` is the reproducible replacement for
the historical manual render instructions above. It uses the CC0 Quaternius
actions already embedded in `var/blender/wretch-factory.blend`, preserves the
full source actions at 30 fps inside a new Blender file, and samples only the
runtime review sheet. AI is not involved in pose, timing, direction, camera, or
registration.

```sh
npm run sprites:locomotion:structure
npm run sprites:locomotion:validate
```

The review contract is:

- `16` idle frames followed by `20` walk frames in every row;
- row order `south, southeast, east, northeast, north, northwest, west, southwest`;
- fixed root yaws `-45, 0, 45, 90, 135, 180, -135, -90`;
- `128x160` transparent cells and footprint anchor `(64,110)`;
- one relaxed minimally clothed body, with detachable hair hidden;
- no alpha touching a cell border and no disconnected meaningful components;
- measurable pose change and complete foot-spread motion in all eight rows;
- no walk frame shorter than `0.82x` its direction's idle body height;
- no walk silhouette wider than `0.78x` its idle body height.

Imported action rotations are measured around the averaged looping action pose,
not the source armature rest pose. This removes the large static rig-space
correction that previously produced crouched frames and impossible stride
silhouettes. Leg amplitudes and the compact opposing arm swing are deterministic
Blender corrections; the source action still owns cadence and contact order.

The current candidate passes those structural gates and remained registered to
the footprint through live direction changes in `valley-v2`. Browser review
measured roughly `93-120 fps` on high while moving and `120 fps` on low, with no
warnings or errors. This accepts the motion structure for controlled finishing,
not the raw render as final art or a default-manifest promotion. Img2img may
stylize accepted frames later, but must not alter their silhouette, limbs,
timing, direction rows, or anchor.
