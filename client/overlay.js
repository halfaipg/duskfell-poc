import { ecologyObjectPressures, terrainDecayConsumerRules } from "./ecology-links.js";
import { nearestEcologyAction } from "./nearby-ecology-action.js";
import { nearestInteractableObject } from "./object-render-policy.js";

export function drawOverlay({
  ctx,
  rect,
  snapshot,
  terrain,
  terrainDebugMode,
  localPlayerRenderPosition,
}) {
  const objects = Array.isArray(snapshot.objects) ? snapshot.objects : [];
  const decayConsumerRules = terrainDecayConsumerRules(terrain?.detailAuthority);
  const nearby = nearestInteractableObject(objects, localPlayerRenderPosition);
  const nearbyEcology = nearestEcologyAction(objects, localPlayerRenderPosition, {
    pressures: ecologyObjectPressures(objects, { decayConsumerRules }),
  });
  const nearbyPrompt = nearby
    ? { label: nearby.label, action: nearby.label, tone: "landmark" }
    : nearbyEcology;
  const overlayHeight = terrainDebugMode ? (nearbyPrompt ? 148 : 126) : nearbyPrompt ? 124 : 80;
  ctx.fillStyle = "rgba(17, 20, 23, 0.72)";
  ctx.fillRect(14, 14, 278, overlayHeight);
  ctx.fillStyle = "#fffdf7";
  ctx.font = "14px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(`Tick: ${snapshot.tick}`, 28, 40);
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  ctx.fillText(`Players: ${players.length}`, 28, 64);
  ctx.fillText("Server owns position and deed claims", 28, 86);
  if (nearbyPrompt) {
    ctx.fillStyle = promptToneColor(nearbyPrompt.tone);
    ctx.fillText(`Nearby: ${nearbyPrompt.label}`, 28, 110);
    if (!nearby && nearbyPrompt.action) {
      ctx.fillStyle = "#fff6dc";
      ctx.fillText(`Action: ${nearbyPrompt.action}`, 28, 132);
    }
  }
  if (terrainDebugMode) {
    ctx.fillStyle = "#f2d98b";
    ctx.fillText(`Terrain debug: ${terrainDebugMode}`, 28, nearbyPrompt ? 154 : 110);
  }

  if (rect.width < 760) {
    ctx.fillStyle = "rgba(17, 20, 23, 0.65)";
    ctx.fillRect(14, rect.height - 48, 286, 34);
    ctx.fillStyle = "#fffdf7";
    ctx.fillText(
      nearbyPrompt ? `Press E: ${nearbyPrompt.action}` : "Use keyboard controls on desktop.",
      28,
      rect.height - 26,
    );
  }
}

function promptToneColor(tone) {
  return {
    charge: "#aef5ef",
    decay: "#d8c18c",
    growth: "#bfe6a5",
    mineral: "#d7d1b8",
    resource: "#dce9cc",
    landmark: "#dce9cc",
  }[tone] ?? "#dce9cc";
}
