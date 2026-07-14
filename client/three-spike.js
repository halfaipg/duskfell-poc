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
async function loadMaterial(name) {
  const blob = await (await fetch(`/assets/terrain/materials/${name}`)).blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return c;
}
const [meadow, heatherTex, oakTex, cliffRaw, fellTex] = await Promise.all([
  loadMaterial("meadow-sward.png"),
  loadMaterial("heather-mat.png"),
  loadMaterial("leaf-litter-loam.png"),
  loadMaterial("granite-cliff.png"),
  loadMaterial("granite-fell.png"),
]);

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
const cliff = cliffRaw;

// ---- splat mask bake: low-res weights only — textures sample at their
// own real-world scale in the shader, so proportions stay true ----
const heathW = bundle.heathWeights ?? null;
const slopeAt = (x, y) => {
  const c = [hAt(x, y), hAt(x + 1, y), hAt(x, y + 1), hAt(x + 1, y + 1)];
  return Math.max(...c) - Math.min(...c);
};
const MPX = 4; // mask px per tile, bilinear-smoothed by sampling
const maskCanvas = document.createElement("canvas");
maskCanvas.width = cols * MPX; maskCanvas.height = rows * MPX;
const mctx = maskCanvas.getContext("2d");
const maskImg = mctx.createImageData(maskCanvas.width, maskCanvas.height);
for (let py = 0; py < maskCanvas.height; py += 1) {
  for (let px = 0; px < maskCanvas.width; px += 1) {
    const x = Math.floor(px / MPX), y = Math.floor(py / MPX);
    const m = materialAt(x, y);
    const o = (py * maskCanvas.width + px) * 4;
    maskImg.data[o] = Math.round(255 * Math.max(0, Math.min(1, (((heathW?.[y]?.[x] ?? 0)) - 0.5) / 0.22)));
    maskImg.data[o + 1] = (m === "dirt" || m === "shore" || m === "settlement") ? 255 : 0;
    maskImg.data[o + 2] = (m === "rock" || m === "stone") ? 255 : 0;
    maskImg.data[o + 3] = m === "water" ? 255 : 0;
  }
}
mctx.putImageData(maskImg, 0, 0);
const albedo = new THREE.CanvasTexture(maskCanvas);

// ---- scene ----
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("gl"), antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
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
// world-scale material samplers: repeat distance in tiles is chosen per
// material so a leaf stays leaf-sized and granite grain stays grain-sized
function matTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const rockTex = matTex(cliff);
const meadowT = matTex(meadow);
const heatherT = matTex(heatherTex);
const litterT = matTex(oakTex);
const fellT = matTex(fellTex);
const terrainMat = new THREE.MeshStandardMaterial({ map: albedo, roughness: 0.95, metalness: 0 });
terrainMat.onBeforeCompile = (shader) => {
  shader.uniforms.uRock = { value: rockTex };
  shader.uniforms.uRockScale = { value: 0.24 };
  shader.uniforms.uMeadow = { value: meadowT };
  shader.uniforms.uHeather = { value: heatherT };
  shader.uniforms.uLitter = { value: litterT };
  shader.uniforms.uFell = { value: fellT };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;")
    .replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);",
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      "#include <common>\nuniform sampler2D uRock;\nuniform float uRockScale;\nuniform sampler2D uMeadow;\nuniform sampler2D uHeather;\nuniform sampler2D uLitter;\nuniform sampler2D uFell;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;",
    )
    .replace(
      "#include <map_fragment>",
      `{
  vec4 splat = texture2D(map, vMapUv); // R heather, G litter, B fell, A water
  vec2 wuv = vWPos.xz;
  // anti-tiling: blend two incommensurate scales, then modulate with a very
  // low-frequency macro sample so no repeat survives at any distance
  #define DUAL(tex, s) mix(texture2D(tex, wuv / (s)).rgb, texture2D(tex, wuv / ((s) * 3.73) + vec2(0.37, 0.71)).rgb, 0.42)
  // soil shows through beneath the instanced grass — blades carry the green
  vec3 col = mix(DUAL(uMeadow, 3.2), DUAL(uLitter, 2.4) * vec3(0.86, 0.8, 0.74), 0.5);
  col = mix(col, DUAL(uHeather, 4.0), splat.r);
  col = mix(col, DUAL(uLitter, 2.4), splat.g);
  col = mix(col, DUAL(uFell, 5.5) * vec3(0.92, 0.93, 0.96), smoothstep(0.3, 0.62, splat.b));
  float macro = texture2D(uMeadow, wuv / 41.0).g;
  col *= 0.82 + macro * 0.36;
  vec3 wn = normalize(vWNormal);
  float steep = 1.0 - smoothstep(0.6, 0.8, wn.y);
  if (steep > 0.001) {
    vec3 an = abs(wn);
    float wx = an.x / max(0.0001, an.x + an.z);
    vec3 rockX = texture2D(uRock, vWPos.zy * uRockScale).rgb;
    vec3 rockZ = texture2D(uRock, vWPos.xy * uRockScale).rgb;
    col = mix(col, mix(rockZ, rockX, wx) * vec3(0.85, 0.86, 0.9), steep);
  }
  // water: darken toward peaty pool tone with a soft shoreline
  col = mix(col, col * vec3(0.2, 0.32, 0.34) + vec3(0.02, 0.08, 0.1), splat.a);
  diffuseColor.rgb = col;
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

// bilinear height for smooth object placement
function hBil(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const h00 = hAt(x0, z0), h10 = hAt(x0 + 1, z0), h01 = hAt(x0, z0 + 1), h11 = hAt(x0 + 1, z0 + 1);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

// natural field layer: photoreal grass tuft cards generated by the art
// pipeline (mixed green/straw blades, seed heads, wildflowers) keyed to
// alpha and instanced with wind sway
const GRASS_RADIUS = 46;
const grassUniforms = { uTime: { value: 0 } };
async function loadCard(name) {
  const blob = await (await fetch(`/assets/terrain/materials/${name}`)).blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: bmp.height / bmp.width };
}
function tuftMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: grassUniforms.uTime ? grassUniforms : grassUniforms, uMap: { value: tex } },
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUvv;
      varying float vTint;
      void main() {
        vUvv = uv;
        float phase = fract(sin(dot(vec2(instanceMatrix[3][0], instanceMatrix[3][2]), vec2(127.1, 311.7))) * 43758.5453);
        vTint = phase;
        vec4 wpos = instanceMatrix * vec4(position, 1.0);
        float bend = uv.y * uv.y;
        float sway = sin(uTime * 1.6 + wpos.x * 0.38 + wpos.z * 0.5 + phase * 6.28318) * 0.07
                   + sin(uTime * 2.9 + phase * 11.0) * 0.02;
        wpos.x += sway * bend;
        wpos.z += sway * 0.6 * bend;
        gl_Position = projectionMatrix * viewMatrix * wpos;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec2 vUvv;
      varying float vTint;
      void main() {
        vec4 tex = texture2D(uMap, vUvv);
        if (tex.a < 0.4) discard;
        vec3 col = tex.rgb * (1.2 + vUvv.y * 0.45) * (0.92 + vTint * 0.16);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
function swardTexture(seedBase, straw) {
  const c = document.createElement("canvas");
  c.width = 160; c.height = 110;
  const g = c.getContext("2d");
  let rs = seedBase;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  g.lineCap = "round";
  for (let i = 0; i < 44; i += 1) {
    const bx = 10 + rnd() * 140;
    const lean = (rnd() - 0.5) * 44;
    const h = 40 + rnd() * 56;
    const grad = g.createLinearGradient(bx, 110, bx + lean, 110 - h);
    grad.addColorStop(0, "rgba(58, 78, 34, 0.95)");
    const greens = [
      "rgba(148, 178, 82, 0.95)", "rgba(128, 164, 72, 0.95)",
      "rgba(164, 186, 90, 0.92)", "rgba(118, 152, 66, 0.95)",
    ];
    const straws = ["rgba(196, 180, 118, 0.9)", "rgba(178, 164, 104, 0.9)"];
    const useStraw = rnd() < straw;
    grad.addColorStop(1, useStraw ? straws[i % 2] : greens[i % 4]);
    g.strokeStyle = grad;
    g.lineWidth = 2.0 + rnd() * 1.4;
    g.beginPath();
    g.moveTo(bx, 110);
    g.quadraticCurveTo(bx + lean * 0.35, 110 - h * 0.62, bx + lean, 110 - h);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
{
  const cards = await Promise.all([
    loadCard("tuft-green.png"),
    loadCard("tuft-flower.png"),
    loadCard("tuft-dry.png"),
  ]);
  const variants = cards.map((c) => ({
    geo: (() => {
      const g = new THREE.PlaneGeometry(0.5, 0.5 * c.aspect);
      g.translate(0, 0.25 * c.aspect, 0);
      return g;
    })(),
    mat: tuftMaterial(c.tex),
    list: [],
  }));
  const swardGeo = new THREE.PlaneGeometry(0.62, 0.3);
  swardGeo.translate(0, 0.15, 0);
  const swards = [swardTexture(424241, 0.18), swardTexture(90909, 0.3)].map((tex) => ({
    geo: swardGeo, mat: tuftMaterial(tex), list: [],
  }));
  variants.push(...swards);
  const x0 = Math.max(1, FOCUS_X - GRASS_RADIUS), x1 = Math.min(cols - 2, FOCUS_X + GRASS_RADIUS);
  const y0 = Math.max(1, FOCUS_Y - GRASS_RADIUS), y1 = Math.min(rows - 2, FOCUS_Y + GRASS_RADIUS);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      const m = materialAt(tx, ty);
      if (m !== "grass" && m !== "dirt" && m !== "field") continue;
      const veg = Math.max(vegAt(tx, ty), m === "grass" ? 0.55 : 0.25);
      const c = [hAt(tx, ty), hAt(tx + 1, ty), hAt(tx, ty + 1), hAt(tx + 1, ty + 1)];
      if (Math.max(...c) - Math.min(...c) > 1.3) continue;
      const heathHere = heathW?.[ty]?.[tx] ?? 0;
      const n = Math.round(12 + veg * 22);
      for (let i = 0; i < n; i += 1) {
        const wx = tx + hash01(tx * 31 + i, ty * 17 + i);
        const wz = ty + hash01(tx * 13 + i * 7, ty * 41 + i);
        const roll = hash01(tx * 7 + i, ty * 23);
        // continuous sward carries the field; photoreal clumps + flowers
        // are sparse accents; dry tussocks own the heathy ground
        let v;
        if (heathHere > 0.55) v = 4;
        else if (roll < 0.02) v = 1;
        else if (roll < 0.045) v = 0;
        else v = roll < 0.55 ? 3 : 4;
        variants[v].list.push([wx, wz, i, v <= 2 ? 1.25 : 1.0]);
      }
    }
  }
  const dummy = new THREE.Object3D();
  for (const variant of variants) {
    const mesh = new THREE.InstancedMesh(variant.geo, variant.mat, variant.list.length);
    for (let i = 0; i < variant.list.length; i += 1) {
      const [wx, wz, k, boost] = variant.list[i];
      dummy.position.set(wx, hBil(wx, wz) * HSCALE - 0.015, wz);
      dummy.rotation.y = hash01(i, 7) * Math.PI * 2;
      const sc = (0.75 + hash01(i, 13 + k) * 0.65) * (boost ?? 1);
      dummy.scale.set(sc, sc * (0.85 + hash01(i, 29) * 0.4), sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}

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
const treeGeo = new THREE.PlaneGeometry(4.6, 6.6);
const trees = new THREE.Group();
for (let y = 0; y < rows; y += 1) {
  for (let x = 0; x < cols; x += 1) {
    if (materialAt(x, y) !== "grass" || vegAt(x, y) < 0.5 || hash01(x + 3, y + 11) < 0.86) continue;
    const t = new THREE.Mesh(treeGeo, treeMat);
    const wx = x + 0.2 + hash01(x, y) * 0.6;
    const wz = y + 0.2 + hash01(x + 9, y) * 0.6;
    const h = (hAt(Math.round(wx), Math.round(wz)) + 0.05) * HSCALE;
    const s = 0.75 + hash01(x + 5, y + 5) * 0.55;
    t.scale.setScalar(s);
    t.position.set(wx, h + 3.3 * s, wz);
    t.castShadow = true;
    trees.add(t);
  }
}
scene.add(trees);

// human-scale reference: a 1.8m figure at the focus point
{
  const fig = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7a5c40, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.62, 8), bodyMat);
  body.position.y = 0.31;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.7 }));
  head.position.y = 0.74;
  fig.add(body, head);
  fig.scale.setScalar(0.9 / 0.85);
  fig.position.set(FOCUS_X + 0.5, hBil(FOCUS_X + 0.5, FOCUS_Y + 0.5) * HSCALE, FOCUS_Y + 0.5);
  fig.traverse((o) => { o.castShadow = true; });
  scene.add(fig);
}

// sun + sky light
const sun = new THREE.DirectionalLight(0xffedc4, 3.8);
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

renderer.setAnimationLoop((t) => {
  grassUniforms.uTime.value = t / 1000;
  renderer.render(scene, cam);
});
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
});
document.title = "Duskfell 3D spike — ready";
