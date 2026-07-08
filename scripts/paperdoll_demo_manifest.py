"""Manifest assembly for review-only paperdoll demo sheets."""

from __future__ import annotations

from paperdoll_demo_config import (
    ANCHOR,
    ANIMATION,
    ASSET_DIR,
    BASE_RENDER,
    CELL,
    COLUMNS,
    DIRECTIONS,
    EQUIPMENT_RENDER,
    FOOTPRINT,
    FRAME_COUNT,
    MANIFEST_PATH,
    NEGATIVE_PROMPT,
    PROMPT,
    ROWS,
    VARIANTS,
)
from asset_pipeline_utils import read_json, sha256_file, write_json


def update_manifest(source_hash: str) -> None:
    manifest = read_json(MANIFEST_PATH)
    existing = {sheet["id"]: sheet for sheet in manifest["sheets"]}

    sheets = [paperdoll_sheet("duskfell-body-base", "actor", source_hash)]
    for variant_id in VARIANTS:
        sheets.extend(
            [
                paperdoll_sheet(f"duskfell-{variant_id}-trousers", "equipment", source_hash),
                paperdoll_sheet(f"duskfell-{variant_id}-boots", "equipment", source_hash),
                paperdoll_sheet(f"duskfell-{variant_id}-jack", "equipment", source_hash),
                paperdoll_sheet(f"duskfell-{variant_id}-cloak", "equipment", source_hash),
                paperdoll_sheet(f"duskfell-{variant_id}-weapon", "equipment", source_hash),
            ],
        )

    for sheet in sheets:
        existing[sheet["id"]] = sheet

    sheet_ids = {entry["id"] for entry in sheets}
    order = [sheet["id"] for sheet in manifest["sheets"] if sheet["id"] not in sheet_ids]
    order.extend(sheet["id"] for sheet in sheets)
    manifest["sheets"] = [existing[sheet_id] for sheet_id in order]
    manifest["paperdolls"] = [
        {
            "id": f"duskfell-paperdoll-{variant_id}",
            "role": "player",
            "label": palette["label"],
            "baseSheetId": "duskfell-body-base",
            "layers": [],
        }
        for variant_id, palette in VARIANTS.items()
    ]
    write_json(MANIFEST_PATH, manifest)


def paperdoll_sheet(sheet_id: str, layer: str, source_hash: str) -> dict[str, object]:
    image = f"{sheet_id}.png"
    return {
        "id": sheet_id,
        "image": image,
        "imageSha256": sha256_file(ASSET_DIR / image),
        "frameGrid": {
            "cellWidth": CELL,
            "cellHeight": CELL,
            "columns": COLUMNS,
            "rows": ROWS,
            "frameCount": FRAME_COUNT,
        },
        "anchor": ANCHOR,
        "footprint": FOOTPRINT,
        "render": BASE_RENDER if layer == "actor" else {**EQUIPMENT_RENDER, "layer": layer},
        "directions": DIRECTIONS,
        "animation": ANIMATION,
        "provenance": {
            "cleanRoom": True,
            "source": "assets/sprites/duskfell-paperdoll-body-source.png plus deterministic local equipment-overlay compositor",
            "createdAt": "2026-07-08",
            "license": "project-original-ai-assisted-review",
            "reviewer": "codex",
            "prompt": PROMPT,
            "negativePrompt": NEGATIVE_PROMPT,
            "method": "ai-generated" if layer == "actor" else "deterministic-local",
            "tool": "OpenAI built-in image generation and Pillow local sprite-layer normalization",
            "toolVersion": "built-in image generation 2026-07-08 plus Pillow local runtime",
            "sourceHash": source_hash,
            "termsSnapshot": "OpenAI service terms reviewed 2026-07-08 for internal PoC asset review",
            "model": "built-in image generation" if layer == "actor" else "Pillow deterministic compositor",
            "modelVersion": "2026-07-08" if layer == "actor" else "local deterministic",
            "seed": "unavailable-built-in-generation" if layer == "actor" else "deterministic-from-frame-bounds",
            "toolReview": {
                "status": "approved-internal",
                "reviewedAt": "2026-07-08",
                "reviewer": "codex",
                "sourceUrl": "https://openai.com/policies/service-terms",
                "risk": "internal review-only paperdoll prototype; row perspective is not final Duskfell quality and needs a replacement oblique body pass before production",
            },
        },
        "approval": {"state": "review"},
    }
