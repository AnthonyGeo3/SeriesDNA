// Canvas drawing. Works in device pixels so strips stay crisp on hi-DPI.
import { segments, ratingToBand } from "./core.js";

// Match the backing store to the element's CSS size x devicePixelRatio.
export function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

export function drawStrip(canvas, show, { palette, mode = "pct", widthFrac = 1 }) {
  const { w, h, dpr } = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const drawW = Math.round(w * widthFrac);
  // A hairline gap between episodes reads as a barcode when they're wide.
  const gap = drawW / show.n >= 8 * dpr ? Math.max(1, Math.round(dpr / 2)) : 0;
  let fill = null;
  for (const seg of segments(show, mode, drawW)) {
    const colour = ratingToBand(seg.rating, palette);
    if (colour !== fill) ctx.fillStyle = fill = colour;
    ctx.fillRect(seg.x, 0, Math.max(1, seg.w - gap), h);
  }
}

// Season ticks with "S1, S2…" labels; labels that would collide are hidden,
// ticks are always kept.
export function drawTicks(canvas, show, { mode = "pct", widthFrac = 1, tick, label, font }) {
  const { w, h, dpr } = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const starts = mode === "hours" ? show.startsHours : show.startsPct;
  const drawW = Math.round(w * widthFrac);
  ctx.font = `${Math.round(10 * dpr)}px ${font}`;
  ctx.textBaseline = "bottom";
  const pad = 3 * dpr;
  let lastEnd = -Infinity;
  for (const { s, start } of show.seasons) {
    const x = Math.round(starts[start] * drawW);
    ctx.fillStyle = tick;
    ctx.fillRect(x, 0, Math.max(1, Math.round(dpr)), Math.round(5 * dpr));
    const text = `S${s}`;
    const tw = ctx.measureText(text).width;
    if (x + pad >= lastEnd + 2 * pad && x + pad + tw <= w) {
      ctx.fillStyle = label;
      ctx.fillText(text, x + pad, h);
      lastEnd = x + pad + tw;
    }
  }
}
