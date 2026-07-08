# Client Agent Instructions

The client is a static browser renderer and input surface. It must never become
the authority for gameplay state.

## Read First

- Root `AGENTS.md`.
- `docs/rendering.md` for camera/projection rules.
- `docs/art-direction.md` for style, anchors, terrain, paperdoll, and decay.
- `docs/architecture.md` for client/server protocol shape.
- `docs/security.md` before changing session, WebSocket, admin, or asset-fetch
  behavior.

## Rules

- Send player intent, not trusted positions or rewards.
- Render server snapshots; do not invent authoritative resource, inventory,
  deed, crafting, decay, or ownership state in the browser.
- Keep the camera contract locked to `military-plan-oblique` with `64x64` square
  diamond ground cells unless the whole project contract changes.
- Keep actor anchors bottom-center and terrain footprints consistent.
- Verify visual changes in the running browser when they affect camera, layout,
  sprites, terrain, animation, occlusion, or interaction.
- Maintain runtime asset hash checks when touching image loading.
- Keep UI functional and compact. Do not add marketing/landing-page surfaces to
  the game client.

## Tests

- Run `npm run test:client` for client logic changes.
- Run focused tests when iterating, then the broader gate before finalizing.
- Use `npm run doctor:server` when the browser cannot reach the local server.
