/* Lift Log service worker — offline cache */
const CACHE = "liftlog-v18";
const SHELL = "./index.html";
const ASSETS = [
  "./",
  "./index.html",
  "./exercises.js",
  "./vendor/supabase.js",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for the app shell. Network-first used to stall on a
// weak signal — the request neither resolves nor rejects, so the app hung on
// exactly the flaky gym wifi it most needs to work on. Now the cached shell
// paints immediately and the network refresh lands in the background.
self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  // Only ever touch our own assets. Supabase REST reads are GETs too, and
  // caching those would serve stale workouts and stale coaching plans.
  if(new URL(req.url).origin !== location.origin) return;
  e.respondWith(staleWhileRevalidate(req));
});

async function staleWhileRevalidate(req){
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(req) || (req.mode === "navigate" ? await cache.match(SHELL) : null);

  const fresh = fetch(req).then(async res => {
    if(res && res.ok){
      // tell open clients when the shell itself actually changed, so a user
      // sitting on a stale version finds out instead of guessing
      if(cached && isShell(req)) {
        const [before, after] = await Promise.all([cached.clone().text(), res.clone().text()]);
        if(before !== after) notifyClients();
      }
      cache.put(req, res.clone());
    }
    return res;
  }).catch(() => null);

  if(cached) return cached;                       // instant paint, refresh behind it

  const res = await withTimeout(fresh, 3000);
  return res || await cache.match(SHELL) || new Response("Offline", {status:503});
}

function isShell(req){
  const p = new URL(req.url).pathname;
  return req.mode === "navigate" || p.endsWith("/index.html") || p.endsWith("/");
}

function withTimeout(promise, ms){
  return Promise.race([promise, new Promise(r => setTimeout(() => r(null), ms))]);
}

async function notifyClients(){
  const cs = await self.clients.matchAll({ type:"window" });
  for(const c of cs) c.postMessage({ type:"update-ready" });
}
