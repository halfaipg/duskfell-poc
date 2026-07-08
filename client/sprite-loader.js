import {
  DETAIL_SHEET_ID,
  FALLBACK_PLAYER_SHEET_ID,
  FALLBACK_PROP_SHEET_ID,
  ITEM_SHEET_ID,
  PLAYER_DIRECTION_NAMES,
  PREFERRED_PLAYER_PAPERDOLL_IDS,
  PREFERRED_PLAYER_SHEET_ID,
  PREFERRED_PLAYER_SHEET_IDS,
  PREFERRED_PROP_SHEET_ID,
} from "./player-config.js";
import { loadVerifiedPngImage } from "./runtime-image-loader.js";
import { selectPaperdollStack, selectSpriteSheet } from "./sprite-assets.js";

export async function loadRuntimeSpriteAssets(manifest) {
  const paperdollActors = await loadPreferredPaperdollActors(manifest);
  const playerSheetIds = PREFERRED_PLAYER_SHEET_IDS.filter((sheetId) => hasSpriteSheet(manifest, sheetId));
  const actorSheetIds =
    playerSheetIds.length > 0
      ? playerSheetIds
      : hasSpriteSheet(manifest, PREFERRED_PLAYER_SHEET_ID)
        ? [PREFERRED_PLAYER_SHEET_ID]
        : [FALLBACK_PLAYER_SHEET_ID];
  const actorSheets = paperdollActors.length > 0
    ? paperdollActors
    : await Promise.all(actorSheetIds.map((sheetId) => loadActorSpriteSheet(manifest, sheetId)));
  const propSheetId = hasSpriteSheet(manifest, PREFERRED_PROP_SHEET_ID)
    ? PREFERRED_PROP_SHEET_ID
    : FALLBACK_PROP_SHEET_ID;
  const propSheet = selectSpriteSheet(manifest, propSheetId, "neutral");
  const propImage = await loadVerifiedPngImage(
    `/assets/sprites/${propSheet.imagePath}`,
    propSheet.imageSha256,
  );
  const itemSheet = hasSpriteSheet(manifest, ITEM_SHEET_ID)
    ? selectSpriteSheet(manifest, ITEM_SHEET_ID, "neutral")
    : null;
  const itemImage = itemSheet
    ? await loadVerifiedPngImage(`/assets/sprites/${itemSheet.imagePath}`, itemSheet.imageSha256)
    : null;
  const detailSheet = hasSpriteSheet(manifest, DETAIL_SHEET_ID)
    ? selectSpriteSheet(manifest, DETAIL_SHEET_ID, "neutral")
    : null;
  const detailImage = detailSheet
    ? await loadVerifiedPngImage(`/assets/sprites/${detailSheet.imagePath}`, detailSheet.imageSha256)
    : null;

  return {
    player: actorSheets[0] ?? null,
    players: actorSheets,
    paperdolls: paperdollActors,
    props: {
      image: propImage,
      cellWidth: propSheet.cellWidth,
      cellHeight: propSheet.cellHeight,
      anchor: propSheet.anchor,
      render: propSheet.render,
      startFrame: propSheet.startFrame,
      frameCount: propSheet.frameCount,
    },
    items: itemSheet && itemImage
      ? {
          image: itemImage,
          cellWidth: itemSheet.cellWidth,
          cellHeight: itemSheet.cellHeight,
          columns: itemSheet.columns,
          anchor: itemSheet.anchor,
          render: itemSheet.render,
          startFrame: itemSheet.startFrame,
          frameCount: itemSheet.frameCount,
          dataUrls: itemIconDataUrls(itemImage, itemSheet),
        }
      : null,
    details: detailSheet && detailImage
      ? {
          image: detailImage,
          cellWidth: detailSheet.cellWidth,
          cellHeight: detailSheet.cellHeight,
          columns: detailSheet.columns,
          anchor: detailSheet.anchor,
          render: detailSheet.render,
          startFrame: detailSheet.startFrame,
          frameCount: detailSheet.frameCount,
        }
      : null,
  };
}

async function loadPreferredPaperdollActors(manifest) {
  const definitions = preferredPaperdollDefinitions(manifest);
  if (definitions.length === 0) return [];

  try {
    return await Promise.all(
      definitions.map((definition) => loadPaperdollActorStack(manifest, definition)),
    );
  } catch (error) {
    console.warn("Paperdoll actors disabled", error);
    return [];
  }
}

function preferredPaperdollDefinitions(manifest) {
  const definitions = Array.isArray(manifest?.paperdolls) ? manifest.paperdolls : [];
  const playableDefinitions = definitions.filter((definition) => {
    if (!definition || definition.role !== "player") return false;
    if (!hasSpriteSheet(manifest, definition.baseSheetId)) return false;
    const layers = Array.isArray(definition.layers) ? definition.layers : [];
    return layers.every((layer) => hasSpriteSheet(manifest, layer?.sheetId));
  });
  const preferred = PREFERRED_PLAYER_PAPERDOLL_IDS
    .map((id) => playableDefinitions.find((definition) => definition.id === id))
    .filter(Boolean);
  return preferred.length > 0 ? preferred : playableDefinitions;
}

async function loadPaperdollActorStack(manifest, definition) {
  const directionStacks = Object.fromEntries(
    PLAYER_DIRECTION_NAMES.map((directionName) => [
      directionName,
      selectPaperdollStack(manifest, definition, directionName),
    ]),
  );
  const southStack = directionStacks.south;
  const directions = Object.fromEntries(
    PLAYER_DIRECTION_NAMES.map((directionName) => {
      const directionStack = directionStacks[directionName];
      return [
        directionName,
        {
          startFrame: directionStack.layers[0].startFrame,
          frameCount: directionStack.layers[0].frameCount,
        },
      ];
    }),
  );
  const images = new Map();
  const layers = await Promise.all(
    southStack.layers.map(async (layer) => {
      const cacheKey = `${layer.imagePath}:${layer.imageSha256}`;
      let image = images.get(cacheKey);
      if (!image) {
        image = await loadVerifiedPngImage(`/assets/sprites/${layer.imagePath}`, layer.imageSha256);
        images.set(cacheKey, image);
      }
      return { ...layer, image };
    }),
  );

  return {
    kind: "paperdoll",
    id: definition.id,
    label: definition.label,
    baseSheetId: southStack.baseSheetId,
    layers,
    cellWidth: southStack.cellWidth,
    cellHeight: southStack.cellHeight,
    columns: layers[0]?.columns ?? southStack.layers[0]?.columns,
    anchor: southStack.anchor,
    render: southStack.render,
    animation: southStack.animation,
    directions,
  };
}

async function loadActorSpriteSheet(manifest, sheetId) {
  const sheet = selectSpriteSheet(manifest, sheetId, "south");
  const directions = Object.fromEntries(
    PLAYER_DIRECTION_NAMES.map((directionName) => {
      const directionSheet = selectSpriteSheet(manifest, sheetId, directionName);
      return [
        directionName,
        {
          startFrame: directionSheet.startFrame,
          frameCount: directionSheet.frameCount,
        },
      ];
    }),
  );
  const image = await loadVerifiedPngImage(`/assets/sprites/${sheet.imagePath}`, sheet.imageSha256);
  return {
    id: sheetId,
    image,
    cellWidth: sheet.cellWidth,
    cellHeight: sheet.cellHeight,
    columns: sheet.columns,
    anchor: sheet.anchor,
    render: sheet.render,
    startFrame: sheet.startFrame,
    frameCount: sheet.frameCount,
    directions,
  };
}

function itemIconDataUrls(image, sheet) {
  const urls = [];
  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = sheet.cellWidth;
  iconCanvas.height = sheet.cellHeight;
  const iconContext = iconCanvas.getContext("2d");
  if (!iconContext) return urls;

  for (let frame = 0; frame < sheet.frameCount; frame += 1) {
    iconContext.clearRect(0, 0, sheet.cellWidth, sheet.cellHeight);
    iconContext.imageSmoothingEnabled = false;
    iconContext.drawImage(
      image,
      (frame % sheet.columns) * sheet.cellWidth,
      Math.floor(frame / sheet.columns) * sheet.cellHeight,
      sheet.cellWidth,
      sheet.cellHeight,
      0,
      0,
      sheet.cellWidth,
      sheet.cellHeight,
    );
    urls.push(iconCanvas.toDataURL("image/png"));
  }
  return urls;
}

function hasSpriteSheet(manifest, sheetId) {
  return Array.isArray(manifest?.sheets) && manifest.sheets.some((sheet) => sheet?.id === sheetId);
}
