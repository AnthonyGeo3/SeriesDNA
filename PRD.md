# Series DNA: Product Requirements

> **Status (28 Oct 2026):** live at https://anthonygeo3.github.io/SeriesDNA/. All build phases are done (section 10). This document describes the app **as built**. Section 10 also lists where it now differs from the original plan, and why. Section 12 covers known limitations and parked ideas.

## 1. What we're building

Series DNA is a fun website for comparing TV shows. It turns any show into a horizontal colour barcode, one vertical band per episode, coloured by rating. Two shows are stacked so you can see where each hit its golden era, sagged in the middle, and stuck (or crashed) the landing.

A scrubber sweeps a laser line across both strips while head-to-head episode cards update live. A **tale of the tape** says who wins the matchup and why. A **Higher or Lower** game gives people a reason to stay.

It's built for a two-minute live demo to a team (section 13), and also for people who land on a shared link cold, often on a phone held upright.

### Decisions locked
- **Exactly 2 shows** (slots A and B). No 3-show mode.
- **Works everywhere, with no rotate nag.** The laptop view must always look great. A landscape phone fits with no vertical scroll. Portrait is a first-class layout: the full-screen "rotate your phone" overlay was removed so cold visitors aren't blocked.
- **Stack:** vanilla HTML, CSS and JS as ES modules (`<script type="module">`), with `<canvas>` for the barcodes. No bundler and no build step.
  - Modules and `fetch()` don't work over `file://`, so run it locally with `npx serve`. The page says so if opened as a file.
- **Styling:** plain CSS with custom properties. No CDN scripts or fonts, because room Wi-Fi is a known risk.
- **Hosting:** GitHub Pages from the root of `main`. Merging to `main` deploys in about a minute.
- **Data:** the TVmaze public API (no key, CORS-enabled) for live search, plus a pre-baked `data/presets.json`, so the presets never depend on Wi-Fi.

## 2. What a visitor sees

1. **Header:**
   - Logo, plus the "A vs B" matchup chips on wide screens.
   - A search box.
   - **Stats**, the **palette** switch, and **Share**.
   - A filled, coloured **Play** button for the game: "Play Higher or Lower" on wide screens. It pulses until the game has been opened once.
2. **Colour key and verdict:** one line above the strips. It reads "Episode rating: 8.8+ · 8.4+ · 8.0+ · 7.6+ · <7.6 · no rating", with a swatch for each band, followed by the verdict, e.g. "⚖ Breaking Bad wins 5–1 · see why".
3. **The two barcodes**, The Boys vs Grey's Anatomy by default:
   - Season ticks underneath each strip.
   - A coverage chip on each label ("99% rated") and the total hours.
   - Golden Era and Drop-Off markers drawn on the strips.
   - On a first visit, a **"Drag across the strips"** hint sits on top until the strips are first used.
4. **Controls:** a **% Lifespan / Hours** toggle and the scrubber slider.
5. **Head-to-head cards:** the episode under the laser in each show. Each shows the code, title, rating, the difference from that show's average, and hours watched so far.
6. **Tale of the tape:** six rounds with a winner on each and an overall verdict. It sits between the cards on laptops and below them in portrait. On a landscape phone it opens from the verdict, inside the Stats sheet.

## 3. File structure

```
/index.html
/styles.css
/app.js              UI wiring, state, events: strips, cards, search, stats sheet, tape, URL state, sharing
/core.js             pure logic, no DOM: data prep, colour, layout, position mapping, stats, tale of the tape, game logic, URL state
/render.js           canvas drawing: strips, markers, season ticks
/game.js             the Higher or Lower screen
/dom.js              tiny h() element builder (text always via textContent, never HTML)
/core.test.mjs       node --test unit tests for core.js and the preset data
/data/presets.json   generated, committed (48 shows, ~342 KB; ~70 KB gzipped)
/scripts/lib.mjs     shared helpers and the preset list for the two scripts below
/scripts/audit.mjs   rating-coverage audit
/scripts/build-presets.mjs
/manifest.webmanifest, /icon-192.png, /icon-512.png   home-screen install
/og.png              social preview image (default matchup)
/PRD.md
```

## 4. Data layer

### TVmaze endpoints
- **Search:** `https://api.tvmaze.com/search/shows?q={query}`
- **Show with episodes, one call** (used for live loads): `https://api.tvmaze.com/shows/{id}?embed=episodes`
- **Episodes** (used by the build scripts): `https://api.tvmaze.com/shows/{id}/episodes`
- Specials are excluded, which is what we want: they have no episode number.

### Normalised model (the only shape the UI sees)
```js
Show = {
  id: 1234, name: "The Boys", year: 2019,
  episodes: [{ s: 1, e: 1, title: "The Name of the Game", rating: 8.6 | null, runtime: 60 }],
  // derived on load by prepareShow():
  n, rated, avg, coverage, cumMinutes, totalMinutes, startsPct, startsHours, seasons: [{ s, start }]
}
```
- `fromTvmaze()` in `core.js` builds this model for both the build scripts and live search, so the two can't drift.
- A missing `runtime` falls back to the show's `averageRuntime`, then 45 minutes.
- Unrated episodes draw as a dark-grey "no rating" band, are left out of all stats, and the card says "No rating".

### Presets (`data/presets.json`)
These 48 shows (5,029 episodes) are 97–100% rated, each pinned to its TVmaze id. The original 15:
- The Boys (15299), Grey's Anatomy (67), Silo (38052), Peaky Blinders (269), Breaking Bad (169)
- Succession (23470), Game of Thrones (82), The Office US (526), Lost (123), Stranger Things (2993)
- Better Call Saul (618), The Wire (179), Friends (431), Dexter (161), The Simpsons (83)

Added 33 so Higher or Lower doesn't keep cycling through the same shows (they also widen the offline list in search):
- The Sopranos (527), Mad Men (385), The Last of Us (46562), House of the Dragon (44778), Ted Lasso (44458)
- The Crown (3594), Ozark (13417), True Detective (5), Fargo (32), Black Mirror (305), Sherlock (335)
- The Mandalorian (38963), The Bear (54198), Schitt's Creek (1775), Brooklyn Nine-Nine (49), Parks and Recreation (174)
- How I Met Your Mother (171), Seinfeld (530), The Walking Dead (73), House (118), Squid Game (43687), Westworld (1371)
- Dark (17861), Mr. Robot (1871), Rick and Morty (216), Yellowstone (27848), Narcos (2705), The Big Bang Theory (66)
- Community (318), Prison Break (541), Suits (172), Avatar: The Last Airbender (555), Fleabag (16149)

Arcane was tried but has no TVmaze match by name and year, so it was left out. Severance is deliberately not a preset, so searching it still shows live search working. With an empty query, the search list shows the presets alphabetically.

`scripts/build-presets.mjs` matches each show by name **and** premiere year, prints the top 3 search matches, and fails if the match isn't the pinned id. That stops it grabbing the UK Office or a reboot.

`scripts/audit.mjs` reports per show: episode count, seasons, percentage rated, min/max/mean and standard deviation. It flags low coverage (under 85%), a flat range (less than 1.0 between min and max), and shows that would hit the guard below. Coronation Street is audited only to prove the guard works.

When run behind an HTTPS proxy (as in the cloud dev container), both scripts need `NODE_USE_ENV_PROXY=1`, on Node 22.21 or later.

### Guard: soaps and mega-shows
A show with more than 1,500 episodes, or fewer than 50% rated, gets "Not enough rating data to build a DNA strip for X." and the current show stays in place.

### Storage (`localStorage`)
Every read and write is wrapped in try/catch, because private mode can throw.

| Key | What |
|---|---|
| `sdna:v1:show:{id}` | live-fetched shows, so reloads are instant and the game can use them |
| `sdna:v1:palette` | `neon` or `okabe` |
| `sdna:v1:dragged` | the drag hint has been dismissed |
| `sdna:v1:played` | the Play button has stopped pulsing |
| `sdna:v1:hilo-mode` | the last game mode played |
| `sdna:v1:hilo-best:show` / `:season` | the best game score for each mode |

## 5. Core logic (`core.js`, pure and tested)

All thresholds live in one `CONFIG` object.

- **Colour bands:** 8.8+, 8.4+, 8.0+, 7.6+, and below 7.6. `null` is the no-data colour.
  - The plan's original 9/8/7/6 left most shows two-tone, because TVmaze ratings cluster around 8.
  - With these thresholds the presets spread roughly 17% / 20% / 26% / 21% / 16% across the five bands.
- **Strip width:** `layout(show, mode, maxMinutes)` gives `widthFrac`. It's 1 in `pct` mode, and `totalMinutes / maxMinutes` in `hours` mode.
- **Position mapping:** the scrubber position `p` is in [0,1] of the bar width.
  - In `pct` mode, the episode is `min(n-1, floor(p·n))`.
  - In `hours` mode, the code binary-searches `cumMinutes`. Past the end of a show, its card shows its last episode, dimmed, with an "Ended" chip.
  - Positions snap to steps of 1/10,000 (`CONFIG.steps`), so a shared link lands on exactly the same episodes. That's fine enough for a 1,500-episode show.
- **Stats:**
  - **Golden Era:** the best rolling mean over 5 rated episodes.
  - **Whiplash:** the standard deviation of ratings. Under 0.35 is Consistent, 0.35–0.6 is Bumpy, and over 0.6 is Chaotic.
  - **Drop-Off:** the lowest rolling mean, over a window of `max(5, round(n·0.05))` episodes. Only the **first** 5% of a show is ignored, to skip weak pilots; finales count, so Game of Thrones' S8 crash shows up.
  - **Delta:** episode rating minus show average, with a sign and one decimal.
- **Season averages:** `seasonAverages(show)` only counts seasons with at least 3 rated episodes (`CONFIG.minSeasonRated`). Both the tale of the tape and the game use it.
- **Tale of the tape:** `tale(a, b)` runs six rounds:

  | Round | Winner |
  |---|---|
  | Average episode | higher |
  | Peak run (the Golden Era mean) | higher |
  | Best season | higher |
  | Worst season | higher (the less bad low wins) |
  | Consistency (std dev) | lower |
  | Latest season | higher |

  Each round is judged on the value *as shown* (1 decimal place, or 2 for the std dev), so numbers that look equal are a tie. The overall verdict is "X wins 4–2" or "Dead heat, 3–3".
- **URL state:** `?a=<id>&b=<id>&at=<percent>&mode=pct|hours`.
  - `at` has up to 2 decimals.
  - Parsing is lenient: junk falls back to the defaults.
  - Always TVmaze ids, never slugs.
- **Game logic:** `gameItems`, `pickNext`, `judge` and `gameGap` (section 8).

## 6. Rendering and interaction

### Canvas (`render.js`)
- One canvas per strip and one per tick row, sized to the CSS box × `devicePixelRatio`. They're redrawn on resize, zoom and rotation.
- Wide episodes are drawn one rectangle each, pixel-snapped so there are no seams, with a hairline gap between episodes (but none after the last, so the strip ends flush).
- When episodes would be narrower than a device pixel, each pixel column averages the episodes it overlaps, so nothing aliases away.
- **Season ticks** label "S1, S2…". Labels that would collide are hidden, but every tick stays.
- **Markers:** Golden Era is a solid outline with a "★ Golden era" pill at the top. Drop-Off is a dashed outline with a "Drop-off" pill at the bottom, so the two pills never collide. Both are hidden on strips too narrow to carry them, such as The Boys' sliver in Hours mode.
- **Laser:** a separate element moved with `transform`, so the barcodes are never redrawn while scrubbing.
- **Toggle animation:** strip widths animate over 500ms (ease-in-out), and also whenever a new show changes the longest runtime. With reduced motion it's instant.

### Palettes
Colours are defined once and never hard-coded in draw code. The CSS gets them as `--band-0..4`, `--ink-0..4` and `--nodata`.

```js
PALETTES = {
  neon:  { name: "Cinema Neon",       bands: ["#00e5a0", "#8be04e", "#f5d13d", "#ff8a3d", "#ff3d6e"], noData: "#2a2f3a" },
  okabe: { name: "Colour-blind safe", bands: ["#fde725", "#5ec962", "#21918c", "#3b528b", "#5b2a86"], noData: "#2a2f3a" },
}
```
The colour-blind palette uses Viridis stops ordered by lightness, so the rating order reads without relying on hue. The colour key and the tape's winner ticks follow the palette switch.

### Scrubber
- Dragging uses Pointer Events with pointer capture and `touch-action: none`.
- A `range` input below the strips stays synced with the laser, which gives keyboard support. Screen readers hear both current episodes as `aria-valuetext`.
- Card updates are batched to one per animation frame.
- During a fast drag the card text updates instantly. The flip animation only plays when stepping slowly (gaps over 150ms), and never with reduced motion.
- **Haptics:** an 8ms `navigator.vibrate` when the laser crosses a season boundary. This works on Android; elsewhere it does nothing.
- **First-visit hint:** "⟵ ⟶ Drag across the strips" sits over the strips until the first drag or slider move. It's remembered after that.

### Cards
Each card shows: show name · `S03E06` · episode title (truncated with an ellipsis) · a big `★ 9.4` · the delta chip (coloured by the rating band, never green/red) · `24.5 hrs in`. A coloured accent bar on the left matches the band.

### Search
- With an empty query it lists the presets, labelled "work offline".
- Typing matches presets instantly. From 2 characters it also searches TVmaze, 300ms after you stop typing, cancelling any earlier request (`AbortController`). Up to 5 live results appear, with preset duplicates removed.
- Each result has **→ A** and **→ B** buttons to pick the slot.
- A loading skeleton covers the strip while a show fetches.
- If the fetch fails, a toast says so: "You're offline. The presets still work." or "Couldn't reach TVmaze…".
- **Landscape phone keyboard workaround:** Android lays the keyboard over most of the screen, so:
  - The keyboard's search key (`enterkeyhint="search"`) searches immediately and closes the keyboard.
  - Touching the results list also closes it.
  - The dropdown sizes itself to the space visible above the keyboard (`visualViewport`), so the first result is always tappable.

### Sharing and the rest
- The address bar always holds the current state, via `history.replaceState` throttled to 300ms.
- **Share** uses `navigator.share`, falling back to copying the link with a "Link copied" toast.
- A link can name shows that aren't presets: they load from the cache or live. If one can't be loaded, a preset stands in and a toast explains.
- **Stats sheet:** a bottom drawer on phones and a side panel (380px) on wide screens, where the app makes room so you can keep scrubbing.
  - It leads with the tale of the tape, then Golden Era, Whiplash and Drop-Off for each show.
  - Tapping a stat jumps the laser there. On phones the drawer closes so you see it land.
- **Open Graph tags** point at `https://anthonygeo3.github.io/SeriesDNA/og.png`, a static screenshot of the default matchup.
- **Manifest:** `display: standalone`, `orientation: any`, with 192px and 512px icons (the 512px one is maskable).

## 7. Layout

Everything is CSS grid and flexbox, using `dvh` (never `vh`), `clamp()` for type, `env(safe-area-inset-*)` padding, minimum 44px tap targets, and a dark theme with glassy cards (`backdrop-filter`, with a solid fallback).

### Laptop and desktop
- The header is at the top. The colour key, strips (up to 120px each), controls and cards sit together, centred in the remaining height.
- At 1000px wide or more, and 561px tall or more, the cards row has three columns: **card A · tale of the tape · card B**.
- On narrower tall screens, the tape spans the full width below the cards.

### Landscape phone (budget about 350px tall)
- No vertical scroll.
- The colour key and verdict share one line: below 420px tall the "Episode rating" title and "see why" are dropped.
- The strips flex down to about 44px each.
- The tape is hidden, and the verdict opens it in the Stats sheet.

### Portrait phone
- **Header, in two rows:** logo and a wide Play button, then search with the icon buttons (Stats becomes a bar-chart icon).
- **Strips:** full width, 76px each. **A's name sits above the pair and B's below**, so the laser runs unbroken across both.
- **Controls:** full width, with the toggle on its own row.
- **Below:** the cards stacked, then the tale of the tape. The page scrolls.

### Game screen
- Full screen: a header with the title, the **Show vs Show / Season vs Season** buttons, score, best and close, then the two cards with "vs" between them, the question, and the guess buttons.
- Spare height is split above the cards and below the buttons, so they stay grouped in the middle.
- In portrait the cards stack, and the mode buttons get their own row on narrow screens.

## 8. Higher or Lower

- **How it plays:** one card shows a rating, the other shows "★ ?". You guess whether the hidden one is rated higher or lower.
  - A correct guess scores a point, and the revealed card becomes the known one.
  - One wrong guess ends the game, with **Play again**.
- **Modes**, picked at the top, each with its own best score, and the last mode remembered:
  - **Show vs Show:** whole-show averages. Easier, and the default.
  - **Season vs Season:** single seasons, with at least 3 rated episodes each. It picks a random show first, then one of its seasons, so long-runners don't crowd the rest out.
- **Pool:** the presets, plus any show the user has searched for before (cached), plus whatever is loaded now. The presets alone give 48 shows and 326 seasons.
- **Difficulty:** pairs start at least 0.5 apart, and the minimum gap shrinks by 0.04 per point, down to 0.1.
- **No repeats:** the last 20 cards (half the pool when it's small) are held back. In a 30-round game that means about 29 different shows in Show vs Show and 30 different seasons in Season vs Season, with every round still meeting the difficulty gap.
- **Ties:** ratings are compared as shown (one decimal place), and a tie counts as correct.
- **Reveal:** the hidden rating counts from the known one to its value over 650ms. The card then shows that show's or season's barcode. Nothing about the hidden card's rating or barcode is visible before the guess.
- **Controls:** ↑/↓ or H/L on desktop, and Escape closes. Reduced motion skips the count-up and the card pop.

## 9. Accessibility
- **Contrast:** dark theme with good contrast; delta chips use band colours plus text, never green/red alone.
- **Colour-blind palette:** perceptually ordered, so rating order doesn't depend on hue.
- **Keyboard:** the slider, the arrow keys in the game, and Escape for the search, sheet and game.
- **Screen readers:**
  - `aria-valuetext` on the scrubber.
  - Screen-reader-only "(wins)" text in the tape.
  - The game question is announced through `aria-live`.
  - The strips have `role="img"` with a summary label.
- **Reduced motion** turns off the tweens, flips, pulse, hint animation, count-up and card pop.

## 10. Status and history

### Phases (all done)
- **Phase 0, data de-risk:** the audit and preset build ran. Coverage was excellent, so the TMDB/OMDb fallback wasn't needed. The bands were retuned (section 5).
- **Phase 1, barcode engine and scrubber:** done. 60fps dragging Grey's (471 episodes), measured in a headless browser with the CPU throttled.
- **Phase 2, toggle, live search and stats:** done. Searching "Severance" works live, and the presets work offline.
- **Phase 3, polish and sharing:** done. Share links round-trip in a fresh browser.
- **Phase 4, deploy:** done. Live on Pages, and real-phone testing found the issues fixed in the changes below.
- **After launch:** the Higher or Lower game, the colour key, the tale of the tape, and the portrait layout.

### Changes from the original plan
| Original plan | Now | Why |
|---|---|---|
| Bands at 9 / 8 / 7 / 6 | 8.8 / 8.4 / 8.0 / 7.6 | TVmaze ratings cluster around 8; the old bands made most strips two-tone |
| Drop-Off ignored the first **and last** 5% | First 5% only | Ignoring the end hid Game of Thrones' S8 crash |
| "modules-free JS", runnable from `index.html` | ES modules; run with `npx serve` locally | The plan contradicted itself (`type="module"`); Pages is unaffected |
| Rivalry pills ("Sprint vs Marathon"…) | Removed | Feedback: let people explore their own favourite shows |
| Landscape-first; full-screen rotate overlay in portrait; orientation lock; manifest forced landscape | Portrait is a proper layout; overlay, lock and forced orientation removed | Cold visitors from shared links mostly hold phones upright |
| Analyst stats only in the Stats sheet | Plus a tale of the tape with a verdict on the main screen | Visitors want to know who wins, not just see numbers |
| No colour key | A colour key above the strips, and a first-visit drag hint | Nothing explained the colours or that the strips can be dragged |
| Slider 0–1000 only | Slider 0–1000, positions snapped to 1/10,000 | So links reproduce the exact episodes on very long shows |
| No game | Higher or Lower, two modes | Makes the site fun beyond a single comparison |

## 11. Test checklist

**Automated:** `node --test` runs 18 unit tests over `core.js` and the preset data. They cover bands, mapping, segments, stats, the tale of the tape, URL state, the game picker and judging, and that every preset passes the guard.

**Browser checks** were run with Playwright against both local and live builds. These scripts aren't committed (see section 12).
- [x] Phone landscape (780×350): no vertical scroll; the colour key and verdict fit on one line; strips about 44px
- [x] Portrait (412 wide): no rotate blocker, full-width strips, no sideways scroll, dragging updates both cards
- [x] Laptop 1440×900 and 1100×680: no overflow; tape between the cards
- [x] No blurry strips on high-resolution screens (canvas backing store = CSS size × DPR)
- [x] Toggle ends exactly at the target widths
- [x] Unrated episodes show "No rating" without breaking stats
- [x] Offline: presets swap, and live search fails with a message
- [x] A share link round-trips shows, position and mode in a fresh browser, including a live (non-preset) show
- [x] Reduced motion turns off flips and tweens
- [x] Keyboard workaround: the first result stays tappable above a simulated keyboard, and the search key closes it
- [x] Game: scoring, per-mode best scores, no peeking, no quick repeats, and the layout on all three sizes
- [~] Dragging smoothness:
  - At 4× CPU throttle, a steady 60fps everywhere.
  - At 6× on the current (slower) dev machine, both this build and the previous one drop frames. The newer UI costs about 6% more per frame (roughly 3.15ms against 2.96ms, unthrottled).
- [ ] Real devices (manual): Android haptics; iOS Safari; the link preview in Teams/Slack

## 12. Known limitations and parked ideas
- **Data quality:**
  - TVmaze ratings cluster between about 7.5 and 9, and smaller shows have few voters, so this is fun, not authoritative.
  - Some runtimes are slot lengths: Grey's is listed at 60 minutes, so Hours mode overstates it (471 hours rather than about 340).
- **Show vs Show is still fairly tight:** the 48 whole-show averages run from 7.3 (Schitt's Creek) to 8.9 (Friends), but the middle half sit between 7.8 and 8.2. Later rounds are often 0.1–0.2 apart, and ties (which count as correct) happen. Searching more shows adds more.
- **Offline needs the page already loaded.** There's no service worker, by choice: a stale cache straight after a deploy is a demo risk.
- **The social preview is static:** every link shows the default matchup image. Static Pages can't make one per link.
- **No committed browser tests:** the Playwright checks above live outside the repo.
- **Parked ideas:** sharing a game score, a "Surprise me" random matchup, season-average strips, and an overlay sparkline. These are considered fine to leave out for now.

## 13. Two-minute demo script
1. **Open the link and say nothing.** The Boys vs Grey's Anatomy glow on screen, with the colour key above. "This is every episode of two shows, squashed onto the same scale."
2. **Drag the scrubber** slowly through Grey's. "Watch the slump arrive." Pause on the Drop-Off marker.
3. **Point at the tale of the tape.** "And it tells you who actually wins." Hit the toggle: The Boys shrinks to a sliver next to Grey's. "This is the time commitment."
4. **Take a suggestion from the room**, search their favourite show live, and drop it in.
5. **Hit Share**, paste the link into the team chat, and let people open it on their phones. Portrait works now, so there's no rotate prompt.
6. **Hit Play** for Higher or Lower: "beat my score". Close with the palette switch: "and it's colour-blind safe", for the designers.

## 14. Working on it
- **Run locally:** `npx serve` in the repo root. Tests: `node --test`.
- **Rebuild presets:** edit `PRESETS` in `scripts/lib.mjs`, then run `node scripts/audit.mjs` and `node scripts/build-presets.mjs`, and commit `data/presets.json`.
- **Deploy:** merge to `main`. Pages redeploys in about a minute, and browsers may cache the old files for up to 10 minutes, so pull to refresh.
