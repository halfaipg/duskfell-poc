import {
  ALLOWED_RENDER_LAYERS,
  ALLOWED_RENDER_SORTS,
  ALLOWED_SHADOW_KINDS,
  assertManifestProjection,
  isObject,
  normalizeSha256,
  safeSpriteImagePath,
} from "./manifest.js";

export function selectSpriteSheet(manifest, sheetId, directionName) {
  assertManifestProjection(manifest);
  if (!Array.isArray(manifest.sheets)) {
    throw new Error("sprite manifest sheets must be an array");
  }

  const sheet = manifest.sheets.find((candidate) => candidate.id === sheetId);
  if (!sheet) {
    throw new Error(`sprite sheet ${sheetId} was not found`);
  }

  const imagePath = safeSpriteImagePath(sheet.image);
  const imageSha256 = normalizeSha256(sheet.imageSha256);
  const frameGrid = normalizeFrameGrid(sheet.frameGrid);
  const anchor = normalizeAnchor(sheet.anchor, frameGrid);
  const render = normalizeRender(sheet.render, frameGrid);
  const direction = selectDirection(sheet.directions, directionName, frameGrid);
  const animation = normalizeAnimation(sheet.animation, direction);

  return {
    imagePath,
    imageSha256,
    cellWidth: frameGrid.cellWidth,
    cellHeight: frameGrid.cellHeight,
    columns: frameGrid.columns,
    rows: frameGrid.rows,
    anchor,
    render,
    ...(animation ? { animation } : {}),
    startFrame: direction.startFrame,
    frameCount: direction.frameCount,
  };
}

function normalizeFrameGrid(frameGrid) {
  if (!isObject(frameGrid)) {
    throw new Error("sprite sheet frameGrid must be an object");
  }
  const { cellWidth, cellHeight, columns, rows, frameCount } = frameGrid;
  for (const [key, value] of Object.entries({ cellWidth, cellHeight, columns, rows, frameCount })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`sprite sheet frameGrid.${key} must be a positive integer`);
    }
  }
  if (cellWidth !== cellHeight) {
    throw new Error("sprite sheet frameGrid cells must be square");
  }
  if (frameCount > columns * rows) {
    throw new Error("sprite sheet frameGrid frameCount exceeds grid capacity");
  }
  return { cellWidth, cellHeight, columns, rows, frameCount };
}

function normalizeAnchor(anchor, frameGrid) {
  if (!isObject(anchor) || anchor.kind !== "foot") {
    throw new Error("sprite sheet anchor must be a foot anchor");
  }
  if (!Number.isInteger(anchor.x) || !Number.isInteger(anchor.y)) {
    throw new Error("sprite sheet anchor x/y must be integers");
  }
  if (anchor.x < 0 || anchor.y < 0 || anchor.x >= frameGrid.cellWidth || anchor.y >= frameGrid.cellHeight) {
    throw new Error("sprite sheet anchor must be inside the frame cell");
  }
  return { kind: "foot", x: anchor.x, y: anchor.y };
}

function normalizeRender(render, frameGrid) {
  if (!isObject(render)) {
    throw new Error("sprite sheet render metadata must be an object");
  }
  if (!ALLOWED_RENDER_LAYERS.has(render.layer)) {
    throw new Error("sprite sheet render layer is not supported by the client");
  }
  if (!ALLOWED_RENDER_SORTS.has(render.sort)) {
    throw new Error("sprite sheet render sort is not supported by the client");
  }
  if (!Number.isInteger(render.zBias) || Math.abs(render.zBias) > 1000) {
    throw new Error("sprite sheet render zBias must be an integer between -1000 and 1000");
  }
  return {
    layer: render.layer,
    sort: render.sort,
    zBias: render.zBias,
    ...(render.scale == null ? {} : { scale: normalizeRenderScale(render.scale) }),
    shadow: normalizeShadow(render.shadow, frameGrid),
  };
}

function normalizeRenderScale(value) {
  if (typeof value !== "number" || value < 0.25 || value > 2) {
    throw new Error("sprite sheet render scale must be a number in [0.25, 2]");
  }
  return value;
}

function normalizeShadow(shadow, frameGrid) {
  if (!isObject(shadow) || !ALLOWED_SHADOW_KINDS.has(shadow.kind)) {
    throw new Error("sprite sheet shadow kind is not supported by the client");
  }
  if (shadow.kind === "none") {
    return { kind: "none" };
  }

  const { x, y, width, height, opacity } = shadow;
  for (const [key, value] of Object.entries({ x, y, width, height })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`sprite sheet shadow.${key} must be a positive integer`);
    }
  }
  if (x >= frameGrid.cellWidth || y >= frameGrid.cellHeight) {
    throw new Error("sprite sheet shadow anchor must be inside the frame cell");
  }
  if (width > frameGrid.cellWidth || height > frameGrid.cellHeight) {
    throw new Error("sprite sheet shadow must fit inside the frame cell");
  }
  if (typeof opacity !== "number" || opacity < 0 || opacity > 1) {
    throw new Error("sprite sheet shadow opacity must be in [0, 1]");
  }
  return { kind: "ellipse", x, y, width, height, opacity };
}

const DIAGONAL_DIRECTION_FALLBACKS = {
  southeast: "south",
  southwest: "west",
  northeast: "east",
  northwest: "north",
};

function selectDirection(directions, directionName, frameGrid) {
  if (!Array.isArray(directions)) {
    throw new Error("sprite sheet directions must be an array");
  }
  let direction = directions.find((candidate) => candidate.name === directionName);
  if (!direction && DIAGONAL_DIRECTION_FALLBACKS[directionName]) {
    // 4-direction sheets (paperdolls, placeholders) render diagonals with
    // the nearest cardinal row instead of failing to load
    direction = directions.find(
      (candidate) => candidate.name === DIAGONAL_DIRECTION_FALLBACKS[directionName],
    );
  }
  if (!direction) {
    throw new Error(`sprite sheet direction ${directionName} was not found`);
  }
  if (!Number.isInteger(direction.startFrame) || direction.startFrame < 0) {
    throw new Error("sprite sheet direction startFrame must be a non-negative integer");
  }
  if (!Number.isInteger(direction.frameCount) || direction.frameCount <= 0) {
    throw new Error("sprite sheet direction frameCount must be a positive integer");
  }
  if (direction.startFrame + direction.frameCount > frameGrid.frameCount) {
    throw new Error("sprite sheet direction range exceeds frameGrid.frameCount");
  }
  return {
    name: direction.name,
    startFrame: direction.startFrame,
    frameCount: direction.frameCount,
  };
}

function normalizeAnimation(animation, direction) {
  if (animation == null) return null;
  if (!isObject(animation)) {
    throw new Error("sprite sheet animation must be an object");
  }
  const idleFrame = normalizeRelativeFrame(animation.idleFrame, direction.frameCount, "sprite sheet animation.idleFrame");
  const rawWalkFrames = animation.walkFrames;
  if (!Array.isArray(rawWalkFrames) || rawWalkFrames.length === 0 || rawWalkFrames.length > 32) {
    throw new Error("sprite sheet animation.walkFrames must be a non-empty bounded array");
  }
  const walkFrames = rawWalkFrames.map((frame, index) =>
    normalizeRelativeFrame(frame, direction.frameCount, `sprite sheet animation.walkFrames[${index}]`),
  );
  const optionalFrames = {};
  for (const key of ["fidgetFrames", "idleFrames"]) {
    const raw = animation[key];
    if (raw == null) continue;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) {
      throw new Error(`sprite sheet animation.${key} must be a non-empty bounded array`);
    }
    optionalFrames[key] = raw.map((frame, index) =>
      normalizeRelativeFrame(frame, direction.frameCount, `sprite sheet animation.${key}[${index}]`),
    );
  }
  return {
    idleFrame,
    walkFrames,
    ...optionalFrames,
  };
}

function normalizeRelativeFrame(value, frameCount, label) {
  if (!Number.isInteger(value) || value < 0 || value >= frameCount) {
    throw new Error(`${label} must be inside the selected direction frame range`);
  }
  return value;
}
