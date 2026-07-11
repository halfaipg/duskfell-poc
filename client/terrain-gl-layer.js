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
  const vertexBuffer = gl.createBuffer();
  const vertexData = new Float32Array(4 * 4);
  const textures = new Set();
  let contextLost = false;

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
    beginWater,
    drawWaterQuad,
    isLost: () => contextLost,
  };
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

vec2 mirrorUv(vec2 uv) {
  return abs(fract(uv * 0.5) * 2.0 - 1.0);
}

void main() {
  float mask = texture2D(uMask, vUv).a;
  if (mask < 0.02) discard;
  vec2 wc = vUv * uCanvasTiles;                 // tile-space coords
  float t = uTime;

  // ripple field distorts the sampling — the fluid wobble
  vec2 wob = vec2(
    sin(wc.y * 6.3 + t * 2.4) + sin(wc.x * 3.7 - t * 1.6) * 0.7,
    cos(wc.x * 5.1 + t * 2.0) + cos(wc.y * 4.3 + t * 1.3) * 0.7
  ) * 0.018;

  // two advected layers of the painted water drift along the channel
  vec2 uv1 = wc * 0.22 + uFlow * t * 0.055 + wob;
  vec2 uv2 = wc * 0.37 - uFlow * t * 0.028 - wob * 1.5 + vec2(0.31);
  vec3 base = texture2D(uWater, mirrorUv(uv1)).rgb;
  vec3 drift = texture2D(uWater, mirrorUv(uv2)).rgb;
  vec3 col = base * 0.66 + drift * 0.44;

  // travelling glints: sharp moving highlight bands
  float g = sin(dot(wc, vec2(7.5, 9.5)) + t * 3.2 + sin(wc.y * 4.7 + t));
  col += vec3(0.85, 0.9, 0.85) * pow(max(g, 0.0), 22.0) * 0.22;

  // edge foam: a soft band where the mask fades at the banks
  float edge = smoothstep(0.04, 0.30, mask) * (1.0 - smoothstep(0.45, 0.9, mask));
  float foamWave = 0.5 + 0.5 * sin(wc.x * 12.0 + wc.y * 9.0 + t * 1.8 + wob.x * 60.0);
  col = mix(col, vec3(0.78, 0.82, 0.78), edge * foamWave * 0.22);

  float alpha = mask * 0.62;
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
