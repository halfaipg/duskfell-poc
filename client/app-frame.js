export function createCanvasFrame({ canvas, screenCtx }) {
  let canvasPixelWidth = 0;
  let canvasPixelHeight = 0;
  let lastFrameTime = 0;
  let lastRenderUpdateTime = 0;
  let smoothedFps = 60;

  return {
    fitCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const nextWidth = Math.floor(rect.width * dpr);
      const nextHeight = Math.floor(rect.height * dpr);
      if (canvasPixelWidth !== nextWidth || canvasPixelHeight !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        canvasPixelWidth = nextWidth;
        canvasPixelHeight = nextHeight;
      }
      screenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return rect;
    },
    updateFrameRate(now) {
      if (lastRenderUpdateTime <= 0) {
        lastRenderUpdateTime = now;
      }
      if (lastFrameTime > 0) {
        const delta = Math.max(1, now - lastFrameTime);
        const instantFps = 1000 / delta;
        smoothedFps = smoothedFps * 0.9 + instantFps * 0.1;
      }
      lastFrameTime = now;
      return smoothedFps;
    },
    smoothedFps() {
      return smoothedFps;
    },
  };
}

export function drawLoading(ctx, rect) {
  ctx.fillStyle = "#d9cfae";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#161a1d";
  ctx.font = "18px system-ui";
  ctx.fillText("Connecting to authoritative server...", 28, 42);
}
