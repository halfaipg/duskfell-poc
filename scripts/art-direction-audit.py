#!/usr/bin/env python3
"""Report whether current art matches the Duskfell visual direction."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


STYLE_DOC = Path("docs/art-direction.md")
SPRITE_MANIFEST = Path("assets/sprites/manifest.json")
TERRAIN_MANIFEST = Path("assets/terrain/manifest.json")
TARGET_TERRAIN_MATERIALS = {
    "grass",
    "dirt",
    "stone",
    "rock",
    "water",
    "shore",
    "field",
    "cobble",
    "ruin",
}
MIN_TERRAIN_FAMILY_TILES = 8


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    report = {
        "styleBible": audit_style_doc(root),
        "projection": audit_projection(root),
        "terrainFamilies": audit_terrain_families(root),
        "characterPipeline": audit_character_pipeline(root),
        "approvalSafety": audit_approval_safety(root),
    }

    problems: list[str] = []
    warnings: list[str] = []
    for section in report.values():
        collect(section, problems, warnings)

    report["problems"] = problems
    report["warnings"] = warnings
    report["nextActions"] = next_actions(report)
    report["ok"] = len(problems) == 0 and len(warnings) == 0

    print(json.dumps(report, indent=2))
    if args.fail_on_warning and (problems or warnings):
        raise SystemExit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--fail-on-warning", action="store_true")
    return parser.parse_args()


def audit_style_doc(root: Path) -> dict[str, Any]:
    path = root / STYLE_DOC
    required_phrases = [
        "military-plan-oblique",
        "Composition Kit",
        "Paperdoll Characters",
        "Character Style Language",
        "stylized carved paperdoll miniature",
        "Approval Gates",
        "Decay Is A System",
    ]
    if not path.exists():
        return {
            "path": str(STYLE_DOC),
            "exists": False,
            "problems": [f"{STYLE_DOC} is missing"],
            "warnings": [],
        }
    text = path.read_text(encoding="utf-8")
    missing = [phrase for phrase in required_phrases if phrase not in text]
    return {
        "path": str(STYLE_DOC),
        "exists": True,
        "requiredPhrases": required_phrases,
        "problems": [],
        "warnings": [f"{STYLE_DOC} missing section phrase: {phrase}" for phrase in missing],
    }


def audit_projection(root: Path) -> dict[str, Any]:
    sprite_manifest = read_json(root / SPRITE_MANIFEST)
    terrain_manifest = read_json(root / TERRAIN_MANIFEST)
    expected = {
        "kind": "military-plan-oblique",
        "tileWidth": 64,
        "tileHeight": 64,
        "tileAspectRatio": 1,
        "axisAngleDegrees": 45,
        "heightAxis": "screen-y",
        "unitsPerTile": 64,
    }
    problems = []
    sprite_projection = sprite_manifest.get("projection", {})
    terrain_projection = terrain_manifest.get("projection", {})
    for name, projection in (("sprites", sprite_projection), ("terrain", terrain_projection)):
        for key, value in expected.items():
            if projection.get(key) != value:
                problems.append(f"{name} projection {key} is {projection.get(key)!r}, expected {value!r}")
    return {
        "expected": expected,
        "sprites": sprite_projection,
        "terrain": terrain_projection,
        "problems": problems,
        "warnings": [],
    }


def audit_terrain_families(root: Path) -> dict[str, Any]:
    manifest = read_json(root / TERRAIN_MANIFEST)
    tiles = [tile for tile in manifest.get("tiles", []) if isinstance(tile, dict)]
    by_material: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for tile in tiles:
        by_material[str(tile.get("material", "unknown"))].append(tile)

    entries = {}
    warnings = []
    for material, material_tiles in sorted(by_material.items()):
        kinds = sorted({str(tile.get("kind", "unknown")) for tile in material_tiles})
        entries[material] = {
            "tileCount": len(material_tiles),
            "kinds": kinds,
            "transitionCount": sum(1 for tile in material_tiles if "transition" in str(tile.get("kind", ""))),
            "hasFlatBase": any(tile.get("kind") == "flat-base" for tile in material_tiles),
            "hasSlope": any("slope" in str(tile.get("kind", "")) for tile in material_tiles),
        }
        if len(material_tiles) < MIN_TERRAIN_FAMILY_TILES:
            warnings.append(f"{material} terrain family has only {len(material_tiles)} tiles")
        if not entries[material]["hasFlatBase"]:
            warnings.append(f"{material} terrain family is missing a flat base")
        if entries[material]["transitionCount"] == 0:
            warnings.append(f"{material} terrain family is missing transitions")

    missing_targets = sorted(TARGET_TERRAIN_MATERIALS - set(by_material))
    for material in missing_targets:
        warnings.append(f"target terrain family missing: {material}")

    placeholder_tiles = [tile.get("id") for tile in tiles if "placeholder" in str(tile.get("id", ""))]
    if placeholder_tiles:
        warnings.append(f"{len(placeholder_tiles)} terrain tiles still use placeholder ids")

    return {
        "manifest": str(TERRAIN_MANIFEST),
        "tileCount": len(tiles),
        "materialCount": len(by_material),
        "targetMaterials": sorted(TARGET_TERRAIN_MATERIALS),
        "families": entries,
        "kindCounts": dict(sorted(Counter(str(tile.get("kind", "unknown")) for tile in tiles).items())),
        "placeholderTileCount": len(placeholder_tiles),
        "problems": [],
        "warnings": warnings,
    }


def audit_character_pipeline(root: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [sys.executable, "scripts/character-pipeline-audit.py"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return {
            "ok": False,
            "problems": ["character pipeline audit failed to run"],
            "warnings": [],
            "stderr": completed.stderr.strip(),
        }
    try:
        audit = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {
            "ok": False,
            "problems": ["character pipeline audit returned invalid JSON"],
            "warnings": [],
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
    return {
        "ok": audit.get("ok"),
        "defaultPlayerPaperdolls": audit.get("defaultPlayerPaperdolls"),
        "playerCardPortraits": audit.get("playerCardPortraits"),
        "body": audit.get("body"),
        "equipmentOverlays": audit.get("equipmentOverlays"),
        "nextActions": audit.get("nextActions", []),
        "problems": audit.get("problems", []),
        "warnings": audit.get("warnings", []),
    }


def audit_approval_safety(root: Path) -> dict[str, Any]:
    sprite_manifest = read_json(root / SPRITE_MANIFEST)
    terrain_manifest = read_json(root / TERRAIN_MANIFEST)
    warnings = []
    problems = []

    approved_sheets = [
        sheet.get("id")
        for sheet in sprite_manifest.get("sheets", [])
        if isinstance(sheet, dict) and sheet.get("approval", {}).get("state") == "approved"
    ]
    review_sheets = [
        sheet.get("id")
        for sheet in sprite_manifest.get("sheets", [])
        if isinstance(sheet, dict) and sheet.get("approval", {}).get("state") == "review"
    ]
    terrain_approval = terrain_manifest.get("approval", {}).get("state")

    character_warnings = audit_character_pipeline(root).get("warnings", [])
    if approved_sheets and character_warnings:
        problems.append("sprite sheets are approved while character pipeline warnings remain")
    if terrain_approval == "approved":
        terrain = audit_terrain_families(root)
        if terrain.get("warnings"):
            problems.append("terrain atlas is approved while terrain family warnings remain")

    if review_sheets:
        warnings.append(f"{len(review_sheets)} sprite sheets are still in review state")
    if terrain_approval != "approved":
        warnings.append(f"terrain atlas approval state is {terrain_approval!r}")

    return {
        "approvedSpriteSheets": approved_sheets,
        "reviewSpriteSheetCount": len(review_sheets),
        "terrainApprovalState": terrain_approval,
        "problems": problems,
        "warnings": warnings,
    }


def next_actions(report: dict[str, Any]) -> list[str]:
    actions = []
    character = report["characterPipeline"]
    terrain = report["terrainFamilies"]
    if character.get("warnings"):
        actions.append("replace or curate the base body sheet until the gait audit passes in all four rows")
    if terrain.get("placeholderTileCount", 0) > 0:
        actions.append("replace placeholder terrain ids with normalized Duskfell material-family atlas tiles")
    missing = [
        warning.removeprefix("target terrain family missing: ")
        for warning in terrain.get("warnings", [])
        if warning.startswith("target terrain family missing: ")
    ]
    if missing:
        actions.append(f"author missing terrain families: {', '.join(missing)}")
    if not actions:
        actions.append("promote the next reviewed art slice only after browser screenshot review")
    return actions


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def collect(section: dict[str, Any], problems: list[str], warnings: list[str]) -> None:
    problems.extend(section.get("problems", []))
    warnings.extend(section.get("warnings", []))


if __name__ == "__main__":
    main()
