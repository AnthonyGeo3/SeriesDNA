// Shared helpers for the Phase 0 scripts (Node 18+, global fetch).
import { CONFIG, fromTvmaze } from "../core.js";

export const API = "https://api.tvmaze.com";

// Guards from PLAN.md section 2, shared with the app.
export const GUARD = CONFIG.guard;
// Audit flags: a preset should be well covered and have a usable spread.
export const AUDIT = { minCoverage: 0.85, minRange: 1.0 };

// Preset shows. `year` is the premiere year and always disambiguates the
// search (UK vs US Office, reboots). `id` pins the expected TVmaze id: if
// the name + year match lands anywhere else, the build fails.
export const PRESETS = [
  { name: "The Boys", year: 2019, id: 15299 },
  { name: "Grey's Anatomy", year: 2005, id: 67 },
  { name: "Silo", year: 2023, id: 38052 },
  { name: "Peaky Blinders", year: 2013, id: 269 },
  { name: "Breaking Bad", year: 2008, id: 169 },
  { name: "Succession", year: 2018, id: 23470 },
  { name: "Game of Thrones", year: 2011, id: 82 },
  { name: "The Office", year: 2005, id: 526 },
  { name: "Lost", year: 2004, id: 123 },
  { name: "Stranger Things", year: 2016, id: 2993 },
  { name: "Better Call Saul", year: 2015, id: 618 },
  { name: "The Wire", year: 2002, id: 179 },
  { name: "Friends", year: 1994, id: 431 },
  { name: "Dexter", year: 2006, id: 161 },
  { name: "The Simpsons", year: 1989, id: 83 },
  { name: "The Sopranos", year: 1999, id: 527 },
  { name: "Mad Men", year: 2007, id: 385 },
  { name: "The Last of Us", year: 2023, id: 46562 },
  { name: "House of the Dragon", year: 2022, id: 44778 },
  { name: "Ted Lasso", year: 2020, id: 44458 },
  { name: "The Crown", year: 2016, id: 3594 },
  { name: "Ozark", year: 2017, id: 13417 },
  { name: "True Detective", year: 2014, id: 5 },
  { name: "Fargo", year: 2014, id: 32 },
  { name: "Black Mirror", year: 2011, id: 305 },
  { name: "Sherlock", year: 2010, id: 335 },
  { name: "The Mandalorian", year: 2019, id: 38963 },
  { name: "The Bear", year: 2022, id: 54198 },
  { name: "Schitt's Creek", year: 2015, id: 1775 },
  { name: "Brooklyn Nine-Nine", year: 2013, id: 49 },
  { name: "Parks and Recreation", year: 2009, id: 174 },
  { name: "How I Met Your Mother", year: 2005, id: 171 },
  { name: "Seinfeld", year: 1989, id: 530 },
  { name: "The Walking Dead", year: 2010, id: 73 },
  { name: "House", year: 2004, id: 118 },
  { name: "Squid Game", year: 2021, id: 43687 },
  { name: "Westworld", year: 2016, id: 1371 },
  { name: "Dark", year: 2017, id: 17861 },
  { name: "Mr. Robot", year: 2015, id: 1871 },
  { name: "Rick and Morty", year: 2013, id: 216 },
  { name: "Yellowstone", year: 2018, id: 27848 },
  { name: "Narcos", year: 2015, id: 2705 },
  { name: "The Big Bang Theory", year: 2007, id: 66 },
  { name: "Community", year: 2009, id: 318 },
  { name: "Prison Break", year: 2005, id: 541 },
  { name: "Suits", year: 2011, id: 172 },
  { name: "Avatar: The Last Airbender", year: 2005, id: 555 },
  { name: "Fleabag", year: 2016, id: 16149 },
];

// Audited but never baked: checks that the soap guard trips.
export const GUARD_TESTS = [{ name: "Coronation Street", year: 1960, id: 4139 }];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJSON(path, tries = 4) {
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fetch(API + path);
    } catch (err) {
      if (i >= tries - 1) throw new Error(`Network error fetching ${API + path}: ${err.cause?.message || err.message}`);
      await sleep(2000 * 2 ** i);
      continue;
    }
    if (res.ok) return res.json();
    // TVmaze answers 429 when rate limited (about 20 calls / 10s).
    if (res.status === 429 && i < tries - 1) {
      await sleep(2000 * 2 ** i);
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${API + path}`);
  }
}

const premiereYear = (show) => (show.premiered ? Number(show.premiered.slice(0, 4)) : null);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Search, print the top 3 matches, and pick the one matching name + year
// (and id, when the preset pins one).
export async function resolveShow(preset, log = console.log) {
  const results = await getJSON(`/search/shows?q=${encodeURIComponent(preset.name)}`);
  log(`  "${preset.name}" top matches:`);
  for (const { show } of results.slice(0, 3)) {
    log(`    id ${String(show.id).padEnd(6)} ${premiereYear(show) ?? "????"}  ${show.name}`);
  }
  const match = results
    .map((r) => r.show)
    .find((s) => norm(s.name) === norm(preset.name) && premiereYear(s) === preset.year);
  if (!match) throw new Error(`No match for "${preset.name}" (${preset.year})`);
  if (preset.id != null && match.id !== preset.id) {
    throw new Error(`"${preset.name}" (${preset.year}) resolved to id ${match.id}, expected ${preset.id}`);
  }
  return match;
}

// Normalised model from PLAN.md section 4 (derived fields are computed on
// load in core.js, so they are not stored).
export async function fetchShow(show) {
  return fromTvmaze(show, await getJSON(`/shows/${show.id}/episodes`));
}

export function summarise(show) {
  const ratings = show.episodes.map((ep) => ep.rating).filter((r) => r != null);
  const n = show.episodes.length;
  const mean = ratings.reduce((a, b) => a + b, 0) / (ratings.length || 1);
  const sd = Math.sqrt(ratings.reduce((a, r) => a + (r - mean) ** 2, 0) / (ratings.length || 1));
  return {
    n,
    seasons: new Set(show.episodes.map((ep) => ep.s)).size,
    rated: ratings.length,
    coverage: n ? ratings.length / n : 0,
    min: ratings.length ? Math.min(...ratings) : null,
    max: ratings.length ? Math.max(...ratings) : null,
    mean: ratings.length ? mean : null,
    sd: ratings.length ? sd : null,
  };
}

export function flags(sum) {
  const out = [];
  if (sum.n > GUARD.maxEpisodes || sum.coverage < GUARD.minCoverage) out.push("GUARD: not enough data");
  else if (sum.coverage < AUDIT.minCoverage) out.push("LOW COVERAGE");
  if (sum.rated && sum.max - sum.min < AUDIT.minRange) out.push("FLAT RANGE");
  return out;
}

export const fmt = (x, d = 1) => (x == null ? "  -" : x.toFixed(d));
