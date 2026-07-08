import { drawEcologyLifecycleCues as drawEcologyLifecycleCueFamily } from "./ecology-lifecycle-cue-draw.js";
import {
  drawObjectResourceMeter as drawObjectResourceMeterCue,
  drawWorldItemIcon as drawWorldItemIconCue,
  resourceMeterColor,
} from "./object-resource-cue-draw.js";
import { drawTerrainDetailLifecycleCues as drawTerrainDetailLifecycleCueFamily } from "./terrain-detail-cue-draw.js";

export function createObjectCueDrawer({ getContext, getSprites }) {
  function drawEcologyLifecycleCues(object, point, scale) {
    drawEcologyLifecycleCueFamily(getContext(), object, point, scale);
  }

  function drawObjectResourceMeter(object, point) {
    drawObjectResourceMeterCue(getContext(), getSprites(), object, point);
  }

  function drawTerrainDetailLifecycleCues(detail, point, scale) {
    drawTerrainDetailLifecycleCueFamily(getContext(), detail, point, scale);
  }

  function drawWorldItemIcon(itemId, x, y, scale) {
    drawWorldItemIconCue(getContext(), getSprites(), itemId, x, y, scale);
  }

  return {
    drawEcologyLifecycleCues,
    drawObjectResourceMeter,
    drawTerrainDetailLifecycleCues,
    drawWorldItemIcon,
    resourceMeterColor,
  };
}
