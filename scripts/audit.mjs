// Phase 0: rating-coverage audit for the preset shows.
// Usage: node scripts/audit.mjs
// (Behind an HTTPS proxy, Node >= 22.21 needs NODE_USE_ENV_PROXY=1.)
import { PRESETS, GUARD_TESTS, resolveShow, fetchShow, summarise, flags, fmt } from "./lib.mjs";

const rows = [];
for (const preset of [...PRESETS, ...GUARD_TESTS]) {
  try {
    const show = await resolveShow(preset);
    const sum = summarise(await fetchShow(show));
    rows.push({ name: `${show.name} (${show.year ?? preset.year})`, id: show.id, ...sum, flags: flags(sum) });
  } catch (err) {
    if (err.message.startsWith("Network error")) {
      console.error(`\n${err.message}\nIs api.tvmaze.com reachable from here?`);
      process.exit(1);
    }
    rows.push({ name: `${preset.name} (${preset.year})`, error: err.message });
  }
}

console.log("\nShow                              id      eps  seas  rated   min   max  mean    sd  flags");
console.log("-".repeat(100));
for (const r of rows) {
  if (r.error) {
    console.log(`${r.name.padEnd(32)}  ERROR: ${r.error}`);
    continue;
  }
  console.log(
    [
      r.name.slice(0, 32).padEnd(32),
      String(r.id).padStart(6),
      String(r.n).padStart(6),
      String(r.seasons).padStart(5),
      `${Math.round(r.coverage * 100)}%`.padStart(6),
      fmt(r.min).padStart(5),
      fmt(r.max).padStart(5),
      fmt(r.mean, 2).padStart(5),
      fmt(r.sd, 2).padStart(5),
      " " + (r.flags.join(", ") || "ok"),
    ].join(" ")
  );
}

if (rows.some((r) => r.error)) process.exitCode = 1;
