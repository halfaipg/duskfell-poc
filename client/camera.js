import { defaultOrigin, projectedBounds, projectWorld } from "./projection.js";

export const CAMERA_VIEW = {
  targetWidth: 980,
  targetHeight: 620,
  maxScale: 1.08,
  marginX: 160,
  marginTop: 160,
  marginBottom: 220,
};

export function computeCamera({
  viewport,
  map,
  focus,
  origin = defaultOrigin(map),
  view = CAMERA_VIEW,
}) {
  validatePositiveDimension("viewport.width", viewport?.width);
  validatePositiveDimension("viewport.height", viewport?.height);
  validatePositiveDimension("view.targetWidth", view?.targetWidth);
  validatePositiveDimension("view.targetHeight", view?.targetHeight);

  const bounds = projectedBounds(map, origin);
  const focusScreen = focus
    ? projectWorld(focus.x, focus.y, 0, origin)
    : projectWorld(map.width / 2, map.height / 2, 0, origin);
  const scale = Math.min(
    viewport.width / view.targetWidth,
    viewport.height / view.targetHeight,
    view.maxScale,
  );
  const visibleWidth = viewport.width / scale;
  const visibleHeight = viewport.height / scale;

  return {
    scale,
    x: clamp(
      focusScreen.x - visibleWidth / 2,
      bounds.minX - view.marginX,
      bounds.maxX - visibleWidth + view.marginX,
    ),
    y: clamp(
      focusScreen.y - visibleHeight / 2,
      bounds.minY - view.marginTop,
      bounds.maxY - visibleHeight + view.marginBottom,
    ),
    origin,
    bounds,
    visibleWorld: {
      width: visibleWidth,
      height: visibleHeight,
    },
  };
}

function validatePositiveDimension(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function clamp(value, min, max) {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}
