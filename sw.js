const CACHE_PREFIX = "portable-pdf-reader-";
const CACHE_NAME = "portable-pdf-reader-v116";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=116",
  "./app.js?v=116",
  "./src/constants.js?v=116",
  "./src/encryption.js?v=116",
  "./src/encrypted-backups.js?v=116",
  "./src/pdf-sources.js?v=116",
  "./src/pdf-tools.js?v=116",
  "./src/pdf-tools.css?v=116",
  "./src/utils.js?v=116",
  "./src/export-blobs.js?v=116",
  "./src/export-worker.js?v=116",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./vendor/jszip/jszip.min.js?v=116",
  "./vendor/epubjs/epub.min.js?v=116",
  "./vendor/pdfjs/pdf.min.mjs",
  "./vendor/pdfjs/pdf.worker.mjs?v=116",
  "./vendor/libsodium/libsodium-wrappers.mjs",
  "./vendor/libsodium/libsodium-sumo.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin || url.pathname.endsWith("/sw.js")) {
    return;
  }

  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    }),
  );
});
