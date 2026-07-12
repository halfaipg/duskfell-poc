// NPC cognition (animus) provider preflight. The engine is optional: absence
// of a key means canned-only NPCs, which is valid — but a half-configured
// live provider is an error.
export function checkAnimusProvider(env, profile, add) {
  const enabled = (env.ANIMUS_ENABLED ?? "true").toLowerCase() !== "false";
  const provider = env.ANIMUS_PROVIDER ?? "auto";
  const apiKey = env.ANIMUS_API_KEY ?? "";
  const baseUrl = env.ANIMUS_BASE_URL ?? "https://api.aipowergrid.io";

  if (!enabled) {
    add("animusProvider", true, "warn", "ANIMUS_ENABLED=false: NPCs are canned-only");
    return;
  }
  if (!["auto", "mock", "openai-compatible"].includes(provider)) {
    add(
      "animusProvider",
      false,
      "error",
      `ANIMUS_PROVIDER must be auto, mock, or openai-compatible; got '${provider}'`,
    );
    return;
  }
  if (provider === "mock") {
    const ok = profile !== "production";
    add(
      "animusProvider",
      ok,
      ok ? "warn" : "error",
      ok
        ? "mock cognition provider configured (deterministic, no live LLM)"
        : "mock cognition provider must not run in production",
    );
    return;
  }
  if (provider === "openai-compatible" && apiKey.length === 0) {
    add(
      "animusProvider",
      false,
      "error",
      "ANIMUS_PROVIDER=openai-compatible requires ANIMUS_API_KEY",
    );
    return;
  }
  if (apiKey.length === 0) {
    add(
      "animusProvider",
      true,
      "warn",
      "no ANIMUS_API_KEY: NPC cognition disabled, NPCs answer canned lines",
    );
    return;
  }

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    add("animusProviderUrl", false, "error", `ANIMUS_BASE_URL is not a valid URL: ${baseUrl}`);
    return;
  }
  const httpsOk = url.protocol === "https:" || profile === "local";
  add(
    "animusProviderUrl",
    httpsOk,
    "error",
    httpsOk
      ? `cognition provider at ${url.origin}`
      : `ANIMUS_BASE_URL must use https for ${profile} deployments (the API key rides the Authorization header)`,
  );
  add(
    "animusProvider",
    true,
    "warn",
    "live NPC cognition enabled; per-minute request budget applies (ANIMUS_REQUESTS_PER_MINUTE)",
  );
}
