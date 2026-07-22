import { loadVerifiedPngImage } from "./runtime-image-loader.js";

const DIRECTION_NAMES = [
  "south",
  "southeast",
  "east",
  "northeast",
  "north",
  "northwest",
  "west",
  "southwest",
];

function reviewSprite({
  id,
  label,
  imagePath,
  imageSha256,
  idleFrameCount = 0,
  motionFrameCount,
  durationMs,
  idleDurationMs,
  anchorY = 128,
  scale = 0.84,
}) {
  const frameCount = idleFrameCount + motionFrameCount;
  return Object.freeze({
    id,
    label,
    imagePath,
    imageSha256,
    cellWidth: 128,
    cellHeight: 160,
    columns: frameCount,
    rows: DIRECTION_NAMES.length,
    anchor: { kind: "foot", x: 64, y: anchorY },
    render: { layer: "actor", sort: "footprint-y", zBias: 0, scale },
    animation: {
      idleFrame: 0,
      idleFrames:
        idleFrameCount > 0
          ? Array.from({ length: idleFrameCount }, (_, index) => index)
          : undefined,
      walkFrames: Array.from(
        { length: motionFrameCount },
        (_, index) => idleFrameCount + index,
      ),
      frameMs: durationMs / motionFrameCount,
      idleFrameMs:
        idleFrameCount > 0 && Number.isFinite(idleDurationMs) && idleDurationMs > 0
          ? idleDurationMs / idleFrameCount
          : undefined,
    },
    directions: Object.fromEntries(
      DIRECTION_NAMES.map((name, row) => [
        name,
        { startFrame: row * frameCount, frameCount },
      ]),
    ),
  });
}

export const KIMODO_REVIEW_SPRITES = Object.freeze({
  blender: reviewSprite({
    id: "blender-cc0-locomotion-v2-review",
    label: "Blender CC0 locomotion v2 review",
    imagePath:
      "/assets/sprites/candidates/blender-locomotion-v2/" +
      "duskfell-locomotion-v2-8x36.png",
    imageSha256: "670ec5c006bb1faaada74f08f68541ae4369b91f60a9751addc5fd6ebd6a809a",
    idleFrameCount: 16,
    motionFrameCount: 20,
    durationMs: 1000,
    idleDurationMs: 2500,
    anchorY: 110,
    scale: 0.9,
  }),
  generated: reviewSprite({
    id: "kimodo-generated-human-locomotion-review",
    label: "Kimodo generated human locomotion review",
    imagePath:
      "/assets/sprites/candidates/kimodo/generated-human-locomotion/" +
      "generated-human-locomotion-wretch-8x36.png",
    imageSha256: "b0c43354590eece9c60f1fb9fc9cf81c1f8d46f72a8de82d397815d0be4a28ec",
    idleFrameCount: 16,
    motionFrameCount: 20,
    durationMs: (20 / 30) * 1000,
    idleDurationMs: 2600,
  }),
  run: reviewSprite({
    id: "kimodo-human-locomotion-review",
    label: "Kimodo human locomotion review",
    imagePath:
      "/assets/sprites/candidates/kimodo/human-locomotion-clean/" +
      "human-locomotion-clean-wretch-8x37.png",
    imageSha256: "bbec00542d2f84f76a5518245b4da3935ed74c924f15a5a6234abc6c945aff47",
    idleFrameCount: 16,
    motionFrameCount: 21,
    durationMs: 700,
  }),
  zombie: reviewSprite({
    id: "kimodo-zombie-gait-review",
    label: "Kimodo zombie gait review",
    imagePath:
      "/assets/sprites/candidates/kimodo/zombie-gait-official-fixture/" +
      "zombie-gait-official-fixture-wretch-8x48.png",
    imageSha256: "508b0dda939c106fe2a5931ea219cbb28508022144b9ae6040b7065d6dbbd2ed",
    motionFrameCount: 48,
    durationMs: 4033,
  }),
});

export function kimodoReviewMode(search = "") {
  const params = new URLSearchParams(search);
  const value = params.get("character") ?? params.get("kimodo");
  if (value === "blender") return "blender";
  if (value === "generated") return "generated";
  if (value === "1" || value === "run") return "run";
  if (value === "zombie") return "zombie";
  return null;
}

export async function loadKimodoReviewSprite(mode) {
  const definition = KIMODO_REVIEW_SPRITES[mode];
  if (!definition) throw new Error(`unknown Kimodo review mode ${mode}`);
  const image = await loadVerifiedPngImage(definition.imagePath, definition.imageSha256);
  return { ...definition, image };
}
