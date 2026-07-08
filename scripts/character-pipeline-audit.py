#!/usr/bin/env python3
"""Audit the Duskfell paperdoll character asset pipeline."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


DEFAULT_MANIFEST = Path("assets/sprites/manifest.json")
DEFAULT_BODY_SHEET_ID = "duskfell-body-base"
DEFAULT_PORTRAIT_DIR = Path("assets/sprites/player-cards")


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    manifest_path = (root / args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    sheets = manifest.get("sheets", [])
    sheets_by_id = {sheet.get("id"): sheet for sheet in sheets if isinstance(sheet, dict)}
    paperdolls = [entry for entry in manifest.get("paperdolls", []) if isinstance(entry, dict)]
    player_paperdolls = [entry for entry in paperdolls if entry.get("role") == "player"]
    base_sheet = sheets_by_id.get(args.body_sheet_id)

    manifest_dir = manifest_path.parent
    report: dict[str, Any] = {
        "ok": True,
        "manifest": {
            "path": str(args.manifest),
            "sheetCount": len(sheets),
            "paperdollCount": len(paperdolls),
            "playerPaperdollCount": len(player_paperdolls),
        },
        "defaultPlayerPaperdolls": audit_default_paperdolls(player_paperdolls, args.body_sheet_id),
        "playerCardPortraits": audit_player_card_portraits(root, player_paperdolls, args.portrait_dir),
        "body": audit_body(root, manifest_dir, base_sheet, args.body_sheet_id),
        "equipmentOverlays": audit_equipment_overlays(sheets),
        "referencePipeline": {
            "chosenPrimary": "aldegad/sprite-gen component-row workflow",
            "why": [
                "locks one accepted body identity before generating action rows",
                "extracts transparent frames and writes runtime frame metadata",
                "supports curation before atlas bake, which is where our current gait fails",
            ],
            "supportingReferences": [
                "0x0funky/agent-sprite-forge for broader Codex sprite/map workflow glue",
                "Universal LPC as a paperdoll/layering architecture reference only",
                "SpriteBrew as UX/export benchmark only, not embedded code",
            ],
        },
    }

    problems: list[str] = []
    warnings: list[str] = []
    collect(report["defaultPlayerPaperdolls"], problems, warnings)
    collect(report["playerCardPortraits"], problems, warnings)
    collect(report["body"], problems, warnings)
    collect(report["equipmentOverlays"], problems, warnings)

    next_actions = []
    gait = report["body"].get("gait")
    if gait and not gait.get("ok"):
        next_actions.append(
            "replace or curate duskfell-body-base so every direction has a clear 8-frame stride",
        )
    if not report["defaultPlayerPaperdolls"].get("bodyOnly"):
        next_actions.append("remove default equipment layers from player paperdolls")
    if not report["playerCardPortraits"].get("complete"):
        next_actions.append("generate front-facing player-card portraits for every player paperdoll")
    if not next_actions:
        next_actions.append("start img2img/inpaint equipment overlays against the approved body grid")

    report["problems"] = problems
    report["warnings"] = warnings
    report["nextActions"] = next_actions
    report["ok"] = len(problems) == 0 and len(warnings) == 0

    print(json.dumps(report, indent=2))
    if args.fail_on_warning and (problems or warnings):
        raise SystemExit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--body-sheet-id", default=DEFAULT_BODY_SHEET_ID)
    parser.add_argument("--portrait-dir", type=Path, default=DEFAULT_PORTRAIT_DIR)
    parser.add_argument("--fail-on-warning", action="store_true")
    return parser.parse_args()


def audit_default_paperdolls(
    player_paperdolls: list[dict[str, Any]],
    body_sheet_id: str,
) -> dict[str, Any]:
    problems = []
    entries = []
    for entry in player_paperdolls:
        layers = entry.get("layers")
        layer_count = len(layers) if isinstance(layers, list) else None
        entries.append(
            {
                "id": entry.get("id"),
                "baseSheetId": entry.get("baseSheetId"),
                "layerCount": layer_count,
            },
        )
        if entry.get("baseSheetId") != body_sheet_id:
            problems.append(f"{entry.get('id')} does not use {body_sheet_id} as baseSheetId")
        if layer_count != 0:
            problems.append(f"{entry.get('id')} has {layer_count} default equipment layers")

    return {
        "bodyOnly": len(problems) == 0 and len(player_paperdolls) > 0,
        "entries": entries,
        "problems": problems,
        "warnings": [] if player_paperdolls else ["no player paperdolls found"],
    }


def audit_player_card_portraits(
    root: Path,
    player_paperdolls: list[dict[str, Any]],
    portrait_dir: Path,
) -> dict[str, Any]:
    absolute_dir = (root / portrait_dir).resolve()
    entries = []
    warnings = []
    for paperdoll in player_paperdolls:
        paperdoll_id = str(paperdoll.get("id", ""))
        expected_path = absolute_dir / f"{paperdoll_id}-front.png"
        exists = expected_path.exists()
        entries.append(
            {
                "paperdollId": paperdoll_id,
                "expectedImage": str(expected_path.relative_to(root)),
                "exists": exists,
            },
        )
        if not exists:
            warnings.append(f"{expected_path.relative_to(root)} missing")

    return {
        "complete": len(warnings) == 0 and len(player_paperdolls) > 0,
        "portraitDir": str(portrait_dir),
        "entries": entries,
        "problems": [],
        "warnings": warnings,
    }


def audit_body(
    root: Path,
    manifest_dir: Path,
    base_sheet: dict[str, Any] | None,
    body_sheet_id: str,
) -> dict[str, Any]:
    if not base_sheet:
        return {
            "sheetId": body_sheet_id,
            "exists": False,
            "problems": [f"{body_sheet_id} not found in sprite manifest"],
            "warnings": [],
        }

    image_path = manifest_dir / str(base_sheet.get("image", ""))
    report: dict[str, Any] = {
        "sheetId": body_sheet_id,
        "image": str(image_path.relative_to(root)) if image_path.is_relative_to(root) else str(image_path),
        "approvalState": base_sheet.get("approval", {}).get("state"),
        "renderScale": base_sheet.get("render", {}).get("scale"),
        "frameGrid": {
            "cellWidth": base_sheet.get("frameGrid", {}).get("cellWidth"),
            "cellHeight": base_sheet.get("frameGrid", {}).get("cellHeight"),
            "columns": base_sheet.get("frameGrid", {}).get("columns"),
            "rows": base_sheet.get("frameGrid", {}).get("rows"),
            "frameCount": base_sheet.get("frameGrid", {}).get("frameCount"),
        },
        "directions": [direction.get("name") for direction in base_sheet.get("directions", [])],
        "exists": image_path.exists(),
        "problems": [],
        "warnings": [],
    }

    if not image_path.exists():
        report["problems"].append(f"{image_path} does not exist")
        return report

    report["gait"] = run_gait_audit(root, image_path)
    if not report["gait"].get("ok"):
        report["warnings"].extend(report["gait"].get("warnings", []))

    if report["approvalState"] == "approved" and not report["gait"].get("ok"):
        report["problems"].append("body sheet is approved while gait audit is failing")

    return report


def audit_equipment_overlays(sheets: list[dict[str, Any]]) -> dict[str, Any]:
    equipment = [
        sheet
        for sheet in sheets
        if isinstance(sheet, dict) and sheet.get("render", {}).get("layer") == "equipment"
    ]
    slot_counts: Counter[str] = Counter()
    archetypes: defaultdict[str, list[str]] = defaultdict(list)
    for sheet in equipment:
        sheet_id = str(sheet.get("id", ""))
        parts = sheet_id.removeprefix("duskfell-").rsplit("-", 1)
        if len(parts) == 2:
            archetype, slot = parts
        else:
            archetype, slot = "unknown", "unknown"
        slot_counts[slot] += 1
        archetypes[archetype].append(slot)

    expected_slots = {"boots", "cloak", "jack", "trousers", "weapon"}
    warnings = []
    for archetype, slots in sorted(archetypes.items()):
        missing = sorted(expected_slots - set(slots))
        if missing:
            warnings.append(f"{archetype} missing overlay slots: {', '.join(missing)}")

    return {
        "available": len(equipment),
        "slots": dict(sorted(slot_counts.items())),
        "archetypes": {key: sorted(value) for key, value in sorted(archetypes.items())},
        "problems": [],
        "warnings": warnings,
    }


def run_gait_audit(root: Path, image_path: Path) -> dict[str, Any]:
    command = [
        sys.executable,
        "scripts/analyze-sprite-gait.py",
        "--image",
        str(image_path.relative_to(root)),
    ]
    completed = subprocess.run(command, cwd=root, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        return {
            "ok": False,
            "returnCode": completed.returncode,
            "warnings": ["gait analyzer failed to run"],
            "stderr": completed.stderr.strip(),
        }
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {
            "ok": False,
            "warnings": ["gait analyzer returned invalid JSON"],
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }


def collect(section: dict[str, Any], problems: list[str], warnings: list[str]) -> None:
    problems.extend(section.get("problems", []))
    warnings.extend(section.get("warnings", []))


if __name__ == "__main__":
    main()
