#!/usr/bin/env python3
"""Fluid-motion demo: walk-cycle sprite sheet + in-world GIF + interactive HTML."""
import os, glob, base64, io, json
from math import radians, cos, sin
from PIL import Image, ImageDraw, ImageEnhance, ImageChops

ROOT = "/Users/j/Documents/New project/uo-chain-sandbox-poc"
CAND = os.path.join(ROOT, "assets/terrain/candidates")
DEMOS = os.path.join(ROOT, "assets/demos")
SHEETS = os.path.join(ROOT, "assets/sprites/player-cards/candidates")
os.makedirs(DEMOS, exist_ok=True)
PPT, TILES = 64, 12
P = PPT * TILES

# ---- 1. terrain: 3x3 mirror-tiled mosaic (hides seams), military-rotated ----
patch = Image.open(os.path.join(CAND, "border-meadow-fenmarsh-gradual.png")).convert("RGB")
probe = patch.resize((128, 128))

def standable(u, v):
    x, y = int(u * 127), int(v * 127)
    px = [probe.getpixel((min(127, max(0, x+dx)), min(127, max(0, y+dy)))) for dx in (-2,0,2) for dy in (-2,0,2)]
    r = sum(p[0] for p in px)/9; g = sum(p[1] for p in px)/9; b = sum(p[2] for p in px)/9
    return g > 60 and g > b * 1.25 and not (b > g * 0.95 and r < 80)

# probe columns of the single patch for the longest walkable v-run
best = None
for uc in [x/100 for x in range(20, 62, 2)]:
    run = sum(1 for vv in range(15, 82, 2) if standable(uc, vv/100))
    if best is None or run > best[1]:
        best = (uc, run)
U_LOCAL = best[0]
print("path column u =", U_LOCAL, "standable samples:", best[1], "/ 34")

# mosaic: mirror-tile so edges are continuous
one = patch.resize((P, P), Image.LANCZOS)
P3 = P * 3
mosaic = Image.new("RGB", (P3, P3))
for r in range(3):
    for c in range(3):
        t = one
        if c % 2 == 0: t = t.transpose(Image.FLIP_LEFT_RIGHT)
        if r % 2 == 0: t = t.transpose(Image.FLIP_TOP_BOTTOM)
        mosaic.paste(t, (c * P, r * P))
P = P3  # world size is now the mosaic
plan_g = mosaic.quantize(96).convert("RGBA")
mil = plan_g.rotate(45, expand=True, resample=Image.NEAREST)
def tone(im):
    im = ImageEnhance.Color(im).enhance(0.82)
    im = ImageEnhance.Brightness(im).enhance(0.94)
    return ImageChops.multiply(im, Image.new("RGB", im.size, (243, 236, 226)))
mil_rgb = Image.new("RGB", mil.size, (8, 8, 10))
mil_rgb.paste(mil, (0, 0), mil)
mil_rgb = tone(mil_rgb)
MW = mil.width
U_PATH = (1 + U_LOCAL) / 3  # center copy

# ---- 2. sprite frames: union bbox, shared scale, pixel quantize ----
frames = sorted(glob.glob("/tmp/wretch-walk/se_*.png"))
imgs = [Image.open(f).convert("RGBA") for f in frames]
boxes = [im.getbbox() for im in imgs]
ub = (min(b[0] for b in boxes), min(b[1] for b in boxes),
      max(b[2] for b in boxes), max(b[3] for b in boxes))
crops = [im.crop(ub) for im in imgs]
SH = 112
scale = SH / crops[0].height
def pixelize(im):
    half = im.resize((max(1, int(im.width * scale / 2)), int(im.height * scale / 2)), Image.LANCZOS)
    rgb = half.convert("RGB").quantize(48).convert("RGB")
    a = half.getchannel("A").point(lambda v: 255 if v >= 96 else 0)
    return Image.merge("RGBA", (*rgb.split(), a)).resize(
        (half.width * 2, half.height * 2), Image.NEAREST)
sprites = [pixelize(c) for c in crops]
SW_, SH_ = sprites[0].width, sprites[0].height
sheet = Image.new("RGBA", (SW_ * len(sprites), SH_), (0, 0, 0, 0))
for i, s in enumerate(sprites):
    sheet.paste(s, (i * SW_, 0))
sheet.save(os.path.join(SHEETS, "duskfell-wretch-walk-se-sheet.png"))
print("sheet:", SW_, "x", SH_, "x", len(sprites))

# ---- 3. world mapping ----
ANG = radians(-45)
def p2m_full(u, v):
    px, py = (u - 0.5) * P, (v - 0.5) * P
    return (MW / 2 + px * cos(ANG) - py * sin(ANG), MW / 2 + px * sin(ANG) + py * cos(ANG))

V0, V1 = (1 + 0.16) / 3, (1 + 0.80) / 3   # path in center copy
CW, CH = 960, 540

# crop terrain to the path corridor to keep file sizes sane
ex0, ey0 = p2m_full(U_PATH, V0)
ex1, ey1 = p2m_full(U_PATH, V1)
MX0 = int(min(ex0, ex1) - CW / 2 - 80); MY0 = int(min(ey0, ey1) - CH / 2 - 80)
MX1 = int(max(ex0, ex1) + CW / 2 + 80); MY1 = int(max(ey0, ey1) + CH / 2 + 80)
MX0, MY0 = max(0, MX0), max(0, MY0)
mil_rgb = mil_rgb.crop((MX0, MY0, min(MW, MX1), min(MW, MY1)))
def p2m(u, v):
    x, y = p2m_full(u, v)
    return (x - MX0, y - MY0)
print("corridor crop:", mil_rgb.size)

# ---- 4. in-world GIF (interpolated version) ----
gif_frames = []
NGIF = 72
for k in range(NGIF):
    t = k / NGIF
    v = V0 + (V1 - V0) * t
    mx, my = p2m(U_PATH, v)
    fi = int(t * NGIF / 6) % len(sprites)   # frame advance tied to distance
    cx, cy = int(mx - CW / 2), int(my - CH * 0.52)
    fr = mil_rgb.crop((cx, cy, cx + CW, cy + CH)).copy()
    sp = sprites[fi]
    fr.paste(sp, (int(CW / 2 - SW_ / 2), int(CH * 0.52 - SH_ * 0.94)), sp)
    fr = fr.resize((640, 360), Image.LANCZOS)
    gif_frames.append(fr.convert("P", palette=Image.ADAPTIVE, colors=160))
gif_frames[0].save(os.path.join(CAND, "fluid-walk-demo.gif"), save_all=True,
                   append_images=gif_frames[1:], duration=70, loop=0)
print("in-world gif done")

# ---- 5. interactive HTML ----
def duri(im, fmt="PNG", q=85):
    b = io.BytesIO()
    if fmt == "JPEG":
        im.convert("RGB").save(b, fmt, quality=q)
    else:
        im.save(b, fmt)
    return "data:image/%s;base64,%s" % (fmt.lower(), base64.b64encode(b.getvalue()).decode())

mil_uri = duri(mil_rgb, "JPEG", 82)
sheet_uri = duri(sheet, "PNG")
cfg = {"MW": MW, "P": P, "U": U_PATH, "V0": V0, "V1": V1, "OX": MX0, "OY": MY0,
       "FW": SW_, "FH": SH_, "NF": len(sprites)}

html = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Duskfell fluid motion demo</title>
<style>
body{margin:0;background:#0a0a0c;color:#e8e2d6;font:14px/1.5 -apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px}
canvas{border:1px solid #333;image-rendering:pixelated;max-width:100%}
.bar{display:flex;gap:22px;align-items:center;flex-wrap:wrap;justify-content:center}
label{cursor:pointer;user-select:none}
.stat{color:#9a917f;font-variant-numeric:tabular-nums}
h1{font-size:16px;margin:4px 0 0}
p{max-width:720px;color:#9a917f;margin:0;text-align:center}
</style></head><body>
<h1>Duskfell — sprite fluidity demo (12-frame factory walk + interpolation)</h1>
<p>Same server, same sprites. The toggle only changes the client: OFF snaps to raw 8&nbsp;Hz server positions (classic clunk), ON tweens position &amp; camera at your display's refresh rate.</p>
<div class="bar">
<label><input type="checkbox" id="interp" checked> smooth interpolation (client-side)</label>
<label>server tick <select id="tick"><option>4</option><option>6</option><option selected>8</option><option>12</option></select> Hz</label>
<span class="stat" id="fps">-- fps</span>
</div>
<canvas id="c" width="960" height="540"></canvas>
<script>
const CFG=__CFG__;
const terrain=new Image();terrain.src="__MIL__";
const sheet=new Image();sheet.src="__SHEET__";
const cv=document.getElementById('c'),g=cv.getContext('2d');g.imageSmoothingEnabled=false;
const A=-Math.PI/4;
function p2m(u,v){const px=(u-0.5)*CFG.P,py=(v-0.5)*CFG.P;
 return [CFG.MW/2+px*Math.cos(A)-py*Math.sin(A)-CFG.OX, CFG.MW/2+px*Math.sin(A)+py*Math.cos(A)-CFG.OY];}
// "server": walks the path, emits discrete positions at tick rate
let sv={v:CFG.V0,prev:CFG.V0,t:0,last:performance.now()};
const SPEED=0.055; // path fraction per second
function serverStep(now,hz){const dt=(now-sv.last)/1000;if(dt<1/hz)return;
 sv.last=now;sv.prev=sv.v;sv.v+=SPEED*dt;if(sv.v>CFG.V1){sv.v=CFG.V0;sv.prev=CFG.V0;}sv.t=now;}
let cam={x:0,y:0,init:false};
let fdist=0,lastRender=performance.now(),fpsA=0;
function loop(now){
 const hz=+document.getElementById('tick').value;
 serverStep(now,hz);
 const smooth=document.getElementById('interp').checked;
 let v;
 if(smooth){const a=Math.min(1,(now-sv.t)/(1000/hz));v=sv.prev+(sv.v-sv.prev)*a;}
 else v=sv.v;
 const[mx,my]=p2m(CFG.U,v);
 const tx=mx-cv.width/2,ty=my-cv.height*0.52;
 if(!cam.init){cam.x=tx;cam.y=ty;cam.init=true;}
 if(smooth){cam.x+=(tx-cam.x)*0.12;cam.y+=(ty-cam.y)*0.12;}
 else{cam.x=tx;cam.y=ty;}
 const dt=(now-lastRender)/1000;lastRender=now;
 fdist+=SPEED*dt*CFG.P*1.35; // px along ground
 const fi=Math.floor(fdist/26)%CFG.NF;
 g.fillStyle='#08080a';g.fillRect(0,0,cv.width,cv.height);
 g.drawImage(terrain,-cam.x,-cam.y);
 g.drawImage(sheet,fi*CFG.FW,0,CFG.FW,CFG.FH,
   Math.round(mx-cam.x-CFG.FW/2),Math.round(my-cam.y-CFG.FH*0.94),CFG.FW,CFG.FH);
 fpsA=fpsA*0.95+(1/Math.max(dt,1e-4))*0.05;
 document.getElementById('fps').textContent=fpsA.toFixed(0)+' fps · '+(smooth?'interpolated':'raw server steps');
 requestAnimationFrame(loop);}
terrain.onload=()=>requestAnimationFrame(loop);
</script></body></html>"""
html = html.replace("__CFG__", json.dumps(cfg)).replace("__MIL__", mil_uri).replace("__SHEET__", sheet_uri)
out = os.path.join(DEMOS, "fluid-motion-demo.html")
open(out, "w").write(html)
print("html:", out, len(html) // 1024, "KB")
