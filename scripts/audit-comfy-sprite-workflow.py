#!/usr/bin/env python3
"""Summarize a ComfyUI API-format sprite workflow for Duskfell intake."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


GENERATOR_CLASSES = {"GeminiImage2Node"}
OUTPUT_CLASSES = {"SaveImage", "SaveVideo"}
KNOWN_BUILT_INS = {
    "ColorToMask",
    "CreateVideo",
    "GetImageSize",
    "ImageBatchMulti",
    "ImageCompositeMasked",
    "ImageCrop",
    "ImageFromBatch",
    "ImagePadForOutpaintMasked",
    "InvertMask",
    "LoadImage",
    "PreviewImage",
    "RepeatImageBatch",
    "SaveImage",
    "SaveVideo",
}


def main() -> None:
    args = parse_args()
    workflow_path = args.workflow.expanduser().resolve()
    workflow = json.loads(workflow_path.read_text(encoding="utf-8"))
    if not isinstance(workflow, dict):
        raise SystemExit("workflow must be an API-format JSON object")

    nodes = [
        {"id": node_id, **node}
        for node_id, node in workflow.items()
        if isinstance(node, dict)
    ]
    class_counts = Counter(node.get("class_type", "<missing>") for node in nodes)
    generator_nodes = [summarize_generator(node) for node in nodes if node.get("class_type") in GENERATOR_CLASSES]
    output_nodes = [summarize_output(node) for node in nodes if node.get("class_type") in OUTPUT_CLASSES]

    custom_classes = sorted(
        class_name
        for class_name in class_counts
        if class_name not in KNOWN_BUILT_INS and class_name not in GENERATOR_CLASSES
    )

    report = {
        "workflow": str(workflow_path),
        "nodeCount": len(nodes),
        "classCounts": dict(class_counts.most_common()),
        "generatorNodes": generator_nodes,
        "outputNodes": output_nodes,
        "customOrPartnerClasses": custom_classes,
        "duskfellFit": assess_fit(generator_nodes, custom_classes),
    }
    print(json.dumps(report, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow", type=Path)
    return parser.parse_args()


def summarize_generator(node: dict[str, Any]) -> dict[str, Any]:
    inputs = node.get("inputs", {})
    prompt = str(inputs.get("prompt", ""))
    return {
        "id": node.get("id"),
        "title": node.get("_meta", {}).get("title"),
        "model": inputs.get("model"),
        "seed": inputs.get("seed"),
        "aspectRatio": inputs.get("aspect_ratio"),
        "resolution": inputs.get("resolution"),
        "promptSummary": summarize_prompt(prompt),
        "mentions": {
            "twoByTwo": "2x2" in prompt,
            "fourFrames": "4-frame" in prompt or "4 frames" in prompt,
            "rightFacing": "facing right" in prompt or "walking to the right" in prompt,
            "chromaGreen": "#00FF00" in prompt or "chromakey green" in prompt.lower(),
        },
    }


def summarize_prompt(prompt: str) -> str:
    first = prompt.strip().splitlines()[0] if prompt.strip() else ""
    return first[:160]


def summarize_output(node: dict[str, Any]) -> dict[str, Any]:
    inputs = node.get("inputs", {})
    return {
        "id": node.get("id"),
        "classType": node.get("class_type"),
        "prefix": inputs.get("filename_prefix"),
    }


def assess_fit(generator_nodes: list[dict[str, Any]], custom_classes: list[str]) -> dict[str, Any]:
    warnings = []
    if any(node["mentions"]["rightFacing"] for node in generator_nodes):
        warnings.append("source workflow is right-facing only; Duskfell needs four plan-oblique directions")
    if any(node["mentions"]["fourFrames"] for node in generator_nodes):
        warnings.append("source workflow uses 4-frame actions; Duskfell walk review target is 8 frames per direction")
    if any(node["mentions"]["chromaGreen"] for node in generator_nodes):
        warnings.append("source workflow outputs chroma-key frames; Duskfell runtime needs transparent PNGs with anchors")
    if custom_classes:
        warnings.append("workflow depends on custom or partner Comfy nodes that must be available in Cloud/Desktop")

    return {
        "recommendedUse": "prototype generator backend only",
        "notReadyAsRuntimePipeline": True,
        "requiredDuskfellPostProcess": [
            "adapt prompts to clean-room nude/base paperdoll body, not dressed final character",
            "generate or curate 4 direction rows for military-plan-oblique facing",
            "extract green key to alpha and remove fringe",
            "normalize into Duskfell 128px cells with bottom-center foot anchors",
            "run npm run sprites:gait and npm run sprites:pipeline before manifest approval",
        ],
        "warnings": warnings,
    }


if __name__ == "__main__":
    main()
