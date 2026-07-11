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
    gl.disable(gl.BLEND);
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

  return {
    beginFrame,
    drawChunkLayer,
    isLost: () => contextLost,
  };
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
