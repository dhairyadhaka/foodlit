// ---------------------------------------------------------------
// FoodLit — cost to cook, worked out from grocery prices.
//
// For each ingredient line: how much of the pack does the dish use?
// ("1 cup toor dal" ≈ 200 g of a 500 g pack = 40%), times the cheapest
// current price for that pack across the apps. Because it reads the live
// CATALOG prices, the cost updates whenever prices are re-checked.
//
// Kitchen measures are converted with everyday rules of thumb (a cup of
// dal ≈ 200 g, a medium onion ≈ 120 g, a tsp of spice powder ≈ 2.5 g).
// They're approximations, but the same ones for every dish, so the
// cook-vs-order comparison stays fair. Loaded after data.js.
// ---------------------------------------------------------------

const Costs = (() => {
  // Grams in one cup, per ingredient (dry goods measured dry).
  const CUP_G = {
    "toor-dal": 200, "masoor-dal": 200, "moong-dal": 200, "urad-whole": 200, "urad-dal": 200,
    "kabuli-chana": 190, rajma: 190, "basmati-rice": 190, quinoa: 170, sooji: 170, poha: 90, oats: 90,
    maida: 125, atta: 120, besan: 90, "green-peas": 140, "sweet-corn": 150, peanuts: 145, macaroni: 100,
    "tomato-puree": 240, curd: 240, milk: 240, cream: 240, "olive-oil": 220, mozzarella: 110, parmesan: 100,
    coriander: 20, mint: 20, cabbage: 70,
  };
  // Cooked / boiled cups are mostly water: count the dry weight that went in.
  const COOKED_CUP_G = { "basmati-rice": 65, rajma: 80, "kabuli-chana": 80 };
  // Weight of one spoon for light, dry things; everything else is ~1 g per ml.
  const TSP_G = {
    turmeric: 2.5, "chilli-powder": 2.5, "coriander-pdr": 2, "garam-masala": 2, "chole-masala": 2, cumin: 2,
    "mustard-seeds": 3, "black-pepper": 2.5, cinnamon: 2.5, "biryani-masala": 2, "tandoori-masala": 2.5,
    "italian-herbs": 1, "chilli-flakes": 1.5, "kasuri-methi": 1, cornflour: 3, "baking-powder": 4, sugar: 4,
    salt: 6, maida: 3, besan: 3, coriander: 1.3, parmesan: 2, peanuts: 3, "urad-dal": 4,
  };
  // Grams per piece, by size word where it matters.
  const PIECE_G = {
    onion: { small: 70, medium: 120, large: 180, "": 120 },
    tomato: { small: 60, medium: 100, large: 150, "": 100 },
    potato: { small: 100, medium: 150, large: 200, boiled: 150, "": 150 },
    capsicum: { small: 100, medium: 150, large: 200, "": 150 },
    carrot: { small: 60, large: 130, "": 90 },
    cucumber: { "": 250 }, "green-chilli": { "": 5 }, cashews: { "": 1.5 },
    garlic: { clove: 5, cloves: 5, "": 5 }, bread: { slice: 20, slices: 20, "": 20 },
    "cheese-slices": { slice: 20, slices: 20, "": 20 }, "spring-onion": { stalk: 15, stalks: 15, bunch: 100, "": 15 },
  };
  // Packs sold by the piece: weight of one piece, for lines given in cups
  // or grams ("1 cup shredded cabbage" ≈ 70 g of a ~700 g cabbage).
  const PC_G = { cabbage: 700, lettuce: 400, broccoli: 300, cauliflower: 600, zucchini: 250 };
  // Packs that hold many small items: count per pack (a bunch ≈ 60 curry leaves).
  const PER_PACK = { "curry-leaves": 60 };
  // Packs sold by the piece: how much of one piece a line uses.
  const PIECE_WORDS = { head: 1, wraps: 1, sprig: 0.2, ripe: 1 };
  const FIXED = { // words with no number
    "to taste": 3, "a pinch": 0.5, "for frying": 30, "to serve": 15, "small bunch": 30,
    "a few leaves": 0.2, "1 bunch": 1,
  };

  function num(t) {
    t = t.trim();
    let m = t.match(/^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)/); // range: average
    if (m) return (+m[1] + +m[2]) / 2;
    m = t.match(/^(\d+)\s*\/\s*(\d+)/); if (m) return +m[1] / +m[2];
    m = t.match(/^(\d+(?:\.\d+)?)/); return m ? +m[1] : null;
  }

  function pack(size) { // "500 g" → {n: 500, unit: "g"}
    const m = size.match(/([\d.]+)\s*(kg|g|ml|L|pc|bunch)/i);
    if (!m) return { n: 1, unit: "pc" };
    const u = m[2].toLowerCase();
    if (u === "kg") return { n: +m[1] * 1000, unit: "g" };
    if (u === "l") return { n: +m[1] * 1000, unit: "g" };
    if (u === "ml") return { n: +m[1], unit: "g" };
    return { n: +m[1], unit: u === "bunch" ? "pc" : u === "g" ? "g" : "pc" };
  }

  // How much of the pack's unit (grams, or pieces) one ingredient line uses.
  function used(key, qtyRaw, p) {
    const q = String(qtyRaw).toLowerCase();
    const paren = q.match(/\((\d+(?:\.\d+)?)\s*(g|kg)\)/); // "2 bunches (500 g)"
    if (paren && p.unit === "g") return +paren[1] * (paren[2] === "kg" ? 1000 : 1);
    for (const [phrase, v] of Object.entries(FIXED)) {
      if (q.startsWith(phrase)) {
        if (key === "coriander" && phrase === "small bunch") return 30;
        if (p.unit === "pc") return phrase === "a few leaves" ? 0.2 : phrase === "1 bunch" ? 1 : 0.1;
        return phrase === "1 bunch" ? p.n : v;
      }
    }
    const n = num(q);
    if (n == null) return null;
    const rest = q.replace(/^[\d.\s/–-]+/, "");
    const word = (rest.match(/^[a-z]+/) || [""])[0];
    if (/^(kg|g|ml|l)\b/.test(rest)) return n * (/^(kg|l)\b/.test(rest) ? 1000 : 1);
    if (word === "cup" || word === "cups") {
      const cooked = /cooked|boiled|to serve/.test(rest) && COOKED_CUP_G[key];
      const g = n * (cooked || CUP_G[key] || 200);
      return p.unit === "pc" ? g / (PC_G[key] || 500) : g;
    }
    if (word === "tbsp") return n * 3 * (TSP_G[key] || 5);
    if (word === "tsp") return n * (TSP_G[key] || 5);
    if (p.unit === "pc" && PER_PACK[key] && !PIECE_WORDS[word]) return n / PER_PACK[key];
    if (p.unit === "pc") return n * (PIECE_WORDS[word] ?? 1);
    const pieces = PIECE_G[key];
    if (pieces) return n * (pieces[word] ?? pieces[""]);
    return null;
  }

  const cheapest = sku => {
    const ps = Object.values(sku.prices).filter(v => v != null);
    return ps.length ? Math.min(...ps) : null;
  };

  // Rupees for one ingredient line at the recipe's base servings.
  function lineCost(ing) {
    if (!ing.key || !CATALOG[ing.key]) return 0; // garnish/extras with no shop item
    const sku = CATALOG[ing.key];
    const price = cheapest(sku);
    if (price == null) return 0;
    const p = pack(sku.size);
    const u = used(ing.key, ing.qty, p);
    if (u == null) return price * 0.25; // unreadable amount: assume a quarter pack
    return price * (u / p.n);
  }

  // Cost to cook the recipe for its base servings, rounded to ₹5.
  function cookCost(r) {
    const total = r.ingredients.reduce((s, ing) => s + lineCost(ing), 0);
    return Math.max(5, Math.round(total / 5) * 5);
  }

  return { cookCost, lineCost, used, pack };
})();
