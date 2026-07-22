import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const terrainRoot = "assets/terrain";
const worldBytes = readFileSync("server/data/world.json");
const world = JSON.parse(worldBytes);
const manifest = JSON.parse(readFileSync(`${terrainRoot}/manifest.json`, "utf8"));
const metadataPath = `${terrainRoot}/${manifest.worldMap.provenance}`;
const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
const mapPath = `${terrainRoot}/${manifest.worldMap.image}`;
const maskPath = `${terrainRoot}/${metadata.authoritativeTrails.mask}`;
const sourcePath = `${terrainRoot}/${metadata.pathlessBase.image}`;
const controlPath = `${terrainRoot}/${metadata.pathlessBase.control}`;
const width = metadata.dimensions.width;
const height = metadata.dimensions.height;

test("runtime map pins its pathless base, world, route set, and baked mask", () => {
  assert.equal(metadata.schemaVersion, "duskfell-runtime-world-map-v2");
  assert.equal(sha256(readFileSync(mapPath)), manifest.worldMap.sha256);
  assert.equal(sha256(readFileSync(mapPath)), metadata.outputSha256);
  assert.equal(sha256(readFileSync(maskPath)), metadata.authoritativeTrails.maskSha256);
  assert.equal(sha256(readFileSync(sourcePath)), metadata.pathlessBase.sha256);
  assert.equal(sha256(readFileSync(controlPath)), metadata.pathlessBase.controlSha256);
  assert.equal(sha256(worldBytes), metadata.world.sha256);
  assert.equal(
    sha256(Buffer.from(JSON.stringify(world.map.terrain.trails))),
    metadata.authoritativeTrails.sha256,
  );
  assert.equal(metadata.authoritativeTrails.count, world.map.terrain.trails.length);
  assert.equal(width, world.map.terrain.materialGrid[0].length * manifest.worldMap.tilePixelWidth);
  assert.equal(height, world.map.terrain.materialGrid.length * manifest.worldMap.tilePixelHeight);
});

test("painted geography clears authoritative semantic drift gates", () => {
  const alignment = metadata.pathlessBase.semanticAlignment;
  assert.ok(alignment.agreement >= 0.9, "painted map must preserve overall material geography");
  assert.ok(alignment.rockRecall >= 0.96, "painted map must preserve mountain massifs and passes");
  assert.ok(alignment.waterRecall >= 0.95, "painted map must preserve authoritative water");
  assert.equal(alignment.sampledTiles, world.map.terrain.materialGrid.length * world.map.terrain.materialGrid[0].length);
});

test("every route lands on the cartographic mask and blocked terrain stays clean", () => {
  const pixels = execFileSync(
    "magick",
    [maskPath, "-alpha", "off", "-colorspace", "gray", "-depth", "8", "gray:-"],
    { maxBuffer: width * height + 1024 },
  );
  assert.equal(pixels.length, width * height);
  const tilePixels = manifest.worldMap.tilePixelWidth;
  for (const trail of world.map.terrain.trails) {
    for (const point of trail.points) {
      const centerX = Math.round(point.x * tilePixels);
      const centerY = Math.round(point.y * tilePixels);
      let strongest = 0;
      for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
        for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
          const x = Math.max(0, Math.min(width - 1, centerX + offsetX));
          const y = Math.max(0, Math.min(height - 1, centerY + offsetY));
          strongest = Math.max(strongest, pixels[y * width + x]);
        }
      }
      assert.ok(strongest >= 180, `${trail.id} control point must land on its baked mask`);
    }
  }

  const terrain = world.map.terrain;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * width + x] === 0) continue;
      const tileX = Math.floor(x / tilePixels);
      const tileY = Math.floor(y / tilePixels);
      const materialIndex = Number.parseInt(terrain.materialGrid[tileY][tileX], 36);
      const material = terrain.materials[materialIndex];
      assert.notEqual(material, "water", "trail mask must not paint water");
      assert.notEqual(material, "rock", "trail mask must not paint massif rock");
    }
  }
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
