// FoodLit service worker — network-first with cache fallback, so the
// app always picks up fresh code when online but still opens offline.
const CACHE = "stc-v17";
const ASSETS = ["./", "./index.html", "./styles.css?v=17", "./app.js?v=17", "./motion.js?v=17", "./data.js?v=17", "./credits.js?v=17", "./manifest.webmanifest", "./favicon.ico", "./icon.svg", "./icon-180.png", "./icon-512.png",
  "./img/aglio-olio.jpg", "./img/aloo-gobi.jpg", "./img/aloo-paratha.jpg", "./img/baingan-bharta.jpg", "./img/bhindi-masala.jpg", "./img/butter-chicken.jpg", "./img/chicken-curry.jpg", "./img/chicken-quesadilla.jpg", "./img/chicken-steak.jpg", "./img/chilli-paneer.jpg", "./img/chole-masala.jpg", "./img/dal-makhani.jpg", "./img/dal-tadka.jpg", "./img/egg-bhurji.jpg", "./img/french-toast.jpg", "./img/grilled-fish.jpg", "./img/grilled-sandwich.jpg", "./img/hakka-noodles.jpg", "./img/kadhai-paneer.jpg", "./img/kadhi-pakora.jpg", "./img/matar-paneer.jpg", "./img/mushroom-alfredo.jpg", "./img/palak-paneer.jpg", "./img/paneer-butter-masala.jpg", "./img/paneer-tikka.jpg", "./img/poha.jpg", "./img/rajma-burrito-bowl.jpg", "./img/rajma.jpg", "./img/thai-green-curry.jpg", "./img/tomato-penne.jpg", "./img/upma.jpg", "./img/veg-pulao.jpg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Same-origin GETs only — Anthropic API calls pass straight through.
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
