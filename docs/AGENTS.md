# Docs Agent Instructions

Docs are durable project state. They should be more reliable than chat history.

## Rules

- Keep docs blunt about implemented, experimental, review-state, stubbed, and
  planned work.
- Update docs when behavior, architecture, security posture, art contracts,
  deployment commands, or agent workflow change.
- Do not describe public/production readiness beyond what tests and runtime
  gates prove.
- Do not preserve stale praise when a blocker remains.
- Keep clean-room warnings visible near any external reference research.
- Link new durable rules from README or the nearest relevant doc index.

## Style

- Prefer concrete rules, file names, commands, and status over abstract mission
  language.
- Keep docs navigable. If a document grows too broad, split by subsystem and
  link both ways.
