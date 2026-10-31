// ---------------------------------------------------------------
// FoodLit — app logic (single-user personal MVP)
// Views: home → identify → recipe → basket, plus pantry & history.
// No build step, no backend. Vision calls go straight to the
// Anthropic API with a locally-stored key (Settings).
// Motion lives in motion.js; this file decides *when* it plays.
// ---------------------------------------------------------------

const $app = document.getElementById("app");
const $photoInput = document.getElementById("photo-input");

// Staples most kitchens already have — seeds the pantry on first run.
// Derived from the `pantry: true` flags in the recipe data so that adding
// a cuisine with new staples (olive oil, soy sauce…) keeps the seed honest
// instead of re-buying a ₹529 oil bottle on every basket.
const DEFAULT_PANTRY = [...new Set(
  RECIPES.flatMap(r => r.ingredients.filter(i => i.pantry && i.key).map(i => i.key))
)];

const store = {
  get apiKey() { return localStorage.getItem("stc_api_key") || ""; },
  set apiKey(v) { localStorage.setItem("stc_api_key", v); },
  get meals() { return JSON.parse(localStorage.getItem("stc_meals") || "[]"); },
  addMeal(m) { localStorage.setItem("stc_meals", JSON.stringify([m, ...this.meals])); },
  // Pantry entries: [{ key, qty }] where qty = number of packs owned.
  get pantry() {
    const raw = localStorage.getItem("stc_pantry");
    let list = raw == null ? DEFAULT_PANTRY.map(key => ({ key, qty: 1 })) : JSON.parse(raw);
    if (list.length && typeof list[0] === "string") list = list.map(key => ({ key, qty: 1 })); // migrate v1 format
    return list;
  },
  savePantry(list) { localStorage.setItem("stc_pantry", JSON.stringify(list)); },
  hasPantry(key) { return this.pantry.some(e => e.key === key && e.qty > 0); },
  pantryQty(key) { const e = this.pantry.find(x => x.key === key); return e ? e.qty : 0; },
  setPantryQty(key, qty) {
    let list = this.pantry;
    const e = list.find(x => x.key === key);
    if (e) { e.qty = qty; if (qty <= 0) list = list.filter(x => x.key !== key); }
    else if (qty > 0) list.push({ key, qty });
    this.savePantry(list);
  },
  saveMeals(list) { localStorage.setItem("stc_meals", JSON.stringify(list)); },

  // ---- backup ----
  // The cooked-meals log is the North Star metric and lives only in this
  // browser's localStorage, so it needs a way out. The API key is
  // deliberately NOT included — a backup file gets mailed and synced around.
  exportData() {
    return {
      app: "foodlit",
      version: 1,
      exportedAt: new Date().toISOString(),
      meals: this.meals,
      pantry: this.pantry,
      prices: priceStore.all,
      orderPrices: orderStore.all,
      plan: planStore.all,
      cookbook: cookbook.data,
    };
  },
};

// Meals are identified by name+date+saved so re-importing a backup can't
// duplicate entries you already have.
const mealKey = m => `${m.name}|${m.date}|${m.saved}`;

// Returns { meals, pantry, error } — never throws on bad input.
function parseBackup(text) {
  let d;
  try { d = JSON.parse(text); }
  catch { return { error: "That file isn't valid JSON." }; }
  if (!d || typeof d !== "object") return { error: "That file isn't a FoodLit backup." };
  // Backups made before the rename say "snap-to-cook" — still ours.
  if (d.app && !["foodlit", "snap-to-cook"].includes(d.app)) return { error: `That backup is from "${String(d.app).slice(0, 20)}", not FoodLit.` };
  if (!Array.isArray(d.meals) && !Array.isArray(d.pantry) && !d.prices && !d.plan && !d.cookbook) {
    return { error: "No meals or pantry data found in that file." };
  }
  const meals = (Array.isArray(d.meals) ? d.meals : [])
    .filter(m => m && typeof m.name === "string")
    .map(m => ({
      name: String(m.name).slice(0, 80),
      emoji: typeof m.emoji === "string" ? m.emoji.slice(0, 8) : "🍽️",
      saved: Number.isFinite(+m.saved) ? Math.max(0, Math.round(+m.saved)) : 0,
      serves: Number.isFinite(+m.serves) ? +m.serves : undefined,
      date: typeof m.date === "string" ? m.date.slice(0, 40) : "",
    }));
  // Drop pantry keys this build doesn't know about, so a backup from a
  // future/older catalog can't poison the basket logic.
  const pantry = (Array.isArray(d.pantry) ? d.pantry : [])
    .filter(e => e && typeof e.key === "string" && CATALOG[e.key])
    .map(e => ({ key: e.key, qty: Math.min(10, Math.max(1, Math.round(+e.qty) || 1)) }));
  const skipped = (Array.isArray(d.pantry) ? d.pantry.length : 0) - pantry.length;
  // Checked prices: known items only, whole rupees or empty, with a real date.
  const prices = {};
  if (d.prices && typeof d.prices === "object") {
    for (const [k, e] of Object.entries(d.prices)) {
      if (!CATALOG[k] || !e || !/^\d{4}-\d{2}-\d{2}$/.test(e.checked)) continue;
      const clean = { checked: e.checked };
      for (const a of Object.keys(APPS)) clean[a] = Number.isFinite(+e[a]) && +e[a] > 0 ? Math.round(+e[a]) : null;
      prices[k] = clean;
    }
  }
  // Your usual order prices: known dishes only, whole rupees.
  const orderPrices = {};
  if (d.orderPrices && typeof d.orderPrices === "object") {
    for (const [id, v] of Object.entries(d.orderPrices)) {
      if (recipeById(id) && Number.isFinite(+v) && +v > 0 && +v < 10000) orderPrices[id] = Math.round(+v);
    }
  }
  // Plan: real dates, known slots and dishes, 1–8 people.
  const plan = {};
  if (d.plan && typeof d.plan === "object") {
    for (const [day, slots] of Object.entries(d.plan)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !slots || typeof slots !== "object") continue;
      for (const [slot, e] of Object.entries(slots)) {
        if (!SLOTS.includes(slot) || !e || !recipeById(e.id)) continue;
        const entry = { id: e.id, serves: Math.min(8, Math.max(1, Math.round(+e.serves) || recipeById(e.id).serves)) };
        if (e.cooked === true) entry.cooked = true;
        if (typeof e.logged === "string") entry.logged = e.logged.slice(0, 200);
        (plan[day] = plan[day] || {})[slot] = entry;
      }
    }
  }
  // Cookbook: known dishes only; notes are plain text, capped.
  const cb = { favs: [], notes: {} };
  if (d.cookbook && typeof d.cookbook === "object") {
    if (Array.isArray(d.cookbook.favs)) cb.favs = [...new Set(d.cookbook.favs.filter(id => typeof id === "string" && recipeById(id)))];
    if (d.cookbook.notes && typeof d.cookbook.notes === "object") {
      for (const [id, t] of Object.entries(d.cookbook.notes)) if (recipeById(id) && typeof t === "string" && t.trim()) cb.notes[id] = t.slice(0, 1000);
    }
  }
  return { meals, pantry, skipped, prices, orderPrices, plan, cookbook: cb };
}

const state = {
  view: "home",          // home | identify | recipe | basket | pantry | history
  query: "",
  timeFilter: 0,         // 0 = all, else max minutes
  cuisine: "all",        // "all" or a CUISINES id
  meal: "all",           // "all" or a MEALS id
  recipeId: null,
  ticks: {},             // per-recipe: { itemIndex: bool }
  servings: {},          // per-recipe: chosen number of people
  selectedApp: null,
  identify: null,        // { imgUrl, status, guesses, error }
  pantrySearch: "",
  pantryAdd: null,       // { key, qty } staged for adding to the pantry
  homeScroll: 0,         // restored on the way back so the photo morphs into its card
};

// ---------- prices ----------

// None of the apps offers live prices, so FoodLit keeps a hand-checked
// snapshot: data.js holds the base (taken PRICES_CHECKED_ON), and anything
// re-checked on the "Update prices" screen is saved here with its own date
// and layered on top. Items flagged `estimated` in data.js were never
// checked; they show as "estimate" until someone checks them.
const priceStore = {
  get all() { try { return JSON.parse(localStorage.getItem("stc_prices") || "{}"); } catch { return {}; } },
  save(all) { localStorage.setItem("stc_prices", JSON.stringify(all)); },
};
const BASE_PRICES = Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, { ...v.prices }]));

function applyPrices() {
  const saved = priceStore.all;
  for (const [key, sku] of Object.entries(CATALOG)) {
    const s = saved[key];
    sku.prices = s ? Object.fromEntries(Object.keys(APPS).map(a => [a, s[a] ?? null])) : { ...BASE_PRICES[key] };
    sku.checked = s ? s.checked : (sku.estimated ? null : PRICES_CHECKED_ON);
  }
}
applyPrices();

const isEstimate = key => !CATALOG[key].checked;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDay = (iso, year = true) => new Date(iso + "T00:00").toLocaleDateString("en-IN",
  year ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" });
const daysAgo = iso => Math.round((new Date(todayISO() + "T00:00") - new Date(iso + "T00:00")) / 864e5);
const STALE_DAYS = 30;

// Items ranked by how many recipes use them: checking the top 20 covers
// most baskets.
const USAGE = (() => {
  const n = {};
  for (const r of RECIPES) for (const k of new Set(r.ingredients.map(i => i.key).filter(Boolean))) n[k] = (n[k] || 0) + 1;
  return n;
})();
const TOP_KEYS = Object.keys(CATALOG).sort((a, b) => (USAGE[b] || 0) - (USAGE[a] || 0) || a.localeCompare(b)).slice(0, 20);

// The honest line under the price comparison.
function priceNote(keys) {
  const dates = keys.map(k => CATALOG[k].checked).filter(Boolean).sort();
  const est = keys.filter(isEstimate).length;
  const when = !dates.length ? "" : dates[0] === dates.at(-1)
    ? `checked ${fmtDay(dates[0])}`
    : `checked between ${fmtDay(dates[0], false)} and ${fmtDay(dates.at(-1))}`;
  return `Not live prices${when ? ` — ${when}` : ""}. Your real total shows in the app.` +
    (est ? ` <b>${plural(est, "price")} ${est === 1 ? "is a rough estimate" : "are rough estimates"}.</b>` : "");
}

// ---------- cook vs order ----------

// Cost to cook comes from grocery prices (costs.js), so it follows any price
// you update. Order price = the dish's typical menu price + 5% food tax +
// platform, delivery and packaging fees, unless you've set what you usually
// pay for it, which then wins. Both scale with the number of people.
const orderStore = {
  get all() { try { return JSON.parse(localStorage.getItem("stc_order") || "{}"); } catch { return {}; } },
  save(all) { localStorage.setItem("stc_order", JSON.stringify(all)); },
};

const cookCostOf = (r, f = 1) => Math.round(Costs.cookCost(r) * f);

function orderBreakdown(r, f = 1) {
  const food = r.menuPrice * f;
  const extras = food * ORDER_EXTRAS.gst + ORDER_EXTRAS.platform + ORDER_EXTRAS.delivery + ORDER_EXTRAS.packaging;
  return { food: Math.round(food), extras: Math.round(extras), total: Math.round(food + extras) };
}
const myOrderPrice = r => orderStore.all[r.id] ?? null;
const orderPriceOf = (r, f = 1) => {
  const mine = myOrderPrice(r);
  return mine != null ? Math.round(mine * f) : orderBreakdown(r, f).total;
};
const savingOf = (r, f = 1) => Math.max(0, orderPriceOf(r, f) - cookCostOf(r, f));

// ---------- helpers ----------

// Indian digit grouping: ₹1,05,000.
const num = n => Math.round(n).toLocaleString("en-IN");
const fmt = n => "₹" + num(n);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function recipeById(id) { return RECIPES.find(r => r.id === id); }

function servingsFor(r) { return state.servings[r.id] || r.serves; }
function factorFor(r) { return servingsFor(r) / r.serves; }

// How well does a query match a recipe? Higher is better, 0 = no match.
// Scored rather than first-match-wins so that a loose substring hit can
// never beat an exact one — "butter chicken" must not land on a recipe
// merely because one of its aliases contains that phrase.
function matchScore(r, q) {
  const name = r.name.toLowerCase();
  if (name === q || r.aliases.includes(q)) return 100;          // exact
  if (name.startsWith(q) || r.aliases.some(a => a.startsWith(q))) return 80;
  if (name.includes(q) || r.aliases.some(a => a.includes(q))) return 60;
  // Query contains the dish name/alias (e.g. a wordy vision guess).
  // Score by how much of the query the match accounts for, so the most
  // specific dish wins rather than whichever appears first in the list.
  if (q.includes(name)) return 40 + (name.length / q.length) * 10;
  const alias = r.aliases.filter(a => q.includes(a)).sort((a, b) => b.length - a.length)[0];
  if (alias) return 20 + (alias.length / q.length) * 10;
  return 0;
}

function findRecipes(q) {
  q = q.trim().toLowerCase();
  if (!q) return RECIPES;
  return RECIPES
    .map(r => ({ r, s: matchScore(r, q) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.r);
}

function matchGuessToRecipe(guess) {
  return findRecipes(guess)[0] || null;
}

// ---------- serving-size scaling ----------

// Scales every numeric token in a quantity string: "1/4 cup", "10–12",
// "200 g", "1.5 tbsp". Non-numeric quantities ("to taste") pass through.
function scaleQty(qty, f) {
  if (f === 1) return qty;
  return String(qty).replace(/\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/g, m => {
    let v;
    if (m.includes("/")) { const [a, b] = m.split("/").map(Number); v = a / b; }
    else v = parseFloat(m);
    return fmtQtyNum(v * f);
  });
}

function fmtQtyNum(v) {
  const whole = Math.floor(v + 1e-9);
  const rem = v - whole;
  const fractions = [[0.25, "1/4"], [1 / 3, "1/3"], [0.5, "1/2"], [2 / 3, "2/3"], [0.75, "3/4"]];
  for (const [dec, txt] of fractions) {
    if (Math.abs(rem - dec) < 0.06) return whole ? `${whole} ${txt}` : txt;
  }
  if (rem < 0.06 || rem > 0.94) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

// ---------- basket model ----------

// Each ingredient row resolved against the catalog. Items already in the
// pantry start unticked. `packs` grows with servings for scale-marked items.
function basketFor(recipe) {
  const ticks = state.ticks[recipe.id] || {};
  const f = factorFor(recipe);
  return recipe.ingredients.map((ing, i) => {
    const sku = ing.key ? CATALOG[ing.key] : null;
    const inPantry = !!(ing.key && store.hasPantry(ing.key));
    const ticked = i in ticks ? ticks[i] : !inPantry;
    const basePacks = ing.packsFor || 1;
    const packs = ing.scale ? Math.ceil(basePacks * f) : basePacks;
    return {
      index: i,
      label: sku ? sku.product : ing.name,
      size: sku ? sku.size : null,
      qty: scaleQty(ing.qty, f),
      key: ing.key || null,
      estimate: !!(sku && isEstimate(ing.key)),
      prices: sku ? sku.prices : null,
      mapped: !!sku,
      inPantry,
      pantryQty: ing.key ? store.pantryQty(ing.key) : 0,
      packs,
      ticked,
    };
  });
}

// Per-app totals over ticked, mapped items (pack count included).
// Apps missing any ticked item are flagged and excluded from the
// "cheapest" crown (PRD edge #9).
function compareApps(items) {
  const active = items.filter(it => it.ticked && it.mapped);
  const result = {};
  for (const appId of Object.keys(APPS)) {
    let total = 0;
    const missing = [];
    for (const it of active) {
      const p = it.prices[appId];
      if (p == null) missing.push(it.label);
      else total += p * it.packs;
    }
    result[appId] = { total, missing, complete: missing.length === 0 };
  }
  const complete = Object.entries(result).filter(([, v]) => v.complete);
  const cheapest = complete.length
    ? complete.reduce((a, b) => (b[1].total < a[1].total ? b : a))[0]
    : null;
  return { perApp: result, cheapest, itemCount: active.length };
}

// Which app to shop on when you haven't picked one: the cheapest app that
// has everything, or, if none does, the one missing the fewest items.
function defaultApp(cmp) {
  if (cmp.cheapest) return cmp.cheapest;
  const ranked = Object.entries(cmp.perApp).sort((a, b) => a[1].missing.length - b[1].missing.length || a[1].total - b[1].total);
  return ranked.length ? ranked[0][0] : null;
}

function cheapestCookCost(recipe) {
  const { perApp, cheapest } = compareApps(basketFor(recipe));
  if (cheapest) return perApp[cheapest].total;
  const totals = Object.values(perApp).map(v => v.total).filter(t => t > 0);
  return totals.length ? Math.min(...totals) : 0;
}

function totalStats() {
  const meals = store.meals;
  return {
    count: meals.length,
    saved: meals.reduce((s, m) => s + (m.saved || 0), 0),
  };
}

// ---------- dish photos ----------

// Photos live at img/<recipe id>.jpg. If one is missing or fails to load,
// the emoji shows through instead — the app never renders a broken image.
function hasPhoto(r) {
  return typeof PHOTO_CREDITS !== "undefined" && !!PHOTO_CREDITS[r.id];
}

// `vt` names the photo for view-transition morphs between screens.
function dishPhoto(r, className = "thumb", { vt = `dish-${r.id}`, eager = false } = {}) {
  // PHOTO_CREDITS lists exactly the dishes that have a photo, so a dish
  // without one renders the emoji directly instead of firing a request
  // that 404s. The onerror path still covers a file going missing.
  const vtAttr = vt ? ` data-vt="${vt}"` : "";
  if (!hasPhoto(r)) return `<span class="${className} no-photo" data-emoji="${r.emoji}"${vtAttr}></span>`;
  return `<span class="${className}" data-emoji="${r.emoji}"${vtAttr}>
    <img src="img/${r.id}.jpg" alt="${esc(r.name)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"
         onerror="this.parentNode.classList.add('no-photo');this.remove();" />
  </span>`;
}

function photoCredit(r) {
  const c = typeof PHOTO_CREDITS !== "undefined" ? PHOTO_CREDITS[r.id] : null;
  if (!c) return "";
  return `<a class="photo-credit" href="${c.page}" target="_blank" rel="noopener">
    Photo · ${esc(c.artist)} · ${esc(c.license)} · Wikimedia Commons ↗</a>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const cuisineName = id => (CUISINES.find(c => c.id === id) || {}).name || "";

// Sonner-style toast: springs up, slides away.
function toast(msg) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span class="toast-msg"></span>`;
  el.querySelector(".toast-msg").textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, 2800);
}

// Screen depth decides whether a navigation pushes forward or pops back.
const DEPTH = { home: 0, pantry: 1, history: 1, identify: 1, prices: 1, plan: 1, cookbook: 1, planlist: 2, recipe: 2, basket: 3 };
let navDir = "forward";

function go(view, extra = {}) {
  const from = state.view;
  if (from === "home") state.homeScroll = window.scrollY;
  navDir = DEPTH[view] >= DEPTH[from] && view !== from ? "forward" : "back";
  Object.assign(state, { view }, extra);
  const top = view === "home" && navDir === "back" ? state.homeScroll : 0;
  render("nav", () => window.scrollTo({ top, behavior: "instant" }));
}

// ---------- icons ----------

// One stroke family (24px grid, 1.75 stroke) so every glyph reads as a set.
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  camera: '<path d="M14.5 4h-5L7.5 7H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  basket: '<path d="M4.5 10h15l-1.6 8.4a2 2 0 0 1-2 1.6H8.1a2 2 0 0 1-2-1.6z"/><path d="M2.5 10h19"/><path d="m8 10 3-6"/><path d="m16 10-3-6"/><path d="M10 14v2.5"/><path d="M14 14v2.5"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 6-6"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18"/><path d="M8 2.5v4"/><path d="M16 2.5v4"/><path d="M7.5 13.5h3"/><path d="M13.5 13.5h3"/><path d="M7.5 17h3"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 4 4 7.5 4c2 0 3.4 1.1 4.5 2.6C13.1 5.1 14.5 4 16.5 4 20 4 22.4 7.6 21.2 11.1 19.5 15.9 12 20.5 12 20.5z"/>',
  heartFill: '<path fill="currentColor" stroke="none" d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 4 4 7.5 4c2 0 3.4 1.1 4.5 2.6C13.1 5.1 14.5 4 16.5 4 20 4 22.4 7.6 21.2 11.1 19.5 15.9 12 20.5 12 20.5z"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6"/><path d="m8.2 13.2 7.6 4.6"/>',
  sliders: '<path d="M4 6h9"/><path d="M17 6h3"/><circle cx="15" cy="6" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 18h11"/><path d="M19 18h1"/><circle cx="17" cy="18" r="2"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flame: '<path d="M12 21c3.9 0 7-2.9 7-6.8 0-3.4-2.2-5.4-3.6-8.2-.8 1.6-1.7 2.5-2.9 2.8.2-2.5-.5-4.8-2.5-6.8-.6 4.2-5 6.3-5 12.2C5 18.1 8.1 21 12 21z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14.4A6.5 6.5 0 0 1 21.5 20"/>',
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none"/>',
  ext: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.8l2.4 11.6a1.5 1.5 0 0 0 1.5 1.2h8.9a1.5 1.5 0 0 0 1.5-1.1L21.5 8H6.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="m6 7 1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  down: '<path d="M12 3.5v12"/><path d="m7 10.5 5 5 5-5"/><path d="M5 20.5h14"/>',
  up: '<path d="M12 15.5v-12"/><path d="m7 8.5 5-5 5 5"/><path d="M5 20.5h14"/>',
  alert: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>',
  crown: '<path d="M3 8.5 7 12l5-6.5 5 6.5 4-3.5-1.8 10H4.8z"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.8-8.8"/><path d="m17 6 3 3"/><path d="m14.5 8.5 2 2"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  rupee: '<path d="M6 4h12"/><path d="M6 9h12"/><path d="M9 4c6.5 0 6.5 9.5 0 9.5H6l8.5 7"/>',
};
const ic = (name, cls = "") =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- branding ----------

// Logomark: a bowl with a fresh sprout — food that's good for you, and a
// habit that grows. Same geometry as icon.svg. The leaves are their own
// group so they can sway on hover and while a photo is being identified.
const LOGO_MARK = `
  <span class="logo-mark" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <g class="mk-leaves" fill="#FFF3E6">
        <path d="M12.4 11.6C12.4 7 15.2 3.8 20 3.2 20 8 17 11.6 12.4 11.6Z" />
        <path d="M11.6 11.6C11.2 8.6 9.2 6.6 6 6.3 6.1 9.4 8.3 11.6 11.6 11.6Z" />
      </g>
      <path fill="#fff" d="M3.5 12.8H20.5C20.5 17.4 16.9 20.6 12 20.6S3.5 17.4 3.5 12.8Z" />
      <rect fill="#fff" x="9" y="20" width="6" height="1.8" rx=".9" />
    </svg>
  </span>`;

// Viewfinder corner brackets — the camera motif on the photo scanner.
const VIEWFINDER = `<span class="vf tl"></span><span class="vf tr"></span><span class="vf bl"></span><span class="vf br"></span>`;

// ---------- "what to cook tonight" ----------

// Breakfast 5–11am, lunch until 4pm, dinner otherwise (late night included).
function mealNow(d = new Date()) {
  const h = d.getHours();
  return h >= 5 && h < 11 ? "breakfast" : h >= 11 && h < 16 ? "lunch" : "dinner";
}
const SLOT_COPY = {
  breakfast: { hello: "Good morning", title: "What's for breakfast?", meal: "breakfast" },
  lunch: { hello: "Good afternoon", title: "What to cook for lunch", meal: "lunch" },
  dinner: { hello: "Good evening", title: "What to cook tonight", meal: "dinner" },
};

// How much of a recipe is already at home. Only catalog items count —
// water or "salt to taste" can't be bought or owned, so they're ignored.
function pantryCoverage(r, owned) {
  const tracked = r.ingredients.filter(i => i.key);
  const have = tracked.filter(i => owned.has(i.key)).length;
  return { have, total: tracked.length, missing: tracked.length - have };
}

// Right meal for the time of day, fewest things to buy first, then quickest.
function tonightPicks(slot, limit = 6) {
  const owned = new Set(store.pantry.filter(e => e.qty > 0).map(e => e.key));
  return RECIPES
    .filter(r => r.meals.includes(slot))
    .map(r => ({ r, ...pantryCoverage(r, owned) }))
    .sort((a, b) => a.missing - b.missing || a.r.time - b.r.time)
    .slice(0, limit);
}

const haveLine = p => p.missing === 0
  ? "You have everything"
  : `You have ${p.have} of ${p.total} · buy ${p.missing}`;

// ---------- guided shopping ----------

// None of the three apps lets another app fill its cart, so FoodLit walks you
// through the basket instead: it opens the chosen app searching for one item
// at a time and remembers which ones you've added. Progress is kept per
// recipe + app for this browser session, so it survives a trip out to the
// app and back (or the page being reloaded while you were away).
const shopStore = {
  all() { try { return JSON.parse(sessionStorage.getItem("stc_shop") || "{}"); } catch { return {}; } },
  get(key) { return new Set(this.all()[key] || []); },
  set(key, done) {
    const all = this.all();
    all[key] = [...done];
    try { sessionStorage.setItem("stc_shop", JSON.stringify(all)); } catch {}
  },
};

// Everything the basket screen and its buttons need to agree on.
function shopContext() {
  if (state.view === "planlist") return planShopContext();
  const r = recipeById(state.recipeId);
  const items = basketFor(r);
  const cmp = compareApps(items);
  const sel = state.selectedApp && cmp.perApp[state.selectedApp] ? state.selectedApp : defaultApp(cmp);
  const app = sel ? APPS[sel] : null;
  const list = items.filter(it => it.ticked && it.mapped).map(it => ({ ...it, shopId: String(it.index) }));
  const key = `${r.id}|${sel}`;
  const n = servingsFor(r);
  const extras = items.filter(it => it.ticked && !it.mapped).map(it => `${it.label} (${it.qty})`);
  return { r, items, cmp, sel, app, list, key, done: shopStore.get(key), extras, title: `${r.name} — ${plural(n, "person", "people")}` };
}

const shopLabel = it => `${it.label}${it.packs > 1 ? ` × ${it.packs}` : ""}`;

function shoppingListText({ title, app, list, extras = [] }) {
  return [
    `${title}${app ? ` · ${app.name}` : ""}`,
    ...list.map(it => `• ${shopLabel(it)}${it.size ? ` (${it.size})` : ""}`),
    ...extras.map(x => `• ${x}`),
  ].join("\n");
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // Older browsers / no permission: the textarea + execCommand fallback.
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {}
    ta.remove(); return ok;
  }
}

// ---------- views ----------

// mode: "nav"    — screen change: view transition + entrance choreography
//       "update" — same screen, new state: shared elements morph in place
//       "plain"  — instant re-render (typing), numbers still roll
//       "reveal" — instant re-render that replays entrances (async results)
function render(mode = "update", after) {
  const views = {
    home: homeView, identify: identifyView, recipe: recipeView,
    basket: basketView, pantry: pantryView, history: historyView, prices: pricesView,
    plan: planView, planlist: planListView, cookbook: cookbookView,
  };
  const fresh = mode === "nav" || mode === "reveal" || mode === "boot";
  const paint = () => {
    $app.dataset.view = state.view;
    $app.innerHTML = views[state.view]();
    bind();
    if (after) after();
    Motion.afterPaint($app, { fresh: fresh && mode !== "boot" });
  };
  if (mode === "nav") Motion.transition(paint, ["nav", navDir]);
  else if (mode === "update") Motion.transition(paint, ["update"]);
  else paint();
}

function topbar(title, backTo) {
  if (!backTo) {
    return `
    <header class="topbar" data-vt="topbar">
      <a class="logo" href="#" data-home aria-label="FoodLit home">
        ${LOGO_MARK}
        <span class="logo-text">food<span class="lit">lit</span></span>
      </a>
      <nav class="top-actions">
        <button class="icon-btn" data-nav="plan" aria-label="Meal plan" title="Meal plan">${ic("calendar")}</button>
        <button class="icon-btn" data-nav="cookbook" aria-label="My cookbook" title="My cookbook">${ic("heart")}</button>
        <button class="icon-btn" data-nav="pantry" aria-label="My pantry" title="My pantry">${ic("basket")}</button>
        <button class="icon-btn" data-settings aria-label="Settings" title="Settings">${ic("sliders")}</button>
      </nav>
    </header>`;
  }
  return `
    <header class="topbar" data-vt="topbar">
      <button class="icon-btn back" data-back="${backTo}" aria-label="Back">${ic("chevL")}</button>
      <h1 class="topbar-title">${esc(title)}</h1>
      <span class="icon-btn spacer" aria-hidden="true"></span>
    </header>`;
}

function cuisineThumb(id) {
  // "All" gets its own dish so it never repeats a cuisine's photo.
  const r = id === "all" ? recipeById("rajma-burrito-bowl") : RECIPES.find(x => x.cuisine === id && hasPhoto(x));
  if (r) return `<img src="img/${r.id}.jpg" alt="" loading="lazy" decoding="async" />`;
  // A cuisine with no photographed dish yet shows its emoji instead.
  const c = CUISINES.find(x => x.id === id);
  return c ? `<span class="thumb-emoji">${c.emoji}</span>` : "";
}

function homeView() {
  const { count, saved } = totalStats();
  const slot = mealNow();
  const copy = SLOT_COPY[slot];
  const picks = tonightPicks(slot);
  const list = findRecipes(state.query)
    .filter(r => state.cuisine === "all" || r.cuisine === state.cuisine)
    .filter(r => state.meal === "all" || r.meals.includes(state.meal))
    .filter(r => !state.timeFilter || r.time <= state.timeFilter);
  // Cuisine counts respect the meal filter (and vice versa) so the numbers
  // on the chips match what tapping them would actually show.
  const countFor = id => RECIPES.filter(r =>
    (id === "all" || r.cuisine === id) &&
    (state.meal === "all" || r.meals.includes(state.meal))).length;
  const searching = !!state.query.trim();
  return `
    ${topbar()}
    <main class="page">
      ${todayPlanCard()}
      <section class="tonight" aria-labelledby="tonight-title">
        <p class="hello" data-enter>${copy.hello}</p>
        <h2 class="tonight-title" id="tonight-title" data-enter>${copy.title}</h2>
        <div class="tonight-row" data-enter>
          <p class="tonight-sub">Picked for ${copy.meal}, starting with what's already in your pantry.</p>
          <div class="row-nav" aria-hidden="true">
            <button class="row-btn" data-row-prev="picks" tabindex="-1">${ic("chevL")}</button>
            <button class="row-btn" data-row-next="picks" tabindex="-1">${ic("chevR")}</button>
          </div>
        </div>
        <div class="picks" id="picks" data-scroller data-enter>
          ${picks.map((p, i) => `
            <button class="pick ${i === 0 ? "pick--top" : ""}" data-recipe="${p.r.id}" data-vt="card-${p.r.id}">
              ${dishPhoto(p.r, "pick-photo", { eager: i < 2 })}
              ${i === 0 ? `<span class="pick-badge">Best match</span>` : ""}
              <span class="pick-body">
                <span class="pick-name">${esc(p.r.name)}</span>
                <span class="pick-meta">${ic("clock")}${p.r.time} min<span class="dot">·</span><span class="save">${fmt(savingOf(p.r))} saved</span></span>
                <span class="have ${p.missing === 0 ? "have--all" : ""}">
                  <span class="have-bar"><span style="--v:${p.total ? (p.have / p.total).toFixed(3) : 0}"></span></span>
                  <span class="have-txt">${haveLine(p)}</span>
                </span>
              </span>
            </button>`).join("")}
          <button class="pick pick--more" data-browse>
            <span class="more-ic">${ic("chevR")}</span>
            <span class="pick-name">See all ${RECIPES.length} dishes</span>
          </button>
        </div>
      </section>

      <div class="quick" data-enter>
        <label class="search">
          ${ic("search")}
          <input id="search" type="search" placeholder="Search a dish" value="${esc(state.query)}" autocomplete="off" />
        </label>
        <button class="snap-btn" data-snap aria-label="Snap or upload a dish photo">${ic("camera")}<span>Snap</span></button>
      </div>

      <button class="savings-card" data-nav="history" data-enter>
        <span class="savings-ic">${ic("rupee")}</span>
        <span class="savings-txt">
          <span class="savings-num">₹<span data-roll="saved">${num(saved)}</span> saved</span>
          <span class="savings-sub">${count ? `${plural(count, "meal")} cooked instead of ordered` : "Cook your first meal to start saving"}</span>
        </span>
        <span class="savings-go" aria-hidden="true">${ic("chevR")}</span>
      </button>

      <div class="sec-head" id="browse">
        <h3 class="sec-title">${searching ? `Results for “${esc(state.query.trim())}”` : "Browse all dishes"}</h3>
        <span class="sec-aux"><span data-roll="list-count">${list.length}</span> ${list.length === 1 ? "dish" : "dishes"}</span>
      </div>
      <div class="cuisines" role="group" aria-label="Cuisine" data-scroller>
        ${[{ id: "all", name: "All" }, ...CUISINES].map(c => {
          const on = state.cuisine === c.id;
          return `
          <button class="cuisine ${on ? "active" : ""}" data-cuisine="${c.id}" aria-pressed="${on}">
            ${on ? `<span class="chip-pill" data-vt="pill-cuisine"></span>` : ""}
            <span class="cuisine-thumb" aria-hidden="true">${cuisineThumb(c.id)}</span>
            <span class="cuisine-name">${c.name}</span>
            <span class="cuisine-count">${countFor(c.id)}</span>
          </button>`;
        }).join("")}
      </div>
      <div class="filters">
        <div class="seg" role="group" aria-label="Meal">
          ${[{ id: "all", name: "Any meal" }, ...MEALS].map(m => {
            const on = state.meal === m.id;
            return `
            <button class="seg-btn ${on ? "active" : ""}" data-meal="${m.id}" aria-pressed="${on}">
              ${on ? `<span class="seg-pill" data-vt="pill-meal"></span>` : ""}
              <span class="seg-label">${m.name}</span>
            </button>`;
          }).join("")}
        </div>
        <div class="seg" role="group" aria-label="Cooking time">
          ${[[0, "Any time"], [20, "20 min"], [30, "30 min"], [45, "45 min"]].map(([v, l]) => {
            const on = state.timeFilter === v;
            return `
            <button class="seg-btn ${on ? "active" : ""}" data-time="${v}" aria-pressed="${on}">
              ${on ? `<span class="seg-pill" data-vt="pill-time"></span>` : ""}
              <span class="seg-label">${v ? `≤ ${l}` : l}</span>
            </button>`;
          }).join("")}
        </div>
      </div>

      <div class="grid">
        ${list.map(r => `
          <button class="dish" data-recipe="${r.id}" data-vt="card-${r.id}">
            <span class="dish-media">
              ${dishPhoto(r, "dish-photo")}
              <span class="dish-time">${ic("clock")}${r.time}m</span>
            </span>
            <span class="dish-body">
              <span class="dish-name">${esc(r.name)}</span>
              <span class="dish-meta">${esc(cuisineName(r.cuisine))} · ${r.kcalPerServe} kcal</span>
            </span>
          </button>`).join("")}
      </div>
      ${list.length ? "" : `
        <div class="empty">
          <span class="empty-ic">${ic("search")}</span>
          <p>Nothing matches${state.query ? ` “${esc(state.query)}”` : ""} with these filters.</p>
          <p class="muted">Try another cuisine or meal, or clear the time limit.</p>
        </div>`}
    </main>`;
}

function identifyView() {
  const id = state.identify || {};
  const loading = id.status === "loading";
  let body = "";
  if (loading) {
    body = `
      <div class="scan-status" role="status">
        <span class="ap-spin" aria-hidden="true">${LOGO_MARK}</span>
        <span class="cycle"><span>Reading the plate…</span><span>Spotting ingredients…</span><span>Matching recipes…</span></span>
      </div>`;
  } else if (id.guesses && id.guesses.length) {
    body = `
      <p class="eyebrow center" data-enter>Best guesses — tap the right one</p>
      <div class="guesses">
        ${id.guesses.map((g, i) => {
          const r = matchGuessToRecipe(g);
          return r
            ? `<button class="guess" data-recipe="${r.id}" data-enter>
                 <span class="guess-rank">0${i + 1}</span>
                 ${dishPhoto(r, "guess-thumb")}
                 <span class="guess-info"><span class="guess-name">${esc(r.name)}</span><span class="guess-sub">${r.time} min · recipe ready</span></span>
                 <span class="guess-go">Cook ${ic("chevR")}</span>
               </button>`
            : `<div class="guess guess--miss" data-enter>
                 <span class="guess-rank">0${i + 1}</span>
                 <span class="guess-thumb no-photo" data-emoji="🍽️"></span>
                 <span class="guess-info"><span class="guess-name">${esc(g)}</span><span class="guess-sub">Not in the curated set yet</span></span>
               </div>`;
        }).join("")}
      </div>`;
  } else if (id.status === "error") {
    body = `<div class="note warn" data-enter>${ic("alert")}<span>${esc(id.error)}</span></div>`;
  }
  // Search fallback is ALWAYS present — never a dead end (P0-1)
  return `
    ${topbar("Identify dish", "home")}
    <main class="page">
      <div class="scan ${loading ? "is-scanning" : ""}" data-enter>
        ${id.imgUrl ? `<img src="${id.imgUrl}" alt="Your photo" />` : ""}
        ${VIEWFINDER}
        ${loading ? `<span class="scan-grid" aria-hidden="true"></span><span class="scan-line" aria-hidden="true"></span>` : ""}
      </div>
      ${body}
      <label class="search" style="margin-top:22px" data-enter>
        ${ic("search")}
        <input id="fallback-search" type="search" placeholder="Not right? Search the dish name…" autocomplete="off" />
      </label>
      <div class="guesses" id="fallback-results"></div>
    </main>`;
}

function recipeView() {
  const r = recipeById(state.recipeId);
  const n = servingsFor(r);
  const f = factorFor(r);
  const cook = cookCostOf(r, f);
  const order = orderPriceOf(r, f);
  const saving = Math.max(0, order - cook);
  const mine = myOrderPrice(r);
  const ob = orderBreakdown(r, f);
  const totalKcal = Math.round(r.kcalPerServe * n);
  const meals = r.meals.map(m => (MEALS.find(x => x.id === m) || { name: m }).name).join(" · ");
  const people = n === 1 ? "person" : "people";
  const cover = pantryCoverage(r, new Set(store.pantry.filter(e => e.qty > 0).map(e => e.key)));
  return `
    ${topbar(r.name, "home")}
    <main class="page r-page">
      <header class="r-hero">
        ${dishPhoto(r, "r-photo", { eager: true })}
        <div class="r-head">
          <p class="eyebrow">${esc(cuisineName(r.cuisine))} · ${esc(meals)}</p>
          <h2 class="r-title" data-split>${esc(r.name)}</h2>
          <div class="r-chips">
            <span class="chip">${ic("clock")}${r.time} min</span>
            <span class="chip">${ic("flame")}${r.kcalPerServe} kcal / serve</span>
            <span class="chip ${cover.missing === 0 ? "chip--good" : ""}">${ic("basket")}${haveLine(cover)}</span>
          </div>
          <div class="r-actions">
            <button class="btn ${cookbook.isFav(r.id) ? "btn-fav-on" : "btn-outline"}" data-fav="${r.id}" aria-pressed="${cookbook.isFav(r.id)}">${ic(cookbook.isFav(r.id) ? "heartFill" : "heart")}${cookbook.isFav(r.id) ? "Saved" : "Save"}</button>
            <button class="btn btn-outline" data-add-plan="${r.id}">${ic("calendar")}Add to plan</button>
          </div>
        </div>
      </header>
      ${photoCredit(r)}
      <div class="r-grid">
        <div class="r-col">
          <section class="panel serves" data-enter>
            <div class="serves-top">
              <div>
                <p class="eyebrow">Cooking for</p>
                <div class="serves-big"><span data-roll="serves">${n}</span><span class="unit">${people}</span></div>
              </div>
              <div class="stepper">
                <button data-serve="-1" ${n <= 1 ? "disabled" : ""} aria-label="Fewer people">${ic("minus")}</button>
                <button data-serve="1" ${n >= 8 ? "disabled" : ""} aria-label="More people">${ic("plus")}</button>
              </div>
            </div>
            <div class="kcal-line">${ic("flame")}<span>Whole dish <b><span data-roll="kcal">${totalKcal}</span> kcal</b></span><span class="muted">· ${r.kcalPerServe} per serving</span></div>
          </section>

          <section class="panel versus" data-enter>
            <div class="vs-head">
              <p class="eyebrow">Cook vs order</p>
              <div class="vs-keep"><span class="vs-keep-lbl">You keep</span><span class="vs-keep-amt">₹<span data-roll="keep">${saving}</span></span></div>
            </div>
            <div class="bar-row">
              <span class="bar-lbl">Cook it</span>
              <span class="bar"><span class="bar-fill cook" data-tween="bar-cook" style="--v:${(cook / Math.max(cook, order, 1)).toFixed(3)}"></span></span>
              <span class="bar-amt">~₹<span data-roll="cook">${cook}</span></span>
            </div>
            <div class="bar-row">
              <span class="bar-lbl">Order it</span>
              <span class="bar"><span class="bar-fill order" data-tween="bar-order" style="--v:${(order / Math.max(cook, order, 1)).toFixed(3)}"></span></span>
              <span class="bar-amt">₹<span data-roll="order">${order}</span></span>
            </div>
            <div class="order-detail">
              <span>${mine != null
                ? `Order price is <b>your usual price</b> for this dish.`
                : `Typical menu ${fmt(ob.food)} + ~${fmt(ob.extras)} tax and fees (platform, delivery, packaging).`}</span>
              ${state.orderEditing === r.id ? "" : `<button class="link-inline" data-order-edit>${mine != null ? "Change" : "Set my usual price"}</button>`}
            </div>
            ${state.orderEditing === r.id ? `
            <div class="order-edit">
              <p class="fine left">What do you usually pay for ${esc(r.name)} for ${plural(r.serves, "person", "people")}, including fees?</p>
              <div class="order-edit-row">
                <label class="p-input">₹<input id="order-input" type="number" inputmode="numeric" min="1" max="9999" value="${mine ?? orderBreakdown(r).total}" aria-label="Your usual price" /></label>
                <button class="btn btn-primary" data-order-save>Save</button>
                <button class="btn btn-ghost" data-order-cancel>Cancel</button>
              </div>
              ${mine != null ? `<button class="link-inline" data-order-reset>Go back to the typical price</button>` : ""}
            </div>` : ""}
            <p class="fine">For ${n} ${people}. Cook cost is worked out from current grocery prices for the amounts this dish uses; leftover packs carry into your next meals.</p>
          </section>

          <a class="video" href="${r.video}" target="_blank" rel="noopener" data-enter>
            <span class="video-play">${ic("play")}</span>
            <span class="video-copy"><span class="video-t">Watch it cooked</span><span class="video-s">Step-by-step video</span></span>
            ${ic("ext", "video-ext")}
          </a>
        </div>

        <div class="r-col">
          <section class="panel" data-enter>
            <div class="panel-head"><h3>Ingredients</h3><span class="sec-aux">${r.ingredients.length} items · for ${n}</span></div>
            <ul class="ings">
              ${r.ingredients.map(ing => {
                const sku = ing.key ? CATALOG[ing.key] : null;
                const inPantry = ing.key && store.hasPantry(ing.key);
                return `<li>
                  <span class="ing-name">${esc(sku ? sku.product.replace(/ \(.*\)/, "") : ing.name)}${inPantry ? ` <span class="mini-badge">In pantry</span>` : ""}</span>
                  <span class="ing-dots" aria-hidden="true"></span>
                  <span class="ing-qty">${esc(scaleQty(ing.qty, f))}</span>
                </li>`;
              }).join("")}
            </ul>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>Method</h3><span class="sec-aux">${r.steps.length} steps</span></div>
            <ol class="steps">${r.steps.map((s, i) => `<li><span class="step-n">${i + 1}</span><p>${esc(s)}</p></li>`).join("")}</ol>
          </section>

          <section class="panel notes">
            <div class="panel-head"><h3>My notes</h3><span class="sec-aux">only you see these</span></div>
            <textarea class="note-input" id="note-input" data-recipe="${r.id}" rows="3" placeholder="e.g. Less chilli, double the garlic, Mum's tip…">${esc(cookbook.note(r.id))}</textarea>
          </section>
        </div>
      </div>
    </main>
    <div class="cta-bar" data-vt="cta">
      <button class="cta" data-basket data-enter>${ic("cart")}<span>Build basket &amp; compare prices</span></button>
    </div>`;
}

function shopPanel(ctx = shopContext()) {
  const { app, list, key, done } = ctx;
  if (!app) return "";
  const total = list.length;
  const doneN = list.filter(it => done.has(it.shopId)).length;
  const next = list.find(it => !done.has(it.shopId));
  const open = it => `href="${app.searchUrl(it.label)}" target="_blank" rel="noopener" data-shop-open="${it.shopId}"`;
  return `
      <section class="panel shop" data-enter style="--c:${app.color}">
        <div class="panel-head">
          <h3>Shop on ${app.name}</h3>
          <span class="sec-aux"><span data-roll="shop-done">${doneN}</span> of ${total} added</span>
        </div>
        <div class="shop-bar" aria-hidden="true"><span data-tween="shop-${key}" style="--v:${total ? (doneN / total).toFixed(3) : 0}"></span></div>
        ${next ? `
        <a class="shop-next" ${open(next)}>
          <span class="shop-next-ic">${ic("cart")}</span>
          <span class="shop-next-txt">
            <span class="shop-next-lbl">${doneN ? "Next item" : "Start with"}</span>
            <span class="shop-next-name">${esc(shopLabel(next))}</span>
          </span>
          <span class="shop-next-go">Open ${ic("ext")}</span>
        </a>
        <p class="fine left">Opens ${app.name} searching for this item. Tap <b>Add</b> there, then come back for the next one.</p>`
        : `
        <div class="shop-finished">${ic("check")}<span>All ${total} items added. Open your cart in ${app.name} to check out.</span></div>`}
        <ul class="shop-list">
          ${list.map(it => {
            const d = done.has(it.shopId);
            return `
            <li class="shop-item ${d ? "done" : ""}">
              <button class="shop-check" data-shop-toggle="${it.shopId}" aria-pressed="${d}" aria-label="${d ? "Mark as not added" : "Mark as added"}: ${esc(it.label)}">${ic("check")}</button>
              <span class="shop-name">${esc(it.label)}<span class="muted">${it.size ? ` · ${it.size}` : ""}${it.packs > 1 ? ` × ${it.packs}` : ""}</span></span>
              <a class="shop-open" ${open(it)} aria-label="Open ${esc(it.label)} in ${app.name}">${d ? "Again" : "Open"} ${ic("ext")}</a>
            </li>`;
          }).join("")}
        </ul>
        <div class="btn-row">
          <button class="btn btn-outline grow" data-shop-copy>${ic("copy")}Copy shopping list</button>
          ${doneN ? `<button class="btn btn-ghost" data-shop-reset>Start over</button>` : ""}
        </div>
        <p class="fine left">${app.name} doesn't let other apps fill its cart yet, so FoodLit opens each item for you.</p>
      </section>`;
}

function pricesView() {
  const filter = state.priceFilter || "top";
  const allKeys = Object.keys(CATALOG).sort((a, b) => (USAGE[b] || 0) - (USAGE[a] || 0) || a.localeCompare(b));
  const estKeys = allKeys.filter(isEstimate);
  const keys = filter === "top" ? TOP_KEYS : filter === "est" ? estKeys : allKeys;
  const freshTop = TOP_KEYS.filter(k => CATALOG[k].checked && daysAgo(CATALOG[k].checked) <= STALE_DAYS).length;
  const status = k => {
    const c = CATALOG[k].checked;
    if (!c) return `<span class="p-status est">Estimate — not checked</span>`;
    const d = daysAgo(c);
    if (d <= 0) return `<span class="p-status ok">${ic("check")}Checked today</span>`;
    return d <= STALE_DAYS
      ? `<span class="p-status ok">${ic("check")}Checked ${fmtDay(c, false)}</span>`
      : `<span class="p-status old">Checked ${fmtDay(c, false)} · ${d} days ago</span>`;
  };
  return `
    ${topbar("Update prices", state.pricesBack || "home")}
    <main class="page">
      <section class="page-hero" data-enter>
        <p class="eyebrow">Keep prices honest</p>
        <h2 class="page-title">Update prices</h2>
        <p class="muted">FoodLit can't read live prices from these apps. Every few weeks, open each item, type the price you see, and tap Save. The top 20 takes about 15 minutes.</p>
      </section>

      <section class="panel p-summary" data-enter>
        <div class="p-summary-top">
          <span class="p-summary-num"><span data-roll="fresh-top">${freshTop}</span><span class="of"> / ${TOP_KEYS.length}</span></span>
          <span class="p-summary-lbl">most-used items checked in the last ${STALE_DAYS} days</span>
        </div>
        <div class="shop-bar" aria-hidden="true"><span data-tween="fresh-top" style="--v:${(freshTop / TOP_KEYS.length).toFixed(3)}"></span></div>
      </section>

      <div class="seg p-filter" role="group" aria-label="Which items">
        ${[["top", `Most used`, TOP_KEYS.length], ["est", "Estimates", estKeys.length], ["all", "All", allKeys.length]].map(([id, name, n]) => `
          <button class="seg-btn ${filter === id ? "active" : ""}" data-price-filter="${id}" aria-pressed="${filter === id}">
            ${filter === id ? `<span class="seg-pill" data-vt="pill-price"></span>` : ""}
            <span class="seg-label">${name}</span><span class="seg-count">${n}</span>
          </button>`).join("")}
      </div>

      ${keys.length ? keys.map(k => {
        const sku = CATALOG[k];
        return `
        <article class="panel p-card" data-price-card="${k}">
          <div class="p-card-head">
            <div class="p-card-name">
              <span class="p-name">${esc(sku.product)}</span>
              <span class="p-size">${sku.size} · used in ${plural(USAGE[k] || 0, "dish", "dishes")}</span>
            </div>
            ${status(k)}
          </div>
          <div class="p-grid">
            ${Object.entries(APPS).map(([a, app]) => `
              <label class="p-cell" style="--c:${app.color}">
                <span class="p-app"><span class="app-dot" aria-hidden="true"></span>${app.name}</span>
                <span class="p-input">₹<input type="number" inputmode="numeric" min="1" max="9999" step="1" data-price-app="${a}" value="${sku.prices[a] ?? ""}" placeholder="—" aria-label="${esc(sku.product)} price on ${app.name}" /></span>
                <a class="p-open" href="${app.searchUrl(sku.product)}" target="_blank" rel="noopener">Open ${ic("ext")}</a>
              </label>`).join("")}
          </div>
          <div class="p-card-foot">
            <span class="fine left">Leave a box empty if that app doesn't sell it.</span>
            <button class="btn btn-primary p-save" data-price-save="${k}">${ic("check")}Save</button>
          </div>
        </article>`;
      }).join("") : `
        <div class="empty">
          <span class="empty-ic">${ic("check")}</span>
          <p>No estimates left.</p>
          <p class="muted">Every price has been checked at least once.</p>
        </div>`}
    </main>`;
}

function basketView() {
  const r = recipeById(state.recipeId);
  const n = servingsFor(r);
  const f = factorFor(r);
  const items = basketFor(r);
  const cmp = compareApps(items);
  const unmappedCount = items.filter(it => !it.mapped && it.ticked).length;
  const sel = state.selectedApp && cmp.perApp[state.selectedApp] ? state.selectedApp : defaultApp(cmp);
  const selApp = sel ? APPS[sel] : null;
  const saving = savingOf(r, f);
  const maxTotal = Math.max(1, ...Object.values(cmp.perApp).map(d => d.total));

  return `
    ${topbar("Your basket", "recipe")}
    <main class="page">
      <section class="b-head" data-enter>
        ${dishPhoto(r, "b-thumb")}
        <div>
          <p class="eyebrow">Basket for</p>
          <h2 class="b-title">${esc(r.name)}</h2>
          <p class="muted">${n} ${n === 1 ? "person" : "people"} · <span data-roll="b-items">${cmp.itemCount}</span> items selected</p>
        </div>
      </section>

      <div class="b-grid">
      <section class="panel" data-enter>
        <div class="panel-head"><h3>Ingredients</h3><span class="sec-aux">Untick what you have</span></div>
        ${items.map((it, i) => `
          <label class="b-row ${it.ticked ? "" : "off"}" data-tween="tick-${r.id}-${it.index}" style="--v:${it.ticked ? 1 : 0};--d:${i * 40}ms">
            <input type="checkbox" class="cbx-input" data-tick="${it.index}" ${it.ticked ? "checked" : ""} />
            <span class="cbx" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <span class="b-info">
              <span class="b-product">${esc(it.label)}${it.size ? `<span class="muted"> · ${it.size}</span>` : ""}${it.packs > 1 ? ` <b class="packs">× ${it.packs}</b>` : ""}</span>
              <span class="b-sub">needs ${esc(it.qty)}${it.inPantry ? ` · in pantry × ${it.pantryQty}` : ""}</span>
              ${!it.mapped ? `<span class="badge warn">${ic("alert")} No product match — add it in the app</span>` : ""}
              ${it.mapped && Object.values(it.prices).some(p => p == null)
                ? `<span class="badge danger">Out of stock on ${Object.keys(it.prices).filter(k => it.prices[k] == null).map(k => APPS[k].name).join(", ")}</span>` : ""}
            </span>
            <span class="b-price">${it.mapped ? `<span class="muted">from</span> ${fmt(Math.min(...Object.values(it.prices).filter(p => p != null)) * it.packs)}${it.estimate ? `<span class="est-tag">estimate</span>` : ""}` : "—"}</span>
          </label>`).join("")}
      </section>

      <div>
      <section class="panel" data-enter>
        <div class="panel-head"><h3>Price across apps</h3><span class="sec-aux">${plural(cmp.itemCount, "item")}</span></div>
        <div class="apps">
          ${Object.entries(APPS).map(([appId, app]) => {
            const d = cmp.perApp[appId];
            const isCheapest = appId === cmp.cheapest;
            const isSel = appId === sel;
            return `
              <button class="app ${isCheapest ? "cheapest" : ""} ${isSel ? "selected" : ""}" data-app="${appId}" style="--c:${app.color}" aria-pressed="${isSel}">
                ${isCheapest ? `<span class="beam" aria-hidden="true"></span>` : ""}
                <span class="app-top">
                  <span class="app-dot" aria-hidden="true"></span>
                  <span class="app-name">${app.name}</span>
                  ${isCheapest ? `<span class="crown">${ic("crown")}Cheapest</span>` : ""}
                  <span class="app-total">₹<span data-roll="app-${appId}">${Math.round(d.total)}</span>${d.complete ? "" : "*"}</span>
                </span>
                <span class="app-bar"><span class="app-fill" data-tween="app-${appId}" style="--v:${(d.total / maxTotal).toFixed(3)}"></span></span>
                <span class="app-note ${d.complete ? "" : "warn"}">
                  ${!d.complete ? `Missing: ${d.missing.map(esc).join(", ")}`
                    : isSel ? "Selected — shop below"
                    : cmp.cheapest && !isCheapest ? `+${fmt(d.total - cmp.perApp[cmp.cheapest].total)} vs ${APPS[cmp.cheapest].name}`
                    : "All items available"}
                </span>
              </button>`;
          }).join("")}
        </div>
        <p class="fine center price-note">${priceNote(items.filter(it => it.ticked && it.mapped).map(it => it.key))} *Excludes items an app doesn't sell.</p>
        <button class="link-btn" data-prices="${items.some(it => it.ticked && it.estimate) ? "est" : "top"}">${ic("sliders")}Update prices</button>
      </section>

      ${unmappedCount ? `<div class="note warn" data-enter>${ic("alert")}<span>${plural(unmappedCount, "item")} couldn't be auto-matched — add ${unmappedCount > 1 ? "them" : "it"} yourself in the app.</span></div>` : ""}

      ${selApp ? `
      ${shopPanel()}
      <section class="savings" data-enter>
        <span class="savings-ic">${ic("spark")}</span>
        <div>
          <div class="savings-amt">₹<span data-roll="b-save">${saving}</span> <span>stays in your pocket</span></div>
          <div class="fine left">~${fmt(cookCostOf(r, f))} of ingredients used vs ${fmt(orderPriceOf(r, f))} to order in, for ${n} ${n === 1 ? "person" : "people"}</div>
        </div>
      </section>` : ""}
      </div>
      </div>
    </main>
    <div class="cta-bar" data-vt="cta">
      <button class="cta cta--leaf" data-cooked data-enter>${ic("check")}<span>I cooked this — log it</span><span class="cta-pill">+${fmt(saving)}</span></button>
    </div>`;
}

function pantryView() {
  const pantry = store.pantry.filter(e => CATALOG[e.key] && e.qty > 0);
  const q = state.pantrySearch.trim().toLowerCase();
  const matches = q
    ? Object.entries(CATALOG).filter(([key, sku]) =>
        sku.product.toLowerCase().includes(q) || key.replace(/-/g, " ").includes(q)).slice(0, 6)
    : [];
  const staged = state.pantryAdd;
  const stagedSku = staged ? CATALOG[staged.key] : null;
  return `
    ${topbar("My pantry", "home")}
    <main class="page">
      <section class="page-hero" data-enter>
        <p class="eyebrow">Your kitchen</p>
        <h2 class="page-title"><span data-roll="p-count">${pantry.length}</span> ${pantry.length === 1 ? "item" : "items"} on the shelf</h2>
        <p class="muted">Pantry items start unticked in every basket, so you never over-order what you already have.</p>
      </section>

      <label class="search" data-enter>
        ${ic("search")}
        <input id="pantry-search" type="search" placeholder="Add an item — paneer, dal, butter…" value="${esc(state.pantrySearch)}" autocomplete="off" />
      </label>

      ${staged ? `
      <section class="panel stage" data-enter>
        <div class="panel-head"><h3>Add to pantry</h3><span class="sec-aux">${stagedSku.size} / pack</span></div>
        <div class="stage-row">
          <span class="stage-name">${esc(stagedSku.product)}</span>
          <div class="stepper small">
            <button data-stage-qty="-1" ${staged.qty <= 1 ? "disabled" : ""} aria-label="One fewer">${ic("minus")}</button>
            <span class="stepper-val" data-roll="stage-qty">${staged.qty}</span>
            <button data-stage-qty="1" ${staged.qty >= 10 ? "disabled" : ""} aria-label="One more">${ic("plus")}</button>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost" data-stage-cancel>Cancel</button>
          <button class="btn btn-primary grow" data-stage-add>${ic("plus")}Add ${staged.qty} × ${stagedSku.size}</button>
        </div>
      </section>` : ""}

      ${!staged && matches.length ? `
      <div class="guesses">
        ${matches.map(([key, sku]) => {
          const owned = store.pantryQty(key);
          return `
          <button class="guess" data-pick="${key}" data-enter>
            <span class="guess-thumb icon-thumb">${ic("basket")}</span>
            <span class="guess-info"><span class="guess-name">${esc(sku.product)}</span>
            <span class="guess-sub">${sku.size} / pack${owned ? ` · in pantry × ${owned}` : ""}</span></span>
            <span class="guess-go">${owned ? "Update" : "Add"} ${ic("chevR")}</span>
          </button>`;
        }).join("")}
      </div>` : ""}

      ${!staged && q && !matches.length ? `
      <div class="note warn">${ic("alert")}<span>No product matches “${esc(state.pantrySearch)}” in the catalog — only catalog items can be added, since they're what the price comparison knows about.</span></div>` : ""}

      <section class="panel" data-enter>
        <div class="panel-head"><h3>On the shelf</h3><span class="sec-aux">${plural(pantry.length, "item")}</span></div>
        ${pantry.length ? pantry.map(e => {
          const sku = CATALOG[e.key];
          return `
          <div class="p-row">
            <span class="p-info">
              <span class="p-name">${esc(sku.product)}</span>
              <span class="p-size">${e.qty} × ${sku.size}</span>
            </span>
            <div class="stepper small">
              <button data-pqty="${e.key}" data-d="-1" aria-label="One fewer">${ic("minus")}</button>
              <span class="stepper-val" data-roll="pq-${e.key}">${e.qty}</span>
              <button data-pqty="${e.key}" data-d="1" ${e.qty >= 10 ? "disabled" : ""} aria-label="One more">${ic("plus")}</button>
            </div>
            <button class="icon-btn danger" data-premove="${e.key}" aria-label="Remove from pantry" title="Remove">${ic("trash")}</button>
          </div>`;
        }).join("")
        : `<div class="empty"><span class="empty-ic">${ic("basket")}</span><p>Your pantry is empty.</p><p class="muted">Search above and add what you have at home.</p></div>`}
      </section>
    </main>`;
}

function historyView() {
  const meals = store.meals;
  const { count, saved } = totalStats();
  const recent = meals.slice(0, 14).reverse();
  const maxSaved = Math.max(1, ...recent.map(m => m.saved || 0));
  return `
    ${topbar("Cooking history", "home")}
    <main class="page">
      <section class="stat-hero" data-enter>
        <div class="sh-cell">
          <span class="sh-num" data-roll="h-count">${count}</span>
          <span class="sh-lbl">${count === 1 ? "meal" : "meals"} cooked</span>
        </div>
        <div class="sh-cell">
          <span class="sh-num leaf">₹<span data-roll="h-saved">${num(saved)}</span></span>
          <span class="sh-lbl">not spent on delivery</span>
        </div>
      </section>

      ${recent.length ? `
      <section class="panel" data-enter>
        <div class="panel-head"><h3>Savings per meal</h3><span class="sec-aux">last ${recent.length}</span></div>
        <div class="spark" role="img" aria-label="Savings for your last ${recent.length} meals">
          ${recent.map((m, i) => `<span class="spark-bar" data-tween="hb-${i}" style="--v:${((m.saved || 0) / maxSaved).toFixed(3)};--d:${i * 45}ms" title="${esc(m.name)} · ${fmt(m.saved)}"></span>`).join("")}
        </div>
      </section>` : ""}

      <section class="panel" data-enter>
        <div class="panel-head"><h3>Log</h3><span class="sec-aux">${plural(count, "entry", "entries")}</span></div>
        ${meals.length ? meals.map(m => `
          <div class="h-row">
            <span class="h-emoji" aria-hidden="true">${esc(m.emoji || "🍽️")}</span>
            <span class="h-info"><span class="h-name">${esc(m.name)}${m.serves ? `<span class="muted"> · ${m.serves} ${m.serves === 1 ? "person" : "people"}</span>` : ""}</span><span class="h-date">${esc(m.date)}</span></span>
            <span class="h-saved">+${fmt(m.saved)}</span>
          </div>`).join("")
        : `<div class="empty"><span class="empty-ic">${ic("chart")}</span><p>Nothing cooked yet.</p><p class="muted">The delivery apps are winning — go snap a dish.</p></div>`}
      </section>
      ${meals.length ? `
      <div class="btn-row" data-enter>
        <button class="btn btn-outline grow" data-export>${ic("down")}Export backup</button>
        <button class="btn btn-outline grow" data-import>${ic("up")}Import</button>
      </div>` : ""}
      <p class="fine center">Every meal here is one you cooked instead of ordering.<br/>
      This log lives only on this device — export it to keep it safe.</p>
    </main>`;
}

// ---------- shopping list sheet ----------

// Fallback when the browser won't let us copy: show the list, pre-selected,
// with a Share button where the phone supports it (WhatsApp, Notes, …).
function showListSheet(text, title = "Your shopping list") {
  const wrap = sheetShell(`
      <h3 class="sheet-title">${ic("copy")}${title}</h3>
      <p class="sheet-copy">Copying was blocked here, so select the text below${navigator.share ? " or share it" : ""}.</p>
      <textarea class="list-text" readonly rows="${Math.min(12, text.split("\n").length + 1)}"></textarea>
      <div class="btn-row">
        <button class="btn btn-ghost grow" data-close>Close</button>
        ${navigator.share ? `<button class="btn btn-primary grow" data-share>Share list</button>` : ""}
      </div>`);
  const ta = wrap.querySelector(".list-text");
  ta.value = text;
  const close = Motion.sheet(wrap);
  ta.focus(); ta.select();
  wrap.querySelector("[data-close]").onclick = close;
  const share = wrap.querySelector("[data-share]");
  if (share) share.onclick = async () => {
    try { await navigator.share({ title: "Shopping list", text }); close(); } catch {}
  };
}

// ---------- settings sheet ----------

function sheetShell(inner) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="sheet-handle" aria-hidden="true"><span></span></div>${inner}</div>`;
  return wrap;
}

function openSettings() {
  const { count, saved } = totalStats();
  const pantryCount = store.pantry.filter(e => CATALOG[e.key] && e.qty > 0).length;
  const wrap = sheetShell(`
      <h3 class="sheet-title">${ic("sliders")}Settings</h3>
      <p class="sheet-copy">To recognise dishes from photos, FoodLit needs an Anthropic key (a private code for the AI). It stays on this device only. Search works without it.</p>
      <label class="field">${ic("key")}<input id="key-input" type="password" placeholder="sk-ant-…" value="${esc(store.apiKey)}" autocomplete="off" /></label>
      <div class="btn-row">
        <button class="btn btn-ghost grow cancel">Cancel</button>
        <button class="btn btn-primary grow save">Save key</button>
      </div>

      <div class="sheet-sep"></div>
      <div class="btn-row"><button class="btn btn-outline grow" data-open-history>${ic("chart")}Cooking history</button></div>

      <div class="sheet-sep"></div>
      <h3 class="sheet-title small">Prices</h3>
      <p class="sheet-copy">Prices aren't live. Check your most-used items every few weeks to keep comparisons honest.</p>
      <div class="btn-row"><button class="btn btn-outline grow" data-open-prices>${ic("sliders")}Update prices</button></div>

      <div class="sheet-sep"></div>
      <h3 class="sheet-title small">Backup your data</h3>
      <p class="sheet-copy">
        <b>${plural(count, "meal")} logged · ${fmt(saved)} saved · ${plural(pantryCount, "pantry item")}.</b><br/>
        This lives only in this browser — clearing site data or switching phones loses it. Your Anthropic key is never included in a backup.
      </p>
      <div class="btn-row">
        <button class="btn btn-outline grow" data-export>${ic("down")}Export</button>
        <button class="btn btn-outline grow" data-import>${ic("up")}Import</button>
      </div>`);
  const close = Motion.sheet(wrap);
  wrap.querySelector(".cancel").onclick = close;
  wrap.querySelector("[data-export]").onclick = () => exportBackup();
  wrap.querySelector("[data-import]").onclick = () => {
    close();
    document.getElementById("import-input").click();
  };
  wrap.querySelector("[data-open-history]").onclick = () => { close(); go("history"); };
  wrap.querySelector("[data-open-prices]").onclick = () => {
    close();
    go("prices", { pricesBack: state.view === "prices" ? "home" : state.view });
  };
  wrap.querySelector(".save").onclick = () => {
    store.apiKey = wrap.querySelector("#key-input").value.trim();
    close();
    toast(store.apiKey ? "Key saved — photo recognition is on" : "Key removed");
  };
}

// ---------- backup: export / import ----------

async function exportBackup() {
  const data = store.exportData();
  const name = `foodlit-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const json = JSON.stringify(data, null, 2);
  const file = new File([json], name, { type: "application/json" });

  // On iOS the share sheet is the reliable way to get a file out of a
  // home-screen web app ("Save to Files"); <a download> is the desktop path.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "FoodLit backup" });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // user dismissed the sheet
      // otherwise fall through to the download path
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${data.meals.length} meals · ${data.pantry.length} pantry items`);
}

// Confirm before touching existing data, and offer merge as well as replace —
// a restore should never silently delete meals you logged since the backup.
function confirmImport(parsed) {
  const cur = { meals: store.meals.length, pantry: store.pantry.length };
  const wrap = sheetShell(`
      <h3 class="sheet-title">${ic("up")}Import backup</h3>
      <p class="sheet-copy">
        That file has <b>${plural(parsed.meals.length, "meal")}</b>
        and <b>${plural(parsed.pantry.length, "pantry item")}</b>.<br/>
        You currently have <b>${plural(cur.meals, "meal")}</b> and <b>${cur.pantry}</b>.
        ${parsed.skipped ? `<br/><span class="warn-text">${plural(parsed.skipped, "pantry item")} skipped — not in this app's catalog.</span>` : ""}
      </p>
      <div class="btn-col">
        <button class="btn btn-primary" data-merge>Merge — keep both (recommended)</button>
        <button class="btn btn-outline" data-replace>Replace everything</button>
        <button class="btn btn-ghost" data-cancel>Cancel</button>
      </div>`);
  const close = Motion.sheet(wrap);
  wrap.querySelector("[data-cancel]").onclick = close;

  wrap.querySelector("[data-merge]").onclick = () => {
    const seen = new Set(store.meals.map(mealKey));
    const added = parsed.meals.filter(m => !seen.has(mealKey(m)));
    // Newest first, matching how addMeal() stores them.
    store.saveMeals([...store.meals, ...added]);
    const pantry = store.pantry;
    let pAdded = 0;
    for (const e of parsed.pantry) {
      const cur = pantry.find(x => x.key === e.key);
      if (cur) cur.qty = Math.min(10, Math.max(cur.qty, e.qty));
      else { pantry.push(e); pAdded++; }
    }
    store.savePantry(pantry);
    const prices = priceStore.all;
    for (const [k, e] of Object.entries(parsed.prices || {})) {
      if (!prices[k] || prices[k].checked < e.checked) prices[k] = e;
    }
    priceStore.save(prices);
    applyPrices();
    orderStore.save({ ...parsed.orderPrices, ...orderStore.all });
    const plan = planStore.all;
    for (const [day, slots] of Object.entries(parsed.plan || {})) {
      for (const [slot, e] of Object.entries(slots)) if (!plan[day]?.[slot]) (plan[day] = plan[day] || {})[slot] = e;
    }
    planStore.save(plan);
    const cb = cookbook.data;
    cookbook.save({
      favs: [...new Set([...cb.favs, ...(parsed.cookbook?.favs || [])])],
      notes: { ...(parsed.cookbook?.notes || {}), ...cb.notes },
    });
    close();
    state.ticks = {};
    go("history");
    toast(`Merged: +${added.length} meals, +${pAdded} pantry items`);
  };

  wrap.querySelector("[data-replace]").onclick = () => {
    store.saveMeals(parsed.meals);
    store.savePantry(parsed.pantry);
    priceStore.save(parsed.prices || {});
    applyPrices();
    orderStore.save(parsed.orderPrices || {});
    planStore.save(parsed.plan || {});
    cookbook.save(parsed.cookbook || { favs: [], notes: {} });
    close();
    state.ticks = {};
    go("history");
    toast(`Restored ${parsed.meals.length} meals · ${parsed.pantry.length} pantry items`);
  };
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = parseBackup(String(reader.result));
    if (parsed.error) { toast("⚠ " + parsed.error); return; }
    if (!parsed.meals.length && !parsed.pantry.length && !Object.keys(parsed.prices || {}).length && !Object.keys(parsed.plan || {}).length && !(parsed.cookbook?.favs.length)) { toast("⚠ That backup is empty."); return; }
    confirmImport(parsed);
  };
  reader.onerror = () => toast("⚠ Couldn't read that file.");
  reader.readAsText(file);
}

// ---------- photo identification (P0-1) ----------

async function identifyPhoto(file) {
  const imgUrl = URL.createObjectURL(file);
  go("identify", { identify: { imgUrl, status: "loading", guesses: null, error: null } });

  if (!store.apiKey) {
    state.identify = {
      imgUrl, status: "error", guesses: null,
      error: "Photo recognition isn't set up yet (add your key in Settings). Meanwhile, search for the dish below.",
    };
    // Let the scanner play briefly so the screen change reads as cause → effect.
    setTimeout(() => render("reveal"), 900);
    return;
  }

  try {
    const { base64, mediaType } = await fileToBase64(file);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": store.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: 'Identify this dish (likely Indian home cooking). Reply with ONLY a JSON array of your top 3 dish-name guesses, most likely first, e.g. ["paneer butter masala","shahi paneer","paneer tikka masala"]. No other text.' },
          ],
        }],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    const text = (data.content || []).map(b => b.text || "").join("");
    const match = text.match(/\[[\s\S]*\]/);
    const guesses = match ? JSON.parse(match[0]).slice(0, 3) : [];
    if (!guesses.length) throw new Error("Couldn't parse a dish name from the model reply.");
    state.identify = { imgUrl, status: "done", guesses, error: null };
  } catch (e) {
    state.identify = {
      imgUrl, status: "error", guesses: null,
      error: `Couldn't identify the photo (${e.message}). Try the search below — never a dead end.`,
    };
  }
  if (state.view === "identify") render("reveal");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const [meta, base64] = reader.result.split(",");
      resolve({ base64, mediaType: meta.match(/data:(.*?);/)[1] });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- event wiring ----------

// Re-render while typing without losing the caret.
function renderKeepingFocus(id) {
  render("plain");
  const el = $app.querySelector("#" + id);
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

// Sideways rows (tonight's picks, cuisine chips). Phones swipe them natively;
// on a laptop a mouse wheel only scrolls vertically and there is no visible
// scrollbar, so the row looked stuck. Add: arrow buttons, wheel → sideways
// while the pointer is over the row (only until it reaches an end, so the
// page still scrolls), and click-and-drag.
function bindScrollers() {
  $app.querySelectorAll("[data-scroller]").forEach(row => {
    const max = () => row.scrollWidth - row.clientWidth;
    const sync = () => {
      const id = row.id;
      if (!id) return;
      const prev = $app.querySelector(`[data-row-prev="${id}"]`), next = $app.querySelector(`[data-row-next="${id}"]`);
      if (prev) prev.disabled = row.scrollLeft <= 2;
      if (next) next.disabled = row.scrollLeft >= max() - 2;
    };
    row.addEventListener("scroll", sync, { passive: true });
    sync();

    // One wheel notch = one card. Small nudges would just snap back to the
    // card they started on, which is exactly what felt "stuck".
    let wheelLock = false;
    const step = () => {
      const [a, b] = row.children;
      return a && b ? b.offsetLeft - a.offsetLeft : row.clientWidth * 0.6;
    };
    row.addEventListener("wheel", e => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpad swipe: native
      const atStart = row.scrollLeft <= 0, atEnd = row.scrollLeft >= max() - 1;
      if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return; // let the page scroll
      e.preventDefault();
      if (wheelLock) return;
      wheelLock = true;
      row.scrollBy({ left: Math.sign(e.deltaY) * step(), behavior: Motion.reduced.matches ? "auto" : "smooth" });
      setTimeout(() => { wheelLock = false; }, 280);
    }, { passive: false });

    let x0 = 0, left0 = 0, dragged = false, down = false;
    row.addEventListener("pointerdown", e => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = true; dragged = false; x0 = e.clientX; left0 = row.scrollLeft;
    });
    row.addEventListener("pointermove", e => {
      if (!down) return;
      const dx = e.clientX - x0;
      if (!dragged && Math.abs(dx) > 6) { dragged = true; row.classList.add("dragging"); row.setPointerCapture(e.pointerId); }
      if (dragged) row.scrollLeft = left0 - dx;
    });
    const end = () => { down = false; row.classList.remove("dragging"); };
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
    // A drag should never also open the dish it started on.
    row.addEventListener("click", e => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
  });
  $app.querySelectorAll("[data-row-prev], [data-row-next]").forEach(b => b.onclick = () => {
    const row = document.getElementById(b.dataset.rowPrev || b.dataset.rowNext);
    const dir = b.dataset.rowPrev ? -1 : 1;
    row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: Motion.reduced.matches ? "auto" : "smooth" });
  });
}

function bind() {
  bindScrollers();
  bindPlanner();
  // navigation
  $app.querySelectorAll("[data-back]").forEach(b => b.onclick = () => go(b.dataset.back));
  $app.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => go(b.dataset.nav));
  $app.querySelectorAll("[data-home]").forEach(b => b.onclick = e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $app.querySelectorAll("[data-settings]").forEach(b => b.onclick = openSettings);
  $app.querySelectorAll("[data-export]").forEach(b => b.onclick = () => exportBackup());
  $app.querySelectorAll("[data-import]").forEach(b => b.onclick = () => $importInput.click());
  $app.querySelectorAll("[data-recipe]").forEach(b => b.onclick = () =>
    go("recipe", { recipeId: b.dataset.recipe, selectedApp: null }));
  $app.querySelectorAll("[data-browse]").forEach(b => b.onclick = () =>
    document.getElementById("browse").scrollIntoView({ behavior: Motion.reduced.matches ? "auto" : "smooth", block: "start" }));
  $app.querySelectorAll("[data-snap]").forEach(b => b.onclick = () => {
    $photoInput.click();          // must stay synchronous with the tap
    Motion.shutter();
  });

  // home search + filters
  const search = $app.querySelector("#search");
  if (search) {
    search.oninput = () => {
      state.query = search.value;
      // Searching looks across every category — an active filter would
      // silently hide matches ("pasta" while Indian is selected, or
      // "poha" while Dinner is).
      if (state.query.trim()) { state.cuisine = "all"; state.meal = "all"; }
      renderKeepingFocus("search");
    };
  }
  $app.querySelectorAll("[data-time]").forEach(b => b.onclick = () => {
    state.timeFilter = Number(b.dataset.time);
    render();
  });
  $app.querySelectorAll("[data-cuisine]").forEach(b => b.onclick = () => {
    state.cuisine = b.dataset.cuisine;
    render();
  });
  $app.querySelectorAll("[data-meal]").forEach(b => b.onclick = () => {
    state.meal = b.dataset.meal;
    render();
  });

  // identify fallback search (live results)
  const fb = $app.querySelector("#fallback-search");
  if (fb) {
    fb.oninput = () => {
      const results = fb.value.trim() ? findRecipes(fb.value).slice(0, 4) : [];
      const box = $app.querySelector("#fallback-results");
      box.innerHTML = results.map(r => `
        <button class="guess" data-fb-recipe="${r.id}">
          ${dishPhoto(r, "guess-thumb")}
          <span class="guess-info"><span class="guess-name">${esc(r.name)}</span><span class="guess-sub">${r.time} min</span></span>
          <span class="guess-go">Cook ${ic("chevR")}</span>
        </button>`).join("");
      box.querySelectorAll("[data-fb-recipe]").forEach(b => b.onclick = () =>
        go("recipe", { recipeId: b.dataset.fbRecipe, selectedApp: null }));
    };
  }

  // serving-size stepper — quantities, kcal, costs and basket all rescale
  $app.querySelectorAll("[data-serve]").forEach(b => b.onclick = () => {
    const r = recipeById(state.recipeId);
    const next = Math.min(8, Math.max(1, servingsFor(r) + Number(b.dataset.serve)));
    state.servings[r.id] = next;
    render();
  });

  // recipe → basket
  $app.querySelectorAll("[data-basket]").forEach(b => b.onclick = () => go("basket"));

  // basket ticks (P0-6 — totals recalc instantly via re-render)
  $app.querySelectorAll("[data-tick]").forEach(cb => cb.onchange = () => {
    const ticks = state.ticks[state.recipeId] || (state.ticks[state.recipeId] = {});
    ticks[Number(cb.dataset.tick)] = cb.checked;
    render();
  });

  // pantry manager — search-to-add with quantity, plus per-item steppers.
  // Any pantry change resets per-recipe tick overrides so baskets pick up
  // the new defaults.
  const ps = $app.querySelector("#pantry-search");
  if (ps) {
    ps.oninput = () => {
      state.pantrySearch = ps.value;
      state.pantryAdd = null;
      renderKeepingFocus("pantry-search");
    };
  }
  $app.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
    state.pantryAdd = { key: b.dataset.pick, qty: Math.max(1, store.pantryQty(b.dataset.pick)) };
    render("reveal");
  });
  $app.querySelectorAll("[data-stage-qty]").forEach(b => b.onclick = () => {
    state.pantryAdd.qty = Math.min(10, Math.max(1, state.pantryAdd.qty + Number(b.dataset.stageQty)));
    render();
  });
  $app.querySelectorAll("[data-stage-cancel]").forEach(b => b.onclick = () => {
    state.pantryAdd = null;
    render();
  });
  $app.querySelectorAll("[data-stage-add]").forEach(b => b.onclick = () => {
    const { key, qty } = state.pantryAdd;
    store.setPantryQty(key, qty);
    state.pantryAdd = null;
    state.pantrySearch = "";
    state.ticks = {};
    render();
    toast(`${CATALOG[key].product} — ${qty} pack${qty > 1 ? "s" : ""} in your pantry`);
  });
  $app.querySelectorAll("[data-pqty]").forEach(b => b.onclick = () => {
    const key = b.dataset.pqty;
    store.setPantryQty(key, Math.min(10, store.pantryQty(key) + Number(b.dataset.d)));
    state.ticks = {};
    render();
  });
  $app.querySelectorAll("[data-premove]").forEach(b => b.onclick = () => {
    store.setPantryQty(b.dataset.premove, 0);
    state.ticks = {};
    render();
  });

  // guided shopping: open marks the item added (the link itself opens the app)
  $app.querySelectorAll("[data-shop-open]").forEach(a => a.addEventListener("click", () => {
    const { key, done } = shopContext();
    done.add(a.dataset.shopOpen);
    shopStore.set(key, done);
    setTimeout(() => render(), 60); // after the new tab/app has opened
  }));
  $app.querySelectorAll("[data-shop-toggle]").forEach(b => b.onclick = () => {
    const { key, done } = shopContext();
    const i = b.dataset.shopToggle;
    done.has(i) ? done.delete(i) : done.add(i);
    shopStore.set(key, done);
    render();
  });
  $app.querySelectorAll("[data-shop-reset]").forEach(b => b.onclick = () => {
    shopStore.set(shopContext().key, new Set());
    render();
  });
  $app.querySelectorAll("[data-shop-copy]").forEach(b => b.onclick = async () => {
    const text = shoppingListText(shopContext());
    if (await copyText(text)) { toast("Shopping list copied — paste it anywhere"); return; }
    showListSheet(text); // copying blocked (some phones / in-app browsers): show it instead
  });

  // update prices: filters, open-from-elsewhere, save one item
  $app.querySelectorAll("[data-price-filter]").forEach(b => b.onclick = () => {
    state.priceFilter = b.dataset.priceFilter;
    render();
  });
  $app.querySelectorAll("[data-prices]").forEach(b => b.onclick = () =>
    go("prices", { pricesBack: state.view, priceFilter: b.dataset.prices || state.priceFilter }));
  $app.querySelectorAll("[data-price-save]").forEach(b => b.onclick = () => {
    const key = b.dataset.priceSave;
    const card = b.closest("[data-price-card]");
    const entry = { checked: todayISO() };
    for (const input of card.querySelectorAll("[data-price-app]")) {
      const raw = input.value.trim();
      if (raw === "") { entry[input.dataset.priceApp] = null; continue; }
      const v = Math.round(Number(raw));
      if (!Number.isFinite(v) || v < 1 || v > 9999) {
        input.focus();
        toast(`Check the ${APPS[input.dataset.priceApp].name} price — numbers only`);
        return;
      }
      entry[input.dataset.priceApp] = v;
    }
    if (Object.keys(APPS).every(a => entry[a] == null)) {
      toast("Enter at least one price before saving");
      return;
    }
    const all = priceStore.all;
    all[key] = entry;
    priceStore.save(all);
    applyPrices();
    render();
    toast(`${CATALOG[key].product} — prices saved`);
  });

  // my usual order price (recipe screen)
  $app.querySelectorAll("[data-order-edit]").forEach(b => b.onclick = () => {
    state.orderEditing = state.recipeId;
    render();
    setTimeout(() => { const i = $app.querySelector("#order-input"); if (i) { i.focus(); i.select(); } }, 50);
  });
  $app.querySelectorAll("[data-order-cancel]").forEach(b => b.onclick = () => {
    state.orderEditing = null;
    render();
  });
  $app.querySelectorAll("[data-order-save]").forEach(b => b.onclick = () => {
    const v = Math.round(Number($app.querySelector("#order-input").value));
    if (!Number.isFinite(v) || v < 1 || v > 9999) { toast("Enter a price in rupees, e.g. 280"); return; }
    const all = orderStore.all;
    all[state.recipeId] = v;
    orderStore.save(all);
    state.orderEditing = null;
    render();
    toast("Saved — savings now use your usual price");
  });
  $app.querySelectorAll("[data-order-reset]").forEach(b => b.onclick = () => {
    const all = orderStore.all;
    delete all[state.recipeId];
    orderStore.save(all);
    state.orderEditing = null;
    render();
    toast("Back to the typical price");
  });

  // app selection for handoff
  $app.querySelectorAll("[data-app]").forEach(b => b.onclick = () => {
    state.selectedApp = b.dataset.app;
    render();
  });

  // log cooked meal — celebrate, then head home
  $app.querySelectorAll("[data-cooked]").forEach(b => b.onclick = () => {
    if (b.disabled) return;
    b.disabled = true;
    const r = recipeById(state.recipeId);
    const meal = logCookedMeal(r, factorFor(r));
    const saved = meal.saved;
    markPlannedCooked(r.id, meal);
    b.classList.add("done");
    b.innerHTML = `${ic("check")}<span>Logged — nice cooking</span>`;
    Motion.confetti();
    setTimeout(() => {
      go("home");
      toast(`Logged! ${fmt(saved)} kept away from delivery`);
    }, Motion.reduced.matches ? 0 : 900);
  });
}

$photoInput.addEventListener("change", () => {
  if ($photoInput.files[0]) identifyPhoto($photoInput.files[0]);
  $photoInput.value = "";
});

const $importInput = document.getElementById("import-input");
$importInput.addEventListener("change", () => {
  if ($importInput.files[0]) handleImportFile($importInput.files[0]);
  $importInput.value = "";
});

// "/" jumps to search on the home screen.
document.addEventListener("keydown", e => {
  if (e.key !== "/" || e.target.matches("input, textarea")) return;
  const s = $app.querySelector("#search, #pantry-search, #fallback-search");
  if (s) { e.preventDefault(); s.focus(); }
});

// Installable PWA: offline cache (needs HTTPS or localhost; silently
// skipped when served over plain http on the LAN).
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// First paint: the home screen eases itself in.
render("reveal");
