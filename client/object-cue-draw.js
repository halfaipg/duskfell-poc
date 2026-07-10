import { drawEcologyLifecycleCues as drawEcologyLifecycleCueFamily } from "./ecology-lifecycle-cue-draw.js";
import {
  drawObjectResourceMeter as drawObjectResourceMeterCue,
  drawWorldItemIcon as drawWorldItemIconCue,
  resourceMeterColor,
} from "./object-resource-cue-draw.js";
import { drawTerrainDetailLifecycleCues as drawTerrainDetailLifecycleCueFamily } from "./terrain-detail-cue-draw.js";
import { VEGETATION_ONLY_ART_PASS } from "./object-render-policy.js";

export function createObjectCueDrawer({ getContext, getSprites }) {
  function drawEcologyLifecycleCues(object, point, scale) {
    if (VEGETATION_ONLY_ART_PASS) return;
    drawEcologyLifecycleCueFamily(getContext(), object, point, scale);
  }

  function drawObjectResourceMeter(object, point) {
    if (VEGETATION_ONLY_ART_PASS) return;
    drawObjectResourceMeterCue(getContext(), getSprites(), object, point);
  }

  function drawTerrainDetailLifecycleCues(detail, point, scale) {
    if (VEGETATION_ONLY_ART_PASS) return;
    drawTerrainDetailLifecycleCueFamily(getContext(), detail, point, scale);
  }

  function drawWorldItemIcon(itemId, x, y, scale) {
    if (VEGETATION_ONLY_ART_PASS) return;
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
