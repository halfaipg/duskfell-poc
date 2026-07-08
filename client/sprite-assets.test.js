import assert from "node:assert/strict";
import test from "node:test";

import { PAPERDOLL_LAYER_ORDER, selectPaperdollStack, selectSpriteSheet } from "./sprite-assets.js";

test("selects a normalized sprite sheet for runtime drawing", () => {
  const sheet = selectSpriteSheet(validManifest(), "player-placeholder", "south");

  assert.deepEqual(sheet, {
    imagePath: "player-placeholder.png",
    imageSha256: "9f33cc048f54aba6aa71ff1034820836dc3ae28e15016394bfb15a8b3799b556",
    cellWidth: 128,
    cellHeight: 128,
    columns: 3,
    rows: 1,
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
    animation: {
      idleFrame: 0,
      walkFrames: [1, 2, 1],
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
    columns: 5,
    rows: 1,
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

test("selects a manifest-backed item icon sheet for inventory UI", () => {
  const sheet = selectSpriteSheet(validManifest(), "duskfell-items", "neutral");

  assert.deepEqual(sheet, {
    imagePath: "duskfell-items.png",
    imageSha256: "961d9dbeb697138b85220547c5d6c80883ef7bad989a01b7076c704e3369d906",
    cellWidth: 64,
    cellHeight: 64,
    columns: 4,
    rows: 1,
    anchor: { kind: "foot", x: 32, y: 48 },
    render: {
      layer: "ui",
      sort: "fixed",
      zBias: 0,
      shadow: {
        kind: "none",
      },
    },
    startFrame: 0,
    frameCount: 4,
  });
});

test("selects a paperdoll body and ordered equipment overlay stack", () => {
  const stack = selectPaperdollStack(
    paperdollManifest(),
    {
      baseSheetId: "body-base",
      layers: [
        { slot: "weapon", sheetId: "spear-overlay" },
        { slot: "armor", sheetId: "iron-armor-overlay" },
        { slot: "cloak", sheetId: "wolf-cloak-overlay" },
      ],
    },
    "east",
  );

  assert.equal(stack.direction, "east");
  assert.equal(stack.baseSheetId, "body-base");
  assert.equal(stack.cellWidth, 192);
  assert.equal(stack.cellHeight, 192);
  assert.deepEqual(stack.anchor, { kind: "foot", x: 96, y: 174 });
  assert.deepEqual(
    stack.layers.map((layer) => layer.slot),
    ["cloak", "body", "armor", "weapon"],
  );
  assert.deepEqual(
    stack.layers.map((layer) => layer.sheetId),
    ["wolf-cloak-overlay", "body-base", "iron-armor-overlay", "spear-overlay"],
  );
  assert.ok(PAPERDOLL_LAYER_ORDER.indexOf("cloak") < PAPERDOLL_LAYER_ORDER.indexOf("body"));
  assert.ok(PAPERDOLL_LAYER_ORDER.indexOf("body") < PAPERDOLL_LAYER_ORDER.indexOf("armor"));
  assert.ok(stack.layers.every((layer) => layer.startFrame === 8 && layer.frameCount === 8));
});

test("rejects paperdoll overlays with mismatched anchors or frame geometry", () => {
  const anchorMismatch = paperdollManifest();
  anchorMismatch.sheets.find((sheet) => sheet.id === "iron-armor-overlay").anchor.y = 170;
  assert.throws(
    () =>
      selectPaperdollStack(
        anchorMismatch,
        { baseSheetId: "body-base", layers: [{ slot: "armor", sheetId: "iron-armor-overlay" }] },
        "east",
      ),
    /foot anchor/,
  );

  const gridMismatch = paperdollManifest();
  gridMismatch.sheets.find((sheet) => sheet.id === "wolf-cloak-overlay").frameGrid.cellWidth = 128;
  assert.throws(
    () =>
      selectPaperdollStack(
        gridMismatch,
        { baseSheetId: "body-base", layers: [{ slot: "cloak", sheetId: "wolf-cloak-overlay" }] },
        "east",
      ),
    /frameGrid|frame grid/,
  );
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

test("rejects malformed actor animation metadata", () => {
  const manifest = validManifest();
  manifest.sheets[0].animation.walkFrames = [1, 3];

  assert.throws(
    () => selectSpriteSheet(manifest, "player-placeholder", "south"),
    /animation\.walkFrames/,
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
        animation: {
          idleFrame: 0,
          walkFrames: [1, 2, 1],
        },
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
      {
        id: "duskfell-items",
        image: "duskfell-items.png",
        imageSha256: "961d9dbeb697138b85220547c5d6c80883ef7bad989a01b7076c704e3369d906",
        frameGrid: {
          cellWidth: 64,
          cellHeight: 64,
          columns: 4,
          rows: 1,
          frameCount: 4,
        },
        anchor: {
          kind: "foot",
          x: 32,
          y: 48,
        },
        render: {
          layer: "ui",
          sort: "fixed",
          zBias: 0,
          shadow: {
            kind: "none",
          },
        },
        directions: [
          {
            name: "neutral",
            startFrame: 0,
            frameCount: 4,
          },
        ],
      },
    ],
  };
}

function paperdollManifest() {
  const base = {
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
      paperdollSheet("body-base", "actor", "body-base.png"),
      paperdollSheet("iron-armor-overlay", "equipment", "iron-armor-overlay.png"),
      paperdollSheet("wolf-cloak-overlay", "equipment", "wolf-cloak-overlay.png"),
      paperdollSheet("spear-overlay", "equipment", "spear-overlay.png"),
    ],
  };
  return base;
}

function paperdollSheet(id, layer, image) {
  return {
    id,
    image,
    imageSha256: "a".repeat(64),
    frameGrid: {
      cellWidth: 192,
      cellHeight: 192,
      columns: 8,
      rows: 4,
      frameCount: 32,
    },
    anchor: {
      kind: "foot",
      x: 96,
      y: 174,
    },
    render: {
      layer,
      sort: "footprint-y",
      zBias: 0,
      shadow: layer === "actor" ? { kind: "ellipse", x: 96, y: 178, width: 54, height: 14, opacity: 0.28 } : { kind: "none" },
    },
    directions: [
      { name: "south", startFrame: 0, frameCount: 8 },
      { name: "east", startFrame: 8, frameCount: 8 },
      { name: "north", startFrame: 16, frameCount: 8 },
      { name: "west", startFrame: 24, frameCount: 8 },
    ],
    animation: {
      idleFrame: 0,
      walkFrames: [1, 2, 3, 4, 5, 6, 7, 6],
    },
  };
}
