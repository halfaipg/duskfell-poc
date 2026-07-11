// Phones and tablets get a reduced-memory render profile: iOS Safari
// silently blanks canvases once total canvas memory crosses ~250MB, which
// desktop-tuned composite caches sail straight past.
export const CONSTRAINED_DEVICE =
  typeof navigator !== "undefined" &&
  ((navigator.deviceMemory != null && navigator.deviceMemory <= 4) ||
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent ?? ""));

// phones report devicePixelRatio 3; rendering the world canvas at 3x burns
// memory and fill rate for no visible gain at game zoom levels
export const RENDER_DPR_CAP = CONSTRAINED_DEVICE ? 2 : Infinity;
