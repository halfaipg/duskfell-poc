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
// keep a share of the raw steps back: pure smoothing turns mountains into
// gentle hills — the blend gives natural slopes with rocky ledge character
const hAt = (x, y) => {
  const cy = Math.max(0, Math.min(rows, y));
  const cx = Math.max(0, Math.min(cols, x));
  return smooth[cy][cx] + (rawH(cx, cy) - smooth[cy][cx]) * 0.3;
};

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
const [meadow, heath, scree, cliff] = await Promise.all(
  ["biome-meadow.webp", "biome-heath.webp", "biome-scree.webp", "biome-cliff.webp"].map(loadPainting),
);

// ---- albedo bake: per-tile crops from the real paintings, slope-aware ----
const TPX = 24; // albedo px per tile
const albedoCanvas = document.createElement("canvas");
albedoCanvas.width = cols * TPX; albedoCanvas.height = rows * TPX;
const actx = albedoCanvas.getContext("2d");
for (let y = 0; y < rows; y += 1) {
  for (let x = 0; x < cols; x += 1) {
    const m = materialAt(x, y);
    const corner = [hAt(x, y), hAt(x + 1, y), hAt(x, y + 1), hAt(x + 1, y + 1)];
    const slope = Math.max(...corner) - Math.min(...corner);
    let src = meadow;
    if (m === "water") src = null;
    else if (slope >= 1.2 || (m === "rock" && slope >= 0.8)) src = cliff;
    else if (m === "rock" || m === "stone") src = scree;
    else if (m === "dirt" || m === "shore") src = heath;
    if (src) {
      // continuous mapping: adjacent tiles sample adjacent painting texels,
      // so same-material regions read as one surface, not patchwork squares
      const su = (x * 48) % Math.max(1, src.width - 48);
      const sv = (y * 48) % Math.max(1, src.height - 48);
      actx.drawImage(src, su, sv, 48, 48, x * TPX, y * TPX, TPX, TPX);
      if (m === "rock" || m === "stone") {
        actx.globalCompositeOperation = "multiply";
        actx.fillStyle = "rgba(140, 143, 150, 0.35)";
        actx.fillRect(x * TPX, y * TPX, TPX, TPX);
        actx.globalCompositeOperation = "source-over";
      }
    } else {
      actx.fillStyle = "#2e4a52";
      actx.fillRect(x * TPX, y * TPX, TPX, TPX);
    }
  }
}
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
scene.background = new THREE.Color(0x10140f);
scene.fog = new THREE.Fog(0x2a3328, SPAN * 1.6, SPAN * 4.5);

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
const terrain = new THREE.Mesh(
  geo,
  new THREE.MeshStandardMaterial({ map: albedo, roughness: 0.95, metalness: 0 }),
);
terrain.receiveShadow = true;
terrain.castShadow = true;
scene.add(terrain);

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
