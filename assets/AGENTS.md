# Assets Agent Instructions

Assets are runtime inputs, not loose decoration. Generated images stay as
candidates until provenance, manifests, verification, and in-browser review make
them acceptable.

## Read First

- Root `AGENTS.md`.
- `docs/art-direction.md`.
- `docs/art-pipeline.md`.
- `docs/rendering.md`.
- `docs/terrain-system.md` for terrain assets.
- `docs/security.md` for clean-room and runtime hash verification.

## Rules

- Keep source/candidate art separate from approved runtime assets.
- Maintain manifest SHA-256 pins and byte budgets when runtime assets change.
- Keep projection, anchors, footprints, and scale consistent with the camera
  contract.
- Do not commit copied copyrighted assets or img2img derivatives of protected
  game art.
- Label experimental or review-state assets honestly.
- Prefer composition kits over one-off pretty images.

## Tests

- Run `npm run assets:verify` after manifest or runtime asset changes.
- Run sprite or terrain test gates for the touched asset family.
