# Series DNA: Build Plan (hand-off to Claude Code)

> Read this whole file first. Work **one phase at a time**. After each phase: run it, tell me what works / what's rough, and stop for my go-ahead. Keep everything runnable by opening `index.html` (or `npx serve`) with no build step.

## 1. What we're building

Series DNA turns any TV show into a horizontal colour barcode, one vertical band per episode, coloured by rating. Two shows are stacked so you can see where each hit its golden era, sagged in the middle, and stuck (or crashed) the landing. A thumb scrubber sweeps a laser line across both strips while head-to-head episode cards update live.

### Decisions locked
- **Exactly 2 shows** (slots A and B). No 3-show mode.
- **Landscape-first.** Laptop (landscape by nature) must always look great. On a phone it must work, but we nudge the user to rotate. Portrait shows a dismissible "rotate your phone" overlay.
- **Stack:** vanilla HTML + CSS + ES6 modules-free JS, `<canvas>` for barcodes, no bundler.
- **Styling:** plain CSS with custom properties. *Not* Tailwind CDN: the room Wi-Fi is already a stated risk and a CDN script is a needless dependency.
- **Hosting:** GitHub Pages from the repo root. Everything (including data) is served as static files.
- **Data:** TVmaze public API (no key, CORS-enabled) for live search + a pre-baked `data/presets.json` so the demo never depends on Wi-Fi.

## 2. De-risk first (Phase 0, ~20 min)

These could sink the idea, so test them before building UI.

1. **Rating coverage.** TVmaze episode ratings (`rating.average`) are often `null` for some episodes, and are less dense than IMDb. Write `scripts/audit.mjs` that, for the ~15 preset shows, prints: episode count, % of episodes with a rating, min/max/mean rating. If a preset has under ~85% coverage or a very flat range (everything 7.5–8.5), swap it for a better one. **If many iconic shows look bad, tell me before continuing**; fallback is baking presets at build time from TMDB/OMDb using a key kept in a local env var (never committed), while live search stays on TVmaze.
2. **Soaps and mega-shows.** Long-running soaps (Coronation Street, EastEnders) have thousands of episodes and mostly empty ratings. Guard: if a searched show has more than ~1,500 episodes or under 50% rated episodes, show a friendly "Not enough rating data to build a DNA strip" message instead of a broken bar.
3. **Landscape phone height.** A Pixel in landscape with browser chrome gives roughly 340–380px of vertical space. The layout in section 7 is budgeted for this. Use `dvh`/`svh`, never `vh`.
4. **Palette accessibility.** The default "Cinema Neon" scale runs emerald to crimson, which is a red/green problem for colour-blind viewers, in front of designers. Build the palette as a swappable config object from day one (section 6) so the Okabe-Ito/Viridis option is a 10-minute job, not a refactor.

## 3. File structure

```
/index.html
/styles.css
/app.js              (UI wiring, state, events)
/core.js             (pure functions: layout, position mapping, stats, colour; no DOM)
/render.js           (canvas drawing + animation)
/data/presets.json   (generated, committed)
/scripts/audit.mjs   (Phase 0)
/scripts/build-presets.mjs
/manifest.webmanifest, /icon-192.png, /icon-512.png   (Phase 3, optional PWA polish)
/PLAN.md
```
Keep `core.js` free of DOM access so it's easy to sanity-check in Node (`node -e` or a tiny `core.test.mjs` with `assert`). Load with `<script type="module">` (fine on GitHub Pages).

## 4. Data layer

### TVmaze endpoints
- Search: `https://api.tvmaze.com/search/shows?q={query}`
- Episodes: `https://api.tvmaze.com/shows/{id}/episodes` (specials excluded by default, which is what we want)
- Rate limit is generous (about 20 calls/10s). One episodes call per show, so no issue.

### Normalised model (the only shape the UI ever sees)
```js
Show = {
  id: 1234,                 // TVmaze id (used in URLs)
  name: "The Boys",
  year: 2019,
  episodes: [               // aired order, specials excluded
    { s: 1, e: 1, title: "The Name of the Game", rating: 8.6 | null, runtime: 60 }
  ],
  // derived once, on load:
  n: 32,
  rated: 31,                // count with non-null rating
  avg: 8.4,                 // mean of rated episodes
  cumMinutes: [60, 120, ...]  // prefix sums for hours-mode lookups
}
```
- `runtime` null falls back to show `averageRuntime`, then 45.
- Null ratings render as a neutral dark-grey "no data" band, are excluded from stats, and the card shows "No rating". Show a small coverage chip ("97% rated") on each strip label.

### Caching
- `localStorage` key `sdna:v1:show:{id}` with try/catch around every read/write (private mode can throw). Cache live-fetched shows so reloads are instant.
- Presets come from `data/presets.json`, keyed by id, loaded first. A live fetch happens only for non-preset shows.

### `scripts/build-presets.mjs` (Node 18+, global `fetch`)
- Input: list of show names (The Boys, Grey's Anatomy, Silo, Peaky Blinders, Breaking Bad, Succession, Game of Thrones, The Office (US), Lost, Stranger Things, plus 3-5 more crowd-pleasers).
- For each: search, **print the top 3 matches with year and id** and pick by an explicit `{ name, id }` override table (avoids grabbing the UK Office or a reboot). Fetch episodes, write only the fields in the model above, minified keys optional.
- Output `data/presets.json`. Print final file size (target under ~400KB) and per-show coverage.

## 5. Core logic (`core.js`, pure and testable)

- `ratingToBand(rating, palette)` returns a colour from thresholds: `>=9.0`, `>=8.0`, `>=7.0`, `>=6.0`, else lowest; `null` returns the no-data colour.
- `layout(show, mode, maxMinutes)` returns `{ widthFrac }` for the strip: `1` in `pct` mode; `totalMinutes / maxMinutes` in `hours` mode.
- **Position mapping.** Scrubber position `p` is in `[0,1]` of the *bar width*.
  - `pct` mode: `idx = min(n-1, floor(p * n))` for each show.
  - `hours` mode: `minutes = p * maxMinutes`; binary-search `cumMinutes` for the episode containing it. If `minutes > show.totalMinutes`, that show is "finished": card shows its finale, dimmed, with "Ended".
- `stats(show)`:
  - **Golden Era:** best rolling mean over a window of 5 rated episodes (if `rated < 5`, window = `rated`). Report start/end SxEy and the mean.
  - **Whiplash:** population standard deviation of rated episodes. Label: `< 0.35` Consistent, `0.35 to 0.6` Bumpy, `> 0.6` Chaotic (tune after seeing real data).
  - **The Drop-Off:** location (as % of lifespan) of the lowest rolling mean, using window `max(5, round(n * 0.05))`, ignoring the first and last 5% to avoid trivial edge dips.
  - **Delta vs average:** `episode.rating - show.avg`, shown with sign, one decimal.
- Keep thresholds and window sizes in one `CONFIG` object at the top.

## 6. Rendering and interaction

### Canvas (`render.js`)
- One `<canvas>` per strip, sized from `getBoundingClientRect()` × `devicePixelRatio`; redraw on resize and orientation change.
- Draw each episode as a rect. When an episode would be under 1 device pixel wide (long shows on narrow screens), bucket by pixel column and average the ratings so nothing aliases away.
- Season dividers: short tick marks under the strip with "S1, S2…" labels (hide labels if they'd collide, keep ticks).
- **Laser line:** a separate absolutely-positioned element (`transform: translateX`) spanning both strips; don't redraw the barcodes on every pointer move.
- **Normalisation toggle animation:** tween each strip's `widthFrac` over about 500ms (ease-in-out) via `requestAnimationFrame`, redrawing the strips each frame.

### Palette config
```js
PALETTES = {
  neon:   { name: "Cinema Neon", bands: [/* >=9, >=8, >=7, >=6, <6 */], noData: "#2a2f3a" },
  okabe:  { name: "Colour-blind safe", bands: [...], noData: "#2a2f3a" }
}
```
Colours must be defined once (CSS variables or this object), never hard-coded in draw code. For the colour-blind palette use a sequential, perceptually ordered scale (Viridis-style or Okabe-Ito picks ordered by lightness) so rating order is readable without hue.

### Scrubber
- Pointer Events on the strip area (`pointerdown/move/up`, `setPointerCapture`, CSS `touch-action: none` on the strips so dragging doesn't scroll the page).
- A chunky `<input type="range" min=0 max=1000>` below the strips, two-way synced with the laser line (also gives free keyboard support and accessibility).
- Update cards inside a `requestAnimationFrame` batch, not on every raw event.
- **Haptics (Pixel/Android Chrome):** `navigator.vibrate(8)` when the laser crosses a season boundary in either show. Feature-detect; silently do nothing on iOS/laptop. This is a cheap, memorable "tactile delighter".

### Cards (head-to-head)
Per show: title · `S03E06` · episode title (truncate with ellipsis) · big `★ 9.4` · delta chip (`+0.8`, coloured by the rating band, not green/red) · `24.5 hrs in`. Subtle flip/fade animation on episode change; respect `prefers-reduced-motion`.

## 7. Layout

### Landscape grid (target viewport 700×360 up to desktop)
```
┌──────────────────────────────────────────────────────────────┐
│ SERIES DNA   [A: The Boys ▾] vs [B: Grey's ▾]   🔎  presets… │ ~40px
├──────────────────────────────────────────────────────────────┤
│ The Boys      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ ~64px
│ S1 | S2 | S3 | S4                                            │ ~12px
│ Grey's Anat.  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ ~64px
│ S1 | S2 | S3 ... S21                                         │ ~12px
├──────────────────────────────────────────────────────────────┤
│ ◀━━━━━━━━━━━━━●━━━━━━━━━━━━━━▶  [% Lifespan | Hours]  [Stats]│ ~44px
├────────────────────────────┬─────────────────────────────────┤
│ CARD A                     │ CARD B                          │ ~100px
└────────────────────────────┴─────────────────────────────────┘
```
- Use CSS grid with `grid-template-rows` in `fr`/`clamp()`; on desktop the strips grow taller (up to ~120px each) and typography scales with `clamp()`.
- The analyst badges (Golden Era, Whiplash, Drop-Off) live in a **Stats sheet** (bottom drawer on phone, side panel on wide screens) so they don't eat the 360px budget. On very wide desktops they can be always-visible beside the cards.
- Respect `env(safe-area-inset-*)` (notches in landscape).
- Dark theme, glassy cards (`backdrop-filter` with a solid fallback), generous tap targets (minimum 44px).

### Portrait phone behaviour
- Detect with `matchMedia("(orientation: portrait) and (max-width: 700px)")`.
- Show a full-screen overlay: animated phone-rotates icon, "Turn your phone sideways for the best view", plus a **"Continue anyway"** button that dismisses it for the session (store in memory, not storage).
- Try `screen.orientation.lock("landscape")` only after a user gesture and only inside try/catch. On Android it generally works only in fullscreen/installed PWA; iOS Safari doesn't support it, so the overlay is the real mechanism. In `manifest.webmanifest` set `"orientation": "landscape"` for the installed-PWA case.
- Portrait fallback layout when dismissed: strips full-width stacked, cards below, page may scroll. Not pretty, but functional.

## 8. Phases and acceptance criteria

### Phase 0: De-risk (20 min)
Scripts `audit.mjs` and `build-presets.mjs` run; `data/presets.json` committed; coverage report reviewed with me.
**Done when:** every preset has good coverage (or we've swapped it), and the file is under ~400KB.

### Phase 1: Barcode engine and scrubber (60 min)
Static page showing The Boys vs Grey's Anatomy from `presets.json`: normalised barcodes, season ticks, laser line, range slider and strip-drag in sync, head-to-head cards updating live. Landscape layout and the portrait overlay.
**Done when:** on a laptop and a phone in landscape, dragging across the strips feels instant (no lag on Grey's ~400 episodes) and the cards always match the laser position.

### Phase 2: Toggle, live search, stats (60 min)
- Normalisation toggle (% Lifespan ↔ Hours) with the tween animation; finished shows dim with "Ended".
- Search box (debounce 300ms, `AbortController`, top 5 results with name and year). Tapping a result asks which slot (A/B) to replace, or just replaces the slot you last interacted with.
- Loading skeleton on a strip while fetching; friendly error toast if offline; the coverage/size guards from section 2.
- Stats sheet with Golden Era, Whiplash, Drop-Off. Mark Golden Era and Drop-Off as small markers on the strip.
**Done when:** searching "Severance" (not a preset) works live, and turning off Wi-Fi leaves presets fully functional.

### Phase 3: Polish and sharing (60 min)
- Rivalry preset pills: "Sprint vs Marathon" (The Boys vs Grey's Anatomy), "Stuck the Landing vs Crashed" (Breaking Bad vs Game of Thrones), "Sci-Fi Showdown" (Silo vs Lost).
- URL state: `?a=<tvmazeId>&b=<tvmazeId>&at=65&mode=pct`, updated with `history.replaceState` (throttled). **Use TVmaze ids, not slugs.** Loading a URL must reproduce the exact moment.
- Share button: `navigator.share({ url })` with clipboard fallback and a "Link copied" toast.
- Palette switcher (Cinema Neon ↔ Colour-blind safe), persisted in `localStorage` (try/catch).
- Open Graph tags (`og:title`, `og:description`, `og:image` with a static screenshot of the default matchup) so links look good when pasted into Teams/Slack.
- Optional: manifest + icons for "Add to Home Screen".
**Done when:** a pasted share link opens the right shows at the right position in a fresh browser.

### Phase 4: Deploy and demo prep (30 min)
Enable Pages (Settings → Pages → deploy from branch, root). Test on a real phone (landscape, rotate prompt, haptics) and on iOS Safari if anyone has one. Hard-refresh test on the live URL. Take the OG screenshot.

### Stretch (only if ahead)
- Overlay sparkline toggle (thin white line of ratings over the colour bands).
- "Surprise me" button picking a random rivalry from presets.
- Tiny confetti or pulse when the laser crosses a show's Golden Era.

## 9. Cut list (if running behind, cut in this order)
1. Sparkline / stretch items
2. PWA manifest and icons
3. Haptics
4. Colour-blind palette (keep the config structure though)
5. Live search (presets only still makes a good demo; this is the last thing to cut because "search your own favourite show" is the best audience hook)

Never cut: the normalised barcodes, the scrubber, the cards, the toggle.

## 10. Test checklist
- [ ] Phone landscape (Pixel): no vertical scroll in default view; overlay appears in portrait; "Continue anyway" works
- [ ] Laptop at about 1440×900 and a small laptop window: layout stays balanced
- [ ] Grey's Anatomy drags at smooth frame rate; no blurry strips on a hi-DPI display
- [ ] Toggle animation is smooth and ends exactly at the target widths
- [ ] Null-rating episodes render as no-data and don't break stats
- [ ] Offline: presets work; live search fails gracefully with a message
- [ ] Share link round-trips (shows, position, mode)
- [ ] Reduced-motion setting disables flips and tweens

## 11. Two-minute demo script
1. **Open the link, say nothing.** The Boys vs Grey's Anatomy glow on screen. "This is every episode of two shows, squashed onto the same scale."
2. **Drag the scrubber** slowly through Grey's. "Watch the slump arrive." Pause on the Drop-Off marker and the stats sheet.
3. **Hit the toggle:** The Boys shrinks to a sliver next to Grey's. "This is the time commitment."
4. **Take a suggestion from the room**, search their favourite show live, drop it in.
5. **Hit Share**, paste the link into the team chat, and let people open it on their own phones.
6. Close with the palette switch: "and it's colour-blind safe", for the designers.

## 12. Suggested prompts for Claude Code
1. "Read PLAN.md. Do Phase 0 only: write the audit and preset-build scripts, run them, and report coverage per show. Stop."
2. "Phase 1. Build the barcode engine, scrubber and cards per sections 5-7. Keep core.js pure. Stop when it runs."
3. "Phase 2 as specced, then show me the stats on three shows so I can sanity-check the thresholds."
4. "Phase 3, then run through the section 10 checklist and tell me what fails."
