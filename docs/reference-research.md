# Quarantined Reference Research

Checked July 6, 2026. This project must not copy code, data, assets, names, packet formats, maps, spawn tables, item tables, or formulas from UO emulator/client projects. These references are useful only for architecture questions and license risk.

## Repositories Reviewed

| Project | URL | License signal |
| --- | --- | --- |
| ModernUO | https://github.com/modernuo/ModernUO | GPL-3.0 on GitHub |
| ServUO | https://github.com/ServUO/ServUO | GPL-2.0 on GitHub |
| ClassicUO | https://github.com/ClassicUO/ClassicUO | BSD-2-Clause on GitHub |
| Moongate v2 | https://github.com/moongate-community/moongate | GPL-3.0 on GitHub |
| Moongate Next | https://github.com/moongate-community/moongate-next | Apache-2.0 on GitHub |
| OpenMMO | https://github.com/Julian-adv/OpenMMO | PolyForm Noncommercial 1.0.0; research only for Duskfell |

## Focused Audits

- [OpenMMO adoption audit](openmmo-research-audit.md) documents the July 22,
  2026 clean-room review of its world generation, terrain rendering, editor,
  housing, characters, networking, performance, and asset provenance.

## Safe Lessons To Convert Into Original Requirements

- Authoritative deterministic tick loop.
- Spatial partitioning for interest management.
- Durable event/journal persistence for replay and repair.
- Data-driven original content with schema validation before boot.
- Distinct account, actor, item, container, structure, region, and script concepts.
- Admin/API tooling with role gates and audit logs.
- Renderer/client separated from server authority.
- Settlement service separated from gameplay and private keys isolated from the sim.

## Explicitly Off Limits

- GPL implementation code unless the product intentionally becomes GPL-compatible.
- UO packet compatibility, packet constants, or serialized formats.
- Original maps, art, sounds, place names, spell names, skill tables, item templates, spawn data, and NPC behavior tables.
- "Nostalgic accuracy" as a feature goal.
- UO client compatibility as an engineering target.

## Impact On This PoC

The PoC should keep its original protocol, original content, and server-owned simulation. The next useful additions are not more UO-like content; they are production bones:

- deterministic replay tests, especially for server-authoritative inventory and economy events
- append-only event log beyond the current JSONL audit trail
- durable settlement job table
- admin inspect/reset endpoints
- spatial partition module
- grow the starter Field Forge recipe into broader original crafting/economy rules
- original nested container model
