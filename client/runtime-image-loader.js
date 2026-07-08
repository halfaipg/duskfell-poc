import { verifySha256Bytes } from "./asset-integrity.js";

export async function loadVerifiedPngImage(src, expectedSha256) {
  const response = await fetch(src, {
    cache: "no-store",
    headers: { accept: "image/png" },
  });
  if (!response.ok) {
    throw new Error(`asset image request failed with ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/png")) {
    throw new Error(`asset image must be served as image/png, got ${contentType || "unknown"}`);
  }
  const bytes = await response.arrayBuffer();
  await verifySha256Bytes(bytes, expectedSha256);
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  try {
    return await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
    image.src = src;
  });
}
