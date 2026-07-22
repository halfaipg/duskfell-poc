const CANDIDATES = {
  zombie: {
    sheetUrl: "../sprites/candidates/kimodo/zombie-gait-official-fixture/zombie-gait-official-fixture-wretch-8x48.png",
    cell: { width: 128, height: 160 },
    frameOffset: 0,
    frameCount: 48,
    durationMs: 4033,
    anchorY: 128,
    label: "Kimodo zombie compatibility review",
  },
  blender: {
    sheetUrl:
      "../sprites/candidates/blender-locomotion-v2/duskfell-locomotion-v2-8x36.png" +
      "?v=670ec5c006bb1faa",
    cell: { width: 128, height: 160 },
    frameOffset: 16,
    frameCount: 20,
    durationMs: 1000,
    anchorY: 110,
    label: "Blender CC0 locomotion v2 review",
  },
};
const candidateName = new URLSearchParams(window.location.search).get("candidate") ?? "zombie";
const candidate = CANDIDATES[candidateName] ?? CANDIDATES.zombie;
const ROWS = [
  ["south", "↓"], ["south-east", "↘"], ["east", "→"], ["north-east", "↗"],
  ["north", "↑"], ["north-west", "↖"], ["west", "←"], ["south-west", "↙"]
];
const canvas = document.querySelector("#stage");
const context = canvas.getContext("2d");
const status = document.querySelector("#status");
const play = document.querySelector("#play");
const speed = document.querySelector("#speed");
const directionBar = document.querySelector("#directions");
const sheet = new Image();
let direction = 1;
let playing = true;
let startedAt = performance.now();
let pausedPhase = 0;

context.imageSmoothingEnabled = false;
ROWS.forEach(([name, symbol], row) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = symbol;
  button.title = name;
  button.setAttribute("aria-label", name);
  button.setAttribute("aria-pressed", String(row === direction));
  button.addEventListener("click", () => {
    direction = row;
    [...directionBar.children].forEach((item, index) => {
      item.setAttribute("aria-pressed", String(index === row));
    });
  });
  directionBar.append(button);
});

function resizeCanvas() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width * ratio));
  canvas.height = Math.max(1, Math.round(box.height * ratio));
  context.imageSmoothingEnabled = false;
}

function drawGround(width, height) {
  context.fillStyle = "#24251f";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(172, 164, 137, 0.07)";
  context.lineWidth = 1;
  const spacing = 58;
  for (let x = -height; x < width + height; x += spacing) {
    context.beginPath(); context.moveTo(x, height); context.lineTo(x + height, 0); context.stroke();
  }
  for (let x = 0; x < width + height * 2; x += spacing) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x - height, height); context.stroke();
  }
  const gradient = context.createRadialGradient(
    width / 2, height * 0.62, 5, width / 2, height * 0.62, width * 0.38
  );
  gradient.addColorStop(0, "rgba(170, 139, 82, 0.13)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function render(now) {
  const width = canvas.width;
  const height = canvas.height;
  drawGround(width, height);
  if (sheet.complete && sheet.naturalWidth) {
    const elapsed = playing
      ? pausedPhase + (now - startedAt) * Number(speed.value)
      : pausedPhase;
    const frame = Math.floor(
      (elapsed % candidate.durationMs) / candidate.durationMs * candidate.frameCount,
    );
    const scale = Math.min(width / 470, height / 280, 3.2);
    const drawWidth = candidate.cell.width * scale;
    const drawHeight = candidate.cell.height * scale;
    const x = Math.round((width - drawWidth) / 2);
    const groundY = height * 0.72;
    const y = Math.round(groundY - candidate.anchorY * scale);
    context.fillStyle = "rgba(0, 0, 0, 0.25)";
    context.beginPath();
    context.ellipse(width / 2, groundY, 34 * scale, 12 * scale, 0, 0, Math.PI * 2);
    context.fill();
    context.drawImage(
      sheet,
      (candidate.frameOffset + frame) * candidate.cell.width,
      direction * candidate.cell.height,
      candidate.cell.width,
      candidate.cell.height,
      x, y, drawWidth, drawHeight
    );
    status.textContent = `${ROWS[direction][0]} · frame ${frame + 1}/${candidate.frameCount} · review`;
  }
  requestAnimationFrame(render);
}

play.addEventListener("click", () => {
  const now = performance.now();
  if (playing) {
    pausedPhase += (now - startedAt) * Number(speed.value);
  } else {
    startedAt = now;
  }
  playing = !playing;
  play.textContent = playing ? "Ⅱ" : "▶";
  play.title = playing ? "Pause animation" : "Play animation";
  play.setAttribute("aria-label", play.title);
});
speed.addEventListener("input", () => {
  startedAt = performance.now();
  pausedPhase = 0;
});
new ResizeObserver(resizeCanvas).observe(canvas);
sheet.addEventListener("load", () => {
  status.textContent = candidate.label;
});
sheet.addEventListener("error", () => {
  status.textContent = "Review sheet failed to load";
});
sheet.src = candidate.sheetUrl;
resizeCanvas();
requestAnimationFrame(render);
