const CACHE_NAME = "jobvisto-app-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.html",
  "./styles.css",
  "./script.js",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/Logo Jobvisto.png",
  "./assets/Logo Jobvisto white transparent.png",
  "./assets/jobvisto-icon-192.png",
  "./assets/jobvisto-icon-512.png"
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

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).catch(() => caches.match("./app.html"))
    )
  );
});
