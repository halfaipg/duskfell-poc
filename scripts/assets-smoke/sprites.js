import { readPngDimensions } from "../verify-sprite-manifest.js";
import { sha256Hex } from "./hash.js";
import { fetchBuffer, fetchJson } from "./http.js";

export async function inspectSpriteAssets(context) {
  const { response: manifestResponse, body: manifest } = await fetchJson(
    context,
    "/assets/sprites/manifest.json",
  );
  const playerSheet = preferredSheet(manifest, "duskfell-wayfarer", "player-placeholder");
  const actorVariants = ["duskfell-ranger", "duskfell-warden", "duskfell-brigand"].map((id) =>
    preferredSheet(manifest, id, id),
  );
  const propSheet = preferredSheet(manifest, "duskfell-props", "props-placeholder");
  const itemSheet = preferredSheet(manifest, "duskfell-items", "duskfell-items");
  const detailSheet = preferredSheet(manifest, "duskfell-details", "duskfell-details");

  const playerImage = await inspectSheetImage(context, playerSheet);
  const propImage = await inspectSheetImage(context, propSheet);
  const itemImage = await inspectSheetImage(context, itemSheet);
  const detailImage = await inspectSheetImage(context, detailSheet);

  return {
    report: {
      manifestStatus: manifestResponse.status,
      imageStatus: playerImage.response.status,
      projection: manifest.projection,
      playerSheet: summarizeSheet(playerSheet, playerImage.sha256),
      actorVariants: actorVariants.map((sheet) => ({
        id: sheet.id,
        image: sheet.image,
        imageSha256: sheet.imageSha256,
        approvalState: sheet.approval.state,
      })),
      imageDimensions: playerImage.dimensions,
      propSheet: summarizeSheet(propSheet, propImage.sha256),
      propImageDimensions: propImage.dimensions,
      itemSheet: summarizeSheet(itemSheet, itemImage.sha256),
      itemImageDimensions: itemImage.dimensions,
      detailSheet: summarizeSheet(detailSheet, detailImage.sha256),
      detailImageDimensions: detailImage.dimensions,
    },
    ok:
      manifestResponse.ok &&
      playerImage.response.ok &&
      projectionMatches(manifest.projection) &&
      actorSheetMatches(playerSheet) &&
      ["placeholder", "review"].includes(playerSheet.approval.state) &&
      actorVariants.length === 3 &&
      actorVariants.every((sheet) => sheet?.approval?.state === "review") &&
      imageMatchesSheet(playerSheet, playerImage) &&
      propImage.response.ok &&
      propSheet.render?.layer === "prop" &&
      propSheet.render?.sort === "footprint-y" &&
      propSheet.render?.shadow?.kind === "ellipse" &&
      ["placeholder", "review"].includes(propSheet.approval.state) &&
      imageMatchesSheet(propSheet, propImage) &&
      itemImage.response.ok &&
      itemSheet.render?.layer === "ui" &&
      itemSheet.render?.sort === "fixed" &&
      itemSheet.approval.state === "review" &&
      imageMatchesSheet(itemSheet, itemImage) &&
      detailImage.response.ok &&
      detailSheet.render?.layer === "terrain" &&
      detailSheet.render?.sort === "footprint-y" &&
      detailSheet.approval.state === "review" &&
      imageMatchesSheet(detailSheet, detailImage),
  };
}

async function inspectSheetImage(context, sheet) {
  const { response, buffer } = await fetchBuffer(context, `/assets/sprites/${sheet.image}`);
  return {
    response,
    dimensions: readPngDimensions(buffer),
    sha256: sha256Hex(buffer),
  };
}

function summarizeSheet(sheet, actualImageSha256) {
  return {
    id: sheet.id,
    image: sheet.image,
    cellWidth: sheet.frameGrid.cellWidth,
    cellHeight: sheet.frameGrid.cellHeight,
    columns: sheet.frameGrid.columns,
    rows: sheet.frameGrid.rows,
    imageSha256: sheet.imageSha256,
    actualImageSha256,
    render: sheet.render,
    approvalState: sheet.approval.state,
  };
}

function actorSheetMatches(sheet) {
  return (
    sheet.render?.layer === "actor" &&
    sheet.render?.sort === "footprint-y" &&
    Number.isInteger(sheet.render?.zBias) &&
    sheet.render?.shadow?.kind === "ellipse" &&
    Number.isFinite(sheet.render?.shadow?.opacity)
  );
}

function imageMatchesSheet(sheet, image) {
  return (
    sheet.imageSha256 === image.sha256 &&
    image.dimensions.width === sheet.frameGrid.columns * sheet.frameGrid.cellWidth &&
    image.dimensions.height === sheet.frameGrid.rows * sheet.frameGrid.cellHeight
  );
}

function preferredSheet(manifest, preferredId, fallbackId) {
  return (
    manifest.sheets.find((sheet) => sheet.id === preferredId) ??
    manifest.sheets.find((sheet) => sheet.id === fallbackId)
  );
}

function projectionMatches(projection) {
  return (
    projection.kind === "military-plan-oblique" &&
    projection.tileWidth === 64 &&
    projection.tileHeight === 64 &&
    projection.tileAspectRatio === 1 &&
    projection.axisAngleDegrees === 45 &&
    projection.heightAxis === "screen-y"
  );
}
