// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  prepareShow, bandIndex, ratingToBand, PALETTES, layout, episodeAt, maxMinutes,
  segments, episodeCode, formatDelta, hoursIn, hasEnoughData, stats, whiplashLabel,
  positionOf, fromTvmaze, encodeState, decodeState, snapP, CONFIG, gameItems, gameGap, pickNext, judge,
} from "./core.js";

const mk = (eps) => prepareShow({ id: 1, name: "T", year: 2000, episodes: eps });
const toy = mk([
  { s: 1, e: 1, rating: 9.0, runtime: 60 },
  { s: 1, e: 2, rating: null, runtime: 30 },
  { s: 2, e: 1, rating: 7.0, runtime: null },
]);

test("prepareShow derives counts, average, prefix sums and seasons", () => {
  assert.equal(toy.n, 3);
  assert.equal(toy.rated, 2);
  assert.equal(toy.avg, 8);
  assert.deepEqual(toy.cumMinutes, [60, 90, 135]); // null runtime -> 45
  assert.deepEqual(toy.seasons, [{ s: 1, start: 0 }, { s: 2, start: 2 }]);
  assert.equal(toy.startsHours[3], 1);
});

test("bands follow the thresholds; null is no-data", () => {
  assert.deepEqual([9.6, 8.8, 8.79, 8.4, 8.0, 7.6, 7.59, 2].map(bandIndex), [0, 0, 1, 1, 2, 3, 4, 4]);
  assert.equal(ratingToBand(null, PALETTES.neon), PALETTES.neon.noData);
});

test("pct mapping clamps to the last episode", () => {
  assert.equal(episodeAt(toy, 0, "pct").idx, 0);
  assert.equal(episodeAt(toy, 0.34, "pct").idx, 1);
  assert.equal(episodeAt(toy, 1, "pct").idx, 2);
});

test("hours mapping binary-searches runtime and marks finished shows", () => {
  const long = mk([{ s: 1, e: 1, rating: 8, runtime: 270 }]);
  const max = maxMinutes([toy, long]);
  assert.equal(layout(toy, "hours", max).widthFrac, 0.5);
  assert.equal(layout(toy, "pct", max).widthFrac, 1);
  assert.deepEqual(episodeAt(toy, 0, "hours", max), { idx: 0, ended: false });
  assert.deepEqual(episodeAt(toy, 60 / 270, "hours", max), { idx: 1, ended: false });
  assert.deepEqual(episodeAt(toy, 0.6, "hours", max), { idx: 2, ended: true });
  assert.deepEqual(episodeAt(long, 1, "hours", max), { idx: 0, ended: false });
});

test("segments: one per episode when wide, column buckets when narrow", () => {
  const wide = segments(toy, "pct", 300);
  assert.equal(wide.length, 3);
  assert.equal(wide.reduce((a, s) => a + s.w, 0), 300);
  const many = mk(Array.from({ length: 1000 }, (_, i) => ({ s: 1, e: i + 1, rating: i < 500 ? 9 : 7, runtime: 40 })));
  const narrow = segments(many, "pct", 100);
  assert.equal(narrow.length, 100);
  assert.equal(narrow[0].rating, 9);
  assert.equal(narrow[99].rating, 7);
});

test("card formatting", () => {
  assert.equal(episodeCode({ s: 3, e: 6 }), "S03E06");
  assert.equal(formatDelta(toy, toy.episodes[0]), "+1.0");
  assert.equal(formatDelta(toy, toy.episodes[2]), "−1.0");
  assert.equal(formatDelta(toy, toy.episodes[1]), null);
  assert.equal(hoursIn(toy, 1), 1.5);
});

test("every preset passes the data guard", () => {
  const presets = JSON.parse(readFileSync(new URL("./data/presets.json", import.meta.url)));
  for (const raw of Object.values(presets)) assert.ok(hasEnoughData(prepareShow(raw)), raw.name);
});

test("positionOf is the inverse of episodeAt", () => {
  const max = 270;
  for (const mode of ["pct", "hours"]) {
    for (let i = 0; i < toy.n; i++) assert.equal(episodeAt(toy, positionOf(toy, i, mode, max), mode, max).idx, i);
  }
});

test("fromTvmaze keeps numbered episodes and falls back on runtime", () => {
  const show = fromTvmaze({ id: 9, name: "X", premiered: "2021-02-03", averageRuntime: 50 }, [
    { season: 1, number: 1, name: "Pilot", rating: { average: 8.1 }, runtime: null },
    { season: 1, number: null, name: "Special", rating: { average: 9 }, runtime: 30 },
    { season: 1, number: 2, name: "Two", rating: { average: null }, runtime: 42 },
  ]);
  assert.deepEqual(show, {
    id: 9, name: "X", year: 2021,
    episodes: [
      { s: 1, e: 1, title: "Pilot", rating: 8.1, runtime: 50 },
      { s: 1, e: 2, title: "Two", rating: null, runtime: 42 },
    ],
  });
});

test("stats: golden era, whiplash and drop-off", () => {
  // 40 episodes at 8, a weak pilot (ignored: first 5%), a peak at 10-14
  // and a dip at 25-29.
  const ratings = Array.from({ length: 40 }, (_, i) =>
    i === 0 ? 2 : i >= 10 && i <= 14 ? 9.5 : i >= 25 && i <= 29 ? 6.5 : 8);
  ratings[12] = null; // a null inside the golden window is skipped
  const show = mk(ratings.map((rating, i) => ({ s: 1 + Math.floor(i / 10), e: (i % 10) + 1, rating, runtime: 30 })));
  const st = stats(show);
  // With 12 unrated, windows 9-14 and 10-15 tie on mean; the earliest wins.
  assert.deepEqual([st.golden.start, st.golden.end], [9, 14]);
  assert.equal(st.drop.start, 25);
  assert.equal(st.drop.end, 29);
  assert.ok(Math.abs(st.drop.mean - 6.5) < 1e-9);
  assert.equal(st.drop.at, 68.75);
  assert.equal(st.whiplash.label, "Chaotic");
  assert.deepEqual([0.2, 0.35, 0.6, 0.61].map(whiplashLabel), ["Consistent", "Bumpy", "Bumpy", "Chaotic"]);
});

test("drop-off counts a crashed finale", () => {
  const ratings = Array.from({ length: 40 }, (_, i) => (i >= 35 ? 5 : 8));
  const st = stats(mk(ratings.map((rating, i) => ({ s: 1, e: i + 1, rating, runtime: 30 }))));
  assert.deepEqual([st.drop.start, st.drop.end], [35, 39]);
});

test("stats cope with tiny and unrated shows", () => {
  const two = stats(mk([{ s: 1, e: 1, rating: 8, runtime: 30 }, { s: 1, e: 2, rating: 9, runtime: 30 }]));
  assert.deepEqual([two.golden.start, two.golden.end], [0, 1]);
  assert.equal(two.drop, null);
  const none = stats(mk([{ s: 1, e: 1, rating: null, runtime: 30 }]));
  assert.deepEqual(none, { golden: null, whiplash: null, drop: null });
});

test("URL state round-trips and tolerates junk", () => {
  const st = { a: 169, b: 82, p: 0.6543, mode: "hours" };
  const qs = encodeState(st);
  assert.equal(qs, "a=169&b=82&at=65.43&mode=hours");
  assert.deepEqual(decodeState("?" + qs), st);
  assert.equal(encodeState({ ...st, p: 0.65 }), "a=169&b=82&at=65&mode=hours");
  assert.deepEqual(decodeState("?a=abc&at=500&mode=nope"), { ...CONFIG.defaultShows, p: 1, mode: "pct" });
  assert.deepEqual(decodeState(""), { ...CONFIG.defaultShows, p: 0, mode: "pct" });
  assert.equal(snapP(0.123456), 0.1235);
});


// Small seeded RNG so game tests are repeatable.
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

test("game items: whole show plus seasons with enough ratings", () => {
  const show = mk([
    ...[8, 9, 8.5].map((rating, i) => ({ s: 1, e: i + 1, rating, runtime: 30 })),
    ...[7, null, 7.2, 7.4].map((rating, i) => ({ s: 2, e: i + 1, rating, runtime: 30 })),
    ...[9, 9].map((rating, i) => ({ s: 3, e: i + 1, rating, runtime: 30 })), // too few rated
  ]);
  const items = gameItems(show);
  assert.deepEqual(items.map((it) => [it.key, it.kind, it.rating, it.start, it.end]), [
    ["1", "show", 8.1, 0, 8], // 65.1 / 8 rated
    ["1:s1", "season", 8.5, 0, 2],
    ["1:s2", "season", 7.2, 3, 6],
  ]);
  const single = gameItems(mk([{ s: 1, e: 1, rating: 8, runtime: 30 }]));
  assert.equal(single.length, 1);
});

test("game: gap shrinks with score; picks respect it; ties count", () => {
  assert.equal(gameGap(0), 0.5);
  assert.equal(gameGap(100), 0.1);
  const presets = JSON.parse(readFileSync(new URL("./data/presets.json", import.meta.url)));
  const pool = Object.values(presets).map((raw) => gameItems(prepareShow(raw)));
  const rng = seeded(42);
  let current = pickNext(pool, null, 0, { kind: "season", rng });
  for (let score = 0; score < 40; score++) {
    const next = pickNext(pool, current, score, { kind: "season", rng });
    assert.equal(next.kind, "season");
    assert.notEqual(next.key, current.key);
    assert.ok(Math.abs(next.rating - current.rating) >= gameGap(score) - 1e-9, `score ${score}`);
    current = next;
  }
  const a = { rating: 8.2 }, b = { rating: 8.5 };
  assert.equal(judge(a, b, "higher"), true);
  assert.equal(judge(a, b, "lower"), false);
  assert.equal(judge(a, { rating: 8.2 }, "lower"), true);
});

test("game: show mode uses whole shows only and avoids recent cards", () => {
  const presets = JSON.parse(readFileSync(new URL("./data/presets.json", import.meta.url)));
  const pool = Object.values(presets).map((raw) => gameItems(prepareShow(raw)));
  const rng = seeded(7);
  const recent = [];
  let current = pickNext(pool, null, 0, { rng });
  for (let score = 0; score < 60; score++) {
    recent.push(current.key);
    const avoid = recent.slice(-5);
    const next = pickNext(pool, current, score, { avoid, rng });
    assert.equal(next.kind, "show");
    assert.ok(!avoid.includes(next.key), `repeat at ${score}`);
    current = next;
  }
});
