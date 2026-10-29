// Higher or Lower: is the next show/season rated higher or lower than this one?
import { prepareShow, gameItems, pickNext, judge, bandIndex } from "./core.js";
import { drawStrip } from "./render.js";
import { h } from "./dom.js";

const BEST_PREFIX = "sdna:v1:hilo-best:"; // + "show" | "season"
const MODE_KEY = "sdna:v1:hilo-mode";
const REVEAL_MS = 650;
const NEXT_ROUND_MS = 900;

const $ = (sel) => document.querySelector(sel);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Not persisted in private mode; the game still works.
  }
}

const loadBest = (mode) => Number(load(BEST_PREFIX + mode)) || 0;

// getShows: raw shows to play with. getStyle: { palette, theme } for strips.
export function createGame({ getShows, getStyle, reducedMotion }) {
  const els = {
    root: $("#game"),
    left: $("#game-left"),
    right: $("#game-right"),
    score: $("#game-score"),
    best: $("#game-best"),
    msg: $("#game-msg"),
    actions: $("#game-actions"),
    higher: $("#game-higher"),
    lower: $("#game-lower"),
    again: $("#game-again"),
    modes: document.querySelectorAll("#game-modes button"),
  };
  let shows = new Map(); // showId -> prepared show
  let pool = [];
  let left = null;
  let right = null;
  let mode = load(MODE_KEY) === "season" ? "season" : "show"; // which cards: whole shows or seasons
  let recent = []; // keys seen lately, so cards don't come straight back
  let score = 0;
  let best = loadBest(mode);
  let bestAtStart = best;
  let phase = "idle"; // guess | reveal | over
  let round = 0; // bumps on every new game/close so stale timers bail out
  let opener = null;

  const label = (it) => (it.kind === "show" ? `${it.name}` : `${it.name} · Season ${it.season}`);

  function stripFor(item) {
    const show = shows.get(item.showId);
    return item.kind === "show" ? show : prepareShow({ ...show, episodes: show.episodes.slice(item.start, item.end + 1) });
  }

  function renderCard(el, item, shownRating) {
    const revealed = shownRating != null;
    const band = revealed ? bandIndex(shownRating) : -1;
    el.style.setProperty("--accent", band < 0 ? "var(--line)" : `var(--band-${band})`);
    el.classList.toggle("hidden-rating", !revealed);
    const canvas = h("canvas", { class: "game-strip", "aria-hidden": "true" });
    el.replaceChildren(
      h("div", { class: "game-kicker" }, item.kind === "show"
        ? `Whole show · ${item.seasons} season${item.seasons === 1 ? "" : "s"}`
        : `Season ${item.season}`),
      h("div", { class: "game-name" }, item.name),
      h("div", { class: "game-meta" }, [item.year, `${item.count} rated episodes`].filter(Boolean).join(" · ")),
      h("div", { class: "game-rating" }, revealed ? `★ ${shownRating.toFixed(1)}` : "★ ?"),
      revealed ? canvas : h("div", { class: "game-strip game-strip-blank" }));
    if (revealed) {
      // Draw once the canvas has its size.
      requestAnimationFrame(() => drawStrip(canvas, stripFor(item), { ...getStyle(), markers: [] }));
    }
  }

  function setScore() {
    els.score.textContent = String(score);
    els.best.textContent = String(best);
  }

  function prompt() {
    els.msg.textContent = `Is ${label(right)} rated higher or lower than ${left.rating.toFixed(1)}?`;
  }

  function showButtons(playing) {
    els.higher.hidden = els.lower.hidden = !playing;
    els.again.hidden = playing;
    els.higher.disabled = els.lower.disabled = false;
  }

  function next() {
    recent.push(left.key);
    const size = pool.reduce((n, items) => n + items.filter((it) => it.kind === mode).length, 0);
    // Up to the last 20 cards (half the pool when it is small) are held back.
    const avoid = recent.slice(-Math.min(20, Math.floor(size / 2)));
    return pickNext(pool, left, score, { kind: mode, avoid });
  }

  function syncModes() {
    for (const b of els.modes) b.setAttribute("aria-pressed", String(b.dataset.kind === mode));
  }

  function start() {
    round++;
    const raws = getShows();
    shows = new Map(raws.map((raw) => [raw.id, prepareShow(raw)]));
    pool = [...shows.values()].map(gameItems);
    syncModes();
    score = 0;
    best = loadBest(mode);
    bestAtStart = best;
    recent = [];
    left = pickNext(pool, null, 0, { kind: mode });
    right = next();
    phase = "guess";
    setScore();
    renderCard(els.left, left, left.rating);
    renderCard(els.right, right, null);
    showButtons(true);
    prompt();
    els.higher.focus();
  }

  // Count the hidden rating up (or down) from the known one, for suspense.
  function reveal(item, from) {
    if (reducedMotion.matches) {
      renderCard(els.right, item, item.rating);
      return Promise.resolve();
    }
    return new Promise((done) => {
      const t0 = performance.now();
      const ratingEl = () => els.right.querySelector(".game-rating");
      renderCard(els.right, item, null);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / REVEAL_MS);
        const k = 1 - (1 - t) ** 3; // ease-out
        if (t < 1) {
          ratingEl().textContent = `★ ${(from + (item.rating - from) * k).toFixed(1)}`;
          requestAnimationFrame(step);
        } else {
          renderCard(els.right, item, item.rating);
          done();
        }
      };
      requestAnimationFrame(step);
    });
  }

  async function guess(dir) {
    if (phase !== "guess") return;
    phase = "reveal";
    const myRound = round;
    els.higher.disabled = els.lower.disabled = true;
    const ok = judge(left, right, dir);
    const tie = left.rating === right.rating;
    await reveal(right, left.rating);
    if (myRound !== round) return;

    if (ok) {
      score++;
      const firstNewBest = score === bestAtStart + 1 && bestAtStart > 0;
      if (score > best) {
        best = score;
        save(BEST_PREFIX + mode, best);
      }
      setScore();
      els.msg.textContent = tie ? "Same rating, so that counts. ✓" : `Correct! ✓${firstNewBest ? " New best!" : ""}`;
      els.right.classList.add("pop");
      await wait(reducedMotion.matches ? 400 : NEXT_ROUND_MS);
      if (myRound !== round) return;
      els.right.classList.remove("pop");
      left = right;
      right = next();
      renderCard(els.left, left, left.rating);
      renderCard(els.right, right, null);
      phase = "guess";
      els.higher.disabled = els.lower.disabled = false;
      prompt();
    } else {
      phase = "over";
      const was = right.rating > left.rating ? "higher" : "lower";
      const beat = score > bestAtStart;
      els.msg.textContent = `✗ It was ${was}. You scored ${score}${beat ? ", a new best!" : `. Best: ${best}`}`;
      showButtons(false);
      els.again.focus();
    }
  }

  function open(fromButton) {
    opener = fromButton ?? null;
    els.root.hidden = false;
    document.body.classList.add("game-open");
    start();
  }

  function close() {
    round++;
    phase = "idle";
    els.root.hidden = true;
    document.body.classList.remove("game-open");
    opener?.focus();
  }

  els.higher.addEventListener("click", () => guess("higher"));
  els.lower.addEventListener("click", () => guess("lower"));
  els.again.addEventListener("click", start);
  for (const b of els.modes) {
    b.addEventListener("click", () => {
      if (b.dataset.kind === mode && phase !== "over") return;
      mode = b.dataset.kind;
      save(MODE_KEY, mode);
      start();
    });
  }
  $("#game-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (els.root.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowUp" || e.key.toLowerCase() === "h") guess("higher");
    else if (e.key === "ArrowDown" || e.key.toLowerCase() === "l") guess("lower");
    else return;
    e.preventDefault();
  });

  return { open, close, isOpen: () => !els.root.hidden };
}
