import {
  PLAYER_CLUSTER_DISTANCE,
  PLAYER_CLUSTER_RING_SIZE,
  PLAYER_CLUSTER_RING_STEP,
  PLAYER_CLUSTER_SMOOTHING_MS,
  PLAYER_CLUSTER_SPREAD_RADIUS,
  PLAYER_RENDER_MARGIN,
} from "./player-config.js";
import {
  PLAYER_MOVEMENT_EPSILON,
  PLAYER_WALK_STOP_GRACE_MS,
  directionFromWorldDelta,
  smoothPlayerRenderPosition,
} from "./player-animation.js";

export function createPlayerRenderState() {
  const motion = new Map();
  const visualPositions = new Map();
  const renderOffsets = new Map();
  const variantIndexes = new Map();
  let lastRenderUpdateTime = 0;
  let lastOffsetUpdateTime = 0;

  return {
    updateRenderOffsets(players, map, localPlayerId = null, now = 0) {
      const offsetTargets = new Map();
      variantIndexes.clear();

      [...players]
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .forEach((player, index) => variantIndexes.set(player.id, index));

      const clusters = playerProximityClusters(players);

      for (const cluster of clusters) {
        if (cluster.length < 2) continue;

        const spreadPlayers = cluster
          .filter((player) => player.id !== localPlayerId)
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (spreadPlayers.length === 0) continue;

        for (let index = 0; index < spreadPlayers.length; index += 1) {
          const player = spreadPlayers[index];
          const ring = Math.floor(index / PLAYER_CLUSTER_RING_SIZE);
          const ringIndex = index % PLAYER_CLUSTER_RING_SIZE;
          const remaining = spreadPlayers.length - ring * PLAYER_CLUSTER_RING_SIZE;
          const ringCount = Math.min(PLAYER_CLUSTER_RING_SIZE, remaining);
          const angle = -Math.PI / 2 + ((ringIndex + 0.5) / ringCount) * Math.PI * 2;
          const radius = PLAYER_CLUSTER_SPREAD_RADIUS + ring * PLAYER_CLUSTER_RING_STEP;
          const target = {
            x: player.x + Math.cos(angle) * radius,
            y: player.y + Math.sin(angle) * radius,
          };
          if (map) {
            target.x = clamp(target.x, PLAYER_RENDER_MARGIN, map.width - PLAYER_RENDER_MARGIN);
            target.y = clamp(target.y, PLAYER_RENDER_MARGIN, map.height - PLAYER_RENDER_MARGIN);
          }
          offsetTargets.set(player.id, {
            x: target.x - player.x,
            y: target.y - player.y,
          });
        }
      }

      // ease offsets toward their targets (or back to zero) so a bystander
      // never teleports when cluster membership flips as someone walks past
      const elapsedMs = Math.max(0, now - (lastOffsetUpdateTime || now));
      const alpha = 1 - Math.exp(-elapsedMs / PLAYER_CLUSTER_SMOOTHING_MS);
      const activeIds = new Set(players.map((player) => player.id));
      for (const id of renderOffsets.keys()) {
        if (!activeIds.has(id)) renderOffsets.delete(id);
      }
      for (const player of players) {
        const target = offsetTargets.get(player.id) ?? { x: 0, y: 0 };
        const current = renderOffsets.get(player.id) ?? { x: 0, y: 0 };
        const next = {
          x: current.x + (target.x - current.x) * alpha,
          y: current.y + (target.y - current.y) * alpha,
        };
        if (!offsetTargets.has(player.id) && Math.hypot(next.x, next.y) < 0.5) {
          renderOffsets.delete(player.id);
        } else {
          renderOffsets.set(player.id, next);
        }
      }
      lastOffsetUpdateTime = now;
    },

    updateVisualPositions(players, now) {
      const activeIds = new Set(players.map((player) => player.id));
      for (const id of visualPositions.keys()) {
        if (!activeIds.has(id)) {
          visualPositions.delete(id);
        }
      }

      const elapsedMs = Math.max(0, now - (lastRenderUpdateTime || now));
      for (const player of players) {
        const target = { x: player.x, y: player.y };
        const previous = visualPositions.get(player.id);
        visualPositions.set(
          player.id,
          smoothPlayerRenderPosition(previous, target, elapsedMs),
        );
      }
      lastRenderUpdateTime = now;
    },

    renderPosition(player) {
      const visual = visualPositions.get(player.id) ?? player;
      const offset = renderOffsets.get(player.id);
      if (!offset) {
        return { x: visual.x, y: visual.y };
      }
      return {
        x: visual.x + offset.x,
        y: visual.y + offset.y,
      };
    },

    motionFor(player, tick, now) {
      const previous = motion.get(player.id);
      if (!previous) {
        const next = {
          x: player.x,
          y: player.y,
          tick,
          moving: false,
          walkStartMs: now,
          lastMovementMs: null,
          sampleMs: now,
          speedRatio: 0,
          direction: "south",
        };
        motion.set(player.id, next);
        return next;
      }

      if (previous.tick !== tick) {
        const dx = player.x - previous.x;
        const dy = player.y - previous.y;
        const distance = Math.hypot(dx, dy);
        const moved = distance > PLAYER_MOVEMENT_EPSILON;
        const sampleElapsedMs = Math.max(16, now - (previous.sampleMs ?? now));
        const wasRecentlyMoving =
          previous.lastMovementMs != null
          && now - previous.lastMovementMs <= PLAYER_WALK_STOP_GRACE_MS;
        const walkStartMs =
          moved && !previous.moving && !wasRecentlyMoving ? now : previous.walkStartMs;
        const direction = moved
          ? directionFromWorldDelta(dx, dy, previous.direction)
          : previous.direction;
        if (direction !== previous.direction) {
          previous.previousDirection = previous.direction;
          previous.directionChangedMs = now;
        }
        previous.x = player.x;
        previous.y = player.y;
        previous.tick = tick;
        previous.walkStartMs = walkStartMs;
        previous.lastMovementMs = moved ? now : previous.lastMovementMs;
        previous.speedRatio = moved
          ? clamp(((distance / sampleElapsedMs) * 1000) / 220, 0.62, 1.45)
          : previous.speedRatio * 0.78;
        previous.sampleMs = now;
        previous.direction = direction;
      }

      const movementAge =
        previous.lastMovementMs == null ? Infinity : now - previous.lastMovementMs;
      previous.moving = movementAge <= PLAYER_WALK_STOP_GRACE_MS;
      if (!previous.moving) {
        previous.speedRatio = 0;
      }

      return previous;
    },

    variantIndexFor(player, fallbackIndex = 0) {
      return variantIndexes.get(player.id) ?? fallbackIndex;
    },

    nearbyPlayerCount(players, player) {
      return players.filter((candidate) => playerDistance(candidate, player) <= PLAYER_CLUSTER_DISTANCE)
        .length;
    },
  };
}

export function playerProximityClusters(players) {
  const clusters = [];
  const visited = new Set();

  for (const player of players) {
    if (visited.has(player.id)) continue;

    const cluster = [];
    const queue = [player];
    visited.add(player.id);

    while (queue.length > 0) {
      const current = queue.shift();
      cluster.push(current);

      for (const candidate of players) {
        if (visited.has(candidate.id)) continue;
        if (playerDistance(current, candidate) > PLAYER_CLUSTER_DISTANCE) continue;
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

export function playerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
