// FoodLit service worker — network-first with cache fallback, so the
// app always picks up fresh code when online but still opens offline.
const CACHE = "stc-v21";
const ASSETS = ["./", "./index.html", "./styles.css?v=21", "./app.js?v=21", "./motion.js?v=21", "./data.js?v=21", "./credits.js?v=21", "./manifest.webmanifest", "./favicon.ico", "./icon.svg", "./icon-180.png", "./icon-512.png",
  "./img/aglio-olio.jpg", "./img/aloo-gobi.jpg", "./img/aloo-paratha.jpg", "./img/arrabbiata.jpg", "./img/baingan-bharta.jpg", "./img/banana-pancakes.jpg", "./img/bean-quesadilla.jpg", "./img/besan-chilla.jpg", "./img/bhindi-masala.jpg", "./img/butter-chicken.jpg", "./img/chana-salad.jpg", "./img/chicken-biryani.jpg", "./img/chicken-curry.jpg", "./img/chicken-fajitas.jpg", "./img/chicken-quesadilla.jpg", "./img/chicken-salad.jpg", "./img/chicken-skewers.jpg", "./img/chicken-steak.jpg", "./img/chicken-wrap.jpg", "./img/chilli-chicken.jpg", "./img/chilli-paneer.jpg", "./img/chole-masala.jpg", "./img/corn-salad.jpg", "./img/dal-makhani.jpg", "./img/dal-tadka.jpg", "./img/egg-bhurji.jpg", "./img/egg-curry.jpg", "./img/egg-fried-rice.jpg", "./img/french-toast.jpg", "./img/grilled-fish.jpg", "./img/grilled-sandwich.jpg", "./img/hakka-noodles.jpg", "./img/jeera-rice.jpg", "./img/kadhai-paneer.jpg", "./img/kadhi-pakora.jpg", "./img/lemon-rice.jpg", "./img/mac-cheese.jpg", "./img/masala-oats.jpg", "./img/masala-omelette.jpg", "./img/masoor-dal.jpg", "./img/matar-paneer.jpg", "./img/mexican-rice.jpg", "./img/minestrone.jpg", "./img/mix-veg.jpg", "./img/moong-chilla.jpg", "./img/mushroom-alfredo.jpg", "./img/mushroom-masala.jpg", "./img/mushroom-soup.jpg", "./img/overnight-oats.jpg", "./img/palak-paneer.jpg", "./img/paneer-bhurji.jpg", "./img/paneer-butter-masala.jpg", "./img/paneer-tikka.jpg", "./img/pb-toast.jpg", "./img/poha.jpg", "./img/quinoa-bowl.jpg", "./img/rajma-burrito-bowl.jpg", "./img/rajma.jpg", "./img/saute-veggies.jpg", "./img/scrambled-eggs.jpg", "./img/sprouts-salad.jpg", "./img/tandoori-chicken.jpg", "./img/thai-green-curry.jpg", "./img/tofu-stir-fry.jpg", "./img/tomato-penne.jpg", "./img/upma.jpg", "./img/veg-pulao.jpg", "./img/veg-skewers.jpg"];

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
