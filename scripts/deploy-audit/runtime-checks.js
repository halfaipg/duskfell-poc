import { MAX_GIT_SHA_BYTES } from "./config.js";
import { fetchWithTimeout, protectedEndpointStatus, tokenHeaders } from "./request.js";

export async function checkText(context, name, path, expected) {
  try {
    const response = await fetchWithTimeout(context, path);
    const body = await response.text();
    context.add(name, response.ok && body === expected, `${response.status} ${body.slice(0, 80)}`);
  } catch (err) {
    context.add(name, false, err.message);
  }
}

export async function checkReady(context) {
  try {
    const response = await fetchWithTimeout(context, "/readyz", {
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    const failed = body.checks?.filter((check) => check.ok !== true).map((check) => check.name) ?? [];
    context.add(
      "readyz",
      response.ok && body.ready === true && failed.length === 0,
      failed.length === 0 ? `${response.status} ready` : `${response.status} failed: ${failed.join(", ")}`,
    );
    return body;
  } catch (err) {
    context.add("readyz", false, err.message);
    return null;
  }
}

export async function checkRuntime(context) {
  const protectedStatus = await protectedEndpointStatus(
    context,
    "admin-runtime-protected",
    "/admin/runtime",
    "x-admin-token",
    context.adminToken,
  );
  if (context.profile === "shared-poc" && protectedStatus !== 401) {
    context.add("admin-runtime-rejects-missing-token", false, `expected 401, got ${protectedStatus}`);
  }

  try {
    const response = await fetchWithTimeout(context, "/admin/runtime", {
      headers: tokenHeaders("x-admin-token", context.adminToken),
    });
    const body = await response.json();
    context.add(
      "admin-runtime",
      response.ok &&
        body.app?.game === "Duskfell" &&
        body.app?.chain === "Base" &&
        body.app?.ticker === "$DUSK" &&
        body.assets?.sprites?.projection?.kind === "military-plan-oblique" &&
        body.assets?.terrain?.projection?.kind === "military-plan-oblique" &&
        imagesVerified(body.assets?.sprites?.images) &&
        imagesVerified(body.assets?.terrain?.images),
      `${response.status} game=${body.app?.game ?? "?"} git=${body.app?.buildGitSha ?? "none"}`,
    );
    if (context.profile === "shared-poc" || context.expectedGitSha != null) {
      context.add(
        "build-git-sha",
        context.expectedGitShaValid && body.app?.buildGitSha === context.expectedGitSha,
        `expected=${context.expectedGitSha} actual=${body.app?.buildGitSha ?? "missing"}`,
      );
    }
    return body;
  } catch (err) {
    context.add("admin-runtime", false, err.message);
    return null;
  }
}

export async function checkSummary(context) {
  try {
    const response = await fetchWithTimeout(context, "/admin/summary", {
      headers: tokenHeaders("x-admin-token", context.adminToken),
    });
    const body = await response.json();
    context.add(
      "admin-summary",
      response.ok &&
        body.content?.schemaVersion === "sundermere-world-v1" &&
        Number.isInteger(body.tick) &&
        Number.isFinite(body.players),
      `${response.status} public=${body.publicDeployment ?? "?"} requireSession=${body.requireSession ?? "?"} requireAccount=${body.requireAccount ?? "?"}`,
    );
    return body;
  } catch (err) {
    context.add("admin-summary", false, err.message);
    return null;
  }
}

export function checkExpectedGitSha(context) {
  if (context.profile !== "shared-poc") {
    context.add("expected-build-git-sha-optional", true, "skipped outside shared-poc profile");
    return true;
  }

  const present = typeof context.expectedGitSha === "string" && context.expectedGitSha.length > 0;
  const bounded = present && Buffer.byteLength(context.expectedGitSha) <= MAX_GIT_SHA_BYTES;
  const formatted = present && /^[0-9a-f]{7,64}$/iu.test(context.expectedGitSha);
  const notUnknown = present && context.expectedGitSha.toLowerCase() !== "unknown";
  context.add("expected-build-git-sha-present", present, "shared-poc audit requires --expectedGitSha");
  context.add(
    "expected-build-git-sha-bounded",
    bounded,
    `--expectedGitSha must be at most ${MAX_GIT_SHA_BYTES} bytes`,
  );
  context.add(
    "expected-build-git-sha-format",
    formatted,
    "--expectedGitSha must be a 7-64 character hexadecimal Git revision",
  );
  context.add(
    "expected-build-git-sha-not-unknown",
    notUnknown,
    "--expectedGitSha must not use the Dockerfile unknown default",
  );
  return present && bounded && formatted && notUnknown;
}

function imagesVerified(images) {
  return (
    Array.isArray(images) &&
    images.length > 0 &&
    images.every(
      (image) =>
        image.sha256Verified === true &&
        typeof image.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(image.sha256) &&
        Number.isInteger(image.bytes) &&
        image.bytes > 0,
    )
  );
}
