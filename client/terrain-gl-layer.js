// WebGL terrain compositor: static chunk canvases upload once as textures
// and draw as camera-transformed quads on a canvas layered UNDER the 2D
// world canvas. Dynamic overlays (water shimmer, entities, labels) stay on
// the 2D canvas above. Returns null when WebGL is unavailable — callers
// fall back to the 2D blit path transparently.
import { GRAPHICS_BUDGET } from "./device-profile.js";

const CLEAR_COLOR = [0x16 / 255, 0x1d / 255, 0x18 / 255];

export function createTerrainGlLayer(canvas) {
  if (!canvas?.getContext) return null;
  const gl =
    canvas.getContext("webgl2", { alpha: false, antialias: false }) ??
    canvas.getContext("webgl", { alpha: false, antialias: false });
  if (!gl) return null;

  const program = buildProgram(gl);
  if (!program) return null;
  const waterProgram = buildWaterProgram(gl);
  const grassProgram = buildGrassProgram(gl);
  const attribPosition = gl.getAttribLocation(program, "aPosition");
  const attribUv = gl.getAttribLocation(program, "aUv");
  const attribPlan = gl.getAttribLocation(program, "aPlan");
  const uniformCamera = gl.getUniformLocation(program, "uCamera");
  const uniformViewport = gl.getUniformLocation(program, "uViewport");
  const uniformTexture = gl.getUniformLocation(program, "uTexture");
  const uniformHeights = gl.getUniformLocation(program, "uHeights");
  const uniformSunDir = gl.getUniformLocation(program, "uSunDir");
  const uniformDaylight = gl.getUniformLocation(program, "uDaylight");
  const uniformCastShadows = gl.getUniformLocation(program, "uCastShadows");
  const uniformGridSize = gl.getUniformLocation(program, "uGridSize");
  let heightsTexture = null;
  let heightsSource = null;
  let lightingState = { origin: { x: 0, y: 0 }, cols: 1, rows: 1 };
  const blitProgram = buildBlitProgram(gl);
  const vertexBuffer = gl.createBuffer();
  const grassBuffers = new Map();
  const vertexData = new Float32Array(4 * 6);
  // texture pool: LRU-evicted, with owner back-references cleared on evict
  // so an evicted texture re-uploads instead of dangling (dangling handles
  // rendered garbage — the "big squares" bug on large worlds)
  const texturePool = new Map(); // texture -> {owner, prop, lastUsed}
  let poolClock = 0;
  const MAX_POOL = GRAPHICS_BUDGET.glTexturePoolEntries;
  let contextLost = false;

  function poolAdd(texture, owner, prop) {
    texturePool.set(texture, { owner, prop, lastUsed: poolClock });
    if (texturePool.size > MAX_POOL) {
      const entries = [...texturePool.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [tex, meta] of entries.slice(0, Math.ceil(MAX_POOL / 4))) {
        gl.deleteTexture(tex);
        if (meta.owner && meta.owner[meta.prop] === tex) meta.owner[meta.prop] = null;
        texturePool.delete(tex);
      }
    }
  }

  function poolTouch(texture) {
    const meta = texturePool.get(texture);
    if (meta) meta.lastUsed = poolClock;
  }
  let sceneFbo = null;
  let sceneTexture = null;
  let sceneWidth = 0;
  let sceneHeight = 0;

  function ensureSceneTarget() {
    if (sceneFbo && sceneWidth === canvas.width && sceneHeight === canvas.height) return true;
    if (sceneTexture) gl.deleteTexture(sceneTexture);
    if (sceneFbo) gl.deleteFramebuffer(sceneFbo);
    sceneTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    sceneFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTexture, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    sceneWidth = canvas.width;
    sceneHeight = canvas.height;
    if (!ok) {
      sceneFbo = null;
    }
    return Boolean(sceneFbo);
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
  });

  function resize(cssWidth, cssHeight, dpr) {
    const width = Math.max(1, Math.floor(cssWidth * dpr));
    const height = Math.max(1, Math.floor(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function beginFrame(camera, cssWidth, cssHeight, dpr) {
    if (contextLost) return false;
    poolClock += 1;
    resize(cssWidth, cssHeight, dpr);
    // terrain renders into the scene texture; the water pass refracts it
    const useFbo = Boolean(blitProgram) && ensureSceneTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, useFbo ? sceneFbo : null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(CLEAR_COLOR[0], CLEAR_COLOR[1], CLEAR_COLOR[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform3f(uniformCamera, camera.x, camera.y, camera.scale);
    gl.uniform2f(uniformViewport, cssWidth, cssHeight);
    gl.disable(gl.DEPTH_TEST);
    // chunk layers overlap via their transparent padding; premultiplied
    // alpha blending composites them exactly like ctx.drawImage did
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(attribPosition);
    gl.enableVertexAttribArray(attribUv);
    gl.enableVertexAttribArray(attribPlan);
    gl.vertexAttribPointer(attribPosition, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(attribUv, 2, gl.FLOAT, false, 24, 8);
    gl.vertexAttribPointer(attribPlan, 2, gl.FLOAT, false, 24, 16);
    return true;
  }

  // world lighting inputs: height grid canvas + live sun. The heights
  // canvas uploads once (re-uploads if the source object changes).
  function setLighting({ heightsCanvas, cols, rows, origin, sun, daylight, castShadows = true }) {
    if (contextLost) return;
    lightingState = { origin, cols, rows };
    gl.useProgram(program);
    if (heightsCanvas && heightsSource !== heightsCanvas) {
      if (heightsTexture) gl.deleteTexture(heightsTexture);
      heightsTexture = textureForCanvasSource(heightsCanvas, false);
      heightsSource = heightsCanvas;
    }
    if (heightsTexture) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, heightsTexture);
      gl.uniform1i(uniformHeights, 3);
    }
    const sunDir = sun ?? { x: -0.45, y: -0.55, z: 0.72 };
    gl.uniform3f(uniformSunDir, sunDir.x, sunDir.y, Math.max(0.12, sunDir.z));
    gl.uniform1f(uniformDaylight, daylight ?? 1);
    gl.uniform1f(uniformCastShadows, castShadows ? 1 : 0);
    gl.uniform2f(uniformGridSize, cols + 1, rows + 1);
  }

  function textureForLayer(layer) {
    if (layer.glTexture && !layer.glTextureStale) {
      poolTouch(layer.glTexture);
      return layer.glTexture;
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    poolAdd(texture, layer, "glTexture");
    layer.glTexture = texture;
    layer.glTextureStale = false;
    return texture;
  }

  function drawChunkLayer(layer) {
    if (contextLost || !layer?.canvas) return false;
    const texture = textureForLayer(layer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniformTexture, 0);

    const x0 = layer.x;
    const y0 = layer.y;
    const x1 = layer.x + layer.width;
    const y1 = layer.y + layer.height;
    // plan (tile) coords per corner: inverse iso of projected position,
    // ignoring baked z displacement (shading offset of <0.5 tile on cliffs)
    const { origin } = lightingState;
    const HALF_W = 32;
    const HALF_H = 32;
    const plan = (px, py) => {
      const dx = (px - origin.x) / HALF_W;
      const dy = (py - origin.y) / HALF_H;
      return { u: ((dx + dy) / 2) / 1, v: ((dy - dx) / 2) / 1 };
    };
    const p00 = plan(x0, y0);
    const p10 = plan(x1, y0);
    const p01 = plan(x0, y1);
    const p11 = plan(x1, y1);
    // triangle strip: nw, ne, sw, se — canvas row 0 sits at v=0
    vertexData.set([
      x0, y0, 0, 0, p00.u, p00.v,
      x1, y0, 1, 0, p10.u, p10.v,
      x0, y1, 0, 1, p01.u, p01.v,
      x1, y1, 1, 1, p11.u, p11.v,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  // ---- shader water: supertile quads masked by the channel field, with
  // per-pixel advection, ripple distortion, glints and edge foam ----
  const waterUniforms = waterProgram
    ? {
        camera: gl.getUniformLocation(waterProgram, "uCamera"),
        viewport: gl.getUniformLocation(waterProgram, "uViewport"),
        time: gl.getUniformLocation(waterProgram, "uTime"),
        flow: gl.getUniformLocation(waterProgram, "uFlow"),
        tiles: gl.getUniformLocation(waterProgram, "uCanvasTiles"),
        mask: gl.getUniformLocation(waterProgram, "uMask"),
        water: gl.getUniformLocation(waterProgram, "uWater"),
      }
    : null;
  let waterTexture = null;
  let waterTextureSource = null;

  function textureForCanvasSource(source, premultiply) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  // present the scene texture to the canvas, then let the water pass sample
  // it for refraction — the riverbed genuinely bends under the surface
  function finishTerrain() {
    if (contextLost || !blitProgram || !sceneFbo) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(blitProgram);
    const blitPosition = gl.getAttribLocation(blitProgram, "aPosition");
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(blitPosition);
    gl.vertexAttribPointer(blitPosition, 2, gl.FLOAT, false, 24, 0);
    vertexData.set([-1, -1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, -1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.uniform1i(gl.getUniformLocation(blitProgram, "uScene"), 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    return true;
  }

  function beginWater(camera, cssWidth, cssHeight, nowMs, waterImage, sun = null) {
    if (contextLost || !waterProgram || !waterImage) return false;
    if (waterTextureSource !== waterImage) {
      if (waterTexture) gl.deleteTexture(waterTexture);
      waterTexture = textureForCanvasSource(waterImage, false);
      waterTextureSource = waterImage;
    }
    gl.useProgram(waterProgram);
    gl.uniform3f(waterUniforms.camera, camera.x, camera.y, camera.scale);
    gl.uniform2f(waterUniforms.viewport, cssWidth, cssHeight);
    gl.uniform1f(waterUniforms.time, (nowMs % 1000000) / 1000);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    const waterPosition = gl.getAttribLocation(waterProgram, "aPosition");
    const waterUv = gl.getAttribLocation(waterProgram, "aUv");
    gl.enableVertexAttribArray(waterPosition);
    gl.enableVertexAttribArray(waterUv);
    gl.vertexAttribPointer(waterPosition, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(waterUv, 2, gl.FLOAT, false, 24, 8);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, waterTexture);
    gl.uniform1i(waterUniforms.water, 1);
    if (sceneTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.uniform1i(gl.getUniformLocation(waterProgram, "uScene"), 2);
    }
    gl.uniform2f(gl.getUniformLocation(waterProgram, "uResolution"), canvas.width, canvas.height);
    const sunDir = sun ?? { x: -0.45, y: -0.55, z: 0.72 };
    gl.uniform3f(gl.getUniformLocation(waterProgram, "uSun"), sunDir.x, sunDir.y, sunDir.z);
    return true;
  }

  function drawWaterQuad(entry, corners, canvasTiles, uvRange = [0, 1]) {
    if (contextLost || !waterProgram) return false;
    const layer = entry.layer;
    if (!layer.glMaskTexture) {
      layer.glMaskTexture = textureForCanvasSource(layer.mask, true);
      poolAdd(layer.glMaskTexture, layer, "glMaskTexture");
    } else {
      poolTouch(layer.glMaskTexture);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer.glMaskTexture);
    gl.uniform1i(waterUniforms.mask, 0);
    gl.uniform2f(waterUniforms.flow, layer.flowX, layer.flowY);
    gl.uniform1f(waterUniforms.tiles, canvasTiles);
    gl.uniform2f(
      gl.getUniformLocation(waterProgram, "uWorldOrigin"),
      entry.worldOriginX ?? 0,
      entry.worldOriginY ?? 0,
    );
    const [u0, u1] = uvRange;
    vertexData.set([
      corners[0].x, corners[0].y, u0, u0, 0, 0,
      corners[1].x, corners[1].y, u1, u0, 0, 0,
      corners[2].x, corners[2].y, u0, u1, 0, 0,
      corners[3].x, corners[3].y, u1, u1, 0, 0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  function drawGrass(entries, camera, cssWidth, cssHeight, nowMs, sun = null) {
    if (contextLost || !grassProgram || !entries?.length) return false;
    gl.useProgram(grassProgram);
    gl.uniform3f(gl.getUniformLocation(grassProgram, "uCamera"), camera.x, camera.y, camera.scale);
    gl.uniform2f(gl.getUniformLocation(grassProgram, "uViewport"), cssWidth, cssHeight);
    gl.uniform1f(gl.getUniformLocation(grassProgram, "uTime"), (nowMs % 1000000) / 1000);
    gl.uniform1f(gl.getUniformLocation(grassProgram, "uWind"), 0.72);
    const sunDir = sun ?? { x: -0.45, y: -0.55, z: 0.72 };
    gl.uniform3f(gl.getUniformLocation(grassProgram, "uSun"), sunDir.x, sunDir.y, sunDir.z);
    const stride = 8 * 4;
    const position = gl.getAttribLocation(grassProgram, "aPosition");
    const tip = gl.getAttribLocation(grassProgram, "aTip");
    const phase = gl.getAttribLocation(grassProgram, "aPhase");
    const color = gl.getAttribLocation(grassProgram, "aColor");
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(tip);
    gl.enableVertexAttribArray(phase);
    gl.enableVertexAttribArray(color);
    for (const vertices of entries) {
      const buffer = grassBufferFor(vertices);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(tip, 1, gl.FLOAT, false, stride, 8);
      gl.vertexAttribPointer(phase, 1, gl.FLOAT, false, stride, 12);
      gl.vertexAttribPointer(color, 4, gl.FLOAT, false, stride, 16);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 8);
    }
    if (!grassDiagnosed) {
      grassDiagnosed = true;
      console.info("Duskfell GPU grass active", {
        chunks: entries.length,
        vertices: entries.reduce((total, entry) => total + entry.length / 8, 0),
        glError: gl.getError(),
      });
    }
    return true;
  }

  let grassDiagnosed = false;

  function grassBufferFor(vertices) {
    const cached = grassBuffers.get(vertices);
    if (cached) return cached;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    grassBuffers.set(vertices, buffer);
    if (grassBuffers.size > 96) {
      const stale = grassBuffers.keys().next().value;
      gl.deleteBuffer(grassBuffers.get(stale));
      grassBuffers.delete(stale);
    }
    return buffer;
  }

  return {
    beginFrame,
    drawChunkLayer,
    finishTerrain,
    beginWater,
    drawWaterQuad,
    drawGrass,
    setLighting,
    isLost: () => contextLost,
  };
}

function buildGrassProgram(gl) {
  const vertexSource = `
attribute vec2 aPosition;
attribute float aTip;
attribute float aPhase;
attribute vec4 aColor;
uniform vec3 uCamera;
uniform vec2 uViewport;
uniform float uTime;
uniform float uWind;
uniform vec3 uSun;
varying vec4 vColor;
void main() {
  float gust = sin(uTime * 1.55 + aPhase) + sin(uTime * 2.7 + aPhase * 1.7) * 0.34;
  vec2 position = aPosition;
  position.x += gust * uWind * aTip * 3.8;
  vec2 screen = (position - uCamera.xy) * uCamera.z;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  float daylight = clamp(uSun.z * 2.2, 0.45, 1.0);
  vColor = vec4(aColor.rgb * daylight * (0.84 + aTip * 0.16), aColor.a);
}`;
  const fragmentSource = `
precision mediump float;
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}`;
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("grass GL program link failed:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function buildBlitProgram(gl) {
  const vertexSource = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = aPosition * 0.5 + 0.5;
}`;
  const fragmentSource = `
precision mediump float;
uniform sampler2D uScene;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uScene, vUv);
}`;
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  return program;
}

function buildWaterProgram(gl) {
  const vertexSource = `
attribute vec2 aPosition;
attribute vec2 aUv;
uniform vec3 uCamera;
uniform vec2 uViewport;
varying vec2 vUv;
void main() {
  vec2 screen = (aPosition - uCamera.xy) * uCamera.z;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUv = aUv;
}`;
  const fragmentSource = `
precision mediump float;
uniform sampler2D uMask;
uniform sampler2D uWater;
uniform vec2 uFlow;
uniform float uTime;
uniform float uCanvasTiles;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform vec3 uSun;
uniform vec2 uWorldOrigin;
varying vec2 vUv;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// animated cellular noise: x = distance to nearest point, y = border factor
vec2 worley(vec2 p, float t) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      o = 0.5 + 0.5 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec2(f1, f2 - f1);
}

void main() {
  float mask = texture2D(uMask, vUv).a;
  if (mask < 0.02) discard;
  // GLOBAL tile coords: waves, caustics and refraction offsets must be
  // continuous across supertile quads or the seams read as cuts
  vec2 wc = vUv * uCanvasTiles + uWorldOrigin;
  float t = uTime;
  vec2 drift = uFlow * t * 0.35;
  float body = smoothstep(0.30, 0.85, mask);
  vec3 sun = normalize(uSun);
  float daylight = clamp(uSun.z * 2.4, 0.0, 1.0);
  float lowSun = clamp(1.0 - uSun.z * 1.8, 0.0, 1.0);
  float surfaceActivity = mix(0.12, 1.0, daylight);

  // animated surface normal field: large swell + travelling wavelets
  vec2 warp = vec2(
    sin(wc.y * 1.7 + t * 0.9) + sin(wc.x * 0.9 - t * 0.6),
    cos(wc.x * 1.3 + t * 0.7) + cos(wc.y * 2.1 + t * 0.5)
  ) * 0.22;
  vec2 wave = vec2(
    sin(wc.y * 5.5 + t * 2.2) + sin((wc.x + wc.y) * 3.1 - t * 1.4) * 0.6,
    cos(wc.x * 4.7 - t * 1.9) + cos((wc.y - wc.x) * 3.7 + t * 1.2) * 0.6
  );
  vec3 normal = normalize(vec3(wave * 0.35 + warp * 0.4, 1.0));

  // REFRACTION: bend the already-rendered riverbed through the surface
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec2 refracted = screenUv + normal.xy * 0.011 * body * surfaceActivity;
  vec3 bed = texture2D(uScene, refracted).rgb;

  // depth tint over the bent bed
  vec3 deep = vec3(0.16, 0.26, 0.24);
  vec3 col = mix(bed, bed * deep * 3.2, body * 0.30);

  // specular dance follows the live sun; low sun = long warm glints,
  // after dark the water dims and goes quiet
  float spec = pow(max(dot(normal, sun), 0.0), mix(42.0, 22.0, lowSun));
  vec3 glintColor = mix(vec3(0.9, 0.94, 0.88), vec3(1.0, 0.78, 0.5), lowSun * 0.8);
  float sunVisible = smoothstep(0.005, 0.12, uSun.z);
  col += glintColor * spec * body * mix(0.18, 0.52, daylight) * sunVisible;
  col *= mix(0.55, 1.0, max(daylight, 0.18));

  // faint caustic glimmer under the refraction
  vec2 w1 = worley((wc - drift) * 1.15 + warp, t * 0.45);
  float caustic = smoothstep(0.30, 0.02, w1.y);
  col += vec3(0.75, 0.85, 0.8) * caustic * body * 0.08 * daylight;

  // bank foam: cellular clumps in the mask fade band
  float edge = smoothstep(0.03, 0.28, mask) * (1.0 - smoothstep(0.34, 0.72, mask));
  vec2 wf = worley(wc * 4.6 + warp * 1.4 - uFlow * t * 0.15, t * 0.6);
  float foam = edge * smoothstep(0.45, 0.05, wf.x);
  col = mix(col, vec3(0.85, 0.9, 0.86), foam * mix(0.16, 0.4, daylight));

  float alpha = clamp(body + foam * 0.5, 0.0, 1.0) * mask;
  gl_FragColor = vec4(col * alpha, alpha);
}`;
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("water GL program link failed:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function buildProgram(gl) {
  const vertexSource = `
attribute vec2 aPosition;
attribute vec2 aUv;
attribute vec2 aPlan;   // tile coords for height sampling
uniform vec3 uCamera;   // x, y, scale (projected-world css px)
uniform vec2 uViewport; // css px
varying vec2 vUv;
varying vec2 vPlan;
void main() {
  vec2 screen = (aPosition - uCamera.xy) * uCamera.z;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUv = aUv;
  vPlan = aPlan;
}`;
  const fragmentSource = `
precision mediump float;
uniform sampler2D uTexture;
uniform sampler2D uHeights;
uniform vec3 uSunDir;
uniform float uDaylight;
uniform float uCastShadows;
uniform vec2 uGridSize;   // cols+1, rows+1 vertex grid
varying vec2 vUv;
varying vec2 vPlan;

float heightAt(vec2 tile) {
  vec2 uv = (tile + 0.5) / uGridSize;
  return texture2D(uHeights, uv).r * 10.0 - 1.0;
}

void main() {
  vec4 texel = texture2D(uTexture, vUv);
  // live hillshade: slope normal from the height grid, lit by the sun —
  // the baked relief stays as detail, this sweeps light across the land
  float hx = heightAt(vPlan + vec2(1.0, 0.0)) - heightAt(vPlan - vec2(1.0, 0.0));
  float hy = heightAt(vPlan + vec2(0.0, 1.0)) - heightAt(vPlan - vec2(0.0, 1.0));
  vec3 normal = normalize(vec3(-hx * 0.9, -hy * 0.9, 1.6));
  float lambert = dot(normal, normalize(uSunDir));
  float shade = clamp(0.72 + lambert * 0.42 * uDaylight, 0.4, 1.22);
  // Cheap terrain casting: six sunward height taps catch mountain/ridge
  // occlusion. It is disabled on constrained devices by uCastShadows.
  float terrainShadow = 0.0;
  if (uCastShadows > 0.5 && uDaylight > 0.03 && uSunDir.z < 0.72) {
    vec2 sunPlan = normalize(uSunDir.xy);
    float rayRise = max(0.06, uSunDir.z) / max(0.08, length(uSunDir.xy));
    float baseHeight = heightAt(vPlan);
    for (int step = 1; step <= 6; step++) {
      float distance = float(step) * 1.35;
      float blocker = heightAt(vPlan + sunPlan * distance);
      float rayHeight = baseHeight + distance * rayRise * 0.72 + 0.12;
      terrainShadow += blocker > rayHeight ? 0.18 : 0.0;
    }
    terrainShadow = min(0.52, terrainShadow) * (1.0 - smoothstep(0.48, 0.72, uSunDir.z));
  }
  shade *= 1.0 - terrainShadow * uDaylight;
  gl_FragColor = vec4(texel.rgb * shade, texel.a);
}`;
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("terrain GL program link failed:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function compile(gl, kind, source) {
  const shader = gl.createShader(kind);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("terrain GL shader compile failed:", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}
