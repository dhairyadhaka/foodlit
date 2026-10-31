# FoodLit (Phase 1 personal MVP)

Photo → recipe → ingredients ordered at the cheapest price. Built from `FoodLit.md` (PRD v0.1).

**UI — "Warm Kitchen" (v18):** a light, friendly design system in `styles.css`. Cream background, terracotta as the one main color, and herb green used only for money saved and "you have this". Headings use Bricolage Grotesque and everything else uses Inter. It's designed for phones first and works down to 360px wide.

**Home = "What to cook tonight":** the home screen leads with dish picks for the current meal (breakfast 5–11am, lunch until 4pm, dinner otherwise). They're sorted by how few ingredients you need to buy, based on your pantry, then by cooking time. Each card says "You have 9 of 11 · buy 2". See `tonightPicks()` in `app.js`. Snap and search sit just below, followed by the savings card and the full browsable list.

**Motion — `motion.js` (no dependencies, so it still works offline):** kept to what explains a change. The dish photo morphs from its card into the recipe (View Transitions), savings and prices roll to their new values, checkboxes draw their tick, and sheets slide up. There's no intro, film grain or glow. All motion is reduced to instant changes with `prefers-reduced-motion`.

**Branding:** the FoodLit mark is a bowl with a fresh sprout (food that's good for you, and a habit that grows) on a terracotta tile. It is defined once as `LOGO_MARK` in `app.js` (the sprout sways on hover and while a photo is identified). `icon.svg` is the source of truth for the favicon and home-screen icons. `icon-180.png`, `icon-512.png` and `favicon.ico` are rendered from it by headless Chrome, as full-bleed squares so iOS and Android can apply their own mask.

**Dish photos:** real photos in `img/<dish-id>.jpg`, sourced from Wikimedia Commons and credited per-recipe in-app — see [CREDITS.md](CREDITS.md). Most are CC BY-SA / CC BY (attribution + share-alike **required** if you ever publish this); a few are CC0. If a photo is missing the card falls back to the dish emoji, so nothing renders broken.

**Backup:** ⚙️ Settings and the History screen both have **Export / Import**. Export writes `foodlit-backup-YYYY-MM-DD.json` (older `snap-to-cook` backups still import) (meals + pantry, **never** the API key) — on iOS it goes through the share sheet so you can Save to Files. Import validates and sanitises the file, then offers **Merge** (dedupes meals by name+date+amount, so restoring an old backup can't wipe newer entries) or **Replace**. Pantry keys not in this build's catalog are skipped and reported.

**Meal planner + cookbook (`planner.js`):** opened from the 📅 button in the top bar.
- **Week board:** Mon–Sun × Breakfast/Lunch/Dinner. Tap an empty slot to pick a dish; your cookbook dishes come first, then the best matches for that meal (fewest things to buy), and search covers everything. Tap a filled slot to change people, open the recipe, mark it cooked (this logs savings; unmarking removes the log), swap or remove it.
- **Month view:** dots show planned and cooked days. Tap a day to jump to its week.
- **Plan my week for me:** fills only the *empty* slots from today on. It picks dishes that suit the meal, prefers the fewest things to buy given your pantry, avoids repeats within the week, varies cuisine from the previous dinner, and nudges towards favourites. Undo restores the previous plan. On weekends it offers to plan next week.
- **Groceries:** adds up every ingredient for the plan's remaining meals (amounts from `costs.js`), skips pantry items, and rounds to whole packs. You get the price across apps and the same guided "Shop on …" walkthrough as the basket. When no app has everything, it picks the one missing the fewest items.
- **Savings forecast:** shown on the board ("₹6,224 kept from delivery if you cook this plan"), along with "Cooked x of y".
- **Home:** "Today's plan" shows the next uncooked meal with **Start cooking**. Logging that dish from its basket ticks it off the plan.
- **Cookbook:** ♡ Save and **Add to plan** on every recipe, plus personal notes on the recipe page. Cookbook dishes show your note.
- **Storage:** everything is kept on the device (`stc_plan`, `stc_cookbook`) and included in backups. Merging fills empty slots and unions favourites.
- **Share plan:** sends the week as text (WhatsApp, etc.).

**Prices (not live):** none of the three apps offers live prices to other apps, so prices are a hand-kept snapshot.
- **Base snapshot:** `data.js` holds the base prices, taken on `PRICES_CHECKED_ON` (13 Aug 2026).
- **Estimates:** items marked `estimated: true` were never checked (the 25 added with the 36-dish expansion). The basket labels them "estimate".
- **Update prices:** ⚙️ Settings → Update prices, or the link under the price comparison. It lists the 20 most-used items first, each with an Open link per app and boxes for the price you see there. Saving stores the prices with today's date in `localStorage` (`stc_prices`), layered on top of `data.js`.
- **The note under the comparison:** shows the check dates, how many prices are estimates, and that the real total shows in the app.
- **Backups:** checked prices are included. Merging keeps whichever check is newer.
- **How often:** re-check the top 20 every few weeks (about 15 minutes).

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
| P0-2 | Recipe search & detail | Curated set of 69 dishes across 7 cuisines (name + aliases search), each with quantities, numbered steps, video link. |
| — | Meal categories | "Any meal / Breakfast (16) / Lunch (42) / Dinner (50)" tabs. A dish can belong to several (`meals: []` in `data.js`) — most Indian mains are lunch **and** dinner. Combines with cuisine and time; chip counts update to reflect the other active filters. Recipe screens show their meal slots. |
| — | Cuisine categories | "Browse by cuisine" strip on home: All / Indian (33) / Italian (5) / Grills (5) / Asian (6) / Mexican (5) / Continental (9) / Salads & Bowls (6). Combines with the time filter; typing a search resets to All so no match is hidden. Add a cuisine by appending to `CUISINES` in `data.js` and tagging recipes with its id. |
| P0-3 | Ingredient → SKU mapping | Hand-curated catalog (95 SKUs) per PRD §8.3; unmapped items flagged amber (e.g. fresh coconut in Poha). |
| P0-4 | Cross-app price comparison | Per-basket totals for Zepto / Blinkit / Instamart with the cheapest highlighted. Apps missing an item are excluded from the crown (edge #9, e.g. paneer is out of stock on Instamart). **Prices are not live.** See *Prices* below. |
| P0-5 | One-tap handoff | Deep links to each app's search page per item; checkout finishes in the partner app (no public ordering API — PRD §8.1). |
| P0-6 | Pantry exclusions | Untick items you have; totals recalc instantly. Pantry staples (salt, oil, spices) start unticked. |
| P1 | Cook-vs-order cost | **Cook** is calculated in `costs.js` from current grocery prices and how much of each pack the dish uses (e.g. 1 cup toor dal ≈ 200 g of a 500 g pack), so it follows any price you update. **Order** = the dish's typical Swiggy/Zomato `menuPrice` (researched Oct 2026) + `ORDER_EXTRAS` in `data.js`: 5% food tax, ₹18 platform fee (₹17.58 on both apps since Mar 2026), and about ₹30 delivery and ₹20 packaging. Recipe screens show the breakdown, and **Set my usual price** replaces it with what you actually pay (saved per dish and included in backups). The full-pack basket total is shown separately, since leftovers carry over. |
| P1 | Meals counter / savings tally | "I cooked this" logs to history; home chip shows meals + ₹ kept from delivery. |
| P1 | Time-to-cook filter | ≤20 / ≤30 / ≤45 min chips on home. |
| P1 | Persistent pantry (🧺) | A real pantry manager: shows only what you own (with pack quantities), add items via catalog search suggestions (no free text) with a quantity stepper, adjust or remove with per-row −/+/🗑. Seeded with 9 staples, stored in localStorage (`[{key, qty}]`, migrates the old format). Pantry items start unticked in every basket and are badged in recipes. |
| P1 | Serving-size scaling | Stepper (1–8 people) on the recipe screen. Ingredient quantities scale (fractions, ranges and units handled), costs scale, and the basket multiplies pack counts for scale-marked ingredients (`scale: true` in `data.js`, e.g. paneer, chicken, eggs, tomatoes, spinach). |
| — | Calories | Hand-estimated `kcalPerServe` per recipe in `data.js`; recipe screen shows whole-dish kcal live-updating with the servings stepper; home cards show kcal/serve. |

## Deliberately not built (PRD Non-Goals)

Native checkout, accounts/auth, nutrition tracking, native apps, multi-user. Prices are a hand-refreshed snapshot (PRD §8.2 accepts semi-manual refresh for v1) — edit `data.js` and bump `PRICES_CHECKED` when you re-check them.

## Phase 0 reminder (do this before trusting any metric)

Write down your last 30 days of Swiggy/Zomato orders (count, spend, avg value) **now** — that's the baseline the savings tally is measured against. You can't recover it later.
