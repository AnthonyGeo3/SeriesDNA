// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  prepareShow, bandIndex, ratingToBand, PALETTES, layout, episodeAt, maxMinutes,
  segments, episodeCode, formatDelta, hoursIn, hasEnoughData,
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
