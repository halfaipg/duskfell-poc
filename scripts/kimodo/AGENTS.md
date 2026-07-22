# Kimodo Animation Pipeline Instructions

This directory owns the offline Kimodo motion-generation boundary and Blender
retargeting adapters. It does not own gameplay movement or runtime inference.

## Rules

- Pin the upstream repository revision and model identity in `config.json`.
- Treat every NPZ as untrusted input: enforce byte, shape, dtype, finite-value,
  skeleton, frame-count, and rotation-matrix checks before Blender reads it.
- Kimodo runs offline on an NVIDIA GPU host. Never put model inference, model
  downloads, prompts, or credentials in the game server or browser client.
- On `gorgadon`, bind CUDA by the RTX 3090 UUID
  `GPU-477cc122-0e94-216c-b3c5-cf0ea1770809` and pass the same value to
  `--expected-cuda-uuid`. Numeric CUDA indices are forbidden because CUDA and
  `nvidia-smi` enumerate this host differently. The RTX 5090 is a live media
  worker and is outside this pipeline's ownership.
- Generated motions and Blender intermediates stay under ignored `var/kimodo/`.
- Rendered sheets stay review candidates until sprite gait, anchor, manifest,
  provenance, and live-browser checks approve them.
- Preserve the source motion at 30 fps. Downsample only for sprite-sheet frame
  selection; do not change the authored action timing.
- Keep horizontal root motion out of ordinary locomotion sprite loops. The
  authoritative game server moves actors; animation supplies the gait.
- Use original prompts and commercially usable models/assets. Do not generate
  motions from protected game animation captures.

## Verification

- `python3 -m unittest discover -s scripts/kimodo/tests -p 'test_*.py'`
- `python3 scripts/kimodo/validate_motion.py MOTION.npz`
- Run the Blender proof command documented in
  `docs/art/kimodo-animation-pipeline.md`.
- Run `npm run test:sprites`, `npm run sprites:pipeline`, and
  `npm run assets:verify` before promoting any rendered sheet.
