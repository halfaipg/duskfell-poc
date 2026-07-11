import { verifySha256Bytes } from "./asset-integrity.js";

export async function loadVerifiedPngImage(src, expectedSha256) {
  return loadVerifiedImage(src, expectedSha256, ["image/png"]);
}

export async function loadVerifiedImage(src, expectedSha256, allowedContentTypes = ["image/png", "image/webp"]) {
  const response = await fetch(src, {
    cache: "no-store",
    headers: { accept: allowedContentTypes.join(", ") },
  });
  if (!response.ok) {
    throw new Error(`asset image request failed with ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const normalizedContentType = contentType.toLowerCase().split(";", 1)[0].trim();
  if (!allowedContentTypes.includes(normalizedContentType)) {
    throw new Error(`asset image content type ${contentType || "unknown"} is unsupported`);
  }
  const bytes = await response.arrayBuffer();
  await verifySha256Bytes(bytes, expectedSha256);
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: normalizedContentType }));
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
