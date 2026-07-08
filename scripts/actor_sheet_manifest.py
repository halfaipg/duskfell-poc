"""Sprite manifest updates for generated actor sheets."""

from __future__ import annotations

from actor_sheet_config import MANIFEST_PATH
from asset_pipeline_utils import read_json, write_json


def update_actor_manifest(base_hash: str, source_hash: str, variant_hashes: dict[str, str]) -> None:
    manifest = read_json(MANIFEST_PATH)
    for sheet in manifest["sheets"]:
        if sheet["id"] == "duskfell-wayfarer":
            sheet["imageSha256"] = base_hash
            sheet["provenance"]["sourceHash"] = source_hash
            sheet["provenance"]["prompt"] = (
                "original clean-room military-plan-oblique dark fantasy adventurer with visible "
                "alternating boots, short split cloak, shield, spear, and four diagonal eight-frame walk cycles"
            )
        elif sheet["id"] in variant_hashes:
            sheet["imageSha256"] = variant_hashes[sheet["id"]]
            sheet["provenance"]["sourceHash"] = base_hash
            sheet["provenance"]["source"] = (
                "local silhouette and equipment variant derived from normalized eight-frame assets/sprites/duskfell-wayfarer.png"
            )
            sheet["provenance"]["prompt"] = role_prompt(sheet["id"])
    write_json(MANIFEST_PATH, manifest)


def role_prompt(sheet_id: str) -> str:
    prompts = {
        "duskfell-ranger": (
            "original clean-room military-plan-oblique dark fantasy ranger variant with green hood, "
            "quiver, longbow silhouette, lighter boots, and four diagonal eight-frame walk cycles"
        ),
        "duskfell-warden": (
            "original clean-room military-plan-oblique dark fantasy warden variant with heavier plate, "
            "large tower shield, helmet crest, bulkier shoulders, and four diagonal eight-frame walk cycles"
        ),
        "duskfell-brigand": (
            "original clean-room military-plan-oblique dark fantasy brigand variant with dark hood, "
            "red scarf, knife silhouette, ragged cloak, and four diagonal eight-frame walk cycles"
        ),
    }
    return prompts.get(sheet_id, "")
