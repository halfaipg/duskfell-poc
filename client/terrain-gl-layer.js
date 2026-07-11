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
  const uniformCamera = gl.getUniformLocation(program, "uCamera");
  const uniformViewport = gl.getUniformLocation(program, "uViewport");
  const uniformTexture = gl.getUniformLocation(program, "uTexture");
  const blitProgram = buildBlitProgram(gl);
  const vertexBuffer = gl.createBuffer();
  const vertexData = new Float32Array(4 * 4);
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
    gl.vertexAttribPointer(attribPosition, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(attribUv, 2, gl.FLOAT, false, 16, 8);
    return true;
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
    // triangle strip: nw, ne, sw, se — canvas row 0 sits at v=0
    vertexData.set([x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x1, y1, 1, 1]);
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
    gl.vertexAttribPointer(blitPosition, 2, gl.FLOAT, false, 16, 0);
    vertexData.set([-1, -1, 0, 0, 1, -1, 0, 0, -1, 1, 0, 0, 1, 1, 0, 0]);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.uniform1i(gl.getUniformLocation(blitProgram, "uScene"), 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    return true;
  }

  function beginWater(camera, cssWidth, cssHeight, nowMs, waterImage) {
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
    gl.vertexAttribPointer(waterPosition, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(waterUv, 2, gl.FLOAT, false, 16, 8);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, waterTexture);
    gl.uniform1i(waterUniforms.water, 1);
    if (sceneTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.uniform1i(gl.getUniformLocation(waterProgram, "uScene"), 2);
    }
    gl.uniform2f(gl.getUniformLocation(waterProgram, "uResolution"), canvas.width, canvas.height);
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
      corners[0].x, corners[0].y, 0, 0,
      corners[1].x, corners[1].y, 1, 0,
      corners[2].x, corners[2].y, 0, 1,
      corners[3].x, corners[3].y, 1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  return {
    beginFrame,
    drawChunkLayer,
    finishTerrain,
    beginWater,
    drawWaterQuad,
    isLost: () => contextLost,
  };
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

  // large slow swell warps the caustic domain — the fluid feel lives here
  vec2 warp = vec2(
    sin(wc.y * 1.7 + t * 0.9) + sin(wc.x * 0.9 - t * 0.6),
    cos(wc.x * 1.3 + t * 0.7) + cos(wc.y * 2.1 + t * 0.5)
  ) * 0.22;

  // calm caustics: bigger cells, soft wide borders, slow morph — one main
  // octave with a faint fine shimmer, so the surface glimmers without
  // reading as a busy net of lines
  vec2 w1 = worley((wc - drift) * 1.15 + warp, t * 0.45);
  vec2 w2 = worley((wc - drift * 1.6) * 2.6 - warp, t * 0.7 + 3.0);
  float web1 = smoothstep(0.30, 0.02, w1.y);
  float web2 = smoothstep(0.26, 0.0, w2.y);
  float caustic = web1 * 0.42 + web2 * 0.10;

  // the painted river stays the base — the shader only deepens the core
  // slightly and lays moving light on top
  float body = smoothstep(0.35, 0.9, mask);
  float baseAlpha = body * 0.18;
  vec3 deep = vec3(0.10, 0.16, 0.15);

  // bank foam: cellular clumps inside the mask fade band
  float edge = smoothstep(0.03, 0.28, mask) * (1.0 - smoothstep(0.34, 0.72, mask));
  vec2 wf = worley(wc * 4.6 + warp * 1.4 - uFlow * t * 0.15, t * 0.6);
  float foam = edge * smoothstep(0.45, 0.05, wf.x);

  vec3 rgb = deep * baseAlpha
           + vec3(0.75, 0.85, 0.8) * caustic * body * 0.22
           + vec3(0.85, 0.9, 0.86) * foam * 0.5;
  float alpha = baseAlpha + foam * 0.35;
  gl_FragColor = vec4(rgb, alpha);
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
uniform vec3 uCamera;   // x, y, scale (projected-world css px)
uniform vec2 uViewport; // css px
varying vec2 vUv;
void main() {
  vec2 screen = (aPosition - uCamera.xy) * uCamera.z;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUv = aUv;
}`;
  const fragmentSource = `
precision mediump float;
uniform sampler2D uTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTexture, vUv);
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
