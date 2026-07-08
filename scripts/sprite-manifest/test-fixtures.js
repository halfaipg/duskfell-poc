import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function validSheet() {
  return {
    id: "hero-walk-placeholder",
    image: "hero.png",
    imageSha256: sha256Hex(makePngHeader(384, 128)),
    frameGrid: {
      cellWidth: 128,
      cellHeight: 128,
      columns: 3,
      rows: 1,
      frameCount: 3,
    },
    anchor: {
      kind: "foot",
      x: 64,
      y: 112,
    },
    footprint: {
      kind: "diamond",
      widthTiles: 1,
      heightTiles: 1,
    },
    render: {
      layer: "actor",
      sort: "footprint-y",
      zBias: 0,
      shadow: {
        kind: "ellipse",
        x: 64,
        y: 116,
        width: 42,
        height: 12,
        opacity: 0.3,
      },
    },
    directions: [
      {
        name: "south",
        startFrame: 0,
        frameCount: 3,
      },
    ],
    provenance: {
      cleanRoom: true,
      source: "temporary-test-fixture",
      createdAt: "2026-07-06",
      license: "test-only",
      reviewer: "test",
      prompt: "original clean-room plan-oblique adventurer",
      method: "hand-authored",
      tool: "test-fixture-writer",
      toolVersion: "1",
      sourceHash: "sha256:test-fixture",
      termsSnapshot: "test-only local fixture",
      toolReview: {
        status: "approved-internal",
        reviewedAt: "2026-07-06",
        reviewer: "test",
        sourceUrl: "https://example.invalid/test-fixture-writer",
        risk: "local deterministic test fixture only",
      },
    },
    approval: {
      state: "review",
    },
  };
}

export function validManifest(sheets, extra = {}) {
  return {
    schemaVersion: "sundermere-sprite-manifest-v1",
    projection: {
      kind: "military-plan-oblique",
      tileWidth: 64,
      tileHeight: 64,
      tileAspectRatio: 1,
      axisAngleDegrees: 45,
      heightAxis: "screen-y",
      unitsPerTile: 64,
    },
    sheets,
    ...extra,
  };
}

export async function makeTempDir() {
  return mkdir(path.join(os.tmpdir(), `sundermere-sprites-${Date.now()}-${Math.random()}`), {
    recursive: true,
  });
}

export function makePngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
