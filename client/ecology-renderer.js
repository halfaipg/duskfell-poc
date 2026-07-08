import { drawEcologyGroundEffect } from "./ecology-ground-effect-draw.js";
import { ecologyGroundEffects } from "./ecology-ground-effects.js";
import { drawEcologyEnergyLink, drawEcologyFeedLink } from "./ecology-link-draw.js";
import {
  coilMyceliumLinks,
  ecologyFeedLinks,
  ecologyObjectPressures,
  terrainDecayConsumerRules,
} from "./ecology-links.js";

export function createEcologyRenderer({ getContext, getTerrain }) {
  function drawEcologyGroundEffects(objects, origin, now) {
    const terrain = getTerrain();
    const decayConsumerRules = terrainDecayConsumerRules(terrain?.detailAuthority);
    const pressures = ecologyObjectPressures(objects, { decayConsumerRules });
    const effects = ecologyGroundEffects(objects, { pressures });
    if (effects.length === 0) return;

    const ctx = getContext();
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    for (const effect of effects) {
      drawEcologyGroundEffect(ctx, effect, origin, now, terrain);
    }
    ctx.restore();
  }

  function drawEcologyEnergyLinks(objects, origin, now) {
    const links = coilMyceliumLinks(objects);
    if (links.length === 0) return;

    const ctx = getContext();
    const terrain = getTerrain();
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const link of links) {
      drawEcologyEnergyLink(ctx, link, origin, now, terrain);
    }
    ctx.restore();
  }

  function drawEcologyFeedLinks(objects, origin, now) {
    const terrain = getTerrain();
    const links = ecologyFeedLinks(objects, undefined, {
      decayConsumerRules: terrainDecayConsumerRules(terrain?.detailAuthority),
    });
    if (links.length === 0) return;

    const ctx = getContext();
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const link of links) {
      drawEcologyFeedLink(ctx, link, origin, now, terrain);
    }
    ctx.restore();
  }

  return {
    drawEcologyGroundEffects,
    drawEcologyEnergyLinks,
    drawEcologyFeedLinks,
  };
}
