// ---------------------------------------------------------------
// FoodLit — meal planner + cookbook.
//
// Plan: a week board (Mon–Sun × Breakfast/Lunch/Dinner) with a month
// overview, "Plan my week for me", one combined grocery list for the plan,
// a savings forecast, and today's plan on the home screen.
// Cookbook: ♡ favourites and personal notes per recipe.
//
// Everything is stored on this device (localStorage) and included in
// backups. Loaded after costs.js and before app.js; the functions here use
// app.js helpers (render, go, ic, fmt, …) only when called, never at load.
// ---------------------------------------------------------------

const SLOTS = ["breakfast", "lunch", "dinner"];
const SLOT_NAME = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

// ---------- dates (local calendar days as yyyy-mm-dd) ----------
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = iso => new Date(iso + "T00:00");
const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const mondayOf = iso => { const d = dateOf(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoOf(d); };
const weekDays = monday => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
const dayShort = iso => dateOf(iso).toLocaleDateString("en-IN", { weekday: "short" });
const dayLong = iso => dateOf(iso).toLocaleDateString("en-IN", { weekday: "long" });
const monShort = iso => dateOf(iso).toLocaleDateString("en-IN", { month: "short" });
const dayTitle = iso => `${dayShort(iso)} ${dateOf(iso).getDate()} ${monShort(iso)}`;
function weekRange(monday) {
  const sun = addDays(monday, 6), a = dateOf(monday), b = dateOf(sun);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${monShort(sun)}`
    : `${a.getDate()} ${monShort(monday)} – ${b.getDate()} ${monShort(sun)}`;
}
function weekName(monday) {
  const cur = mondayOf(todayISO());
  if (monday === cur) return "This week";
  if (monday === addDays(cur, 7)) return "Next week";
  if (monday === addDays(cur, -7)) return "Last week";
  return weekRange(monday);
}

// ---------- storage ----------
// Plan: { "2026-11-02": { dinner: { id, serves, cooked?, logged? } } }
const planStore = {
  get all() { try { return JSON.parse(localStorage.getItem("stc_plan") || "{}"); } catch { return {}; } },
  save(all) { localStorage.setItem("stc_plan", JSON.stringify(all)); },
  get(day, slot) { return this.all[day]?.[slot] ?? null; },
  set(day, slot, entry) {
    const all = this.all;
    all[day] = all[day] || {};
    if (entry) all[day][slot] = entry; else delete all[day][slot];
    if (!Object.keys(all[day]).length) delete all[day];
    this.save(all);
  },
};

// Cookbook: { favs: [recipe ids, newest first], notes: { id: text } }
const cookbook = {
  get data() {
    try { return { favs: [], notes: {}, ...JSON.parse(localStorage.getItem("stc_cookbook") || "{}") }; }
    catch { return { favs: [], notes: {} }; }
  },
  save(d) { localStorage.setItem("stc_cookbook", JSON.stringify(d)); },
  isFav(id) { return this.data.favs.includes(id); },
  toggle(id) {
    const d = this.data;
    d.favs = d.favs.includes(id) ? d.favs.filter(x => x !== id) : [id, ...d.favs];
    this.save(d);
    return d.favs.includes(id);
  },
  note(id) { return this.data.notes[id] || ""; },
  setNote(id, text) {
    const d = this.data, t = String(text).trim().slice(0, 1000);
    if (t) d.notes[id] = t; else delete d.notes[id];
    this.save(d);
  },
};

// ---------- plan maths ----------
function weekEntries(monday) {
  const all = planStore.all;
  return weekDays(monday).flatMap(day => SLOTS.map(slot => ({ day, slot, e: all[day]?.[slot] })))
    .filter(x => x.e && recipeById(x.e.id));
}
const entryFactor = e => e.serves / recipeById(e.id).serves;
function weekForecast(monday) {
  const list = weekEntries(monday);
  return {
    planned: list.length,
    cooked: list.filter(x => x.e.cooked).length,
    keep: list.reduce((s, x) => s + savingOf(recipeById(x.e.id), entryFactor(x.e)), 0),
  };
}

// Fill empty slots from today onward: right meal, fewest things to buy,
// no repeats this week, a different cuisine from yesterday's dinner, and a
// nudge towards favourites. Seeded per week so the same week plans the same
// way, while different weeks get variety.
function autoPlan(monday, slots) {
  const all = planStore.all, today = todayISO();
  const owned = new Set(store.pantry.filter(e => e.qty > 0).map(e => e.key));
  const used = new Set(weekEntries(monday).map(x => x.e.id));
  const favs = new Set(cookbook.data.favs);
  let seed = [...monday].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const filled = [];
  let lastCuisine = null;
  for (const day of weekDays(monday)) {
    for (const slot of SLOTS) {
      const have = all[day]?.[slot];
      if (have) { if (slot === "dinner") lastCuisine = recipeById(have.id)?.cuisine ?? lastCuisine; continue; }
      if (day < today || !slots.includes(slot)) continue;
      const best = RECIPES.filter(r => r.meals.includes(slot) && !used.has(r.id))
        .map(r => ({ r, score: pantryCoverage(r, owned).missing * 2 + (slot === "dinner" && r.cuisine === lastCuisine ? 3 : 0) - (favs.has(r.id) ? 2 : 0) + rnd() * 3 }))
        .sort((a, b) => a.score - b.score)[0];
      if (!best) continue;
      all[day] = all[day] || {};
      all[day][slot] = { id: best.r.id, serves: best.r.serves };
      used.add(best.r.id);
      filled.push({ day, slot });
      if (slot === "dinner") lastCuisine = best.r.cuisine;
    }
  }
  planStore.save(all);
  return filled;
}

// Everything to buy for the plan's meals from today onward (not yet
// cooked), added up across dishes, minus what's in the pantry.
function planGroceries(monday) {
  const today = todayISO();
  const entries = weekEntries(monday).filter(x => !x.e.cooked && x.day >= today);
  const owned = new Set(store.pantry.filter(e => e.qty > 0).map(e => e.key));
  const byKey = new Map(), extras = [];
  for (const { e } of entries) {
    const r = recipeById(e.id), f = entryFactor(e);
    for (const ing of r.ingredients) {
      if (!ing.key || !CATALOG[ing.key]) { extras.push(`${ing.name} (${scaleQty(ing.qty, f)}) for ${r.name}`); continue; }
      if (owned.has(ing.key)) continue;
      const p = Costs.pack(CATALOG[ing.key].size);
      const u = Costs.used(ing.key, ing.qty, p) ?? p.n * 0.25;
      const cur = byKey.get(ing.key) || { amount: 0, dishes: new Set() };
      cur.amount += u * f;
      cur.dishes.add(r.name);
      byKey.set(ing.key, cur);
    }
  }
  const items = [...byKey.entries()].map(([key, x], index) => {
    const sku = CATALOG[key], p = Costs.pack(sku.size);
    return {
      index, key, shopId: key, label: sku.product, size: sku.size,
      packs: Math.max(1, Math.ceil(x.amount / p.n - 0.05)),
      prices: sku.prices, mapped: true, ticked: true, estimate: isEstimate(key), dishes: [...x.dishes],
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
  return { entries, items, extras };
}

// The guided-shopping context for the plan's grocery list (see shopPanel).
function planShopContext() {
  const monday = state.planWeek || mondayOf(todayISO());
  const { entries, items, extras } = planGroceries(monday);
  const cmp = compareApps(items);
  const sel = state.planApp && cmp.perApp[state.planApp] ? state.planApp : defaultApp(cmp);
  const key = `plan:${monday}|${sel}`;
  return {
    title: `Meal plan, ${weekRange(monday)}`, app: sel ? APPS[sel] : null, list: items, items, key,
    done: shopStore.get(key), extras, cmp, sel, entries, monday,
  };
}

function planShareText(monday) {
  const all = planStore.all, f = weekForecast(monday);
  const lines = [`FoodLit meal plan · ${weekRange(monday)}`];
  for (const day of weekDays(monday)) {
    const meals = SLOTS.filter(s => all[day]?.[s] && recipeById(all[day][s].id))
      .map(s => `${SLOT_NAME[s]}: ${recipeById(all[day][s].id).name}`);
    if (meals.length) lines.push(`${dayShort(day)} ${dateOf(day).getDate()} — ${meals.join(" · ")}`);
  }
  if (f.planned) lines.push("", `${plural(f.planned, "meal")} planned · keeps ~${fmt(f.keep)} from delivery`);
  return lines.join("\n");
}

// Log a cooked meal (shared by the basket button and the plan) and return
// the meal record, so the plan can find and undo it.
function logCookedMeal(r, f) {
  const meal = {
    name: r.name, emoji: r.emoji, saved: savingOf(r, f), serves: Math.round(r.serves * f),
    date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
  };
  store.addMeal(meal);
  return meal;
}

// Cooking a dish that's on today's plan ticks it off there.
function markPlannedCooked(recipeId, meal) {
  const today = todayISO(), day = planStore.all[today] || {};
  const slot = SLOTS.find(s => day[s]?.id === recipeId && !day[s].cooked);
  if (!slot) return;
  planStore.set(today, slot, { ...day[slot], cooked: true, logged: mealKey(meal) });
}

// ---------- views ----------

function planSlotHTML(day, slot, e) {
  const r = e && recipeById(e.id);
  if (!r) {
    return `<button class="slot slot--empty" data-slot-add="${day}|${slot}">
      <span class="slot-plus">${ic("plus")}</span><span class="slot-label">${SLOT_NAME[slot]}</span></button>`;
  }
  return `<button class="slot ${e.cooked ? "slot--cooked" : ""}" data-slot-open="${day}|${slot}">
      ${dishPhoto(r, "slot-thumb", { vt: null })}
      <span class="slot-info">
        <span class="slot-kind">${SLOT_NAME[slot]}</span>
        <span class="slot-name">${esc(r.name)}</span>
        <span class="slot-meta">${plural(e.serves, "person", "people")} · ${e.cooked ? "cooked" : `keeps ${fmt(savingOf(r, entryFactor(e)))}`}</span>
      </span>
      ${e.cooked ? `<span class="slot-done" aria-label="Cooked">${ic("check")}</span>` : ""}
    </button>`;
}

function planWeekHTML(monday) {
  const all = planStore.all, today = todayISO();
  return weekDays(monday).map(day => {
    const isToday = day === today, past = day < today;
    return `
      <section class="day ${isToday ? "day--today" : ""} ${past ? "day--past" : ""}" id="day-${day}">
        <div class="day-head">
          <span class="day-name">${dayLong(day)}</span>
          <span class="day-date">${dateOf(day).getDate()} ${monShort(day)}</span>
          ${isToday ? `<span class="day-badge">Today</span>` : ""}
        </div>
        <div class="day-slots">${SLOTS.map(slot => planSlotHTML(day, slot, all[day]?.[slot])).join("")}</div>
      </section>`;
  }).join("");
}

function planMonthHTML() {
  const month = state.planMonth || todayISO().slice(0, 7) + "-01";
  const first = dateOf(month), all = planStore.all, today = todayISO();
  const start = mondayOf(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const label = first.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const prev = isoOf(new Date(first.getFullYear(), first.getMonth() - 1, 1));
  const next = isoOf(new Date(first.getFullYear(), first.getMonth() + 1, 1));
  return `
    <div class="week-nav">
      <button class="icon-btn" data-month-go="${prev}" aria-label="Previous month">${ic("chevL")}</button>
      <span class="week-label">${label}</span>
      <button class="icon-btn" data-month-go="${next}" aria-label="Next month">${ic("chevR")}</button>
    </div>
    <div class="month">
      ${["M", "T", "W", "T", "F", "S", "S"].map(d => `<span class="month-dow">${d}</span>`).join("")}
      ${days.map(day => {
        const inMonth = dateOf(day).getMonth() === first.getMonth();
        const dots = SLOTS.map(s => {
          const e = all[day]?.[s];
          return `<i class="dot ${e && recipeById(e.id) ? (e.cooked ? "dot--cooked" : "dot--planned") : ""}"></i>`;
        }).join("");
        const n = SLOTS.filter(s => all[day]?.[s]).length;
        return `<button class="month-day ${inMonth ? "" : "month-day--out"} ${day === today ? "month-day--today" : ""}" data-month-day="${day}" aria-label="${dayTitle(day)}: ${plural(n, "meal")} planned">
          <span class="month-num">${dateOf(day).getDate()}</span><span class="month-dots">${dots}</span></button>`;
      }).join("")}
    </div>
    <p class="fine center"><i class="dot dot--planned"></i> planned &nbsp; <i class="dot dot--cooked"></i> cooked · tap a day to plan it</p>`;
}

function planView() {
  const monday = state.planWeek || mondayOf(todayISO());
  const mode = state.planMode || "week";
  const f = weekForecast(monday);
  const groceries = planGroceries(monday);
  return `
    ${topbar("Meal plan", "home")}
    <main class="page">
      <section class="page-hero plan-hero" data-enter>
        <p class="eyebrow">Your meal plan</p>
        <h2 class="page-title">${mode === "week" ? weekName(monday) : "Month at a glance"}</h2>
      </section>

      <div class="plan-modes seg" role="group" aria-label="View">
        ${[["week", "Week"], ["month", "Month"]].map(([id, name]) => `
          <button class="seg-btn ${mode === id ? "active" : ""}" data-plan-mode="${id}" aria-pressed="${mode === id}">
            ${mode === id ? `<span class="seg-pill" data-vt="pill-plan"></span>` : ""}<span class="seg-label">${name}</span>
          </button>`).join("")}
      </div>

      ${mode === "month" ? planMonthHTML() : `
      <div class="week-nav">
        <button class="icon-btn" data-week-go="-7" aria-label="Previous week">${ic("chevL")}</button>
        <span class="week-label">${weekRange(monday)}</span>
        <button class="icon-btn" data-week-go="7" aria-label="Next week">${ic("chevR")}</button>
      </div>
      ${monday !== mondayOf(todayISO()) ? `<button class="link-btn" data-week-today>${ic("calendar")}Back to this week</button>` : ""}

      <section class="panel forecast" data-enter>
        ${f.planned ? `
        <div class="fc-top">
          <span class="fc-num">₹<span data-roll="fc-keep">${num(f.keep)}</span></span>
          <span class="fc-lbl">kept from delivery if you cook this plan</span>
        </div>
        <div class="fc-row"><span>Cooked <b>${f.cooked} of ${f.planned}</b></span><span class="muted">${plural(f.planned, "meal")} planned</span></div>
        <div class="shop-bar" aria-hidden="true"><span data-tween="fc-${monday}" style="--v:${(f.cooked / f.planned).toFixed(3)}"></span></div>`
        : `<p class="fc-empty"><b>Nothing planned yet.</b> Tap a slot below to pick a dish, or let FoodLit fill the week for you.</p>`}
      </section>

      <div class="plan-actions">
        <button class="btn btn-primary grow" data-plan-auto>${ic("spark")}Plan my week for me</button>
        <button class="btn btn-outline" data-plan-list ${groceries.items.length ? "" : "disabled"}>${ic("cart")}Groceries${groceries.items.length ? ` · ${groceries.items.length}` : ""}</button>
        <button class="icon-btn" data-plan-share aria-label="Share plan" title="Share plan" ${f.planned ? "" : "disabled"}>${ic("share")}</button>
      </div>
      ${monday === mondayOf(todayISO()) && [0, 6].includes(new Date().getDay())
        ? `<button class="link-btn" data-week-go="7">${ic("calendar")}It's the weekend: plan next week</button>` : ""}
      ${state.planUndo ? `<div class="undo-bar">${ic("check")}<span>Filled ${plural(state.planUndo.count, "meal")}.</span><button class="link-inline" data-plan-undo>Undo</button></div>` : ""}

      <div class="week">${planWeekHTML(monday)}</div>`}
    </main>`;
}

function planListView() {
  const ctx = planShopContext();
  const { entries, items, extras, cmp, sel, monday } = ctx;
  const maxTotal = Math.max(1, ...Object.values(cmp.perApp).map(d => d.total));
  return `
    ${topbar("Groceries for the plan", "plan")}
    <main class="page">
      <section class="page-hero" data-enter>
        <p class="eyebrow">${weekRange(monday)}</p>
        <h2 class="page-title">${plural(items.length, "item")} for ${plural(entries.length, "meal")}</h2>
        <p class="muted">Everything your plan needs from today on, added up across dishes, minus what's already in your pantry.</p>
      </section>
      ${!items.length ? `
      <div class="empty">
        <span class="empty-ic">${ic("cart")}</span>
        <p>Nothing to buy.</p>
        <p class="muted">${entries.length ? "Your pantry already covers the plan." : "Plan some meals for today onward first."}</p>
      </div>` : `
      <section class="panel" data-enter>
        <div class="panel-head"><h3>Price across apps</h3><span class="sec-aux">${plural(items.length, "item")}</span></div>
        <div class="apps">
          ${Object.entries(APPS).map(([appId, app]) => {
            const d = cmp.perApp[appId], isCheapest = appId === cmp.cheapest, isSel = appId === sel;
            return `
            <button class="app ${isCheapest ? "cheapest" : ""} ${isSel ? "selected" : ""}" data-plan-app="${appId}" style="--c:${app.color}" aria-pressed="${isSel}">
              <span class="app-top">
                <span class="app-dot" aria-hidden="true"></span><span class="app-name">${app.name}</span>
                ${isCheapest ? `<span class="crown">${ic("crown")}Cheapest</span>` : ""}
                <span class="app-total">₹<span data-roll="papp-${appId}">${Math.round(d.total)}</span>${d.complete ? "" : "*"}</span>
              </span>
              <span class="app-bar"><span class="app-fill" data-tween="papp-${appId}" style="--v:${(d.total / maxTotal).toFixed(3)}"></span></span>
              <span class="app-note ${d.complete ? "" : "warn"}">${d.complete ? (isSel ? "Selected — shop below" : "All items available") : `Missing: ${d.missing.map(esc).join(", ")}`}</span>
            </button>`;
          }).join("")}
        </div>
        <p class="fine center price-note">${priceNote(items.map(it => it.key))} *Excludes items an app doesn't sell.</p>
      </section>
      ${shopPanel(ctx)}
      ${extras.length ? `<div class="note warn">${ic("alert")}<span>Also needed, not sold as a single item: ${extras.map(esc).join("; ")}.</span></div>` : ""}`}
    </main>`;
}

function cookbookView() {
  const { favs, notes } = cookbook.data;
  const list = favs.map(recipeById).filter(Boolean);
  return `
    ${topbar("My cookbook", "home")}
    <main class="page">
      <section class="page-hero" data-enter>
        <p class="eyebrow">Saved recipes</p>
        <h2 class="page-title">My cookbook</h2>
        <p class="muted">Tap ♡ Save on any recipe to keep it here. Your notes show under each dish.</p>
      </section>
      ${list.length ? `
      <div class="grid">
        ${list.map(r => `
          <button class="dish" data-recipe="${r.id}" data-vt="card-${r.id}">
            <span class="dish-media">${dishPhoto(r, "dish-photo")}<span class="dish-time">${ic("clock")}${r.time}m</span><span class="dish-fav">${ic("heartFill")}</span></span>
            <span class="dish-body">
              <span class="dish-name">${esc(r.name)}</span>
              ${notes[r.id] ? `<span class="dish-note">“${esc(notes[r.id].slice(0, 80))}${notes[r.id].length > 80 ? "…" : ""}”</span>` : `<span class="dish-meta">${esc(cuisineName(r.cuisine))} · keeps ${fmt(savingOf(r))}</span>`}
            </span>
          </button>`).join("")}
      </div>` : `
      <div class="empty">
        <span class="empty-ic">${ic("heart")}</span>
        <p>No saved recipes yet.</p>
        <p class="muted">Open any dish and tap ♡ Save.</p>
        <button class="btn btn-primary" data-nav="home" style="margin-top:14px">Browse dishes</button>
      </div>`}
    </main>`;
}

// Home: today's plan above tonight's picks.
function todayPlanCard() {
  const today = todayISO(), day = planStore.all[today] || {};
  const slots = SLOTS.filter(s => day[s] && recipeById(day[s].id));
  if (!slots.length) {
    return `
      <button class="plan-cta" data-nav="plan" data-enter>
        <span class="plan-cta-ic">${ic("calendar")}</span>
        <span class="plan-cta-txt"><b>Plan your week</b><span>Pick dishes for the days ahead and shop once.</span></span>
        ${ic("chevR")}
      </button>`;
  }
  const now = SLOTS.indexOf(mealNow());
  const next = slots.find(s => !day[s].cooked && SLOTS.indexOf(s) >= now) || slots.find(s => !day[s].cooked);
  const r = next && recipeById(day[next].id);
  return `
    <section class="today-plan" data-enter>
      <div class="tp-head"><span class="eyebrow">Today's plan</span><button class="link-inline" data-nav="plan">See week</button></div>
      ${r ? `
      <div class="tp-main">
        ${dishPhoto(r, "tp-photo", { vt: null })}
        <div class="tp-info">
          <span class="tp-kind">${SLOT_NAME[next]}</span>
          <span class="tp-name">${esc(r.name)}</span>
          <span class="tp-meta">${ic("clock")}${r.time} min · keeps ${fmt(savingOf(r, entryFactor(day[next])))}</span>
        </div>
      </div>
      <button class="btn btn-primary tp-cook" data-plan-cook="${today}|${next}">Start cooking</button>`
      : `<p class="tp-done">${ic("check")}Everything planned for today is cooked. Nice work!</p>`}
      ${slots.length > 1 ? `<ul class="tp-list">${slots.map(s => `
        <li class="${day[s].cooked ? "done" : ""}"><span class="tp-slot">${SLOT_NAME[s]}</span><span class="tp-dish">${esc(recipeById(day[s].id).name)}</span>${day[s].cooked ? ic("check") : ""}</li>`).join("")}</ul>` : ""}
    </section>`;
}

// ---------- sheets ----------

function dishPickRows(rows, owned) {
  return rows.map(r => {
    const c = pantryCoverage(r, owned);
    return `
      <button class="pick-row" data-pick-dish="${r.id}">
        ${dishPhoto(r, "pick-row-thumb", { vt: null })}
        <span class="pick-row-info">
          <span class="pick-row-name">${esc(r.name)}${cookbook.isFav(r.id) ? ` <span class="fav-mini">${ic("heartFill")}</span>` : ""}</span>
          <span class="pick-row-meta">${r.time} min · ${haveLine(c)}</span>
        </span>
        <span class="pick-row-add">${ic("plus")}</span>
      </button>`;
  }).join("");
}

// Pick a dish for one slot: favourites and good matches first, search for anything.
function openSlotPicker(day, slot) {
  const owned = new Set(store.pantry.filter(e => e.qty > 0).map(e => e.key));
  const favs = cookbook.data.favs.map(recipeById).filter(r => r && r.meals.includes(slot));
  const suggested = RECIPES.filter(r => r.meals.includes(slot) && !favs.includes(r))
    .map(r => ({ r, m: pantryCoverage(r, owned).missing })).sort((a, b) => a.m - b.m || a.r.time - b.r.time).slice(0, 8).map(x => x.r);
  const defaultList = () => `
    ${favs.length ? `<p class="pick-sec">${ic("heart")}From your cookbook</p>${dishPickRows(favs, owned)}` : ""}
    <p class="pick-sec">${ic("spark")}Good for ${SLOT_NAME[slot].toLowerCase()} · fewest things to buy</p>${dishPickRows(suggested, owned)}
    <p class="pick-sec muted">Search above to find any of the ${RECIPES.length} dishes.</p>`;
  const wrap = sheetShell(`
      <h3 class="sheet-title">${ic("calendar")}${SLOT_NAME[slot]} · ${dayTitle(day)}</h3>
      <label class="search sheet-search">${ic("search")}<input id="pick-search" type="search" placeholder="Search any dish" autocomplete="off" /></label>
      <div class="pick-list" id="pick-list">${defaultList()}</div>`);
  wrap.querySelector(".modal").classList.add("modal--tall");
  const close = Motion.sheet(wrap);
  const list = wrap.querySelector("#pick-list");
  const bindRows = () => list.querySelectorAll("[data-pick-dish]").forEach(b => b.onclick = () => {
    const r = recipeById(b.dataset.pickDish);
    planStore.set(day, slot, { id: r.id, serves: r.serves });
    state.planUndo = null;
    close();
    render();
    toast(`${r.name} added to ${dayShort(day)} ${SLOT_NAME[slot].toLowerCase()}`);
  });
  bindRows();
  wrap.querySelector("#pick-search").oninput = e => {
    const q = e.target.value.trim();
    list.innerHTML = q ? (dishPickRows(findRecipes(q).slice(0, 20), owned) || `<p class="pick-sec muted">No dish matches “${esc(q)}”.</p>`) : defaultList();
    bindRows();
  };
}

// A filled slot: people, cost, open recipe, mark cooked, swap, remove.
function openSlotActions(day, slot) {
  const e = planStore.get(day, slot), r = e && recipeById(e.id);
  if (!r) return;
  const f = entryFactor(e), keep = savingOf(r, f);
  const wrap = sheetShell(`
      <div class="slot-sheet-head">
        ${dishPhoto(r, "slot-sheet-thumb", { vt: null })}
        <div><p class="eyebrow">${SLOT_NAME[slot]} · ${dayTitle(day)}</p><h3 class="sheet-title">${esc(r.name)}</h3></div>
      </div>
      <div class="slot-sheet-serves">
        <span>Cooking for <b>${plural(e.serves, "person", "people")}</b></span>
        <div class="stepper small">
          <button data-ss-serve="-1" ${e.serves <= 1 ? "disabled" : ""} aria-label="Fewer people">${ic("minus")}</button>
          <button data-ss-serve="1" ${e.serves >= 8 ? "disabled" : ""} aria-label="More people">${ic("plus")}</button>
        </div>
      </div>
      <p class="sheet-copy">Cook ~${fmt(cookCostOf(r, f))} · order ${fmt(orderPriceOf(r, f))} · <b>keeps ${fmt(keep)}</b></p>
      <div class="btn-col">
        <button class="btn btn-primary" data-ss-open>${ic("chevR")}Open recipe</button>
        <button class="btn btn-outline" data-ss-cooked>${e.cooked ? `${ic("minus")}Mark as not cooked` : `${ic("check")}I cooked this (+${fmt(keep)})`}</button>
        <button class="btn btn-outline" data-ss-swap>${ic("spark")}Swap dish</button>
        <button class="btn btn-ghost danger-text" data-ss-remove>${ic("trash")}Remove from plan</button>
      </div>`);
  const close = Motion.sheet(wrap);
  const reopen = () => { close(); render(); setTimeout(() => openSlotActions(day, slot), 380); };
  wrap.querySelectorAll("[data-ss-serve]").forEach(b => b.onclick = () => {
    const cur = planStore.get(day, slot);
    planStore.set(day, slot, { ...cur, serves: Math.min(8, Math.max(1, cur.serves + Number(b.dataset.ssServe))) });
    reopen();
  });
  wrap.querySelector("[data-ss-open]").onclick = () => {
    close();
    state.servings[r.id] = e.serves;
    go("recipe", { recipeId: r.id, selectedApp: null });
  };
  wrap.querySelector("[data-ss-cooked]").onclick = () => {
    const cur = planStore.get(day, slot);
    if (cur.cooked) {
      // Undo: take the logged meal back out of the history too.
      if (cur.logged) store.saveMeals(store.meals.filter(m => mealKey(m) !== cur.logged));
      planStore.set(day, slot, { id: cur.id, serves: cur.serves });
      close(); render();
      toast("Marked as not cooked");
    } else {
      const meal = logCookedMeal(r, entryFactor(cur));
      planStore.set(day, slot, { ...cur, cooked: true, logged: mealKey(meal) });
      close(); render();
      Motion.confetti();
      toast(`Logged! ${fmt(meal.saved)} kept away from delivery`);
    }
  };
  wrap.querySelector("[data-ss-swap]").onclick = () => { close(); setTimeout(() => openSlotPicker(day, slot), 380); };
  wrap.querySelector("[data-ss-remove]").onclick = () => {
    planStore.set(day, slot, null);
    close(); render();
    toast(`${r.name} removed from the plan`);
  };
}

// From a recipe: pick a day and meal in the next two weeks.
function openAddToPlan(r) {
  const today = todayISO(), all = planStore.all;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const slots = SLOTS.filter(s => r.meals.includes(s));
  const wrap = sheetShell(`
      <h3 class="sheet-title">${ic("calendar")}Add ${esc(r.name)} to your plan</h3>
      <p class="sheet-copy">Pick a day and meal. Taken slots show what's already planned.</p>
      <div class="atp-list">
        ${days.map(day => `
          <div class="atp-day">
            <span class="atp-date">${i18nDay(day, today)}</span>
            <span class="atp-slots">${slots.map(s => {
              const taken = all[day]?.[s] && recipeById(all[day][s].id);
              return `<button class="atp-slot ${taken ? "atp-slot--taken" : ""}" data-atp="${day}|${s}" title="${taken ? esc(taken.name) : ""}">${SLOT_NAME[s]}${taken ? `<small>${esc(taken.name)}</small>` : ""}</button>`;
            }).join("")}</span>
          </div>`).join("")}
      </div>`);
  wrap.querySelector(".modal").classList.add("modal--tall");
  const close = Motion.sheet(wrap);
  wrap.querySelectorAll("[data-atp]").forEach(b => b.onclick = () => {
    const [day, slot] = b.dataset.atp.split("|");
    const replaced = planStore.get(day, slot);
    planStore.set(day, slot, { id: r.id, serves: servingsFor(r) });
    close();
    toast(`${replaced ? "Swapped in" : "Added"} for ${dayShort(day)} ${SLOT_NAME[slot].toLowerCase()}`);
  });
}
const i18nDay = (day, today) => day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : dayTitle(day);

function openAutoPlan(monday) {
  const today = todayISO();
  const emptyCount = s => weekDays(monday).filter(d => d >= today && !planStore.get(d, s)).length;
  const counts = Object.fromEntries(SLOTS.map(s => [s, emptyCount(s)]));
  const pre = { breakfast: false, lunch: true, dinner: true };
  const wrap = sheetShell(`
      <h3 class="sheet-title">${ic("spark")}Plan my week for me</h3>
      <p class="sheet-copy">FoodLit fills the <b>empty</b> slots from today on with dishes that suit the meal, use what's in your pantry, don't repeat, and mix cuisines. Anything you've planned stays.</p>
      <div class="ap-slots">
        ${SLOTS.map(s => `
          <label class="ap-slot">
            <input type="checkbox" data-ap="${s}" ${pre[s] && counts[s] ? "checked" : ""} ${counts[s] ? "" : "disabled"} />
            <span class="ap-box">${ic("check")}</span>
            <span class="ap-name">${SLOT_NAME[s]}</span>
            <span class="ap-count">${counts[s] ? `${plural(counts[s], "empty slot")}` : "all planned"}</span>
          </label>`).join("")}
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost grow" data-close>Cancel</button>
        <button class="btn btn-primary grow" data-ap-go>${ic("spark")}Fill my week</button>
      </div>`);
  const close = Motion.sheet(wrap);
  wrap.querySelector("[data-close]").onclick = close;
  wrap.querySelector("[data-ap-go]").onclick = () => {
    const slots = [...wrap.querySelectorAll("[data-ap]:checked")].map(c => c.dataset.ap);
    if (!slots.length) { toast("Pick at least one meal to fill"); return; }
    const before = JSON.stringify(planStore.all);
    const filled = autoPlan(monday, slots);
    close();
    state.planUndo = filled.length ? { before, count: filled.length } : null;
    render();
    toast(filled.length ? `Planned ${plural(filled.length, "meal")} — tap any to swap` : "Nothing to fill — those slots are already planned");
  };
}

async function sharePlan(monday) {
  const text = planShareText(monday);
  if (navigator.share) { try { await navigator.share({ title: "My meal plan", text }); return; } catch (e) { if (e?.name === "AbortError") return; } }
  if (await copyText(text)) toast("Plan copied — paste it in WhatsApp or anywhere");
  else showListSheet(text, "Your meal plan");
}

// ---------- events (called from app.js bind()) ----------
function bindPlanner() {
  const $ = s => $app.querySelectorAll(s);
  $("[data-plan-mode]").forEach(b => b.onclick = () => { state.planMode = b.dataset.planMode; render(); });
  $("[data-week-go]").forEach(b => b.onclick = () => {
    state.planWeek = addDays(state.planWeek || mondayOf(todayISO()), Number(b.dataset.weekGo));
    state.planUndo = null;
    render();
  });
  $("[data-week-today]").forEach(b => b.onclick = () => { state.planWeek = mondayOf(todayISO()); state.planUndo = null; render(); });
  $("[data-month-go]").forEach(b => b.onclick = () => { state.planMonth = b.dataset.monthGo; render(); });
  $("[data-month-day]").forEach(b => b.onclick = () => {
    const day = b.dataset.monthDay;
    state.planMode = "week";
    state.planWeek = mondayOf(day);
    render();
    setTimeout(() => document.getElementById(`day-${day}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  });
  $("[data-slot-add]").forEach(b => b.onclick = () => { const [d, s] = b.dataset.slotAdd.split("|"); openSlotPicker(d, s); });
  $("[data-slot-open]").forEach(b => b.onclick = () => { const [d, s] = b.dataset.slotOpen.split("|"); openSlotActions(d, s); });
  $("[data-plan-auto]").forEach(b => b.onclick = () => openAutoPlan(state.planWeek || mondayOf(todayISO())));
  $("[data-plan-undo]").forEach(b => b.onclick = () => {
    planStore.save(JSON.parse(state.planUndo.before));
    state.planUndo = null;
    render();
    toast("Plan restored");
  });
  $("[data-plan-list]").forEach(b => b.onclick = () => go("planlist"));
  $("[data-plan-share]").forEach(b => b.onclick = () => sharePlan(state.planWeek || mondayOf(todayISO())));
  $("[data-plan-app]").forEach(b => b.onclick = () => { state.planApp = b.dataset.planApp; render(); });
  $("[data-plan-cook]").forEach(b => b.onclick = () => {
    const [d, s] = b.dataset.planCook.split("|");
    const e = planStore.get(d, s);
    state.servings[e.id] = e.serves;
    go("recipe", { recipeId: e.id, selectedApp: null });
  });
  // Recipe page: ♡ save, add to plan, notes.
  $("[data-fav]").forEach(b => b.onclick = () => {
    const on = cookbook.toggle(b.dataset.fav);
    render();
    toast(on ? "Saved to your cookbook" : "Removed from your cookbook");
  });
  $("[data-add-plan]").forEach(b => b.onclick = () => openAddToPlan(recipeById(b.dataset.addPlan)));
  const note = $app.querySelector("#note-input");
  if (note) {
    let timer;
    const saveNote = () => { cookbook.setNote(note.dataset.recipe, note.value); };
    note.oninput = () => { clearTimeout(timer); timer = setTimeout(saveNote, 500); };
    note.onblur = () => { clearTimeout(timer); saveNote(); };
  }
}
