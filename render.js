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

export function drawStrip(canvas, show, { palette, mode = "pct", widthFrac = 1, markers = [], theme }) {
  const { w, h, dpr } = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const drawW = Math.round(w * widthFrac);
  // A hairline gap between episodes reads as a barcode when they're wide.
  const gap = drawW / show.n >= 8 * dpr ? Math.max(1, Math.round(dpr / 2)) : 0;
  let fill = null;
  const segs = segments(show, mode, drawW);
  segs.forEach((seg, i) => {
    const colour = ratingToBand(seg.rating, palette);
    if (colour !== fill) ctx.fillStyle = fill = colour;
    const g = i === segs.length - 1 ? 0 : gap; // the strip ends flush
    ctx.fillRect(seg.x, 0, Math.max(1, seg.w - g), h);
  });
  drawMarkers(ctx, show, { mode, drawW, h, dpr, markers, theme });
}

// Golden Era / Drop-Off: an outline round the episode range plus a small
// label pill pinned to its start (kept inside the strip).
function drawMarkers(ctx, show, { mode, drawW, h, dpr, markers, theme }) {
  // Skip on strips too short or narrow (hours mode) to carry the pills.
  if (!markers.length || h < 24 * dpr || drawW < 160 * dpr) return;
  const starts = mode === "hours" ? show.startsHours : show.startsPct;
  const line = Math.max(1, Math.round(1.5 * dpr));
  ctx.font = `700 ${Math.round(10 * dpr)}px ${theme.font}`;
  ctx.textBaseline = "middle";
  for (const { start, end, label, dashed } of markers) {
    const x0 = Math.round(starts[start] * drawW);
    const x1 = Math.max(x0 + line * 2, Math.round(starts[end + 1] * drawW));
    ctx.save();
    ctx.strokeStyle = theme.markerLine;
    ctx.lineWidth = line;
    ctx.setLineDash(dashed ? [3 * dpr, 2 * dpr] : []);
    ctx.strokeRect(x0 + line / 2, line / 2, x1 - x0 - line, h - line);
    ctx.restore();

    const padX = 5 * dpr;
    const pillH = Math.round(15 * dpr);
    const pillW = Math.ceil(ctx.measureText(label).width + padX * 2);
    // Inside the drawn strip; Drop-Off sits at the bottom so the two never collide.
    const px = Math.max(0, Math.min(x0, drawW - pillW));
    const py = dashed ? h - pillH - Math.round(3 * dpr) : Math.round(3 * dpr);
    ctx.fillStyle = theme.pillBg;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(px, py, pillW, pillH, pillH / 2) : ctx.rect(px, py, pillW, pillH);
    ctx.fill();
    ctx.fillStyle = theme.pillInk;
    ctx.fillText(label, px + padX, py + pillH / 2 + dpr / 2);
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
