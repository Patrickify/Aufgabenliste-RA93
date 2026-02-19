// --- 1. FIREBASE IMPORTE FÜR PUSH-NACHRICHTEN ---
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

// Firebase initialisieren (im Hintergrund)
firebase.initializeApp({
  apiKey: "AIzaSyCPTt1ZZ-lj5qZ1Rrn-N7e5QZnhtXB-Pu8",
  authDomain: "aufgabenliste-zdl-ra-93.firebaseapp.com",
  projectId: "aufgabenliste-zdl-ra-93",
  storageBucket: "aufgabenliste-zdl-ra-93.firebasestorage.app",
  messagingSenderId: "857214150388",
  appId: "1:857214150388:web:8bc019911092be0cffe0a1"
});

const messaging = firebase.messaging();

// Wenn die App im Hintergrund oder geschlossen ist, Pushes anzeigen
messaging.onBackgroundMessage(function(payload) {
  console.log('Background Push empfangen: ', payload);
  const notificationTitle = payload.notification.title || "RA 93 Pro";
  const notificationOptions = {
    body: payload.notification.body,
    icon: './icon-192.png',
    badge: './icon-192.png'
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

// --- 2. DEIN OFFLINE CACHE & APP-LOGIK ---
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
  if (e.request.url.startsWith('http')) {
    e.respondWith((async()=>{
      try {
        const cached = await caches.match(e.request);
        if(cached) return cached;
        return await fetch(e.request);
      } catch(err) {
        if (e.request.mode === 'navigate') {
          return caches.match("./index.html");
        }
      }
    })());
  }
});

/* Auf Klick der Benachrichtigung reagieren */
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
