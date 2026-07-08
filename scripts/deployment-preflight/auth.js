import { isCompactPrintable, isLocalHost, looksLikePlaceholderSecret } from "./parsing.js";

const MAX_AUTH_TOKEN_BYTES = 4096;
const MAX_JWT_ISSUER_BYTES = 512;
const MAX_JWT_AUDIENCE_BYTES = 256;

export function checkAccountAuth(env, profile, add) {
  if (profile === "local") {
    return;
  }

  const accountMode = env.ACCOUNT_AUTH_MODE ?? "dev-token";
  add(
    "account-auth-mode-supported",
    accountMode === "dev-token" || accountMode === "jwt-hs256",
    "error",
    "ACCOUNT_AUTH_MODE must be dev-token or jwt-hs256",
  );

  const tokens = [
    ["ADMIN_TOKEN", env.ADMIN_TOKEN],
    ["METRICS_TOKEN", env.METRICS_TOKEN],
  ];
  let accountCredential = null;

  if (accountMode === "dev-token") {
    tokens.unshift(["DEV_ACCOUNT_TOKEN", env.DEV_ACCOUNT_TOKEN]);
    accountCredential = ["DEV_ACCOUNT_TOKEN", env.DEV_ACCOUNT_TOKEN];
  } else if (accountMode === "jwt-hs256") {
    tokens.unshift(["ACCOUNT_JWT_HS256_SECRET", env.ACCOUNT_JWT_HS256_SECRET]);
    accountCredential = ["ACCOUNT_JWT_HS256_SECRET", env.ACCOUNT_JWT_HS256_SECRET];
    addJwtIdentityChecks(env, add);
  }

  for (const [name, token] of tokens) {
    add(`${name.toLowerCase()}-present`, Boolean(token), "error", `${name} must be set`);
    add(
      `${name.toLowerCase()}-strong`,
      typeof token === "string" && Buffer.byteLength(token) >= 24,
      "error",
      `${name} must be at least 24 bytes`,
    );
    add(
      `${name.toLowerCase()}-bounded`,
      typeof token === "string" && Buffer.byteLength(token) <= MAX_AUTH_TOKEN_BYTES,
      "error",
      `${name} must be at most ${MAX_AUTH_TOKEN_BYTES} bytes`,
    );
    add(
      `${name.toLowerCase()}-trimmed`,
      typeof token === "string" && token.trim() === token,
      "error",
      `${name} must not have surrounding whitespace`,
    );
    add(
      `${name.toLowerCase()}-not-placeholder`,
      typeof token === "string" && !looksLikePlaceholderSecret(token),
      "error",
      `${name} must not use placeholder text`,
    );
  }

  const presentValues = tokens.map(([, token]) => token).filter(Boolean);
  add(
    "auth-credentials-distinct",
    new Set(presentValues).size === presentValues.length,
    "error",
    `${accountCredential?.[0] ?? "account credential"}, admin, and metrics credentials must be distinct`,
  );
}

export function hasValidJwtIdentityConfig(env) {
  return (
    typeof env.ACCOUNT_JWT_HS256_SECRET === "string" &&
    Buffer.byteLength(env.ACCOUNT_JWT_HS256_SECRET) >= 24 &&
    Buffer.byteLength(env.ACCOUNT_JWT_HS256_SECRET) <= MAX_AUTH_TOKEN_BYTES &&
    env.ACCOUNT_JWT_HS256_SECRET.trim() === env.ACCOUNT_JWT_HS256_SECRET &&
    !looksLikePlaceholderSecret(env.ACCOUNT_JWT_HS256_SECRET) &&
    isPublicJwtIssuer(env.ACCOUNT_JWT_ISSUER) &&
    typeof env.ACCOUNT_JWT_AUDIENCE === "string" &&
    Buffer.byteLength(env.ACCOUNT_JWT_AUDIENCE) <= MAX_JWT_AUDIENCE_BYTES &&
    env.ACCOUNT_JWT_AUDIENCE.trim() === env.ACCOUNT_JWT_AUDIENCE &&
    isCompactPrintable(env.ACCOUNT_JWT_AUDIENCE) &&
    !looksLikePlaceholderSecret(env.ACCOUNT_JWT_AUDIENCE)
  );
}

function addJwtIdentityChecks(env, add) {
  add(
    "account-jwt-issuer-present",
    Boolean(env.ACCOUNT_JWT_ISSUER),
    "error",
    "ACCOUNT_JWT_ISSUER must be set for jwt-hs256 mode",
  );
  add(
    "account-jwt-audience-present",
    Boolean(env.ACCOUNT_JWT_AUDIENCE),
    "error",
    "ACCOUNT_JWT_AUDIENCE must be set for jwt-hs256 mode",
  );
  add(
    "account-jwt-issuer-bounded",
    typeof env.ACCOUNT_JWT_ISSUER === "string" &&
      Buffer.byteLength(env.ACCOUNT_JWT_ISSUER) <= MAX_JWT_ISSUER_BYTES,
    "error",
    `ACCOUNT_JWT_ISSUER must be at most ${MAX_JWT_ISSUER_BYTES} bytes`,
  );
  add(
    "account-jwt-issuer-trimmed",
    typeof env.ACCOUNT_JWT_ISSUER === "string" &&
      env.ACCOUNT_JWT_ISSUER.trim() === env.ACCOUNT_JWT_ISSUER,
    "error",
    "ACCOUNT_JWT_ISSUER must not have surrounding whitespace",
  );
  add(
    "account-jwt-issuer-url",
    isPublicJwtIssuer(env.ACCOUNT_JWT_ISSUER),
    "error",
    "ACCOUNT_JWT_ISSUER must be an https issuer URL with a non-local host and no query, fragment, or userinfo",
  );
  add(
    "account-jwt-audience-bounded",
    typeof env.ACCOUNT_JWT_AUDIENCE === "string" &&
      Buffer.byteLength(env.ACCOUNT_JWT_AUDIENCE) <= MAX_JWT_AUDIENCE_BYTES,
    "error",
    `ACCOUNT_JWT_AUDIENCE must be at most ${MAX_JWT_AUDIENCE_BYTES} bytes`,
  );
  add(
    "account-jwt-audience-trimmed",
    typeof env.ACCOUNT_JWT_AUDIENCE === "string" &&
      env.ACCOUNT_JWT_AUDIENCE.trim() === env.ACCOUNT_JWT_AUDIENCE,
    "error",
    "ACCOUNT_JWT_AUDIENCE must not have surrounding whitespace",
  );
  add(
    "account-jwt-audience-printable",
    isCompactPrintable(env.ACCOUNT_JWT_AUDIENCE),
    "error",
    "ACCOUNT_JWT_AUDIENCE must not contain whitespace or control characters",
  );
  add(
    "account-jwt-audience-not-placeholder",
    typeof env.ACCOUNT_JWT_AUDIENCE === "string" &&
      !looksLikePlaceholderSecret(env.ACCOUNT_JWT_AUDIENCE),
    "error",
    "ACCOUNT_JWT_AUDIENCE must not use placeholder text",
  );
}

function isPublicJwtIssuer(value) {
  if (typeof value !== "string") return false;
  if (Buffer.byteLength(value) > MAX_JWT_ISSUER_BYTES) return false;
  if (value.trim() !== value) return false;
  if (!isCompactPrintable(value)) return false;
  if (value.includes("?") || value.includes("#") || value.includes("@")) return false;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return (
    parsed.protocol === "https:" &&
    parsed.hostname.length > 0 &&
    !isLocalHost(parsed.hostname)
  );
}
