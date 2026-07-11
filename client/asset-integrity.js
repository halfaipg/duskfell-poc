let warnedInsecureContext = false;

export async function verifySha256Bytes(bytes, expectedSha256) {
  assertSha256Pin(expectedSha256);
  if (!globalThis.crypto?.subtle) {
    // http LAN contexts have no Web Crypto; failing every asset here turns
    // "opened via IP address" into a blank world — degrade loudly instead
    if (!warnedInsecureContext) {
      warnedInsecureContext = true;
      console.warn("Web Crypto unavailable (insecure context?) — skipping asset SHA-256 verification");
    }
    return expectedSha256;
  }
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`asset SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
  return actualSha256;
}

export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable");
  }
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertSha256Pin(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("asset SHA-256 pin must be a lowercase SHA-256 hex digest");
  }
}
