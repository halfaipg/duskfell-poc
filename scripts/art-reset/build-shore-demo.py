#!/usr/bin/env python3
"""Shore-run demo v2: single coherent shoreline patch, tight UO zoom,
crisp pixels (no JPEG, no browser scaling blur), improved sprite color."""
import os, glob, base64, io, json
from math import radians, cos, sin
from PIL import Image, ImageEnhance, ImageChops

ROOT = "/Users/j/Documents/New project/uo-chain-sandbox-poc"
CAND = os.path.join(ROOT, "assets/terrain/candidates")
DEMOS = os.path.join(ROOT, "assets/demos")
SHEETS = os.path.join(ROOT, "assets/sprites/player-cards/candidates")
PPT, TILES = 64, 12
P = PPT * TILES  # 768 — single patch world

# ---- terrain: ONE coherent patch, no mosaic ----
patch = Image.open("/tmp/out-shoreline.png").convert("RGB")
probe = patch.resize((128, 128))

def is_water(u, v):
    x, y = min(127, max(0, int(u * 127))), min(127, max(0, int(v * 127)))
    r, g, b = probe.getpixel((x, y))[:3]
    return g > r * 1.25 and b > r * 1.05 and g > 60

# straight-line run path, landward-verified
vs = [vi / 100 for vi in range(14, 87, 2)]
raw_uw = []
for v in vs:
    uw = 0.45
    for ui in range(15, 95):
        u = ui / 100
        if is_water(u, v) and all(is_water(min(0.99, u + k * 0.02), v) for k in (1, 2, 3)):
            uw = u
            break
    raw_uw.append(uw)
mins = [min(raw_uw[max(0, i - 3):min(len(raw_uw), i + 4)]) - 0.075 for i in range(len(vs))]
n = len(vs)
mv = sum(vs) / n; mu = sum(mins) / n
slope = sum((vs[i] - mv) * (mins[i] - mu) for i in range(n)) / max(1e-9, sum((vs[i] - mv) ** 2 for i in range(n)))
slope = max(-0.35, min(0.35, slope))
us = [mu + slope * (v - mv) for v in vs]
for _ in range(4):
    for i, v in enumerate(vs):
        while us[i] > 0.10 and (is_water(us[i], v) or is_water(us[i] + 0.045, v)):
            us[i] -= 0.02
    for i in range(n):
        lo, hi = max(0, i - 4), min(n, i + 5)
        us[i] = sum(us[lo:hi]) / (hi - lo)
for i, v in enumerate(vs):
    while us[i] > 0.10 and is_water(us[i], v):
        us[i] -= 0.02
cpath = [[vs[i], us[i]] for i in range(n)]
print("path u range:", round(min(us), 2), "-", round(max(us), 2), "slope:", round(slope, 3))

plan_g = patch.resize((P, P), Image.LANCZOS).quantize(128).convert("RGBA")
mil = plan_g.rotate(45, expand=True, resample=Image.NEAREST)
def tone(im):
    im = ImageEnhance.Color(im).enhance(0.85)
    im = ImageEnhance.Brightness(im).enhance(0.96)
    return ImageChops.multiply(im, Image.new("RGB", im.size, (245, 239, 230)))
MW = mil.width
# void fill: open lake water behind the diamond (scene reads as a headland)
wsrc = Image.open("/tmp/out-water.png").convert("RGB").crop((100, 0, 1024, 560))
wtile = wsrc.resize((P, P), Image.LANCZOS).quantize(64).convert("RGB")
wtile = ImageEnhance.Color(wtile).enhance(0.6)
wtile = ImageEnhance.Brightness(wtile).enhance(0.62)
wtile = ImageChops.multiply(wtile, Image.new("RGB", wtile.size, (170, 210, 215)))
wtile = tone(wtile)
mil_rgb = Image.new("RGB", (MW, MW))
for ty in range(0, MW, P):
    for tx in range(0, MW, P):
        mil_rgb.paste(wtile, (tx, ty))
mil_toned = tone(Image.new("RGB", mil.size, (16, 20, 24)))
fg = Image.new("RGB", mil.size, (16, 20, 24))
fg.paste(mil, (0, 0), mil)
fg = tone(fg)
mil_rgb.paste(fg, (0, 0), mil.getchannel("A"))
print("mil size:", MW)

# ---- sprite: more color depth, lifted skin ----
frames = sorted(glob.glob("/tmp/wretch-run/se_*.png"))
imgs = [Image.open(f).convert("RGBA") for f in frames]
boxes = [im.getbbox() for im in imgs]
ub = (min(b[0] for b in boxes), min(b[1] for b in boxes),
      max(b[2] for b in boxes), max(b[3] for b in boxes))
crops = [im.crop(ub) for im in imgs]
SH = 112
scale = SH / crops[0].height
def pixelize(im):
    half = im.resize((max(1, int(im.width * scale / 2)), int(im.height * scale / 2)), Image.LANCZOS)
    rgb = half.convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(0.88)
    rgb = ImageEnhance.Brightness(rgb).enhance(1.07)
    rgb = rgb.quantize(96).convert("RGB")
    a = half.getchannel("A").point(lambda v: 255 if v >= 96 else 0)
    return Image.merge("RGBA", (*rgb.split(), a)).resize((half.width * 2, half.height * 2), Image.NEAREST)
sprites = [pixelize(c) for c in crops]
SW_, SH_ = sprites[0].width, sprites[0].height
sheet = Image.new("RGBA", (SW_ * len(sprites), SH_), (0, 0, 0, 0))
for i, s in enumerate(sprites):
    sheet.paste(s, (i * SW_, 0))
sheet.save(os.path.join(SHEETS, "duskfell-wretch-run-se-sheet.png"))

# ---- mapping ----
ANG = radians(-45)
def p2m(u, v):
    px, py = (u - 0.5) * P, (v - 0.5) * P
    return (MW / 2 + px * cos(ANG) - py * sin(ANG), MW / 2 + px * sin(ANG) + py * cos(ANG))
CW, CH = 640, 360   # tight UO-ish window; displayed 1.5x with pixelated

def path_at(t):
    f = t * (len(cpath) - 1)
    i = min(len(cpath) - 2, int(f))
    a = f - i
    v = cpath[i][0] * (1 - a) + cpath[i + 1][0] * a
    u = cpath[i][1] * (1 - a) + cpath[i + 1][1] * a
    return u, v

def cam_for(mx, my):
    cx = max(0, min(MW - CW, mx - CW / 2))
    cy = max(0, min(MW - CH, my - CH * 0.52))
    return int(cx), int(cy)

# ---- GIF ----
gif_frames = []
NGIF = 76
for k in range(NGIF):
    t = k / NGIF
    u, v = path_at(t)
    mx, my = p2m(u, v)
    cx, cy = cam_for(mx, my)
    fr = mil_rgb.crop((cx, cy, cx + CW, cy + CH)).copy()
    sp = sprites[int(k * 1.5) % len(sprites)]
    fr.paste(sp, (int(mx - cx - SW_ / 2), int(my - cy - SH_ * 0.94)), sp)
    edge = min(k / 5.0, (NGIF - 1 - k) / 5.0, 1.0)
    if edge < 1.0:
        fr = ImageEnhance.Brightness(fr).enhance(max(0.05, edge))
    gif_frames.append(fr.convert("P", palette=Image.ADAPTIVE, colors=176))
gif_frames[0].save(os.path.join(CAND, "shore-run-demo.gif"), save_all=True,
                   append_images=gif_frames[1:], duration=50, loop=0)
print("gif done")

# ---- HTML ----
def duri_png(im):
    b = io.BytesIO()
    im.save(b, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()

cfg = {"MW": MW, "P": P, "FW": SW_, "FH": SH_, "NF": len(sprites),
       "CW": CW, "CH": CH,
       "PATH": [[round(v, 4), round(u, 4)] for v, u in cpath]}
html = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Duskfell shore run demo</title>
<style>
body{margin:0;background:#0a0a0c;color:#e8e2d6;font:14px/1.5 -apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px}
canvas{border:1px solid #333;width:960px;max-width:96vw;image-rendering:pixelated;image-rendering:crisp-edges}
.bar{display:flex;gap:22px;align-items:center;flex-wrap:wrap;justify-content:center}
label{cursor:pointer;user-select:none}
.stat{color:#9a917f;font-variant-numeric:tabular-nums}
h1{font-size:16px;margin:4px 0 0}
p{max-width:720px;color:#9a917f;margin:0;text-align:center}
</style></head><body>
<h1>Duskfell — shore run</h1>
<p>One coherent shoreline, UO-scale zoom, chunky pixels. Toggle interpolation to compare raw server steps vs client tweening.</p>
<div class="bar">
<label><input type="checkbox" id="interp" checked> smooth interpolation</label>
<label>server tick <select id="tick"><option>4</option><option>6</option><option selected>8</option><option>12</option></select> Hz</label>
<span class="stat" id="fps">-- fps</span>
</div>
<canvas id="c" width="640" height="360"></canvas>
<script>
const CFG=__CFG__;
const terrain=new Image();terrain.src="__MIL__";
const sheet=new Image();sheet.src="__SHEET__";
const cv=document.getElementById('c'),g=cv.getContext('2d');
g.imageSmoothingEnabled=false;
const A=-Math.PI/4;
function p2m(u,v){const px=(u-0.5)*CFG.P,py=(v-0.5)*CFG.P;
 return [CFG.MW/2+px*Math.cos(A)-py*Math.sin(A), CFG.MW/2+px*Math.sin(A)+py*Math.cos(A)];}
function pathAt(t){const PP=CFG.PATH,f=t*(PP.length-1),i=Math.min(PP.length-2,Math.floor(f)),a=f-i;
 return [PP[i][1]*(1-a)+PP[i+1][1]*a, PP[i][0]*(1-a)+PP[i+1][0]*a];}
let cam={x:0,y:0,init:false};
let sv={t:0,prev:0,at:0,last:performance.now()};
const SPEED=0.11;
function serverStep(now,hz){const dt=(now-sv.last)/1000;if(dt<1/hz)return;
 sv.last=now;sv.prev=sv.t;sv.t+=SPEED*dt;if(sv.t>1){sv.t=0;sv.prev=0;cam.init=false;}sv.at=now;}
let fdist=0,lastRender=performance.now(),fpsA=0;
function loop(now){
 const hz=+document.getElementById('tick').value;
 serverStep(now,hz);
 const smooth=document.getElementById('interp').checked;
 let t;
 if(smooth){const a=Math.min(1,(now-sv.at)/(1000/hz));t=sv.prev+(sv.t-sv.prev)*a;}
 else t=sv.t;
 const[u,v]=pathAt(t);
 const[mx,my]=p2m(u,v);
 const tx=Math.max(0,Math.min(CFG.MW-CFG.CW,mx-CFG.CW/2));
 const ty=Math.max(0,Math.min(CFG.MW-CFG.CH,my-CFG.CH*0.52));
 if(!cam.init){cam.x=tx;cam.y=ty;cam.init=true;}
 if(smooth){cam.x+=(tx-cam.x)*0.12;cam.y+=(ty-cam.y)*0.12;}
 else{cam.x=tx;cam.y=ty;}
 const dt=(now-lastRender)/1000;lastRender=now;
 fdist+=SPEED*dt*CFG.P*1.35;
 const fi=Math.floor(fdist/15)%CFG.NF;
 const icx=Math.round(cam.x),icy=Math.round(cam.y);
 g.fillStyle='#101418';g.fillRect(0,0,cv.width,cv.height);
 g.drawImage(terrain,-icx,-icy);
 g.drawImage(sheet,fi*CFG.FW,0,CFG.FW,CFG.FH,
   Math.round(mx-icx-CFG.FW/2),Math.round(my-icy-CFG.FH*0.94),CFG.FW,CFG.FH);
 const edge=Math.min(t/0.03,(1-t)/0.03,1);
 if(edge<1){g.fillStyle='rgba(8,8,10,'+(1-Math.max(0,edge))+')';g.fillRect(0,0,cv.width,cv.height);}
 fpsA=fpsA*0.95+(1/Math.max(dt,1e-4))*0.05;
 document.getElementById('fps').textContent=fpsA.toFixed(0)+' fps · '+(smooth?'interpolated':'raw server steps');
 requestAnimationFrame(loop);}
terrain.onload=()=>requestAnimationFrame(loop);
</script></body></html>"""
html = html.replace("__CFG__", json.dumps(cfg)).replace("__MIL__", duri_png(mil_rgb)).replace("__SHEET__", duri_png(sheet))
out = os.path.join(DEMOS, "shore-run-demo.html")
open(out, "w").write(html)
print("html:", out, os.path.getsize(out) // 1024, "KB")
