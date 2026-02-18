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

// Installation: Alles in den Cache laden
self.addEventListener("install", (e) => {
  e.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    for(const a of ASSETS){
      try{ await cache.add(a); } catch(err){ console.warn("Cache Fehler:", a); }
    }
    self.skipWaiting();
  })());
});

// Aktivierung: Alte Caches löschen
self.addEventListener("activate", (e) => {
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k === CACHE ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

// Fetch: Netzwerk-Anfragen bearbeiten
self.addEventListener("fetch", (e) => {
  // Verhindert Fehler bei Anfragen an andere Domains (wie Firebase)
  if (e.request.url.startsWith('http')) {
    e.respondWith((async()=>{
      try {
        const cached = await caches.match(e.request);
        if(cached) return cached;
        return await fetch(e.request);
      } catch(err) {
        // Nur bei HTML-Anfragen die index.html zurückgeben
        if (e.request.mode === 'navigate') {
          return caches.match("./index.html");
        }
      }
    })());
  }
});

/* --- NEU: Auf Klick der Benachrichtigung reagieren --- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // Nachricht schließen
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Wenn die App schon offen ist, fokussieren
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) return client.focus();
      }
      // Sonst App neu öffnen
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
