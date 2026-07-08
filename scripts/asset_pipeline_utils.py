"""Shared helpers for deterministic asset normalization scripts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_hash(script_path: Path, *source_paths: Path) -> str:
    hasher = hashlib.sha256()
    hasher.update(script_path.read_bytes())
    for source_path in source_paths:
        if source_path.exists():
            hasher.update(source_path.read_bytes())
    return hasher.hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def write_json(path: Path, data: Any) -> None:
    path.write_text(f"{json.dumps(data, indent=2)}\n")
