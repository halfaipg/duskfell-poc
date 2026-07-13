// WebGL terrain compositor: static chunk canvases upload once as textures
// and draw as camera-transformed quads on a canvas layered UNDER the 2D
// world canvas. Dynamic overlays (water shimmer, entities, labels) stay on
// the 2D canvas above. Returns null when WebGL is unavailable — callers
// fall back to the 2D blit path transparently.
const CLEAR_COLOR = [0x16 / 255, 0x1d / 255, 0x18 / 255];
const MAX_TEXTURES = 96;

export function createTerrainGlLayer(canvas) {
  if (!canvas?.getContext) return null;
  const gl =
    canvas.getContext("webgl2", { alpha: false, antialias: false }) ??
    canvas.getContext("webgl", { alpha: false, antialias: false });
  if (!gl) return null;

  const program = buildProgram(gl);
  if (!program) return null;
  const waterProgram = buildWaterProgram(gl);
  const attribPosition = gl.getAttribLocation(program, "aPosition");
  const attribUv = gl.getAttribLocation(program, "aUv");
  const attribPlan = gl.getAttribLocation(program, "aPlan");
  const uniformCamera = gl.getUniformLocation(program, "uCamera");
  const uniformViewport = gl.getUniformLocation(program, "uViewport");
  const uniformTexture = gl.getUniformLocation(program, "uTexture");
  const uniformHeights = gl.getUniformLocation(program, "uHeights");
  const uniformSunDir = gl.getUniformLocation(program, "uSunDir");
  const uniformDaylight = gl.getUniformLocation(program, "uDaylight");
  const uniformGridSize = gl.getUniformLocation(program, "uGridSize");
  let heightsTexture = null;
  let heightsSource = null;
  let lightingState = { origin: { x: 0, y: 0 }, cols: 1, rows: 1 };
  const blitProgram = buildBlitProgram(gl);
  const vertexBuffer = gl.createBuffer();
  const vertexData = new Float32Array(4 * 6);
  const textures = new Set();
  let contextLost = false;
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
  function setLighting({ heightsCanvas, cols, rows, origin, sun, daylight }) {
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
    gl.uniform2f(uniformGridSize, cols + 1, rows + 1);
  }

  function textureForLayer(layer) {
    if (layer.glTexture && !layer.glTextureStale) return layer.glTexture;
    if (textures.size >= MAX_TEXTURES) {
      // rebuild storms replace every chunk at once; dropping the whole pool
      // is simpler than tracking ownership and costs one re-upload each
      for (const texture of textures) gl.deleteTexture(texture);
      textures.clear();
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
    textures.add(texture);
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

  function drawWaterQuad(entry, corners, canvasTiles) {
    if (contextLost || !waterProgram) return false;
    const layer = entry.layer;
    if (!layer.glMaskTexture) {
      layer.glMaskTexture = textureForCanvasSource(layer.mask, true);
      textures.add(layer.glMaskTexture);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer.glMaskTexture);
    gl.uniform1i(waterUniforms.mask, 0);
    gl.uniform2f(waterUniforms.flow, layer.flowX, layer.flowY);
    gl.uniform1f(waterUniforms.tiles, canvasTiles);
    vertexData.set([
      corners[0].x, corners[0].y, 0, 0, 0, 0,
      corners[1].x, corners[1].y, 1, 0, 0, 0,
      corners[2].x, corners[2].y, 0, 1, 0, 0,
      corners[3].x, corners[3].y, 1, 1, 0, 0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  // ---- GL grass: one triangle per blade, wind in the vertex shader, and
  // a second flattened pass casting each blade's shadow along the sun ----
  const grassProgram = buildGrassProgram(gl);
  const grassBuffers = new Map(); // chunkKey -> {buffer, vertexCount}
  const grassUniforms = grassProgram
    ? {
        camera: gl.getUniformLocation(grassProgram, "uCamera"),
        viewport: gl.getUniformLocation(grassProgram, "uViewport"),
        time: gl.getUniformLocation(grassProgram, "uTime"),
        mode: gl.getUniformLocation(grassProgram, "uMode"),
        shadow: gl.getUniformLocation(grassProgram, "uShadow"),
        daylight: gl.getUniformLocation(grassProgram, "uDaylight"),
      }
    : null;

  function grassBufferFor(chunkKey, buildBlades) {
    let entry = grassBuffers.get(chunkKey);
    if (entry) return entry;
    const data = buildBlades();
    if (!data || data.length === 0) {
      entry = { buffer: null, vertexCount: 0 };
    } else {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      entry = { buffer, vertexCount: data.length / 7 };
    }
    if (grassBuffers.size > 160) {
      for (const stale of grassBuffers.values()) {
        if (stale.buffer) gl.deleteBuffer(stale.buffer);
      }
      grassBuffers.clear();
    }
    grassBuffers.set(chunkKey, entry);
    return entry;
  }

  function beginGrass(camera, cssWidth, cssHeight, nowMs, shadow, daylight) {
    if (contextLost || !grassProgram) return false;
    gl.useProgram(grassProgram);
    gl.uniform3f(grassUniforms.camera, camera.x, camera.y, camera.scale);
    gl.uniform2f(grassUniforms.viewport, cssWidth, cssHeight);
    gl.uniform1f(grassUniforms.time, (nowMs % 1000000) / 1000);
    gl.uniform3f(grassUniforms.shadow, shadow.dirX, shadow.dirY, shadow.length);
    gl.uniform1f(grassUniforms.daylight, daylight);
    return true;
  }

  function drawGrassChunk(chunkKey, buildBlades) {
    if (contextLost || !grassProgram) return;
    const entry = grassBufferFor(chunkKey, buildBlades);
    if (!entry.buffer || entry.vertexCount === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    const aPos = gl.getAttribLocation(grassProgram, "aPos");
    const aCorner = gl.getAttribLocation(grassProgram, "aCorner");
    const aParams = gl.getAttribLocation(grassProgram, "aParams");
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aCorner);
    gl.enableVertexAttribArray(aParams);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 28, 8);
    gl.vertexAttribPointer(aParams, 3, gl.FLOAT, false, 28, 16);
    // shadow pass first (under the blades), then the blades
    const mode = gl.getUniformLocation(grassProgram, "uMode");
    gl.uniform1f(mode, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, entry.vertexCount);
    gl.uniform1f(mode, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, entry.vertexCount);
  }

  function clearGrass() {
    for (const entry of grassBuffers.values()) {
      if (entry.buffer) gl.deleteBuffer(entry.buffer);
    }
    grassBuffers.clear();
  }

  return {
    beginFrame,
    drawChunkLayer,
    finishTerrain,
    beginWater,
    drawWaterQuad,
    setLighting,
    beginGrass,
    drawGrassChunk,
    clearGrass,
    isLost: () => contextLost,
  };
}

function buildGrassProgram(gl) {
  const vertexSource = `
attribute vec2 aPos;      // projected base position (world px)
attribute vec2 aCorner;   // offset from base: x spread, y = -height at tip
attribute vec3 aParams;   // phase, heightFrac (0 base, 1 tip), shade
uniform vec3 uCamera;
uniform vec2 uViewport;
uniform float uTime;
uniform float uMode;      // 0 = blade, 1 = ground shadow
uniform vec3 uShadow;     // dirX, dirY, length
varying float vFrac;
varying float vShade;
void main() {
  float sway = (sin(uTime * 1.9 + aParams.x) + sin(uTime * 3.3 + aParams.x * 1.7) * 0.45)
             * 1.7 * aParams.y;
  vec2 world;
  if (uMode < 0.5) {
    world = aPos + vec2(aCorner.x + sway, aCorner.y);
  } else {
    // flatten the blade onto the ground along the sun's cast direction
    float rise = -aCorner.y;
    world = aPos + vec2(aCorner.x + sway * 0.6, 0.0)
          + vec2(uShadow.x, uShadow.y * 0.55) * rise * uShadow.z;
  }
  vec2 screen = (world - uCamera.xy) * uCamera.z;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vFrac = aParams.y;
  vShade = aParams.z;
}`;
  const fragmentSource = `
precision mediump float;
uniform float uMode;
uniform float uDaylight;
varying float vFrac;
varying float vShade;
void main() {
  if (uMode < 0.5) {
    vec3 base = vec3(0.24, 0.30, 0.19);
    vec3 tip = vec3(0.45, 0.54, 0.31);
    vec3 col = mix(base, tip, vFrac) * (0.82 + vShade * 0.36);
    col *= mix(0.62, 1.0, max(uDaylight, 0.25));
    gl_FragColor = vec4(col, 1.0);
  } else {
    float a = 0.20 * uDaylight;
    gl_FragColor = vec4(vec3(0.06, 0.08, 0.06) * a, a);
  }
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
  vec2 wc = vUv * uCanvasTiles;
  float t = uTime;
  vec2 drift = uFlow * t * 0.35;
  float body = smoothstep(0.30, 0.85, mask);

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
  vec2 refracted = screenUv + normal.xy * 0.011 * body;
  vec3 bed = texture2D(uScene, refracted).rgb;

  // depth tint over the bent bed
  vec3 deep = vec3(0.16, 0.26, 0.24);
  vec3 col = mix(bed, bed * deep * 3.2, body * 0.30);

  // specular dance follows the live sun; low sun = long warm glints,
  // after dark the water dims and goes quiet
  vec3 sun = normalize(uSun);
  float daylight = clamp(uSun.z * 2.4, 0.0, 1.0);
  float lowSun = clamp(1.0 - uSun.z * 1.8, 0.0, 1.0);
  float spec = pow(max(dot(normal, sun), 0.0), mix(34.0, 14.0, lowSun));
  vec3 glintColor = mix(vec3(0.9, 0.94, 0.88), vec3(1.0, 0.78, 0.5), lowSun * 0.8);
  col += glintColor * spec * body * mix(0.15, 0.62, daylight);
  col *= mix(0.55, 1.0, max(daylight, 0.18));

  // faint caustic glimmer under the refraction
  vec2 w1 = worley((wc - drift) * 1.15 + warp, t * 0.45);
  float caustic = smoothstep(0.30, 0.02, w1.y);
  col += vec3(0.75, 0.85, 0.8) * caustic * body * 0.08 * daylight;

  // bank foam: cellular clumps in the mask fade band
  float edge = smoothstep(0.03, 0.28, mask) * (1.0 - smoothstep(0.34, 0.72, mask));
  vec2 wf = worley(wc * 4.6 + warp * 1.4 - uFlow * t * 0.15, t * 0.6);
  float foam = edge * smoothstep(0.45, 0.05, wf.x);
  col = mix(col, vec3(0.85, 0.9, 0.86), foam * 0.4);

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
uniform vec2 uGridSize;   // cols+1, rows+1 vertex grid
varying vec2 vUv;
varying vec2 vPlan;

float heightAt(vec2 tile) {
  vec2 uv = (tile + 0.5) / uGridSize;
  return texture2D(uHeights, uv).r * 5.0 - 1.0;
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
