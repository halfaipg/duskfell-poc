import {
  addAuthoredLandmark,
  addAuthoredSettlement,
  beginAuthoredTrail,
  buildWorldAuthoringPatch,
  commitAuthoredTrail,
  extendAuthoredTrail,
  removeNearestAuthoredFeature,
} from "./world-editor-authoring.js";
import {
  AUTHORABLE_TERRAIN_FIELDS,
  appendTerrainPoint,
  applyRiverRoutePoint,
  applyTerrainBrushPoint,
  createTerrainOperation,
} from "./world-editor-terrain-authoring.js";

const authority = document.querySelector("#authority");
const projection = document.querySelector("#projection");
const authorityContext = authority.getContext("2d");
const projectionContext = projection.getContext("2d");
const fieldInput = document.querySelector("#field");
const radiusInput = document.querySelector("#radius");
const strengthInput = document.querySelector("#strength");
const overlayInput = document.querySelector("#overlay");
const featuresInput = document.querySelector("#features");
const ecologyInput = document.querySelector("#ecology");
const hydrologyDetailsInput = document.querySelector("#hydrologyDetails");
const packageInput = document.querySelector("#package");
const toolInput = document.querySelector("#tool");
const landmarkTypeInput = document.querySelector("#landmarkType");
const terrainControls = document.querySelector("#terrainControls");
const landmarkControls = document.querySelector("#landmarkControls");
const trailControls = document.querySelector("#trailControls");
const cancelTrailButton = document.querySelector("#cancelTrail");
const status = document.querySelector("#status");
let original = null;
let world = null;
let groundImage = null;
let painting = false;
let derivedStale = false;
let authoringDirty = false;
let trailDraft = null;
let terrainOperations = [];
let activeTerrainOperation = null;
let projectionFrame = null;
let authoringOptions = { maxSlope: 0.72, minSettlementSpacing: 8, minLandmarkSpacing: 8, maxBridgeTiles: 4, trailWidth: 1.15 };

const DEFAULT_PACKAGE = "/worlds/generated/duskfell-climate-chunked-v1";
const RESOURCE_COLORS = { Wood: "#3e8b50", Fiber: "#a3bd62", Ore: "#8e9ba9", Stone: "#c0bbae", Deadwood: "#775039", Mycelium: "#a77cb6", Seed: "#d5b456" };

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function normalizePackageRoot(value) {
  const root = value.trim().replace(/\/+$/, "");
  if (!/^\/(?:assets\/terrain\/worlds|worlds\/generated)\/[a-z0-9][a-z0-9./-]*$/i.test(root) || root.includes("..")) throw new Error("package must be inside approved worlds or generated review packages");
  return root;
}

function artifactUrl(root, recordedPath) {
  if (!recordedPath) return `${root}/gameplay-master.png`;
  if (recordedPath.startsWith("/")) return recordedPath;
  if (recordedPath.startsWith("assets/") || recordedPath.startsWith("worlds/")) return `/${recordedPath}`;
  return `${root}/${recordedPath.split("/").at(-1)}`;
}

async function load(requestedRoot = packageInput.value) {
  const root = normalizePackageRoot(requestedRoot || DEFAULT_PACKAGE);
  status.textContent = `Loading ${root.split("/").at(-1)}...`;
  const [bundleResponse, manifestResponse, recipeResponse] = await Promise.all([
    fetch(`${root}/world-bundle-v2.json`, { cache: "no-store" }),
    fetch(`${root}/manifest.json`, { cache: "no-store" }),
    fetch(`${root}/recipe.json`, { cache: "no-store" }),
  ]);
  if (!bundleResponse.ok) throw new Error(`bundle request returned ${bundleResponse.status}`);
  if (!manifestResponse.ok) throw new Error(`manifest request returned ${manifestResponse.status}`);
  if (!recipeResponse.ok) throw new Error(`recipe request returned ${recipeResponse.status}`);
  const manifest = await manifestResponse.json();
  const recipe = await recipeResponse.json();
  const image = await loadImage(artifactUrl(root, manifest.rasters?.gameplay?.path));
  original = await bundleResponse.json();
  world = structuredClone(original);
  ensureAuthoringShape(world);
  authoringOptions = {
    maxSlope: recipe.planning?.maxTrailSlope ?? 0.72,
    minSettlementSpacing: recipe.planning?.minSettlementSpacing ?? 8,
    minLandmarkSpacing: recipe.ecology?.minLandmarkSpacingTiles ?? 8,
    maxBridgeTiles: 4,
    trailWidth: recipe.planning?.trailWidth ?? 1.15,
  };
  groundImage = image;
  authority.height = Math.max(320, Math.round(authority.width * world.dimensions.rows / world.dimensions.cols));
  authority.style.aspectRatio = `${world.dimensions.cols} / ${world.dimensions.rows}`;
  derivedStale = false;
  authoringDirty = false;
  trailDraft = null;
  terrainOperations = [];
  activeTerrainOperation = null;
  cancelTrailButton.disabled = true;
  packageInput.value = root;
  document.querySelector("#worldSize").textContent = `${world.dimensions.cols} x ${world.dimensions.rows} tiles`;
  updateCounts();
  const params = new URLSearchParams(location.search);
  params.set("package", root);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  status.textContent = `${world.id} | deterministic authority loaded`;
  render();
}

function ensureAuthoringShape(bundle) {
  bundle.features ??= {};
  bundle.features.settlements ??= [];
  bundle.features.trails ??= [];
  bundle.ecology ??= {};
  bundle.ecology.habitats ??= { patches: [] };
  bundle.ecology.resourceNodes ??= [];
  bundle.ecology.landmarks ??= bundle.features.landmarks ?? [];
  bundle.features.landmarks = bundle.ecology.landmarks;
}

function updateCounts() {
  document.querySelector("#habitatCount").textContent = String(world.ecology.habitats?.patches?.length ?? 0);
  document.querySelector("#resourceCount").textContent = String(world.ecology.resourceNodes.length);
  document.querySelector("#climateZoneCount").textContent = String(new Set((world.climate?.zones?.rows ?? []).join("")).size);
  document.querySelector("#fogTileCount").textContent = String((world.fields.fogPotential ?? []).flat().filter((value) => value > 0.2).length);
  document.querySelector("#watershedCount").textContent = String(world.hydrology.authority?.watersheds?.basins?.length ?? 0);
  document.querySelector("#tributaryCount").textContent = String(world.hydrology.authority?.tributaries?.length ?? 0);
  document.querySelector("#shorelineCount").textContent = String(world.hydrology.authority?.shorelineSegments?.length ?? 0);
  document.querySelector("#settlementCount").textContent = String(world.features.settlements.length);
  document.querySelector("#trailCount").textContent = String(world.features.trails.length);
  document.querySelector("#landmarkCount").textContent = String(world.ecology.landmarks.length);
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function colorForField(value, field) {
  const ramps = {
    elevation: [41, 30, 24, 232, 232, 220],
    moisture: [101, 69, 43, 40, 126, 145],
    temperature: [53, 92, 130, 194, 102, 54],
    precipitation: [105, 80, 49, 49, 126, 153],
    humidity: [102, 80, 52, 44, 137, 143],
    fogPotential: [48, 52, 49, 221, 226, 218],
    windExposure: [54, 72, 79, 206, 190, 151],
    growingSeason: [71, 59, 42, 107, 151, 63],
    rockiness: [43, 48, 39, 193, 196, 188],
    snow: [31, 42, 44, 246, 248, 244],
    vegetation: [58, 45, 31, 105, 145, 61],
    water: [55, 48, 38, 40, 128, 151],
  };
  const ramp = ramps[field] ?? ramps.water;
  return ramp.slice(0, 3).map((start, index) => Math.round(start + (ramp[index + 3] - start) * value));
}

function selectedGrid() {
  if (fieldInput.value === "elevation") return world.heights;
  if (fieldInput.value === "riverSpline") return world.fields.water;
  return world.fields[fieldInput.value];
}

function render() {
  if (!world) return;
  authorityContext.clearRect(0, 0, authority.width, authority.height);
  authorityContext.drawImage(groundImage, 0, 0, authority.width, authority.height);
  if (overlayInput.checked) drawFieldOverlay();
  drawHydrology(authorityContext, false);
  drawDerivedAuthority(authorityContext, false);
  drawProjection();
}

function drawFieldOverlay() {
  const field = selectedGrid();
  const rows = field.length;
  const cols = field[0].length;
  const cellWidth = authority.width / cols;
  const cellHeight = authority.height / rows;
  authorityContext.save();
  authorityContext.globalAlpha = 0.42;
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    const [r, g, b] = colorForField(field[y][x], fieldInput.value);
    authorityContext.fillStyle = `rgb(${r} ${g} ${b})`;
    authorityContext.fillRect(x * cellWidth, y * cellHeight, cellWidth + 1, cellHeight + 1);
  }
  authorityContext.restore();
}

function drawHydrology(context, projected) {
  const points = world.hydrology.riverCenterline;
  context.save();
  context.strokeStyle = "rgba(116, 196, 204, 0.92)";
  context.lineWidth = projected ? 2 : 3;
  context.beginPath();
  for (let index = 0; index < points.length; index += 1) {
    const point = mapPoint(points[index].x, points[index].y, projected);
    if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
  }
  context.stroke();
  if (hydrologyDetailsInput.checked) {
    context.strokeStyle = "rgba(103, 191, 199, 0.82)";
    context.lineWidth = projected ? 1.2 : 2;
    for (const tributary of world.hydrology.authority?.tributaries ?? []) {
      context.beginPath();
      for (const [index, source] of tributary.points.entries()) {
        const point = mapPoint(source.x, source.y, projected);
        if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }
    if (!projected) {
      const basinIds = world.hydrology.authority?.watersheds?.basinIds ?? [];
      context.strokeStyle = "rgba(224, 188, 103, 0.24)";
      context.lineWidth = 1;
      for (let y = 0; y < basinIds.length; y += 1) for (let x = 0; x < (basinIds[y]?.length ?? 0); x += 1) {
        for (const edge of [
          basinIds[y]?.[x + 1] !== undefined && basinIds[y][x + 1] !== basinIds[y][x] ? [{ x: x + 1, y }, { x: x + 1, y: y + 1 }] : null,
          basinIds[y + 1]?.[x] !== undefined && basinIds[y + 1][x] !== basinIds[y][x] ? [{ x, y: y + 1 }, { x: x + 1, y: y + 1 }] : null,
        ]) {
          if (!edge) continue;
          const from = mapPoint(edge[0].x, edge[0].y, false);
          const to = mapPoint(edge[1].x, edge[1].y, false);
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();
        }
      }
      context.strokeStyle = "rgba(202, 224, 205, 0.3)";
      context.lineWidth = 1;
      for (const segment of world.hydrology.authority?.shorelineSegments ?? []) {
        const from = mapPoint(segment.a.x, segment.a.y, false);
        const to = mapPoint(segment.b.x, segment.b.y, false);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }
    }
    for (const body of world.hydrology.authority?.waterBodies ?? []) {
      if (!body.outlet) continue;
      const from = mapPoint(body.outlet.from.x, body.outlet.from.y, projected);
      const to = mapPoint(body.outlet.to.x, body.outlet.to.y, projected);
      context.strokeStyle = "#f0cf79";
      context.lineWidth = projected ? 1.5 : 2.5;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
  }
  context.restore();
}

function projectPoint(x, y, elevation = 0) {
  if (projectionFrame) {
    const rawX = projectionFrame.origin.x + (x - y) * 32;
    const rawY = projectionFrame.origin.y + (x + y) * 32 - elevation * 40;
    return {
      x: (rawX - projectionFrame.camera.x) * projectionFrame.scale,
      y: (rawY - projectionFrame.camera.y) * projectionFrame.scale,
    };
  }
  const scaleX = projection.width / (world.dimensions.cols + world.dimensions.rows) * 0.87;
  return { x: projection.width / 2 + (x - y) * scaleX, y: 108 + (x + y) * (scaleX * 0.5) - elevation * 92 };
}

function elevationAt(x, y) {
  const x0 = Math.max(0, Math.min(world.dimensions.cols, Math.floor(x)));
  const y0 = Math.max(0, Math.min(world.dimensions.rows, Math.floor(y)));
  const x1 = Math.min(world.dimensions.cols, x0 + 1);
  const y1 = Math.min(world.dimensions.rows, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  return (world.heights[y0][x0] * (1 - tx) + world.heights[y0][x1] * tx) * (1 - ty)
    + (world.heights[y1][x0] * (1 - tx) + world.heights[y1][x1] * tx) * ty;
}

function mapPoint(x, y, projected) {
  if (projected) return projectPoint(x, y, elevationAt(x, y));
  return { x: x / world.dimensions.cols * authority.width, y: y / world.dimensions.rows * authority.height };
}

function drawDerivedAuthority(context, projected) {
  context.save();
  context.globalAlpha = derivedStale ? 0.38 : 0.95;
  if (featuresInput.checked) {
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const trail of world.features?.trails ?? []) {
      context.beginPath();
      for (const [index, point] of trail.points.entries()) {
        const mapped = mapPoint(point.x, point.y, projected);
        if (index === 0) context.moveTo(mapped.x, mapped.y); else context.lineTo(mapped.x, mapped.y);
      }
      context.strokeStyle = "#c1a36b";
      context.lineWidth = projected ? 2 : 4;
      context.stroke();
    }
    for (const settlement of world.features?.settlements ?? []) {
      const point = mapPoint(settlement.x, settlement.y, projected);
      context.beginPath();
      context.arc(point.x, point.y, projected ? 4 : 6, 0, Math.PI * 2);
      context.fillStyle = "#e1c477";
      context.strokeStyle = "#2b2417";
      context.lineWidth = 2;
      context.fill();
      context.stroke();
    }
  }
  if (ecologyInput.checked) {
    for (const node of world.ecology?.resourceNodes ?? []) {
      const point = mapPoint(node.x, node.y, projected);
      context.beginPath();
      context.arc(point.x, point.y, projected ? 1.8 : 3, 0, Math.PI * 2);
      context.fillStyle = RESOURCE_COLORS[node.resource] ?? "#ffffff";
      context.strokeStyle = "#191a16";
      context.lineWidth = 1;
      context.fill();
      context.stroke();
    }
    for (const landmark of world.ecology?.landmarks ?? []) {
      const point = mapPoint(landmark.x, landmark.y, projected);
      const radius = projected ? 5 : 8;
      context.beginPath();
      context.moveTo(point.x, point.y - radius);
      context.lineTo(point.x + radius, point.y);
      context.lineTo(point.x, point.y + radius);
      context.lineTo(point.x - radius, point.y);
      context.closePath();
      context.fillStyle = "#e2bd55";
      context.strokeStyle = "#2b2417";
      context.lineWidth = 2;
      context.fill();
      context.stroke();
    }
  }
  if (trailDraft) drawTrailDraft(context, projected);
  context.restore();
}

function drawTrailDraft(context, projected) {
  context.save();
  context.globalAlpha = 1;
  context.setLineDash(projected ? [4, 3] : [8, 5]);
  context.strokeStyle = "#67d5ca";
  context.lineWidth = projected ? 2 : 4;
  context.beginPath();
  for (const [index, point] of trailDraft.points.entries()) {
    const mapped = mapPoint(point.x, point.y, projected);
    if (index === 0) context.moveTo(mapped.x, mapped.y); else context.lineTo(mapped.x, mapped.y);
  }
  context.stroke();
  context.restore();
}

function drawProjection() {
  projectionContext.clearRect(0, 0, projection.width, projection.height);
  projectionContext.fillStyle = "#10110e";
  projectionContext.fillRect(0, 0, projection.width, projection.height);
  const rows = world.dimensions.rows;
  const cols = world.dimensions.cols;
  projectionFrame = fitProductionProjection(cols, rows);
  const tileWidth = 64 * projectionFrame.scale;
  if (groundImage && tileWidth >= 3.5) drawRaisedGameplayPainting(cols, rows);
  else if (groundImage) drawFlatGameplayPainting(cols, rows);
  else drawFallbackProjection(cols, rows);
  drawHydrology(projectionContext, true);
  drawDerivedAuthority(projectionContext, true);
}

function fitProductionProjection(cols, rows) {
  const maxHeight = Math.max(0, ...world.heights.flat()) * 2;
  const origin = { x: rows * 32 + 24, y: maxHeight * 40 + 24 };
  const bounds = {
    minX: 0,
    minY: 0,
    maxX: (cols + rows) * 32 + 48,
    maxY: origin.y + (cols + rows) * 32 + 24,
  };
  const padding = 14;
  const scale = Math.min(
    (projection.width - padding * 2) / (bounds.maxX - bounds.minX),
    (projection.height - padding * 2) / (bounds.maxY - bounds.minY),
  );
  return {
    origin,
    scale,
    camera: {
      x: bounds.minX - padding / scale,
      y: bounds.minY - padding / scale,
    },
  };
}

function drawRaisedGameplayPainting(cols, rows) {
  const sourceTileWidth = groundImage.naturalWidth / cols;
  const sourceTileHeight = groundImage.naturalHeight / rows;
  projectionContext.imageSmoothingEnabled = true;
  for (let depth = 0; depth < cols + rows - 1; depth += 1) {
    const minX = Math.max(0, depth - rows + 1);
    const maxX = Math.min(cols - 1, depth);
    for (let x = minX; x <= maxX; x += 1) {
      const y = depth - x;
      const nw = projectPoint(x, y, world.heights[y][x] * 2);
      const ne = projectPoint(x + 1, y, world.heights[y][x + 1] * 2);
      const se = projectPoint(x + 1, y + 1, world.heights[y + 1][x + 1] * 2);
      const sw = projectPoint(x, y + 1, world.heights[y + 1][x] * 2);
      const sourceX = x * sourceTileWidth;
      const sourceY = y * sourceTileHeight;
      drawImageTriangle(groundImage, sourceX, sourceY, sourceTileWidth, sourceTileHeight, nw, ne, se, "north");
      drawImageTriangle(groundImage, sourceX, sourceY, sourceTileWidth, sourceTileHeight, nw, se, sw, "south");
      drawProjectionRelief(nw, ne, se, sw, x, y);
    }
  }
}

function drawImageTriangle(image, sx, sy, sw, sh, first, second, third, half) {
  projectionContext.save();
  projectionContext.beginPath();
  projectionContext.moveTo(first.x, first.y);
  projectionContext.lineTo(second.x, second.y);
  projectionContext.lineTo(third.x, third.y);
  projectionContext.closePath();
  projectionContext.clip();
  const ux = half === "north" ? (second.x - first.x) / sw : (second.x - third.x) / sw;
  const uy = half === "north" ? (second.y - first.y) / sw : (second.y - third.y) / sw;
  const vx = half === "north" ? (third.x - second.x) / sh : (third.x - first.x) / sh;
  const vy = half === "north" ? (third.y - second.y) / sh : (third.y - first.y) / sh;
  projectionContext.setTransform(ux, uy, vx, vy, first.x, first.y);
  projectionContext.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  projectionContext.restore();
}

function drawProjectionRelief(nw, ne, se, sw, x, y) {
  const eastSlope = ((world.heights[y][x + 1] + world.heights[y + 1][x + 1]) - (world.heights[y][x] + world.heights[y + 1][x])) / 2;
  const southSlope = ((world.heights[y + 1][x] + world.heights[y + 1][x + 1]) - (world.heights[y][x] + world.heights[y][x + 1])) / 2;
  const shade = clamp((eastSlope + southSlope) * 0.28, -0.14, 0.18);
  if (Math.abs(shade) < 0.015) return;
  projectionContext.beginPath();
  projectionContext.moveTo(nw.x, nw.y);
  projectionContext.lineTo(ne.x, ne.y);
  projectionContext.lineTo(se.x, se.y);
  projectionContext.lineTo(sw.x, sw.y);
  projectionContext.closePath();
  projectionContext.fillStyle = shade > 0 ? `rgba(24, 28, 24, ${shade})` : `rgba(255, 241, 209, ${-shade})`;
  projectionContext.fill();
}

function drawFlatGameplayPainting(cols, rows) {
  const frame = projectionFrame;
  const a = frame.scale * 32 / (groundImage.naturalWidth / cols);
  const b = frame.scale * 32 / (groundImage.naturalWidth / cols);
  const c = -frame.scale * 32 / (groundImage.naturalHeight / rows);
  const d = frame.scale * 32 / (groundImage.naturalHeight / rows);
  const e = (frame.origin.x - frame.camera.x) * frame.scale;
  const f = (frame.origin.y - frame.camera.y) * frame.scale;
  projectionContext.save();
  projectionContext.setTransform(a, b, c, d, e, f);
  projectionContext.drawImage(groundImage, 0, 0);
  projectionContext.restore();
}

function drawFallbackProjection(cols, rows) {
  const palette = { meadow: [92,112,64], loam:[101,82,57], rock:[111,111,104], snow:[220,225,221], wetland:[58,83,68], water:[44,92,101] };
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    const weights = Object.fromEntries(Object.entries(world.biomeWeights).map(([name, values]) => [name, values[y][x]]));
    const rgb = [0, 1, 2].map((channel) => Math.round(Object.entries(weights).reduce((sum, [name, weight]) => sum + palette[name][channel] * weight, 0)));
    const nw = projectPoint(x, y, world.heights[y][x] * 2);
    const ne = projectPoint(x + 1, y, world.heights[y][x + 1] * 2);
    const se = projectPoint(x + 1, y + 1, world.heights[y + 1][x + 1] * 2);
    const sw = projectPoint(x, y + 1, world.heights[y + 1][x] * 2);
    projectionContext.beginPath();
    projectionContext.moveTo(nw.x, nw.y); projectionContext.lineTo(ne.x, ne.y); projectionContext.lineTo(se.x, se.y); projectionContext.lineTo(sw.x, sw.y); projectionContext.closePath();
    projectionContext.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
    projectionContext.fill();
  }
}

function paint(event) {
  if (!painting || !world || !activeTerrainOperation) return;
  const rect = authority.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * world.dimensions.cols;
  const y = (event.clientY - rect.top) / rect.height * world.dimensions.rows;
  if (!appendTerrainPoint(activeTerrainOperation, x, y, world.dimensions)) return;
  derivedStale = true;
  if (fieldInput.value === "riverSpline") {
    applyRiverRoutePoint(world.hydrology.riverCenterline, { x, y }, world.dimensions.cols);
    rebuildRiverMask();
    render();
    return;
  }
  const grid = selectedGrid();
  applyTerrainBrushPoint(grid, { x, y }, activeTerrainOperation);
  render();
}

function rebuildRiverMask() {
  const width = 1.45;
  for (let y = 0; y < world.dimensions.rows; y += 1) {
    const center = world.hydrology.riverCenterline[y]?.x ?? world.dimensions.cols / 2;
    for (let x = 0; x < world.dimensions.cols; x += 1) {
      const distance = Math.abs(x + 0.5 - center);
      const t = clamp((distance - width * 0.72) / (width * 0.68));
      const river = 1 - t * t * (3 - 2 * t);
      world.fields.river[y][x] = river;
      world.fields.water[y][x] = Math.max(world.fields.lake[y][x], river);
    }
  }
}

function worldPointFromEvent(event) {
  const rect = authority.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width * world.dimensions.cols,
    y: (event.clientY - rect.top) / rect.height * world.dimensions.rows,
  };
}

function nearestSettlementAt(point, radius = 2.5) {
  return world.features.settlements
    .map((settlement) => ({ settlement, distance: Math.hypot(settlement.x - point.x, settlement.y - point.y) }))
    .filter((entry) => entry.distance <= radius)
    .sort((left, right) => left.distance - right.distance || left.settlement.id.localeCompare(right.settlement.id))[0]?.settlement ?? null;
}

function markAuthored(message) {
  authoringDirty = true;
  updateCounts();
  status.textContent = `${world.id} | ${message}; authoring patch unsaved`;
  render();
}

function authorFeature(event) {
  if (!world || toolInput.value === "terrain") return;
  const point = worldPointFromEvent(event);
  try {
    if (toolInput.value === "settlement") {
      const settlement = addAuthoredSettlement(world, point.x, point.y, {
        maxSlope: authoringOptions.maxSlope,
        minSpacing: authoringOptions.minSettlementSpacing,
      });
      markAuthored(`placed ${settlement.name}`);
      return;
    }
    if (toolInput.value === "landmark") {
      const landmark = addAuthoredLandmark(world, landmarkTypeInput.value, point.x, point.y, {
        maxSlope: authoringOptions.maxSlope,
        minSpacing: authoringOptions.minLandmarkSpacing,
      });
      markAuthored(`placed ${landmark.name}`);
      return;
    }
    if (toolInput.value === "delete") {
      const removed = removeNearestAuthoredFeature(world, point.x, point.y);
      if (!removed) throw new Error("no editable feature is near that point");
      markAuthored(`removed ${removed.kind} ${removed.id}`);
      return;
    }
    const endpoint = nearestSettlementAt(point);
    if (!trailDraft) {
      trailDraft = beginAuthoredTrail(world, point.x, point.y);
      cancelTrailButton.disabled = false;
      status.textContent = `${world.id} | trail started at ${trailDraft.from}`;
      render();
      return;
    }
    if (endpoint && endpoint.id !== trailDraft.from) {
      const trail = commitAuthoredTrail(world, trailDraft, endpoint.x, endpoint.y, {
        maxSlope: authoringOptions.maxSlope,
        maxBridgeTiles: authoringOptions.maxBridgeTiles,
        width: authoringOptions.trailWidth,
      });
      trailDraft = null;
      cancelTrailButton.disabled = true;
      markAuthored(`created trail ${trail.id}`);
      return;
    }
    extendAuthoredTrail(world, trailDraft, point.x, point.y);
    status.textContent = `${world.id} | routing trail from ${trailDraft.from}`;
    render();
  } catch (error) {
    status.textContent = `${world.id} | ${error.message}`;
  }
}

function updateToolControls() {
  terrainControls.hidden = toolInput.value !== "terrain";
  landmarkControls.hidden = toolInput.value !== "landmark";
  trailControls.hidden = toolInput.value !== "trail";
  authority.dataset.tool = toolInput.value;
  if (toolInput.value !== "trail" && trailDraft) {
    trailDraft = null;
    cancelTrailButton.disabled = true;
    render();
  }
}

function downloadJson(value, filename) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

authority.addEventListener("pointerdown", (event) => {
  if (toolInput.value !== "terrain") {
    authorFeature(event);
    return;
  }
  if (!AUTHORABLE_TERRAIN_FIELDS.has(fieldInput.value)) {
    status.textContent = `${world.id} | ${fieldInput.options[fieldInput.selectedIndex].text} is derived and inspect-only`;
    return;
  }
  activeTerrainOperation = createTerrainOperation(
    fieldInput.value,
    document.querySelector('input[name="mode"]:checked').value,
    Number(radiusInput.value),
    Number(strengthInput.value),
  );
  painting = true;
  authority.setPointerCapture(event.pointerId);
  paint(event);
});
authority.addEventListener("pointermove", (event) => { if (toolInput.value === "terrain") paint(event); });
authority.addEventListener("pointerup", () => {
  if (!painting) return;
  painting = false;
  if (activeTerrainOperation?.points.length) terrainOperations.push(activeTerrainOperation);
  activeTerrainOperation = null;
  authoringDirty = true;
  status.textContent = `${world.id} | ${terrainOperations.length} terrain operations unsaved; derived layers stale`;
});
authority.addEventListener("pointercancel", () => { painting = false; activeTerrainOperation = null; });
for (const input of [fieldInput, overlayInput, hydrologyDetailsInput, featuresInput, ecologyInput]) input.addEventListener("change", render);
for (const [input, output] of [[radiusInput, "#radiusValue"], [strengthInput, "#strengthValue"]]) input.addEventListener("input", () => { document.querySelector(output).textContent = input.value; });
toolInput.addEventListener("change", updateToolControls);
cancelTrailButton.addEventListener("click", () => {
  trailDraft = null;
  terrainOperations = [];
  activeTerrainOperation = null;
  cancelTrailButton.disabled = true;
  status.textContent = `${world.id} | trail cancelled`;
  render();
});
document.querySelector("#reset").addEventListener("click", () => {
  world = structuredClone(original);
  ensureAuthoringShape(world);
  derivedStale = false;
  authoringDirty = false;
  trailDraft = null;
  cancelTrailButton.disabled = true;
  updateCounts();
  status.textContent = `${world.id} | reset`;
  render();
});
document.querySelector("#loadPackage").addEventListener("click", () => load().catch((error) => { status.textContent = `Load failed: ${error.message}`; }));
packageInput.addEventListener("keydown", (event) => { if (event.key === "Enter") document.querySelector("#loadPackage").click(); });
document.querySelector("#export").addEventListener("click", () => {
  downloadJson(world, `${world.id}-edited.json`);
  status.textContent = `${world.id} | exported`;
});
document.querySelector("#exportPatch").addEventListener("click", () => {
  try {
    const patch = buildWorldAuthoringPatch(original, world, { ...authoringOptions, terrainOperations });
    downloadJson(patch, `${world.id}-authoring-patch.json`);
    authoringDirty = false;
    status.textContent = `${world.id} | authoring patch exported`;
  } catch (error) {
    status.textContent = `${world.id} | export failed: ${error.message}`;
  }
});

const requestedPackage = new URLSearchParams(location.search).get("package") ?? DEFAULT_PACKAGE;
packageInput.value = requestedPackage;
updateToolControls();
load(requestedPackage).catch((error) => { status.textContent = `Load failed: ${error.message}`; });
