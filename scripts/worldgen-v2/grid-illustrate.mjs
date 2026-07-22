import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const worldDir = path.join(ROOT, "assets/terrain/worlds/valley-v2");
const model = process.argv[2] ?? "FLUX.2 Klein 4B FP8";
const key = process.env.GRID_API_KEY;
if (!key) throw new Error("GRID_API_KEY is required");

const sourcePath = path.join(worldDir, "gameplay-master.png");
const source = fs.readFileSync(sourcePath).toString("base64");
const prompt = [
  "Transform this exact Duskfell structural terrain control into a richly illustrated dark medieval RPG world surface.",
  "Preserve geography pixel-for-pixel: same river centerline and width, same lake boundary, same valley walls, same mountain massing, same snowline, no added or removed water, no moved ridges.",
  "Orthographic top-down terrain master for a military plan-oblique game, no horizon.",
  "Warm dark loam and compacted earth, restrained olive meadow and moss, embedded slate stones, gravel banks, stratified gray mountain rock, natural alpine snow, deep blue-green water.",
  "Hand-painted high-fidelity late-1990s pre-rendered dark-fantasy RPG language upgraded to HD; broad quiet regions with dense microtexture only up close.",
  "Surface painting only: no characters, buildings, trees, bushes, text, UI, border, tile grid, mirrored patterns, fake paths, or cast shadows from absent objects.",
].join(" ");

const body = {
  model,
  prompt,
  image: `data:image/png;base64,${source}`,
  size: "1536x1536",
  output_format: "png",
  response_format: "b64_json",
  seed: 74291,
};
if (model === "FLUX.2 Klein 4B FP8") {
  body.strength = 0.68;
  body.steps = 6;
}

const response = await fetch("https://api.aipowergrid.io/v1/images/generations", {
  method: "POST",
  headers: { apikey: key, "content-type": "application/json" },
  body: JSON.stringify(body),
});
const payload = await response.json();
if (!response.ok) throw new Error(`Grid ${response.status}: ${JSON.stringify(payload)}`);
const slug = model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const outputPath = path.join(worldDir, `illustrated-${slug}-v1.png`);
fs.writeFileSync(outputPath, Buffer.from(payload.data[0].b64_json, "base64"));
delete payload.data[0].b64_json;
fs.writeFileSync(path.join(worldDir, `illustrated-${slug}-v1.json`), `${JSON.stringify({ request: { ...body, image: "gameplay-master.png" }, response: payload }, null, 2)}\n`);
console.log(JSON.stringify({ output: path.relative(ROOT, outputPath), model, grid: payload.grid }, null, 2));
