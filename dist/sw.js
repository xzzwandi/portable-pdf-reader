const CACHE_NAME = "portable-pdf-reader-v105";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=105",
  "./app.js?v=105",
  "./src/constants.js?v=105",
  "./src/encryption.js?v=105",
  "./src/encrypted-backups.js?v=105",
  "./src/pdf-sources.js?v=105",
  "./src/utils.js?v=105",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./vendor/jszip/jszip.min.js?v=46",
  "./vendor/epubjs/epub.min.js?v=46",
  "./vendor/pdfjs/pdf.min.mjs",
  "./vendor/pdfjs/pdf.worker.mjs?v=105",
  "./vendor/libsodium/libsodium-wrappers.mjs",
  "./vendor/libsodium/libsodium-sumo.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
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
