// Duskfell 3D terrain spike: proves the Three.js render-layer direction.
// Loads the real world bundle, builds a displaced heightmap mesh, bakes a
// slope-aware albedo from the actual painterly ground plates (cliff paint
// lands on steep faces), lights it with a shadow-casting sun, and scatters
// painterly billboard trees that occlude and shadow correctly for free.
import * as THREE from "/vendor/three.module.js";

const params = new URLSearchParams(location.search);
const FOCUS_X = Number(params.get("tx") ?? 91);
const FOCUS_Y = Number(params.get("ty") ?? 14);
const SPAN = Number(params.get("span") ?? 46); // tiles visible across
const HSCALE = Number(params.get("h") ?? 0.75); // tiles of rise per height step

const bundle = await (await fetch("/assets/terrain/world-bundle.json", { cache: "no-store" })).json();
const cols = bundle.cols, rows = bundle.rows;
const H = bundle.heights; // (rows+1) x (cols+1)
const mats = ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"];
const materialAt = (x, y) =>
  x < 0 || y < 0 || x >= cols || y >= rows ? "rock" : mats[parseInt(bundle.materialGrid[y][x], 36)] ?? "grass";
const vegAt = (x, y) => bundle.vegetation?.[y]?.[x] ?? 0;
const rawH = (x, y) => H[Math.max(0, Math.min(rows, y))][Math.max(0, Math.min(cols, x))];
// the terrace steps were a workaround for 2D staircase walkability art —
// real geometry wants real slopes, so smooth the height field for render
const smooth = [];
for (let y = 0; y <= rows; y += 1) {
  smooth.push(new Float32Array(cols + 1));
  for (let x = 0; x <= cols; x += 1) {
    let sum = 0, wsum = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const w = 1 / (1 + dx * dx + dy * dy);
        sum += rawH(x + dx, y + dy) * w;
        wsum += w;
      }
    }
    smooth[y][x] = sum / wsum;
  }
}
// pure smooth heights: the terrace steps are a 2D-era artifact — smooth
// slopes render as one continuous mountainside with no panel seams
const hAt = (x, y) => smooth[Math.max(0, Math.min(rows, y))][Math.max(0, Math.min(cols, x))];

const hash01 = (a, b) => {
  let v = (Math.imul(a + 37, 374761393) ^ Math.imul(b + 91, 668265263)) >>> 0;
  return ((Math.imul(v ^ (v >>> 13), 1274126177) >>> 0) % 1000) / 1000;
};

async function loadPainting(name) {
  const blob = await (await fetch(`/assets/terrain/ground-patches/${name}`)).blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return c;
}
const [meadow, heath, scree, cliffRaw] = await Promise.all(
  ["biome-meadow.webp", "biome-heath.webp", "biome-scree.webp", "biome-cliff.webp"].map(loadPainting),
);

// the cliff plate has dark fissure lines painted into it; at terrain scale
// they read as black grid wires — inpaint them with the surrounding rock
// tone (heavily blurred copy) so they become soft shading instead
function healCracks(src) {
  const w = src.width, h = src.height;
  const blur = document.createElement("canvas");
  blur.width = w; blur.height = h;
  const bctx = blur.getContext("2d");
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(src, 0, 0, w / 12, h / 12);
  bctx.drawImage(blur, 0, 0, w / 12, h / 12, 0, 0, w, h);
  const bdata = bctx.getImageData(0, 0, w, h).data;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d");
  octx.drawImage(src, 0, 0);
  const img = octx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15;
    if (lum < 88) {
      // dark crack: mostly replace with local rock tone, keep a whisper
      const k = Math.max(0, lum / 88) * 0.35 + 0.08;
      d[i] = d[i] * k + bdata[i] * (1 - k) * 0.92;
      d[i + 1] = d[i + 1] * k + bdata[i + 1] * (1 - k) * 0.92;
      d[i + 2] = d[i + 2] * k + bdata[i + 2] * (1 - k) * 0.92;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}
const cliff = healCracks(cliffRaw);

// ---- albedo bake: layered like the game compositor, soft boundaries ----
// each material class paints through a mask rendered at 1px/tile and scaled
// up with bilinear smoothing, so regions blend over ~a tile instead of
// meeting at hard square edges; mirrored mapping never wrap-jumps
const TPX = 24; // albedo px per tile
const albedoCanvas = document.createElement("canvas");
albedoCanvas.width = cols * TPX; albedoCanvas.height = rows * TPX;
const actx = albedoCanvas.getContext("2d");

function paintLayer(src, maskFn, tint) {
  const mask = document.createElement("canvas");
  mask.width = cols; mask.height = rows;
  const mctx = mask.getContext("2d");
  const img = mctx.createImageData(cols, rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      img.data[(y * cols + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, maskFn(x, y))));
    }
  }
  mctx.putImageData(img, 0, 0);
  const layer = document.createElement("canvas");
  layer.width = albedoCanvas.width; layer.height = albedoCanvas.height;
  const lctx = layer.getContext("2d");
  // one continuous mirror-tiled sheet — per-tile crops leave dark bilinear
  // bleed at every crop border, which reads as a black grid
  const bw = src.width * (TPX / 48);
  const bh = src.height * (TPX / 48);
  lctx.imageSmoothingEnabled = true;
  for (let by = 0; by * bh < layer.height; by += 1) {
    for (let bx = 0; bx * bw < layer.width; bx += 1) {
      lctx.save();
      lctx.translate(bx * bw + (bx % 2 ? bw : 0), by * bh + (by % 2 ? bh : 0));
      lctx.scale(bx % 2 ? -1 : 1, by % 2 ? -1 : 1);
      lctx.drawImage(src, 0, 0, bw, bh);
      lctx.restore();
    }
  }
  if (tint) {
    lctx.globalCompositeOperation = "multiply";
    lctx.fillStyle = tint;
    lctx.fillRect(0, 0, layer.width, layer.height);
  }
  lctx.globalCompositeOperation = "destination-in";
  lctx.imageSmoothingEnabled = true;
  lctx.drawImage(mask, 0, 0, layer.width, layer.height);
  actx.drawImage(layer, 0, 0);
}
const slopeAt = (x, y) => {
  const c = [hAt(x, y), hAt(x + 1, y), hAt(x, y + 1), hAt(x + 1, y + 1)];
  return Math.max(...c) - Math.min(...c);
};
// base coat: meadow everywhere
paintLayer(meadow, () => 1, null);
// dirt & shore
paintLayer(heath, (x, y) => {
  const m = materialAt(x, y);
  return m === "dirt" || m === "shore" || m === "settlement" ? 1 : 0;
}, null);
// rock body, slate-toned
paintLayer(scree, (x, y) => {
  const m = materialAt(x, y);
  return m === "rock" || m === "stone" ? 1 : 0;
}, "rgba(140, 143, 150, 0.75)");
// cliff paint on genuinely steep ground, wherever it is
paintLayer(cliff, (x, y) => Math.max(0, Math.min(1, (slopeAt(x, y) - 0.45) / 0.2)), "rgba(168, 170, 178, 0.85)");
// water: dark pool tint with a soft shoreline
paintLayer(meadow, (x, y) => (materialAt(x, y) === "water" ? 1 : 0), "rgba(30, 58, 66, 0.92)");

const albedo = new THREE.CanvasTexture(albedoCanvas);
albedo.colorSpace = THREE.SRGBColorSpace;
albedo.anisotropy = 8;

// ---- scene ----
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("gl"), antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
const scene = new THREE.Scene();
{
  const sky = document.createElement("canvas");
  sky.width = 4; sky.height = 256;
  const g = sky.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#20282e");
  grad.addColorStop(0.55, "#3a4438");
  grad.addColorStop(1, "#141a14");
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
}
scene.fog = new THREE.Fog(0x39443a, SPAN * 2.4, SPAN * 7.0);

// terrain: one vertex per world vertex, Y up
const geo = new THREE.PlaneGeometry(cols, rows, cols, rows);
geo.rotateX(-Math.PI / 2); // XZ plane, +Z = south (tile y)
const pos = geo.attributes.position;
for (let vy = 0; vy <= rows; vy += 1) {
  for (let vx = 0; vx <= cols; vx += 1) {
    const i = vy * (cols + 1) + vx;
    pos.setX(i, vx);
    pos.setZ(i, vy);
    pos.setY(i, Math.max(-0.6, hAt(vx, vy)) * HSCALE);
  }
}
geo.computeVertexNormals();
// triplanar rock on steep ground: the baked albedo is projected top-down,
// so steep curvy faces stretch it into smears that read as gaps — sample
// the rock texture from the side on those faces instead
const rockTex = new THREE.CanvasTexture(cliff);
rockTex.colorSpace = THREE.SRGBColorSpace;
rockTex.wrapS = rockTex.wrapT = THREE.MirroredRepeatWrapping;
rockTex.anisotropy = 8;
const terrainMat = new THREE.MeshStandardMaterial({ map: albedo, roughness: 0.95, metalness: 0 });
terrainMat.onBeforeCompile = (shader) => {
  shader.uniforms.uRock = { value: rockTex };
  shader.uniforms.uRockScale = { value: 0.16 };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;")
    .replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);",
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      "#include <common>\nuniform sampler2D uRock;\nuniform float uRockScale;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;",
    )
    .replace(
      "#include <map_fragment>",
      `#include <map_fragment>
{
  vec3 wn = normalize(vWNormal);
  float steep = 1.0 - smoothstep(0.62, 0.82, wn.y);
  if (steep > 0.001) {
    vec3 an = abs(wn);
    float wx = an.x / max(0.0001, an.x + an.z);
    vec4 rockX = texture2D(uRock, vWPos.zy * uRockScale);
    vec4 rockZ = texture2D(uRock, vWPos.xy * uRockScale);
    vec3 rock = mix(rockZ.rgb, rockX.rgb, wx) * vec3(0.82, 0.83, 0.87);
    diffuseColor.rgb = mix(diffuseColor.rgb, rock, steep);
  }
}`,
    );
};
const terrain = new THREE.Mesh(geo, terrainMat);
terrain.receiveShadow = true;
terrain.castShadow = true;
scene.add(terrain);

// diorama pedestal: the world edge reads as a deliberate cut, not a void
const pedestal = new THREE.Mesh(
  new THREE.BoxGeometry(cols, 6, rows),
  new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 1 }),
);
pedestal.position.set(cols / 2, -3 - 0.6 * HSCALE, rows / 2);
scene.add(pedestal);

// water plane at sea level
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(cols, rows),
  new THREE.MeshStandardMaterial({ color: 0x39606c, transparent: true, opacity: 0.82, roughness: 0.25 }),
);
water.rotation.x = -Math.PI / 2;
water.position.set(cols / 2, -0.28 * HSCALE, rows / 2);
scene.add(water);

// painterly billboard tree texture (procedural for the spike)
function treeTexture() {
  const c = document.createElement("canvas");
  c.width = 96; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#3d2c1c";
  g.fillRect(44, 78, 8, 44);
  for (let i = 0; i < 90; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 34;
    const px = 48 + Math.cos(a) * r * 0.9;
    const py = 48 + Math.sin(a) * r;
    const s = 7 + Math.random() * 9;
    const tone = 42 + Math.random() * 40;
    g.fillStyle = `rgba(${tone * 0.55}, ${tone}, ${tone * 0.5}, 0.85)`;
    g.beginPath(); g.arc(px, py, s, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const treeMat = new THREE.MeshStandardMaterial({
  map: treeTexture(), transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9,
  emissive: 0x1c2a18, emissiveIntensity: 0.8,
});
const treeGeo = new THREE.PlaneGeometry(1.6, 2.2);
const trees = new THREE.Group();
for (let y = 0; y < rows; y += 1) {
  for (let x = 0; x < cols; x += 1) {
    if (materialAt(x, y) !== "grass" || vegAt(x, y) < 0.5 || hash01(x + 3, y + 11) < 0.72) continue;
    const t = new THREE.Mesh(treeGeo, treeMat);
    const wx = x + 0.2 + hash01(x, y) * 0.6;
    const wz = y + 0.2 + hash01(x + 9, y) * 0.6;
    const h = (hAt(Math.round(wx), Math.round(wz)) + 0.05) * HSCALE;
    const s = 0.8 + hash01(x + 5, y + 5) * 0.7;
    t.scale.setScalar(s);
    t.position.set(wx, h + 1.1 * s, wz);
    t.castShadow = true;
    trees.add(t);
  }
}
scene.add(trees);

// sun + sky light
const sun = new THREE.DirectionalLight(0xfff2d8, 3.4);
sun.position.set(FOCUS_X - 26, 34, FOCUS_Y + 18);
sun.target.position.set(FOCUS_X, 0, FOCUS_Y);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
const sc = sun.shadow.camera;
sc.left = -SPAN; sc.right = SPAN; sc.top = SPAN; sc.bottom = -SPAN; sc.far = 160;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbdd0e8, 0x2c3524, 0.9));

// fixed oblique camera, UO-ish angle from the south-east
const aspect = innerWidth / innerHeight;
const cam = new THREE.OrthographicCamera(-SPAN / 2 * aspect, SPAN / 2 * aspect, SPAN / 2, -SPAN / 2, 0.1, 400);
const target = new THREE.Vector3(FOCUS_X, hAt(FOCUS_X, FOCUS_Y) * HSCALE, FOCUS_Y);
cam.position.copy(target).add(new THREE.Vector3(26, 24, 44));
cam.lookAt(target);

// billboard the trees toward the fixed camera
const camDir = new THREE.Vector3().subVectors(cam.position, target);
const yaw = Math.atan2(camDir.x, camDir.z);
trees.children.forEach((t) => { t.rotation.y = yaw; });

renderer.render(scene, cam);
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  renderer.render(scene, cam);
});
document.title = "Duskfell 3D spike — ready";
