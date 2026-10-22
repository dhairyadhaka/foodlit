// ---------------------------------------------------------------
// FoodLit — motion layer. Zero dependencies, offline-safe.
//
// Built on the platform rather than a library so the PWA keeps
// working with no network:
//   • View Transitions API  — screen changes + shared-element morphs
//                             (dish card photo → recipe hero → basket)
//   • Web Animations API    — staggered entrances, split-text reveals
//   • CSS scroll timelines  — reveals/parallax (see styles.css)
//
// Timing follows Emil Kowalski's rules (ease-out by default, UI under
// ~300ms, transform/opacity only, interruptible). Spring curves are
// pre-baked `linear()` easings (Jake Archibald / Adam Argyle technique).
// Rolling digits are a vanilla take on barvian/number-flow.
// ---------------------------------------------------------------

const Motion = (() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
  const SHEET = "cubic-bezier(0.32, 0.72, 0, 1)";

  // ---------- view transitions ----------

  // Elements opt in with data-vt="<name>". Only on-screen ones get the
  // name, so a 33-card grid doesn't snapshot cards nobody can see, and
  // duplicates (two guesses mapping to one recipe) are skipped — a
  // duplicate name would abort the whole transition.
  function tagShared() {
    const seen = new Set();
    document.querySelectorAll("[data-vt]").forEach(el => {
      const name = el.dataset.vt;
      const r = el.getBoundingClientRect();
      const onScreen = r.bottom > -80 && r.top < innerHeight + 80 && r.width > 0;
      if (onScreen && !seen.has(name)) { seen.add(name); el.style.viewTransitionName = name; }
      else el.style.viewTransitionName = "none";
    });
  }

  let token = 0;
  // types: ["nav", "forward"|"back"] or ["update"]. Exposed to CSS as
  // html[data-vt-type~="…"] — works on every browser with the callback form.
  function transition(update, types) {
    if (!document.startViewTransition || reduced.matches) { update(); return; }
    const html = document.documentElement;
    const mine = ++token;
    tagShared();
    html.dataset.vtType = types.join(" ");
    const vt = document.startViewTransition(() => { update(); tagShared(); });
    // A skipped transition (tab hidden, a newer one started) rejects these;
    // the DOM update still happens, so there's nothing to report.
    vt.ready.catch(() => {});
    vt.updateCallbackDone.catch(() => {});
    vt.finished.catch(() => {}).finally(() => { if (mine === token) delete html.dataset.vtType; });
  }

  // ---------- entrances ----------

  function enter(root) {
    if (reduced.matches) return;
    let i = 0;
    root.querySelectorAll("[data-enter]").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top > innerHeight + 40) return; // below the fold: scroll reveal handles it
      el.animate([
        { opacity: 0, transform: "translateY(12px)" },
        { opacity: 1, transform: "none" },
      ], { duration: 520, delay: 40 + i++ * 45, easing: EASE_OUT, fill: "backwards" });
    });
    root.querySelectorAll("[data-split]").forEach(splitReveal);
  }

  // Word-by-word blur-rise (react-bits "Blur Text", done with WAAPI).
  function splitReveal(el) {
    if (el.dataset.splitDone) return;
    el.dataset.splitDone = "1";
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute("aria-label", el.textContent.trim());
    el.innerHTML = words.map(w => `<span class="w" aria-hidden="true"><span>${w}</span></span>`).join(" ");
    el.querySelectorAll(".w > span").forEach((s, i) => s.animate([
      { transform: "translateY(60%)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ], { duration: 600, delay: 80 + i * 50, easing: EASE_OUT, fill: "backwards" }));
  }

  // ---------- rolling numbers ----------

  // Any [data-roll="key"] element rolls its digits from the value it had
  // last render (or from zeros on a fresh screen) to the new one. Each
  // digit is a 0–9 column translated with a spring transition.
  const lastText = new Map();
  function roll(root, fresh) {
    root.querySelectorAll("[data-roll]").forEach(el => {
      const key = el.dataset.roll;
      const next = el.textContent.trim();
      let prev = !fresh && lastText.has(key) ? lastText.get(key) : next.replace(/\d/g, "0");
      lastText.set(key, next);
      if (reduced.matches) return;
      prev = prev.length >= next.length ? prev.slice(prev.length - next.length) : prev.padStart(next.length, " ");
      el.textContent = "";
      el.classList.add("roll");
      const sr = document.createElement("span");
      sr.className = "sr-only"; sr.textContent = next;
      el.appendChild(sr);
      const cols = [];
      [...next].forEach((ch, i) => {
        if (!/\d/.test(ch)) {
          const s = document.createElement("span");
          s.setAttribute("aria-hidden", "true"); s.textContent = ch;
          el.appendChild(s);
          return;
        }
        const dg = document.createElement("span");
        dg.className = "dg"; dg.setAttribute("aria-hidden", "true");
        const col = document.createElement("span");
        col.className = "dg-col";
        col.innerHTML = "0123456789".split("").map(d => `<span>${d}</span>`).join("");
        const from = /\d/.test(prev[i]) ? +prev[i] : 0;
        col.style.transform = `translateY(${-from * 10}%)`;
        col.style.transitionDelay = `${(next.length - i) * 35}ms`;
        dg.appendChild(col);
        el.appendChild(dg);
        cols.push([col, +ch]);
      });
      requestAnimationFrame(() => requestAnimationFrame(() =>
        cols.forEach(([col, d]) => { col.style.transform = `translateY(${-d * 10}%)`; })));
    });
  }

  // ---------- tweened custom properties ----------

  // [data-tween="key"] with style="--v: 0.42": bars, checkboxes and meters
  // animate from their previous value instead of snapping on re-render.
  const lastV = new Map();
  function tween(root, fresh) {
    root.querySelectorAll("[data-tween]").forEach(el => {
      const key = el.dataset.tween;
      const next = el.style.getPropertyValue("--v").trim() || "0";
      const prev = !fresh && lastV.has(key) ? lastV.get(key) : (el.dataset.tweenFrom ?? "0");
      lastV.set(key, next);
      if (prev === next || reduced.matches) return;
      el.style.setProperty("--v", prev);
      el.getBoundingClientRect();
      requestAnimationFrame(() => el.style.setProperty("--v", next));
    });
  }

  // Run after every paint of #app.
  function afterPaint(root, { fresh }) {
    roll(root, fresh);
    tween(root, fresh);
    if (fresh) enter(root);
  }

  // ---------- one-shot effects ----------

  // Camera shutter: an iris closes and reopens over the screen.
  function shutter() {
    if (reduced.matches) return;
    const el = document.createElement("div");
    el.className = "shutter";
    document.body.appendChild(el);
    el.animate([
      { clipPath: "circle(150% at 50% 50%)", opacity: 1 },
      { clipPath: "circle(0% at 50% 50%)", opacity: 1, offset: 0.45 },
      { clipPath: "circle(0% at 50% 50%)", opacity: 1, offset: 0.55 },
      { clipPath: "circle(150% at 50% 50%)", opacity: 0 },
    ], { duration: 520, easing: "cubic-bezier(0.65, 0, 0.35, 1)" }).finished.finally(() => el.remove());
  }

  function confetti() {
    if (reduced.matches) return;
    const c = document.createElement("canvas");
    c.className = "confetti";
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    document.body.appendChild(c);
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const colors = ["--terracotta", "--tomato", "--leaf", "--butter"].map(v => css.getPropertyValue(v).trim());
    const parts = Array.from({ length: 90 }, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const v = 9 + Math.random() * 9;
      return {
        x: innerWidth / 2, y: innerHeight - 90,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        c: colors[(Math.random() * colors.length) | 0],
      };
    });
    const t0 = performance.now();
    (function frame(t) {
      const age = (t - t0) / 1000;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1.1) / 0.6);
      for (const p of parts) {
        p.vy += 0.38; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.scale(1, Math.cos(p.r * 2));
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (age < 1.7) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  // ---------- bottom sheet (vaul-inspired) ----------

  function sheet(wrap) {
    document.body.appendChild(wrap);
    const panel = wrap.querySelector(".modal");
    const close = () => closeSheet(wrap);
    wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    wrap._off = () => document.removeEventListener("keydown", onKey);
    // Drag the handle down to dismiss.
    const handle = wrap.querySelector(".sheet-handle");
    if (handle) {
      let y0 = null, dy = 0, tStart = 0;
      handle.addEventListener("pointerdown", e => {
        y0 = e.clientY; dy = 0; tStart = performance.now();
        handle.setPointerCapture(e.pointerId);
        panel.style.transition = "none";
      });
      handle.addEventListener("pointermove", e => {
        if (y0 == null) return;
        dy = Math.max(0, e.clientY - y0);
        panel.style.transform = `translateY(${dy}px)`;
      });
      handle.addEventListener("pointerup", () => {
        if (y0 == null) return;
        const v = dy / (performance.now() - tStart);
        y0 = null;
        panel.style.transition = "";
        if (dy > 110 || v > 0.6) close(); else panel.style.transform = "";
      });
    }
    return close;
  }

  function closeSheet(wrap) {
    if (!wrap.isConnected || wrap.dataset.closing) return;
    wrap.dataset.closing = "1";
    wrap._off && wrap._off();
    if (reduced.matches) { wrap.remove(); return; }
    const panel = wrap.querySelector(".modal");
    const cur = getComputedStyle(panel).transform;
    panel.animate([{ transform: cur === "none" ? "none" : cur }, { transform: "translateY(105%)" }],
      { duration: 360, easing: SHEET, fill: "forwards" });
    wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease", fill: "forwards" })
      .finished.finally(() => wrap.remove());
  }

  return { transition, afterPaint, enter, shutter, confetti, sheet, closeSheet, reduced };
})();
