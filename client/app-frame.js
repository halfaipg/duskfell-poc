import { RENDER_DPR_CAP } from "./device-profile.js";

export function createCanvasFrame({ canvas, screenCtx }) {
  let canvasPixelWidth = 0;
  let canvasPixelHeight = 0;
  let lastFrameTime = 0;
  let lastRenderUpdateTime = 0;
  let smoothedFps = 60;

  return {
    fitCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, RENDER_DPR_CAP);
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

export function drawLoading(ctx, rect, progress = null) {
  ctx.fillStyle = "#14181a";
  ctx.fillRect(0, 0, rect.width, rect.height);
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  ctx.textAlign = "center";
  ctx.fillStyle = "#e8dcbc";
  ctx.font = "700 34px Georgia, serif";
  ctx.fillText("Duskfell", cx, cy - 46);

  if (progress?.error) {
    ctx.fillStyle = "#e0907c";
    ctx.font = "600 15px system-ui";
    ctx.fillText("The world failed to load — reload to try again.", cx, cy + 4);
    ctx.fillStyle = "#8a7d63";
    ctx.font = "13px system-ui";
    ctx.fillText(String(progress.error).slice(0, 90), cx, cy + 28);
    ctx.textAlign = "left";
    return;
  }

  const fraction = progress?.total ? Math.min(1, progress.done / progress.total) : 0;
  const barWidth = Math.min(380, rect.width * 0.7);
  const barX = cx - barWidth / 2;
  const barY = cy - 8;
  ctx.fillStyle = "#242b28";
  ctx.fillRect(barX, barY, barWidth, 14);
  ctx.fillStyle = "#c8ad7a";
  ctx.fillRect(barX + 2, barY + 2, Math.max(0, (barWidth - 4) * fraction), 10);
  ctx.strokeStyle = "#514331";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, 13);

  ctx.fillStyle = "#8f9d95";
  ctx.font = "600 14px system-ui";
  const label = progress
    ? `Painting the world… ${progress.done}/${progress.total}`
    : "Connecting to authoritative server…";
  ctx.fillText(label, cx, barY + 38);
  ctx.textAlign = "left";
}
