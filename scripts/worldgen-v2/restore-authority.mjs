import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const worldDir = path.join(ROOT, "assets/terrain/worlds/valley-v2");
const candidate = path.resolve(process.argv[2] ?? path.join(worldDir, "illustrated-openai-v2.png"));
const output = path.resolve(process.argv[3] ?? candidate.replace(/\.png$/i, "-authority.png"));
const bundle = JSON.parse(fs.readFileSync(path.join(worldDir, "world-bundle-v2.json"), "utf8"));
const dimensions = execFileSync("magick", ["identify", "-format", "%wx%h", candidate], { encoding: "utf8" }).trim();
const [width, height] = dimensions.split("x").map(Number);

function writeMask(name, field, curve = (value) => value) {
  const bytes = Buffer.alloc(64 * 64);
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    bytes[y * 64 + x] = Math.round(Math.max(0, Math.min(1, curve(field[y][x]))) * 255);
  }
  const source = path.join(worldDir, `${name}-authority-64.pgm`);
  const target = path.join(worldDir, `${name}-authority-mask.png`);
  fs.writeFileSync(source, Buffer.concat([Buffer.from("P5\n64 64\n255\n"), bytes]));
  execFileSync("magick", [source, "-filter", "Cubic", "-resize", `${width}x${height}!`, "-blur", "0x0.7", target]);
  fs.unlinkSync(source);
  return target;
}

const waterMask = writeMask("water", bundle.fields.water, (value) => Math.max(0, (value - 0.08) / 0.92));
const runtimeWaterMask = path.join(worldDir, "water-authority-gameplay-v1.png");
const waterLayer = path.join(worldDir, ".water-layer.png");

execFileSync("magick", [candidate, "-fill", "#123f49", "-colorize", "72%", "-modulate", "88,82,100", waterLayer]);
execFileSync("magick", [candidate, waterLayer, waterMask, "-compose", "over", "-composite", output]);
// Runtime shimmer consumes the same authority shape as the restored art.
// Copying luminance into alpha makes Canvas/WebGL clipping exact and keeps
// this mask reproducible whenever the accepted world painting is rebuilt.
execFileSync("magick", [waterMask, "-resize", "2048x2048!", "-alpha", "copy", runtimeWaterMask]);
fs.unlinkSync(waterLayer);
console.log(JSON.stringify({
  candidate: path.relative(ROOT, candidate),
  output: path.relative(ROOT, output),
  waterMask: path.relative(ROOT, waterMask),
  runtimeWaterMask: path.relative(ROOT, runtimeWaterMask),
}, null, 2));
