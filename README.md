# FoodLit (Phase 1 personal MVP)

Photo → recipe → ingredients ordered at the cheapest price. Built from `FoodLit.md` (PRD v0.1).

**UI — "Warm Kitchen" (v18):** a light, friendly design system in `styles.css`. Cream background, terracotta as the one main color, and herb green used only for money saved and "you have this". Headings use Bricolage Grotesque and everything else uses Inter. It's designed for phones first and works down to 360px wide.

**Home = "What to cook tonight":** the home screen leads with dish picks for the current meal (breakfast 5–11am, lunch until 4pm, dinner otherwise). They're sorted by how few ingredients you need to buy, based on your pantry, then by cooking time. Each card says "You have 9 of 11 · buy 2". See `tonightPicks()` in `app.js`. Snap and search sit just below, followed by the savings card and the full browsable list.

**Motion — `motion.js` (no dependencies, so it still works offline):** kept to what explains a change. The dish photo morphs from its card into the recipe (View Transitions), savings and prices roll to their new values, checkboxes draw their tick, and sheets slide up. There's no intro, film grain or glow. All motion is reduced to instant changes with `prefers-reduced-motion`.

**Branding:** the FoodLit mark is a bowl with a fresh sprout (food that's good for you, and a habit that grows) on a terracotta tile. It is defined once as `LOGO_MARK` in `app.js` (the sprout sways on hover and while a photo is identified). `icon.svg` is the source of truth for the favicon and home-screen icons. `icon-180.png`, `icon-512.png` and `favicon.ico` are rendered from it by headless Chrome, as full-bleed squares so iOS and Android can apply their own mask.

**Dish photos:** real photos in `img/<dish-id>.jpg`, sourced from Wikimedia Commons and credited per-recipe in-app — see [CREDITS.md](CREDITS.md). Most are CC BY-SA / CC BY (attribution + share-alike **required** if you ever publish this); a few are CC0. If a photo is missing the card falls back to the dish emoji, so nothing renders broken.

**Backup:** ⚙️ Settings and the History screen both have **Export / Import**. Export writes `foodlit-backup-YYYY-MM-DD.json` (older `snap-to-cook` backups still import) (meals + pantry, **never** the API key) — on iOS it goes through the share sheet so you can Save to Files. Import validates and sanitises the file, then offers **Merge** (dedupes meals by name+date+amount, so restoring an old backup can't wipe newer entries) or **Replace**. Pantry keys not in this build's catalog are skipped and reported.

**Editing note:** asset URLs are versioned (`styles.css?v=5`). After changing `app.js`, `motion.js`, `data.js` or `styles.css`, bump the `?v=` number in `index.html` **and** the `CACHE` name in `sw.js`, or browsers and the installed PWA will serve the stale cached copy.

**Run it:** any static server, e.g.

```bash
python3 -m http.server 4173 --directory snap-to-cook
```

then open http://localhost:4173 on your phone or browser (mobile-width works best).

## What's implemented (PRD mapping)

| PRD | Feature | How |
|---|---|---|
| P0-1 | Photo dish recognition | Claude vision (Haiku 4.5) called directly from the browser with your Anthropic API key (⚙️ Settings, stored in localStorage). Top-3 guesses matched to recipes by a specificity-ranked scorer (exact name/alias beats a loose substring), so "butter chicken" can't land on a chicken-steak recipe. Search fallback always shown — never a dead end. |
| P0-2 | Recipe search & detail | Curated set of 33 dishes across 6 cuisines (name + aliases search), each with quantities, numbered steps, video link. |
| — | Meal categories | "All day / 🌅 Breakfast (6) / ☀️ Lunch (22) / 🌙 Dinner (26)" tabs. A dish can belong to several (`meals: []` in `data.js`) — most Indian mains are lunch **and** dinner. Combines with cuisine and time; chip counts update to reflect the other active filters. Recipe screens show their meal slots. |
| — | Cuisine categories | "Browse by cuisine" strip on home: All / 🇮🇳 Indian (21) / 🍝 Italian (3) / 🥩 Grills (2) / 🥢 Asian (3) / 🌮 Mexican (2) / 🍳 Continental (2). Combines with the time filter; typing a search resets to All so no match is hidden. Add a cuisine by appending to `CUISINES` in `data.js` and tagging recipes with its id. |
| P0-3 | Ingredient → SKU mapping | Hand-curated catalog (70 SKUs) per PRD §8.3; unmapped items flagged amber (e.g. fresh coconut in Poha). |
| P0-4 | Cross-app price comparison | Per-basket totals for Zepto / Blinkit / Instamart, cheapest highlighted, "last checked" timestamp; apps missing an item are excluded from the crown (edge #9 — e.g. paneer is out of stock on Instamart). |
| P0-5 | One-tap handoff | Deep links to each app's search page per item; checkout finishes in the partner app (no public ordering API — PRD §8.1). |
| P0-6 | Pantry exclusions | Untick items you have; totals recalc instantly. Pantry staples (salt, oil, spices) start unticked. |
| P1 | Cook-vs-order cost | Recipe screen shows cook ~₹ (hand-estimated `cookCost` in `data.js` = ingredients the meal actually uses) vs delivered ₹. The full-pack basket total is shown separately — leftovers carry over. |
| P1 | Meals counter / savings tally | "I cooked this" logs to history; home chip shows meals + ₹ kept from delivery. |
| P1 | Time-to-cook filter | ≤20 / ≤30 / ≤45 min chips on home. |
| P1 | Persistent pantry (🧺) | A real pantry manager: shows only what you own (with pack quantities), add items via catalog search suggestions (no free text) with a quantity stepper, adjust or remove with per-row −/+/🗑. Seeded with 9 staples, stored in localStorage (`[{key, qty}]`, migrates the old format). Pantry items start unticked in every basket and are badged in recipes. |
| P1 | Serving-size scaling | Stepper (1–8 people) on the recipe screen. Ingredient quantities scale (fractions, ranges and units handled), costs scale, and the basket multiplies pack counts for scale-marked ingredients (`scale: true` in `data.js`, e.g. paneer, chicken, eggs, tomatoes, spinach). |
| — | Calories | Hand-estimated `kcalPerServe` per recipe in `data.js`; recipe screen shows whole-dish kcal live-updating with the servings stepper; home cards show kcal/serve. |

## Deliberately not built (PRD Non-Goals)

Native checkout, accounts/auth, nutrition tracking, native apps, multi-user. Prices are a hand-refreshed snapshot (PRD §8.2 accepts semi-manual refresh for v1) — edit `data.js` and bump `PRICES_CHECKED` when you re-check them.

## Phase 0 reminder (do this before trusting any metric)

Write down your last 30 days of Swiggy/Zomato orders (count, spend, avg value) **now** — that's the baseline the savings tally is measured against. You can't recover it later.
