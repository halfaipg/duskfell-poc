import { PROJECTION } from "../../client/projection.js";

import { isObject } from "./validation.js";

export function validateProjection(projection, errors) {
  if (!isObject(projection)) {
    errors.push("projection must be an object");
    return;
  }

  if (projection.kind !== PROJECTION.kind) {
    errors.push(`projection.kind must be ${PROJECTION.kind}`);
  }
  if (projection.tileWidth !== PROJECTION.tileW) {
    errors.push(`projection.tileWidth must match client projection (${PROJECTION.tileW})`);
  }
  if (projection.tileHeight !== PROJECTION.tileH) {
    errors.push(`projection.tileHeight must match client projection (${PROJECTION.tileH})`);
  }
  if (projection.tileWidth !== projection.tileHeight) {
    errors.push("projection tiles must be 1:1 diamonds, not 2:1 dimetric tiles");
  }
  if (projection.tileAspectRatio !== PROJECTION.tileAspectRatio) {
    errors.push(
      `projection.tileAspectRatio must match client projection (${PROJECTION.tileAspectRatio})`,
    );
  }
  if (projection.axisAngleDegrees !== PROJECTION.axisAngleDegrees) {
    errors.push(
      `projection.axisAngleDegrees must match client projection (${PROJECTION.axisAngleDegrees})`,
    );
  }
  if (projection.heightAxis !== PROJECTION.heightAxis) {
    errors.push(`projection.heightAxis must match client projection (${PROJECTION.heightAxis})`);
  }
  if (projection.unitsPerTile !== PROJECTION.unitsPerTile) {
    errors.push(
      `projection.unitsPerTile must match client projection (${PROJECTION.unitsPerTile})`,
    );
  }
}
