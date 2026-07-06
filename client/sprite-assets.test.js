import assert from "node:assert/strict";
import test from "node:test";

import { selectSpriteSheet } from "./sprite-assets.js";

test("selects a normalized sprite sheet for runtime drawing", () => {
  const sheet = selectSpriteSheet(validManifest(), "player-placeholder", "south");

  assert.deepEqual(sheet, {
    imagePath: "player-placeholder.png",
    imageSha256: "9f33cc048f54aba6aa71ff1034820836dc3ae28e15016394bfb15a8b3799b556",
    cellWidth: 128,
    cellHeight: 128,
    anchor: { kind: "foot", x: 64, y: 112 },
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
    startFrame: 0,
    frameCount: 3,
  });
});

test("selects a manifest-backed prop sheet for world objects", () => {
  const sheet = selectSpriteSheet(validManifest(), "props-placeholder", "neutral");

  assert.deepEqual(sheet, {
    imagePath: "props-placeholder.png",
    imageSha256: "e98cb00d374d276500cd5e578e1e910e0da6395ada6826f3134a0eb11a344af9",
    cellWidth: 128,
    cellHeight: 128,
    anchor: { kind: "foot", x: 64, y: 104 },
    render: {
      layer: "prop",
      sort: "footprint-y",
      zBias: -8,
      shadow: {
        kind: "ellipse",
        x: 64,
        y: 116,
        width: 58,
        height: 16,
        opacity: 0.24,
      },
    },
    startFrame: 0,
    frameCount: 5,
  });
});

test("rejects projection drift before selecting a sheet", () => {
  const manifest = validManifest();
  manifest.projection.tileHeight = 32;

  assert.throws(
    () => selectSpriteSheet(manifest, "player-placeholder", "south"),
    /projection does not match/,
  );
});

test("rejects unsafe image paths at runtime", () => {
  const manifest = validManifest();
  manifest.sheets[0].image = "../private/secret.png";

  assert.throws(
    () => selectSpriteSheet(manifest, "player-placeholder", "south"),
    /unsafe segment/,
  );
});

test("rejects missing or malformed sprite image hashes at runtime", () => {
  const manifest = validManifest();
  manifest.sheets[0].imageSha256 = "SHA256-not-normalized";

  assert.throws(
    () => selectSpriteSheet(manifest, "player-placeholder", "south"),
    /imageSha256/,
  );
});

test("rejects direction ranges that exceed the frame grid", () => {
  const manifest = validManifest();
  manifest.sheets[0].directions[0].startFrame = 2;
  manifest.sheets[0].directions[0].frameCount = 2;

  assert.throws(
    () => selectSpriteSheet(manifest, "player-placeholder", "south"),
    /direction range exceeds/,
  );
});

test("rejects unsupported render layers at runtime", () => {
  const manifest = validManifest();
  manifest.sheets[0].render.layer = "debug-overlay";

  assert.throws(
    () => selectSpriteSheet(manifest, "player-placeholder", "south"),
    /render layer is not supported/,
  );
});

function validManifest() {
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
    sheets: [
      {
        id: "player-placeholder",
        image: "player-placeholder.png",
        imageSha256: "9f33cc048f54aba6aa71ff1034820836dc3ae28e15016394bfb15a8b3799b556",
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
      },
      {
        id: "props-placeholder",
        image: "props-placeholder.png",
        imageSha256: "e98cb00d374d276500cd5e578e1e910e0da6395ada6826f3134a0eb11a344af9",
        frameGrid: {
          cellWidth: 128,
          cellHeight: 128,
          columns: 5,
          rows: 1,
          frameCount: 5,
        },
        anchor: {
          kind: "foot",
          x: 64,
          y: 104,
        },
        render: {
          layer: "prop",
          sort: "footprint-y",
          zBias: -8,
          shadow: {
            kind: "ellipse",
            x: 64,
            y: 116,
            width: 58,
            height: 16,
            opacity: 0.24,
          },
        },
        directions: [
          {
            name: "neutral",
            startFrame: 0,
            frameCount: 5,
          },
        ],
      },
    ],
  };
}
