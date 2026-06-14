const CACHE_NAME = "jobvisto-app-v24";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.html",
  "./portal-clientes.html",
  "./portal-cleaners.html",
  "./styles.css",
  "./script.js",
  "./app.css",
  "./app.js?v=9",
  "./manifest.webmanifest",
  "./assets/Logo Jobvisto.png",
  "./assets/Logo Jobvisto white transparent.png",
  "./assets/jobvisto-icon-192.png",
  "./assets/jobvisto-icon-512.png",
  "./assets/meir.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Avoid intercepting chrome-extension or external analytics calls
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache the fresh version for offline use
        if (response.status === 200) {
          const cacheCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cacheCopy);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline fallback: check cache
        return caches.match(event.request).then((cached) => {
          return cached || caches.match("./app.html");
        });
      })
  );
});
