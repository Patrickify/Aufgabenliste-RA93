const CACHE = "ra93-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    for(const a of ASSETS){
      try{ await cache.add(a); }catch(err){}
    }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k===CACHE ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  e.respondWith((async()=>{
    try{
      const cached = await caches.match(e.request);
      if(cached) return cached;
      const res = await fetch(e.request);
      return res;
    }catch(err){
      return caches.match("./index.html");
    }
  })());
});
