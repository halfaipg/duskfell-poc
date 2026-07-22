import { loadVerifiedPngImage } from "./runtime-image-loader.js";

export const TREE_REVIEW_SPRITES = Object.freeze({
  blender: Object.freeze({
    id: "duskfell-blender-img2img-tree-review",
    label: "Blender structure plus illustrated tree-family review",
    imagePath:
      "/assets/sprites/candidates/blender-tree-family-v1/" +
      "duskfell-details-blender-img2img-v1.png",
    imageSha256: "079ef07b298311efa4cc6ac36067029fc5e14b06dbdc8c545e5fd0ffc4e37a43",
    cellWidth: 192,
    cellHeight: 192,
    columns: 31,
    anchor: { kind: "foot", x: 96, y: 176 },
    render: {
      layer: "terrain",
      sort: "footprint-y",
      zBias: -4,
      scale: 1.1,
      shadow: { kind: "ellipse", x: 96, y: 180, width: 64, height: 16, opacity: 0.2 },
    },
    startFrame: 0,
    frameCount: 31,
  }),
});

export function treeReviewMode(search = "") {
  const value = new URLSearchParams(search).get("trees");
  if (value === "1" || value === "blender") return "blender";
  return null;
}

export async function loadTreeReviewSprite(mode) {
  const definition = TREE_REVIEW_SPRITES[mode];
  if (!definition) throw new Error(`unknown tree review mode ${mode}`);
  const image = await loadVerifiedPngImage(definition.imagePath, definition.imageSha256);
  return { ...definition, image };
}
