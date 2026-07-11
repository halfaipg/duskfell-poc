import { projectWorld } from "./projection.js";
import { terrainHeightAtWorld } from "./terrain.js";

const NPC_PARTY_RING_COLOR = "#aef5ef";
const NPC_COLOR = "#c9a227";

/// NPCs render through the same sprite/animation pipeline as players, so they
/// get walk cycles, shadows, footfalls, and position smoothing for free. The
/// adapter provides the player-shaped fields the pipeline expects.
export function toNpcAdapter(npc) {
  return {
    id: `npc:${npc.id}`,
    npcId: npc.id,
    name: npc.name,
    x: npc.x,
    y: npc.y,
    partyPlayerId: npc.partyPlayerId ?? null,
    color: NPC_COLOR,
    demoDeeds: [],
    resources: {},
    inventory: { capacitySlots: 1, items: [] },
    // NPCs draw their own nameplate; skip the near-range player name label.
    hideNameLabel: true,
  };
}

export function createNpcDrawer({
  getContext,
  getTerrain,
  getLocalPlayerId,
  getBubbleFor,
  playerDrawer,
  playerRenderState,
}) {
  function renderSortKey(adapter, origin) {
    return playerDrawer.renderSortKey(adapter, origin);
  }

  function drawNpc(adapter, origin, now) {
    const ctx = getContext();
    const terrain = getTerrain();
    const position = playerRenderState.renderPosition(adapter);
    const z = terrainHeightAtWorld(terrain, position.x, position.y);
    const point = projectWorld(position.x, position.y, z, origin);

    // Party ring under the local player's companion, beneath the sprite.
    if (adapter.partyPlayerId && adapter.partyPlayerId === getLocalPlayerId()) {
      ctx.save();
      ctx.strokeStyle = NPC_PARTY_RING_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y + 4, 21, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    playerDrawer.drawPlayer(adapter, origin, now, []);

    const inParty = Boolean(
      adapter.partyPlayerId && adapter.partyPlayerId === getLocalPlayerId(),
    );
    drawNameplate(ctx, point, adapter.name, inParty);

    const bubble = getBubbleFor?.(adapter.npcId);
    if (bubble) {
      drawSpeechBubble(ctx, point, bubble);
    }
  }

  return {
    drawNpc,
    renderSortKey,
  };
}

const NAMEPLATE_BOTTOM_OFFSET = -64;

/// Always-visible floating nameplate: dark pill, gold accent, diamond marker.
/// Party members swap the accent to the party color and gain a link glyph.
function drawNameplate(ctx, point, name, inParty) {
  const accent = inParty ? NPC_PARTY_RING_COLOR : "#c9a227";
  const label = inParty ? `${name} · party` : name;

  ctx.save();
  ctx.font = "700 13px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textWidth = ctx.measureText(label).width;
  const diamond = 7;
  const paddingX = 10;
  const width = textWidth + diamond + paddingX * 2 + 6;
  const height = 22;
  const left = point.x - width / 2;
  const bottom = point.y + NAMEPLATE_BOTTOM_OFFSET;
  const top = bottom - height;
  const middle = top + height / 2;

  roundedRect(ctx, left, top, width, height, 6);
  ctx.fillStyle = "rgba(17, 20, 23, 0.85)";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Diamond marker on the left edge of the pill.
  const diamondX = left + paddingX;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(diamondX, middle - diamond / 2);
  ctx.lineTo(diamondX + diamond / 2, middle);
  ctx.lineTo(diamondX, middle + diamond / 2);
  ctx.lineTo(diamondX - diamond / 2, middle);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#fff6dc";
  ctx.fillText(label, diamondX + diamond / 2 + 3 + textWidth / 2, middle);

  // Pointer stem down toward the head.
  ctx.fillStyle = "rgba(17, 20, 23, 0.85)";
  ctx.beginPath();
  ctx.moveTo(point.x - 4, bottom);
  ctx.lineTo(point.x, bottom + 5);
  ctx.lineTo(point.x + 4, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x, y + radius);
  ctx.closePath();
}

const BUBBLE_MAX_LINE_CHARS = 34;
const BUBBLE_MAX_LINES = 4;

function drawSpeechBubble(ctx, point, text) {
  const lines = wrapBubbleText(text, BUBBLE_MAX_LINE_CHARS, BUBBLE_MAX_LINES);
  ctx.save();
  ctx.font = "12px system-ui";
  ctx.textAlign = "center";
  const lineHeight = 15;
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const boxWidth = widest + 16;
  const boxHeight = lines.length * lineHeight + 12;
  // Sits above the nameplate.
  const top = point.y - 98 - boxHeight;

  ctx.fillStyle = "rgba(255, 253, 247, 0.94)";
  ctx.strokeStyle = "#3d4643";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(point.x - boxWidth / 2, top, boxWidth, boxHeight);
  ctx.fill();
  ctx.stroke();
  // Tail.
  ctx.beginPath();
  ctx.moveTo(point.x - 5, top + boxHeight);
  ctx.lineTo(point.x, top + boxHeight + 7);
  ctx.lineTo(point.x + 5, top + boxHeight);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#22282a";
  lines.forEach((line, index) => {
    ctx.fillText(line, point.x, top + 16 + index * lineHeight);
  });
  ctx.restore();
}

function wrapBubbleText(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate.length > maxChars ? candidate.slice(0, maxChars) : candidate;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
  }
  if (lines.length === maxLines && words.length > 0) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, maxChars - 1)}…`;
  }
  return lines.length > 0 ? lines : [""];
}
