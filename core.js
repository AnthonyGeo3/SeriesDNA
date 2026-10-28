// Pure functions: data prep, colour, layout, position mapping. No DOM access,
// so everything here can be checked in Node (see core.test.mjs).

export const CONFIG = {
  // Band thresholds, best first: >=8.8, >=8.4, >=8.0, >=7.6, else lowest.
  // TVmaze ratings cluster around 8, so the plan's 9/8/7/6 left most shows
  // two-tone (see the Phase 0 audit).
  thresholds: [8.8, 8.4, 8.0, 7.6],
  defaultRuntime: 45,
  guard: { maxEpisodes: 1500, minCoverage: 0.5 },
  defaultShows: { a: 15299, b: 67 }, // The Boys vs Grey's Anatomy
};

// Five bands, best first, matching CONFIG.thresholds. `ink` is the text
// colour that reads on each band.
export const PALETTES = {
  neon: {
    name: "Cinema Neon",
    bands: ["#00e5a0", "#8be04e", "#f5d13d", "#ff8a3d", "#ff3d6e"],
    ink: ["#06110d", "#0b1206", "#141004", "#160b04", "#16040a"],
    noData: "#2a2f3a",
  },
  okabe: {
    name: "Colour-blind safe",
    // Viridis stops, ordered by lightness so rank reads without hue.
    bands: ["#fde725", "#5ec962", "#21918c", "#3b528b", "#5b2a86"],
    ink: ["#1a1600", "#0a1a06", "#ffffff", "#ffffff", "#ffffff"],
    noData: "#2a2f3a",
  },
};

// Raw preset/TVmaze-normalised show -> model with derived fields.
export function prepareShow(raw) {
  const episodes = raw.episodes.map((ep) => ({ ...ep, runtime: ep.runtime || CONFIG.defaultRuntime }));
  const n = episodes.length;
  const cumMinutes = new Array(n);
  let total = 0;
  let sum = 0;
  let rated = 0;
  for (let i = 0; i < n; i++) {
    total += episodes[i].runtime;
    cumMinutes[i] = total;
    if (episodes[i].rating != null) {
      sum += episodes[i].rating;
      rated++;
    }
  }
  // Start of each episode as a fraction of the strip, plus a closing 1.
  const startsPct = new Float64Array(n + 1);
  const startsHours = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    startsPct[i] = n ? i / n : 0;
    startsHours[i] = i === 0 ? 0 : cumMinutes[i - 1] / total;
  }
  const seasons = [];
  episodes.forEach((ep, i) => {
    if (i === 0 || ep.s !== episodes[i - 1].s) seasons.push({ s: ep.s, start: i });
  });
  return {
    ...raw,
    episodes,
    n,
    rated,
    avg: rated ? sum / rated : null,
    coverage: n ? rated / n : 0,
    cumMinutes,
    totalMinutes: total,
    startsPct,
    startsHours,
    seasons,
  };
}

// Friendly guard for soaps and mega-shows (PLAN section 2).
export function hasEnoughData(show) {
  return show.n > 0 && show.n <= CONFIG.guard.maxEpisodes && show.coverage >= CONFIG.guard.minCoverage;
}

// 0 = best band ... 4 = lowest, -1 = no data.
export function bandIndex(rating) {
  if (rating == null) return -1;
  const i = CONFIG.thresholds.findIndex((t) => rating >= t);
  return i === -1 ? CONFIG.thresholds.length : i;
}

export function ratingToBand(rating, palette) {
  const i = bandIndex(rating);
  return i === -1 ? palette.noData : palette.bands[i];
}

export function maxMinutes(shows) {
  return Math.max(...shows.map((s) => s.totalMinutes));
}

// Strip width as a fraction of the bar: full in pct mode, by runtime in hours.
export function layout(show, mode, maxMins) {
  return { widthFrac: mode === "hours" ? show.totalMinutes / maxMins : 1 };
}

// Scrubber position p in [0,1] of the bar -> { idx, ended }.
export function episodeAt(show, p, mode, maxMins) {
  if (mode !== "hours") return { idx: Math.min(show.n - 1, Math.floor(p * show.n)), ended: false };
  const minutes = p * maxMins;
  if (minutes > show.totalMinutes) return { idx: show.n - 1, ended: true };
  // First episode whose cumulative runtime passes `minutes`.
  let lo = 0;
  let hi = show.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (show.cumMinutes[mid] > minutes) hi = mid;
    else lo = mid + 1;
  }
  return { idx: lo, ended: false };
}

export function seasonAt(show, idx) {
  return show.episodes[idx].s;
}

// Coloured runs for a strip `widthPx` device pixels wide. Episodes at least
// 1px wide are drawn individually (pixel-snapped so there are no seams);
// otherwise each pixel column averages the episodes overlapping it, so
// nothing aliases away on long shows.
export function segments(show, mode, widthPx) {
  const starts = mode === "hours" ? show.startsHours : show.startsPct;
  const { n, episodes } = show;
  const out = [];
  if (!n || widthPx <= 0) return out;
  let minW = Infinity;
  for (let i = 0; i < n; i++) minW = Math.min(minW, (starts[i + 1] - starts[i]) * widthPx);
  if (minW >= 1) {
    for (let i = 0; i < n; i++) {
      const x0 = Math.round(starts[i] * widthPx);
      const x1 = Math.round(starts[i + 1] * widthPx);
      if (x1 > x0) out.push({ x: x0, w: x1 - x0, rating: episodes[i].rating });
    }
    return out;
  }
  const cols = Math.round(widthPx);
  let first = 0; // first episode that ends after the current column starts
  for (let c = 0; c < cols; c++) {
    while (first < n - 1 && starts[first + 1] * widthPx <= c) first++;
    let sum = 0;
    let count = 0;
    for (let j = first; j < n && starts[j] * widthPx < c + 1; j++) {
      if (episodes[j].rating != null) {
        sum += episodes[j].rating;
        count++;
      }
    }
    out.push({ x: c, w: 1, rating: count ? sum / count : null });
  }
  return out;
}

export function episodeCode(ep) {
  const pad = (x) => String(x).padStart(2, "0");
  return `S${pad(ep.s)}E${pad(ep.e)}`;
}

export function formatDelta(show, ep) {
  if (ep.rating == null || show.avg == null) return null;
  const d = ep.rating - show.avg;
  const r = Math.round(d * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(1)}`;
}

// Hours watched by the end of episode idx.
export function hoursIn(show, idx) {
  return show.cumMinutes[idx] / 60;
}
