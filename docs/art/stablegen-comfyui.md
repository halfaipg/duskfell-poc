# StableGen ComfyUI Backend

Dedicated ComfyUI instance for [StableGen](https://github.com/sakalond/StableGen) — the Blender addon we use for AI-assisted mesh generation and texturing (items, players, props). Set up 2026-07-10.

## Where it runs

- **Host:** `192.168.66.52` (VPN), user `gorgadon`
- **GPU split:** RTX 3090 (GPU0) is dedicated to this StableGen ComfyUI. The RTX 5090 (GPU1) stays untouched as the live media worker serving the grid (~4 GB in use).
- **Service:** `stablegen-comfy.service` (systemd) — active + enabled, so it survives reboots and auto-restarts on failure.

## How to reach it

- On the VPN: <http://192.168.66.52:8189>
- Off the VPN, tunnel first:

  ```sh
  ssh -L 8189:localhost:8189 gorgadon@192.168.66.52
  # then open http://localhost:8189
  ```

- **From Blender (StableGen addon):** in StableGen's preferences, set the ComfyUI server address to `http://192.168.66.52:8189` (or `http://localhost:8189` when tunneling). That's the whole connection — StableGen drives this instance for both mesh gen (TRELLIS) and texturing (SDXL/RealVisXL).

## What's installed

All custom nodes load with zero import failures.

- **SDXL texturing:** RealVisXL V5.0 + ControlNet Union ProMax + depth + IP-Adapter + Hyper/LoRAs
- **TRELLIS.2:** image → 3D mesh (CUDA wheels resolved clean for cu124 / torch 2.6); model configs registered
- **PBR extraction:** Marigold + StableDelight
- **Extras:** GeometryPack, IPAdapter_plus
- Reuses the existing FLUX models/encoders **read-only** — no duplicate weights on disk

## How this fits the pipeline

Per [blender-img2img-pipeline.md](blender-img2img-pipeline.md), Blender owns deterministic structure (camera, scale, silhouettes, poses) and img2img owns painterly richness. StableGen adds the 3D leg: image→mesh via TRELLIS.2 for candidate props/items, and multi-view-consistent SDXL texturing of meshes we already have (e.g. the wretch, world-kit props) instead of hand-painting or single-view projection.
