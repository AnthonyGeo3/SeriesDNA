// Phase 0: bake data/presets.json from TVmaze so the demo works offline.
// Usage: node scripts/build-presets.mjs
// (Behind an HTTPS proxy, Node >= 22.21 needs NODE_USE_ENV_PROXY=1.)
import { mkdir, writeFile } from "node:fs/promises";
import { PRESETS, resolveShow, fetchShow, summarise, flags } from "./lib.mjs";

const OUT = new URL("../data/presets.json", import.meta.url);
const TARGET_BYTES = 400 * 1024;

const presets = {};
const resolved = [];
for (const preset of PRESETS) {
  let show, data;
  try {
    show = await resolveShow(preset); // throws on ambiguity: never guess
    data = await fetchShow(show);
  } catch (err) {
    console.error(`\nBuild failed, data/presets.json not written.\n${err.message}`);
    process.exit(1);
  }
  presets[data.id] = data;
  resolved.push({ name: data.name, year: data.year, id: data.id, ...summarise(data) });
}

const json = JSON.stringify(presets);
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(OUT, json);

console.log("\nPer-show coverage:");
for (const r of resolved) {
  const f = flags(r);
  console.log(`  ${`${r.name} (${r.year})`.padEnd(32)} ${String(r.n).padStart(4)} eps  ${`${Math.round(r.coverage * 100)}%`.padStart(4)} rated  ${f.join(", ")}`);
}
console.log("\nResolved ids:");
for (const r of resolved) console.log(`  { name: ${JSON.stringify(r.name)}, year: ${r.year}, id: ${r.id} },`);

const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
console.log(`\nWrote data/presets.json: ${kb} KB ${Buffer.byteLength(json) > TARGET_BYTES ? "(OVER the ~400 KB target)" : "(under the ~400 KB target)"}`);
