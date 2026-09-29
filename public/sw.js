'use strict';

/* =====================================================================
   THE LAST VIBE — Service worker (PWA)
   Stratégie : stale-while-revalidate pour le shell (HTML/CSS/JS/icônes),
   réseau d'abord pour la navigation, jamais de cache sur :
     - /api/* (données vivantes : votes, cas, profil)
     - /events (SSE)
     - /og/*  (images de partage dynamiques)
     - /c/*   (pages SSR de partage)
   Les appels API en échec réseau renvoient le cache éventuel sinon
   une réponse "offline" JSON pour que le front bascule en mode local.
===================================================================== */

const CACHE = 'the-last-vibe-v5';
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/config.js',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/vendor/capacitor.js',
  '/vendor/local-notifications.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApiLike(url) {
  return url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/events') ||
    url.pathname.startsWith('/og/') ||
    url.pathname.startsWith('/c/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // CDN/tailwind : pas de cache
  if (isApiLike(url)) {
    event.respondWith(
      fetch(req).then((res) => res).catch(() => {
        if (url.pathname.startsWith('/api/')) {
          return new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return Response.error();
      })
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })()
  );
});