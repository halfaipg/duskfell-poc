import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://api.aipowergrid.io";

const args = parseArgs(process.argv.slice(2));
const apiKey = process.env.GRID_API_KEY;
if (!apiKey) throw new Error("GRID_API_KEY is required");

const inputPath = path.resolve(requiredArg(args, "input"));
const outputPath = path.resolve(requiredArg(args, "output"));
const prompt = requiredArg(args, "prompt");
const model = args.model ?? "FLUX.2 Klein 4B FP8";
const style = args.style ?? null;
const seed = Number.parseInt(args.seed ?? "7341", 10);
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("--seed must be a non-negative integer");
const strength = args.strength == null ? null : Number.parseFloat(args.strength);
if (strength != null && (!Number.isFinite(strength) || strength < 0 || strength > 1)) {
  throw new Error("--strength must be a number between 0 and 1");
}
const steps = args.steps == null ? null : Number.parseInt(args.steps, 10);
if (steps != null && (!Number.isSafeInteger(steps) || steps < 1 || steps > 100)) {
  throw new Error("--steps must be an integer between 1 and 100");
}

const sourceBytes = await readFile(inputPath);
const sourceMime = mimeTypeFor(inputPath);
const response = await fetch(`${process.env.GRID_BASE_URL ?? DEFAULT_BASE_URL}/v1/images/generations`, {
  method: "POST",
  headers: {
    apikey: apiKey,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    ...(style ? { style } : {}),
    prompt,
    negative_prompt:
      "geometry drift, moved river, changed shoreline, new roads, new buildings, new characters, horizon, camera tilt, mirrored composition, symmetric composition, tile grid, text, logo, watermark",
    image: `data:${sourceMime};base64,${sourceBytes.toString("base64")}`,
    response_format: "b64_json",
    output_format: "png",
    size: "1024x1024",
    seed,
    ...(strength != null ? { strength } : {}),
    ...(steps != null ? { steps } : {}),
    n: 1,
  }),
});
const raw = await response.text();
if (!response.ok) throw new Error(`Grid image generation failed (${response.status}): ${raw.slice(0, 1000)}`);
const result = JSON.parse(raw);
const imageData = result.data?.[0];
if (!imageData?.b64_json) throw new Error("Grid response did not include data[0].b64_json");
const outputBytes = Buffer.from(imageData.b64_json, "base64");
await writeFile(outputPath, outputBytes);

const metadataPath = outputPath.replace(/\.[^.]+$/, ".json");
await writeFile(
  metadataPath,
  `${JSON.stringify(
    {
      schemaVersion: "duskfell-grid-img2img-proof-v1",
      input: path.basename(inputPath),
      inputSha256: sha256Hex(sourceBytes),
      output: path.basename(outputPath),
      outputSha256: sha256Hex(outputBytes),
      model: result.grid?.model ?? model,
      style,
      worker: result.grid?.worker ?? null,
      generationSeconds: result.grid?.gen_time ?? null,
      seed: imageData.seed ?? seed,
      strength,
      steps,
      prompt,
      revisedPrompt: imageData.revised_prompt ?? null,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    output: outputPath,
    metadata: metadataPath,
    model: result.grid?.model ?? model,
    style,
    seed: imageData.seed ?? seed,
    strength,
    steps,
  }),
);

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requiredArg(parsed, key) {
  const value = parsed[key];
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function mimeTypeFor(filePath) {
  if (path.extname(filePath).toLowerCase() === ".png") return "image/png";
  if (path.extname(filePath).toLowerCase() === ".webp") return "image/webp";
  throw new Error("--input must be a PNG or WebP image");
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
