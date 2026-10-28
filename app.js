// UI wiring: state, events, cards. Pure logic lives in core.js, drawing in render.js.
import {
  CONFIG, PALETTES, prepareShow, maxMinutes, layout, episodeAt, seasonAt,
  bandIndex, episodeCode, formatDelta, hoursIn,
} from "./core.js";
import { drawStrip, drawTicks } from "./render.js";

const SLOTS = ["a", "b"];
const $ = (sel, root = document) => root.querySelector(sel);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  shows: { a: null, b: null },
  p: 0, // scrubber position in [0,1] of the bar width
  mode: "pct",
  palette: PALETTES.neon,
  shown: { a: null, b: null }, // what each card currently shows
  season: { a: null, b: null }, // for haptics on season boundaries
};

const els = {
  strips: $("#strips"),
  track: $("#track"),
  laser: $("#laser"),
  scrub: $("#scrub"),
  status: $("#status"),
  rotate: $("#rotate"),
};
let trackWidth = 0;

function applyPalette(palette) {
  const root = document.documentElement.style;
  palette.bands.forEach((c, i) => root.setProperty(`--band-${i}`, c));
  palette.ink.forEach((c, i) => root.setProperty(`--ink-${i}`, c));
  root.setProperty("--nodata", palette.noData);
}

// ---- Strips ----------------------------------------------------------------

function drawAll() {
  const shows = SLOTS.map((s) => state.shows[s]);
  const max = maxMinutes(shows);
  const css = getComputedStyle(document.documentElement);
  const theme = {
    tick: css.getPropertyValue("--tick").trim(),
    label: css.getPropertyValue("--muted").trim(),
    font: css.getPropertyValue("--font").trim(),
  };
  for (const slot of SLOTS) {
    const show = state.shows[slot];
    const { widthFrac } = layout(show, state.mode, max);
    const opts = { palette: state.palette, mode: state.mode, widthFrac };
    drawStrip($(`.strip[data-slot="${slot}"]`), show, opts);
    drawTicks($(`.ticks[data-slot="${slot}"]`), show, { ...opts, ...theme });
  }
  trackWidth = els.track.getBoundingClientRect().width;
  moveLaser();
}

function renderLabels() {
  for (const slot of SLOTS) {
    const show = state.shows[slot];
    const pct = Math.round(show.coverage * 100);
    $(`.slot[data-slot="${slot}"] .slot-name`).textContent = show.name;
    const name = $(`.label[data-slot="${slot}"] .label-name`);
    name.textContent = show.name;
    name.title = `${show.name} (${show.year})`;
    $(`.label[data-slot="${slot}"] .coverage`).textContent = `${pct}% rated`;
    $(`.strip[data-slot="${slot}"]`).setAttribute(
      "aria-label",
      `${show.name}: ${show.n} episodes across ${show.seasons.length} seasons, average rating ${show.avg.toFixed(1)}`
    );
  }
}

// ---- Cards -----------------------------------------------------------------

const cards = {};
const FLIP_MIN_GAP_MS = 150;

function buildCards() {
  for (const slot of SLOTS) {
    const el = $(`.card[data-slot="${slot}"]`);
    el.innerHTML = `
      <div class="card-show"></div>
      <div class="card-body">
        <div class="card-ep"><span class="card-code"></span><span class="card-title"></span></div>
        <div class="card-row">
          <span class="card-rating"></span>
          <span class="card-delta"></span>
          <span class="card-ended">Ended</span>
          <span class="card-hours"></span>
        </div>
      </div>`;
    cards[slot] = {
      el,
      show: $(".card-show", el),
      body: $(".card-body", el),
      code: $(".card-code", el),
      title: $(".card-title", el),
      rating: $(".card-rating", el),
      delta: $(".card-delta", el),
      hours: $(".card-hours", el),
      anim: null,
      lastChange: -Infinity,
    };
    cards[slot].show.textContent = state.shows[slot].name;
  }
}

function renderCard(slot, idx, ended, animate) {
  const show = state.shows[slot];
  const ep = show.episodes[idx];
  const c = cards[slot];
  c.code.textContent = episodeCode(ep);
  c.title.textContent = ep.title;
  c.title.title = ep.title;
  const hasRating = ep.rating != null;
  c.rating.textContent = hasRating ? `★ ${ep.rating.toFixed(1)}` : "No rating";
  c.rating.classList.toggle("none", !hasRating);
  const delta = formatDelta(show, ep);
  c.delta.textContent = delta ?? "";
  c.delta.hidden = delta == null;
  c.delta.title = delta == null ? "" : `vs the show's ${show.avg.toFixed(1)} average`;
  const band = bandIndex(ep.rating);
  c.el.style.setProperty("--accent", band < 0 ? "var(--nodata)" : `var(--band-${band})`);
  c.el.style.setProperty("--accent-ink", band < 0 ? "var(--fg)" : `var(--ink-${band})`);
  c.hours.textContent = `${hoursIn(show, idx).toFixed(1)} hrs in`;
  c.el.classList.toggle("ended", ended);

  // Flip only when stepping slowly; during a fast scrub the text just updates.
  const now = performance.now();
  const settled = now - c.lastChange > FLIP_MIN_GAP_MS;
  c.lastChange = now;
  if (animate && settled && !reducedMotion.matches && c.body.animate) {
    c.anim?.cancel();
    c.anim = c.body.animate(
      [{ opacity: 0.35, transform: "rotateX(40deg)" }, { opacity: 1, transform: "none" }],
      { duration: 180, easing: "ease-out" }
    );
  }
}

// ---- Scrubbing ---------------------------------------------------------------

let frameQueued = false;
let userDriven = false;

function setP(p, fromUser) {
  state.p = Math.min(1, Math.max(0, p));
  userDriven ||= fromUser;
  if (!frameQueued) {
    frameQueued = true;
    requestAnimationFrame(frame);
  }
}

function moveLaser() {
  els.laser.style.transform = `translateX(${state.p * trackWidth - 1}px)`;
}

// All visual updates for a scrub happen here, once per frame.
function frame() {
  frameQueued = false;
  moveLaser();
  const v = Math.round(state.p * 1000);
  if (+els.scrub.value !== v) els.scrub.value = v;

  const max = maxMinutes(SLOTS.map((s) => state.shows[s]));
  let crossedSeason = false;
  const spoken = [];
  for (const slot of SLOTS) {
    const show = state.shows[slot];
    const { idx, ended } = episodeAt(show, state.p, state.mode, max);
    const prev = state.shown[slot];
    if (!prev || prev.idx !== idx || prev.ended !== ended) {
      renderCard(slot, idx, ended, prev != null);
      state.shown[slot] = { idx, ended };
    }
    const season = seasonAt(show, idx);
    if (state.season[slot] != null && season !== state.season[slot]) crossedSeason = true;
    state.season[slot] = season;
    const ep = show.episodes[idx];
    spoken.push(`${show.name} ${episodeCode(ep)}, ${ep.rating != null ? ep.rating.toFixed(1) : "no rating"}`);
  }
  els.scrub.setAttribute("aria-valuetext", spoken.join("; "));

  // Tactile tick on Android; a no-op elsewhere.
  if (crossedSeason && userDriven && "vibrate" in navigator) navigator.vibrate(8);
  userDriven = false;
}

function bindScrubbing() {
  let rect = null;
  const fromPointer = (e) => setP((e.clientX - rect.left) / rect.width, true);
  els.track.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    rect = els.track.getBoundingClientRect();
    els.track.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  els.track.addEventListener("pointermove", (e) => {
    if (rect) fromPointer(e);
  });
  const end = () => (rect = null);
  els.track.addEventListener("pointerup", end);
  els.track.addEventListener("pointercancel", end);
  els.scrub.addEventListener("input", () => setP(els.scrub.value / 1000, true));
}

// ---- Resize ------------------------------------------------------------------

function bindResize() {
  let queued = false;
  const redraw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      drawAll();
    });
  };
  new ResizeObserver(redraw).observe(els.strips);
  window.addEventListener("resize", redraw); // also catches zoom / DPR changes
}

// ---- Portrait prompt -----------------------------------------------------------

function bindRotatePrompt() {
  const portrait = matchMedia("(orientation: portrait) and (max-width: 700px)");
  let dismissed = false; // per session, in memory only
  const sync = () => (els.rotate.hidden = dismissed || !portrait.matches);
  portrait.addEventListener("change", sync);
  $("#rotate-dismiss").addEventListener("click", () => {
    dismissed = true;
    sync();
  });
  // Orientation lock only works in fullscreen on Android; iOS has neither.
  const lock = $("#rotate-lock");
  if (document.documentElement.requestFullscreen && screen.orientation?.lock) {
    lock.hidden = false;
    lock.addEventListener("click", async () => {
      try {
        await document.documentElement.requestFullscreen();
        await screen.orientation.lock("landscape");
      } catch {
        // Not supported here: the prompt stays until the phone is rotated.
      }
    });
  }
  sync();
}

// ---- Boot ----------------------------------------------------------------------

async function init() {
  applyPalette(state.palette);
  bindRotatePrompt();
  let presets;
  try {
    const res = await fetch("data/presets.json");
    if (!res.ok) throw new Error(res.status);
    presets = await res.json();
  } catch {
    if (location.protocol !== "file:") els.status.textContent = "Couldn't load the show data. Try reloading.";
    return;
  }
  for (const slot of SLOTS) state.shows[slot] = prepareShow(presets[CONFIG.defaultShows[slot]]);
  els.status.textContent = "";
  renderLabels();
  buildCards();
  drawAll();
  bindScrubbing();
  bindResize();
  setP(0, false);
}

init();
