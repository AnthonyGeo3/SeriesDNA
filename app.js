// UI wiring: state, events, cards. Pure logic lives in core.js, drawing in render.js.
import {
  CONFIG, PALETTES, fromTvmaze, prepareShow, hasEnoughData, maxMinutes, layout,
  episodeAt, positionOf, seasonAt, bandIndex, episodeCode, formatDelta, hoursIn, stats,
  snapP, encodeState, decodeState, tale,
} from "./core.js";
import { drawStrip, drawTicks } from "./render.js";
import { h } from "./dom.js";
import { createGame } from "./game.js";

const API = "https://api.tvmaze.com";
const SLOTS = ["a", "b"];
const TWEEN_MS = 500;
const SEARCH_DEBOUNCE_MS = 300;
const FLIP_MIN_GAP_MS = 150;
const CACHE_PREFIX = "sdna:v1:show:";
const PALETTE_KEY = "sdna:v1:palette";
const PLAYED_KEY = "sdna:v1:played";
const DRAGGED_KEY = "sdna:v1:dragged";
const URL_THROTTLE_MS = 300;

const $ = (sel, root = document) => root.querySelector(sel);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const widePanel = matchMedia("(min-width: 1000px)");

const state = {
  presets: {},
  shows: { a: null, b: null },
  stats: { a: null, b: null },
  p: 0, // scrubber position in [0,1] of the bar width
  mode: "pct",
  widthFrac: { a: 1, b: 1 }, // drawn strip widths (tweened)
  paletteKey: "neon",
  palette: PALETTES.neon,
  shown: { a: null, b: null }, // what each card currently shows
  season: { a: null, b: null }, // for haptics on season boundaries
  loading: { a: 0, b: 0 }, // request token per slot, so stale loads are dropped
};

const els = {
  strips: $("#strips"),
  track: $("#track"),
  laser: $("#laser"),
  scrub: $("#scrub"),
  status: $("#status"),
  legend: $("#legend"),
  verdict: $("#verdict"),
  tape: $("#tape"),
  dragHint: $("#drag-hint"),
  searchInput: $("#search-input"),
  searchResults: $("#search-results"),
  stats: $("#stats"),
  statsBody: $("#stats-body"),
  statsOpen: $("#stats-open"),
  statsBackdrop: $("#stats-backdrop"),
  toast: $("#toast"),
  palette: $("#palette"),
  share: $("#share"),
};
let trackWidth = 0;
let theme = null;

function applyPalette(palette) {
  const root = document.documentElement.style;
  palette.bands.forEach((c, i) => root.setProperty(`--band-${i}`, c));
  palette.ink.forEach((c, i) => root.setProperty(`--ink-${i}`, c));
  root.setProperty("--nodata", palette.noData);
}

function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    tick: v("--tick"),
    label: v("--muted"),
    font: v("--font"),
    markerLine: v("--marker-line"),
    pillBg: v("--pill-bg"),
    pillInk: v("--pill-ink"),
  };
}

let toastTimer = 0;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 4000);
}

// ---- Strips ----------------------------------------------------------------

function markersFor(slot) {
  const st = state.stats[slot];
  const out = [];
  if (st?.golden) out.push({ ...st.golden, label: "★ Golden era" });
  if (st?.drop) out.push({ ...st.drop, label: "Drop-off", dashed: true });
  return out;
}

function drawStrips() {
  for (const slot of SLOTS) {
    const show = state.shows[slot];
    const opts = { palette: state.palette, mode: state.mode, widthFrac: state.widthFrac[slot] };
    drawStrip($(`.strip[data-slot="${slot}"]`), show, { ...opts, markers: markersFor(slot), theme });
    drawTicks($(`.ticks[data-slot="${slot}"]`), show, { ...opts, ...theme });
  }
}

function drawAll() {
  drawStrips();
  trackWidth = els.track.getBoundingClientRect().width;
  moveLaser();
}

function targetWidths() {
  const max = maxMinutes(SLOTS.map((s) => state.shows[s]));
  return Object.fromEntries(SLOTS.map((s) => [s, layout(state.shows[s], state.mode, max).widthFrac]));
}

// Tween strip widths to their targets (mode toggle, or a new show changing
// the longest runtime), redrawing each frame.
let tweenFrame = 0;
function animateWidths() {
  cancelAnimationFrame(tweenFrame);
  const to = targetWidths();
  const from = { ...state.widthFrac };
  if (reducedMotion.matches) {
    state.widthFrac = to;
    drawStrips();
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / TWEEN_MS);
    const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease-in-out
    for (const s of SLOTS) state.widthFrac[s] = t === 1 ? to[s] : from[s] + (to[s] - from[s]) * k;
    drawStrips();
    if (t < 1) tweenFrame = requestAnimationFrame(step);
  };
  tweenFrame = requestAnimationFrame(step);
}

function renderLabels() {
  for (const slot of SLOTS) {
    const show = state.shows[slot];
    $(`.slot[data-slot="${slot}"] .slot-name`).textContent = show.name;
    const name = $(`.label[data-slot="${slot}"] .label-name`);
    name.textContent = show.name;
    name.title = show.year ? `${show.name} (${show.year})` : show.name;
    $(`.label[data-slot="${slot}"] .coverage`).textContent = `${Math.round(show.coverage * 100)}% rated`;
    $(`.label[data-slot="${slot}"] .label-hours`).textContent = `${Math.round(show.totalMinutes / 60)} hrs`;
    $(`.strip[data-slot="${slot}"]`).setAttribute(
      "aria-label",
      `${show.name}: ${show.n} episodes across ${show.seasons.length} seasons, average rating ${show.avg.toFixed(1)}`
    );
    cards[slot].show.textContent = show.name;
  }
}

// ---- Cards -----------------------------------------------------------------

const cards = {};

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
  state.p = snapP(p);
  userDriven ||= fromUser;
  queueFrame();
}

function queueFrame() {
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
    spoken.push(`${show.name} ${ended ? "ended" : episodeCode(ep)}, ${ep.rating != null ? ep.rating.toFixed(1) : "no rating"}`);
  }
  els.scrub.setAttribute("aria-valuetext", spoken.join("; "));
  scheduleUrl();

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

  // First visit: say the strips can be dragged, until they have been.
  let dragged = false;
  try {
    dragged = localStorage.getItem(DRAGGED_KEY) === "1";
  } catch {
    // No storage: show the hint this visit.
  }
  els.dragHint.hidden = dragged;
  const used = () => {
    if (!els.dragHint.hidden) {
      els.dragHint.hidden = true;
      try {
        localStorage.setItem(DRAGGED_KEY, "1");
      } catch {
        // Not remembered in private mode.
      }
    }
  };
  els.track.addEventListener("pointerdown", used);
  els.scrub.addEventListener("input", used);
}

// ---- Colour key and tale of the tape ---------------------------------------------

// Built from CONFIG.thresholds; the swatches use the palette's CSS variables,
// so they follow the palette switch.
function renderLegend() {
  const t = CONFIG.thresholds;
  const labels = [...t.map((x) => `${x.toFixed(1)}+`), `<${t.at(-1).toFixed(1)}`];
  const item = (swatch, text) => h("span", { class: "legend-item", role: "listitem" },
    h("span", { class: "legend-swatch", style: `background: var(${swatch})` }), text);
  els.legend.replaceChildren(
    h("span", { class: "legend-title" }, "Episode rating"),
    ...labels.map((text, i) => item(`--band-${i}`, text)),
    item("--nodata", "no rating"));
}

function verdictText(t) {
  const { a, b } = t.score;
  if (t.winner === "draw") return `Dead heat, ${a}–${b}`;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return `${state.shows[t.winner].name} wins ${hi}–${lo}`;
}

function tapeCell(row, side) {
  const v = row[side];
  let text = "–";
  if (v != null && typeof v === "object") text = `S${v.s} · ${v.mean.toFixed(1)}`;
  else if (v != null) text = row.key === "steady" ? `±${v.toFixed(2)}` : `★ ${v.toFixed(1)}`;
  const win = row.winner === side;
  return h("td", { class: win ? "win" : row.winner && row.winner !== "tie" ? "lose" : null },
    text, win ? h("span", { class: "sr-only" }, " (wins)") : null);
}

const TAPE_HINTS = {
  avg: "Mean rating of every rated episode",
  peak: "Best run of 5 episodes in a row (the Golden Era)",
  best: "Highest-rated season",
  worst: "Lowest-rated season: the less bad one wins",
  steady: "How much ratings swing (standard deviation): steadier wins",
  latest: "Most recent season with enough ratings",
};

function tapeTable(t) {
  const name = (slot) => h("th", { scope: "col", title: state.shows[slot].name },
    h("span", { class: "tape-slot" }, slot.toUpperCase()), " ", state.shows[slot].name);
  return h("div", { class: "tape-inner" },
    h("div", { class: "tape-head" }, h("span", { class: "tape-title" }, "Tale of the tape"), h("b", {}, verdictText(t))),
    h("table", { class: "tape-table" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Round")), name("a"), name("b"))),
      h("tbody", {}, ...t.rows.map((row) =>
        h("tr", {}, h("th", { scope: "row", title: TAPE_HINTS[row.key] }, row.label), tapeCell(row, "a"), tapeCell(row, "b"))))));
}

function renderTape() {
  const t = tale(state.shows.a, state.shows.b);
  els.verdict.replaceChildren(h("span", { "aria-hidden": "true" }, "⚖ "), verdictText(t), h("span", { class: "verdict-more" }, " · see why"));
  els.tape.replaceChildren(tapeTable(t));
}

// ---- Mode toggle (% Lifespan <-> Hours) -------------------------------------------

function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  syncModeButtons();
  animateWidths();
  queueFrame();
}

function syncModeButtons() {
  for (const b of document.querySelectorAll(".mode button")) b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
}

function bindMode() {
  for (const b of document.querySelectorAll(".mode button")) b.addEventListener("click", () => setMode(b.dataset.mode));
}

// ---- Loading shows ---------------------------------------------------------------

function cacheGet(id) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cacheSet(show) {
  try {
    localStorage.setItem(CACHE_PREFIX + show.id, JSON.stringify(show));
  } catch {
    // Private mode or full storage: the show just won't be cached.
  }
}

async function fetchShow(id) {
  const res = await fetch(`${API}/shows/${id}?embed=episodes`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return fromTvmaze(json, json._embedded?.episodes ?? []);
}

async function loadIntoSlot(slot, { id, name }) {
  const token = ++state.loading[slot];
  const skeleton = $(`.skeleton[data-slot="${slot}"]`);
  let raw = state.presets[id] ?? cacheGet(id);
  if (!raw) {
    skeleton.hidden = false;
    try {
      raw = await fetchShow(id);
    } catch {
      if (token === state.loading[slot]) {
        skeleton.hidden = true;
        toast(navigator.onLine === false
          ? "You're offline. The presets still work."
          : "Couldn't reach TVmaze. Check your connection; the presets still work.");
      }
      return;
    }
    if (token !== state.loading[slot]) return; // a newer pick replaced this one
    skeleton.hidden = true;
  }
  const show = prepareShow(raw);
  if (!hasEnoughData(show)) {
    toast(`Not enough rating data to build a DNA strip for ${name}.`);
    return;
  }
  if (!state.presets[id]) cacheSet(raw);
  setSlot(slot, show);
  refreshAfterShowChange();
}

function setSlot(slot, show) {
  state.shows[slot] = show;
  state.stats[slot] = stats(show);
  state.shown[slot] = null;
  state.season[slot] = null;
}

function refreshAfterShowChange() {
  renderLabels();
  renderTape();
  renderStats();
  animateWidths(); // the longest runtime may have changed (hours mode)
  drawStrips();
  queueFrame();
}

// ---- Search ----------------------------------------------------------------------

let searchTimer = 0;
let searchController = null;

function presetMatches(q) {
  const needle = q.toLowerCase();
  return Object.values(state.presets)
    .filter((s) => s.name.toLowerCase().includes(needle))
    .map((s) => ({ id: s.id, name: s.name, year: s.year }))
    .sort((a, b) => a.name.localeCompare(b.name)); // presets are keyed by id, so order them for people
}

function resultRow(entry) {
  const pick = (slot) => () => {
    closeSearch();
    els.searchInput.value = "";
    els.searchInput.blur();
    loadIntoSlot(slot, entry);
  };
  const slotButton = (slot) =>
    h("button", {
      type: "button",
      onclick: pick(slot),
      "aria-label": `Put ${entry.name} in slot ${slot.toUpperCase()}, replacing ${state.shows[slot].name}`,
      title: `Replace ${state.shows[slot].name}`,
    }, `→ ${slot.toUpperCase()}`);
  return h("div", { class: "result" },
    h("span", { class: "result-name" }, entry.name, entry.year ? h("span", { class: "result-year" }, String(entry.year)) : null),
    slotButton("a"),
    slotButton("b"));
}

// live: undefined = not searched, "loading", "error", or an array of results.
function renderResults(q, live) {
  const box = els.searchResults;
  box.replaceChildren();
  const presets = presetMatches(q);
  if (presets.length) {
    box.append(h("div", { class: "results-head" }, q ? "Presets" : "Presets (work offline)"));
    for (const p of presets) box.append(resultRow(p));
  }
  if (q.length >= 2) {
    box.append(h("div", { class: "results-head" }, "TVmaze"));
    if (live === "loading") box.append(h("div", { class: "results-note" }, "Searching…"));
    else if (live === "error") box.append(h("div", { class: "results-note" }, "Couldn't reach TVmaze. The presets still work."));
    else if (Array.isArray(live)) {
      const fresh = live.filter((r) => !state.presets[r.id]);
      if (!fresh.length && !presets.length) box.append(h("div", { class: "results-note" }, `No shows found for “${q}”.`));
      for (const r of fresh) box.append(resultRow(r));
    }
  }
  openSearch();
}

async function searchLive(q) {
  searchController?.abort();
  searchController = new AbortController();
  try {
    const res = await fetch(`${API}/search/shows?q=${encodeURIComponent(q)}`, { signal: searchController.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const live = json.slice(0, 5).map(({ show }) => ({
      id: show.id,
      name: show.name,
      year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    }));
    if (els.searchInput.value.trim() === q) renderResults(q, live);
  } catch (err) {
    if (err.name !== "AbortError" && els.searchInput.value.trim() === q) renderResults(q, "error");
  }
}

function openSearch() {
  els.searchResults.hidden = false;
  els.searchInput.setAttribute("aria-expanded", "true");
  fitResults();
}

// In landscape an on-screen keyboard can cover most of the screen; keep the
// dropdown inside what's still visible above it.
function fitResults() {
  if (els.searchResults.hidden) return;
  const vv = window.visualViewport;
  const visibleBottom = vv ? vv.offsetTop + vv.height : innerHeight;
  const top = els.searchResults.getBoundingClientRect().top;
  els.searchResults.style.setProperty("--results-max", `${Math.max(64, Math.floor(visibleBottom - top - 8))}px`);
}

function closeSearch() {
  clearTimeout(searchTimer);
  searchController?.abort();
  els.searchResults.hidden = true;
  els.searchInput.setAttribute("aria-expanded", "false");
}

function bindSearch() {
  els.searchInput.addEventListener("input", () => {
    const q = els.searchInput.value.trim();
    clearTimeout(searchTimer);
    searchController?.abort();
    if (q.length < 2) {
      renderResults(q);
      return;
    }
    renderResults(q, "loading");
    searchTimer = setTimeout(() => searchLive(q), SEARCH_DEBOUNCE_MS);
  });
  els.searchInput.addEventListener("focus", () => {
    if (!els.searchInput.value.trim()) renderResults("");
  });
  // The keyboard's search key searches now and puts the keyboard away so
  // the results can be tapped; touching the list does the same.
  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = els.searchInput.value.trim();
    if (q.length >= 2) {
      clearTimeout(searchTimer);
      searchLive(q);
    }
    els.searchInput.blur();
  });
  els.searchResults.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" && document.activeElement === els.searchInput) els.searchInput.blur();
  });
  window.visualViewport?.addEventListener("resize", fitResults);
  window.visualViewport?.addEventListener("scroll", fitResults);
  document.addEventListener("pointerdown", (e) => {
    if (!$("#search").contains(e.target)) closeSearch();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!els.searchResults.hidden) {
      closeSearch();
      els.searchInput.blur();
    } else if (!els.stats.hidden) toggleStats(false);
  });
}

// ---- Stats sheet -----------------------------------------------------------------

function jumpTo(slot, start, end) {
  const show = state.shows[slot];
  const max = maxMinutes(SLOTS.map((s) => state.shows[s]));
  setP(positionOf(show, Math.round((start + end) / 2), state.mode, max), true);
  if (!widePanel.matches) toggleStats(false); // the drawer covers the cards on phones
}

function statButton(slot, name, range, value, note) {
  return h("button", { type: "button", class: "stat", onclick: () => jumpTo(slot, range.start, range.end), title: "Jump the laser here" },
    h("span", { class: "stat-name" }, name),
    h("span", { class: "stat-value" }, value),
    h("span", { class: "stat-note" }, note));
}

function renderStats() {
  if (els.stats.hidden) return;
  els.statsBody.replaceChildren(h("section", { class: "stats-tape" }, tapeTable(tale(state.shows.a, state.shows.b))));
  for (const slot of SLOTS) {
    const show = state.shows[slot];
    const st = state.stats[slot];
    const code = (i) => episodeCode(show.episodes[i]);
    const count = (r) => `${r.end - r.start + 1} episodes`;
    const section = h("section", { class: "stats-show" },
      h("h3", {}, show.name, h("small", {}, `${show.n} eps · ${Math.round(show.totalMinutes / 60)} hrs · avg ${show.avg.toFixed(1)}`)));
    if (st.golden) {
      section.append(statButton(slot, "Golden Era", st.golden,
        `${code(st.golden.start)} – ${code(st.golden.end)}`,
        `★ ${st.golden.mean.toFixed(1)} average over ${count(st.golden)}`));
    }
    if (st.whiplash) {
      section.append(h("div", { class: "stat" },
        h("span", { class: "stat-name" }, "Whiplash"),
        h("span", { class: "stat-value" }, st.whiplash.label),
        h("span", { class: "stat-note" }, `ratings swing ±${st.whiplash.sd.toFixed(2)} (std dev)`)));
    }
    if (st.drop) {
      section.append(statButton(slot, "Drop-Off", st.drop,
        `${Math.round(st.drop.at)}% in · ${code(st.drop.start)} – ${code(st.drop.end)}`,
        `★ ${st.drop.mean.toFixed(1)} average over ${count(st.drop)}`));
    }
    els.statsBody.append(section);
  }
}

function toggleStats(open = els.stats.hidden) {
  els.stats.hidden = !open;
  els.statsBackdrop.hidden = !open;
  els.statsOpen.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("stats-open", open);
  if (open) renderStats();
}

function bindStats() {
  els.statsOpen.addEventListener("click", () => toggleStats());
  $("#stats-close").addEventListener("click", () => toggleStats(false));
  els.statsBackdrop.addEventListener("click", () => toggleStats(false));
}

// ---- URL state and sharing -----------------------------------------------------

const currentState = () => ({ a: state.shows.a.id, b: state.shows.b.id, p: state.p, mode: state.mode });
const shareUrl = () => `${location.origin}${location.pathname}?${encodeState(currentState())}`;

// Trailing throttle: the URL catches up with the latest state.
let urlTimer = 0;
function scheduleUrl() {
  if (urlTimer) return;
  urlTimer = setTimeout(() => {
    urlTimer = 0;
    history.replaceState(null, "", `?${encodeState(currentState())}`);
  }, URL_THROTTLE_MS);
}

async function share() {
  const url = shareUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: "Series DNA", text: `${state.shows.a.name} vs ${state.shows.b.name}`, url });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // the user closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  } catch {
    toast(url); // no clipboard access: at least show the link
  }
}

function setPalette(key, announce) {
  state.paletteKey = key;
  state.palette = PALETTES[key];
  applyPalette(state.palette);
  els.palette.setAttribute("aria-pressed", String(key === "okabe"));
  try {
    localStorage.setItem(PALETTE_KEY, key);
  } catch {
    // Not persisted in private mode; the switch still works.
  }
  if (announce) toast(`${state.palette.name} palette`);
}

function savedPalette() {
  try {
    const key = localStorage.getItem(PALETTE_KEY);
    return PALETTES[key] ? key : "neon";
  } catch {
    return "neon";
  }
}

// Everything the game can ask about: presets, shows searched for before
// (cached) and whatever is loaded now.
function gameShows() {
  const byId = new Map(Object.values(state.presets).map((raw) => [raw.id, raw]));
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(CACHE_PREFIX)) continue;
      const raw = JSON.parse(localStorage.getItem(key));
      if (raw?.episodes?.length && hasEnoughData(prepareShow(raw))) byId.set(raw.id, raw);
    }
  } catch {
    // No storage: presets are plenty.
  }
  for (const show of Object.values(state.shows)) if (show) byId.set(show.id, show);
  return [...byId.values()];
}

function bindHeaderButtons() {
  const game = createGame({
    getShows: gameShows,
    getStyle: () => ({ palette: state.palette, theme }),
    reducedMotion,
  });
  // Pulse the Play button until the game has been tried once.
  const play = $("#game-open");
  let played = false;
  try {
    played = localStorage.getItem(PLAYED_KEY) === "1";
  } catch {
    // No storage: just pulse this visit.
  }
  play.classList.toggle("nudge", !played);
  play.addEventListener("click", () => {
    closeSearch();
    toggleStats(false);
    play.classList.remove("nudge");
    try {
      localStorage.setItem(PLAYED_KEY, "1");
    } catch {
      // Not remembered in private mode.
    }
    game.open(play);
  });
  els.share.addEventListener("click", share);
  els.palette.addEventListener("click", () => {
    setPalette(state.paletteKey === "okabe" ? "neon" : "okabe", true);
    drawStrips();
  });
}

// A shared link may name non-preset shows: preset, then cache, then TVmaze.
// Anything that can't be loaded falls back to the default for that slot.
async function initialShow(slot, id) {
  let raw = state.presets[id] ?? cacheGet(id);
  if (!raw) {
    try {
      raw = await fetchShow(id);
    } catch {
      raw = null;
    }
  }
  const show = raw && prepareShow(raw);
  if (show && hasEnoughData(show)) {
    if (!state.presets[id]) cacheSet(raw);
    return { show, ok: true };
  }
  return { show: prepareShow(state.presets[CONFIG.defaultShows[slot]]), ok: false };
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

// ---- Boot ----------------------------------------------------------------------

async function init() {
  setPalette(savedPalette(), false);
  theme = readTheme();
  try {
    const res = await fetch("data/presets.json");
    if (!res.ok) throw new Error(res.status);
    state.presets = await res.json();
  } catch {
    if (location.protocol !== "file:") els.status.textContent = "Couldn't load the show data. Try reloading.";
    return;
  }
  buildCards();
  const want = decodeState(location.search);
  const loaded = await Promise.all(SLOTS.map((slot) => initialShow(slot, want[slot])));
  SLOTS.forEach((slot, i) => setSlot(slot, loaded[i].show));
  if (loaded.some((r) => !r.ok)) toast("Couldn't load a show from the link, so a preset stands in.");
  state.mode = want.mode;
  syncModeButtons();
  state.widthFrac = targetWidths();
  els.status.textContent = "";
  renderLegend();
  renderLabels();
  renderTape();
  drawAll();
  bindScrubbing();
  bindMode();
  bindSearch();
  bindStats();
  bindHeaderButtons();
  els.verdict.addEventListener("click", () => toggleStats(true));
  bindResize();
  setP(want.p, false);
}

init();
