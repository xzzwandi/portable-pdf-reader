const DEFAULT_CACHE_LIMIT = 24;
const DEFAULT_MAX_DIMENSION = 320;
const DEFAULT_TIMEOUT_MS = 8_000;

function boundedOption(value, fallback, maximum) {
  return Number.isFinite(value) && value > 0 ? Math.min(maximum, Math.max(1, Math.floor(value))) : fallback;
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  // Removing the attributes would allocate the default 300 x 150 bitmap again.
  canvas.width = 0;
  canvas.height = 0;
}

function cancellationError() {
  const error = new Error("Thumbnail request cancelled");
  error.name = "AbortError";
  return error;
}

function waitForOperation(operation, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); reject(cancellationError()); };
    // Keep rejection handlers attached to an unabortable PDF.js getPage call,
    // including after a newer request has stopped waiting for its result.
    Promise.resolve(operation).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      const error = new Error(`Thumbnail operation timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });
}

/**
 * Independent, low-resolution PDF thumbnails. The caller supplies its nearby
 * candidate pages in priority order and copies canvases received by callback.
 * Canvas ownership stays with this bounded cache; eviction or clear releases it.
 * request() resolves when that batch finishes or is superseded/cancelled.
 */
export function createPdfThumbnailCache(options = {}) {
  const createCanvas = options.createCanvas || (() => document.createElement("canvas"));
  const cacheLimit = boundedOption(options.cacheLimit, DEFAULT_CACHE_LIMIT, 32);
  const maxDimension = boundedOption(options.maxDimension, DEFAULT_MAX_DIMENSION, 320);
  const timeoutMs = boundedOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, 30_000);
  const cache = new Map();
  let pdfDocument = null;
  let generation = 0;
  let activeBatch = null;
  let activeRender = null;
  let draining = false;

  function current(batch) {
    return activeBatch === batch && pdfDocument === batch.document &&
      generation === batch.generation && !batch.controller.signal.aborted;
  }

  function notify(batch, callback, page, value) {
    if (!current(batch)) return;
    try { batch.handlers[callback]?.(page, value); } catch {
      // A consumer error must not stall the remaining thumbnail queue.
    }
  }

  function remember(page, canvas) {
    const previous = cache.get(page);
    if (previous && previous !== canvas) releaseCanvas(previous);
    cache.delete(page);
    cache.set(page, canvas);
    while (cache.size > cacheLimit) {
      const oldest = cache.keys().next().value;
      releaseCanvas(cache.get(oldest));
      cache.delete(oldest);
    }
  }

  async function renderThumbnail(batch, pageNumber) {
    let canvas = null;
    let job = null;
    let retained = false;
    try {
      const page = await waitForOperation(batch.document.getPage(pageNumber), batch.controller.signal, timeoutMs);
      if (!current(batch)) return null;
      const base = page.getViewport({ scale: 1 });
      const longestEdge = Math.max(base.width, base.height);
      if (!Number.isFinite(longestEdge) || longestEdge <= 0 || base.width <= 0 || base.height <= 0) {
        throw new Error("Invalid PDF page dimensions");
      }
      const viewport = page.getViewport({ scale: maxDimension / longestEdge });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
        throw new Error("Invalid PDF thumbnail dimensions");
      }
      canvas = createCanvas();
      canvas.width = Math.max(1, Math.min(maxDimension, Math.ceil(viewport.width)));
      canvas.height = Math.max(1, Math.min(maxDimension, Math.ceil(viewport.height)));
      const canvasContext = canvas.getContext("2d", { alpha: false });
      if (!canvasContext) throw new Error("Canvas rendering is unavailable");
      const task = page.render({ canvasContext, viewport, background: "#ffffff" });
      job = { batch, task };
      activeRender = job;
      if (!task?.promise) throw new Error("PDF thumbnail render did not start");
      await waitForOperation(task.promise, batch.controller.signal, timeoutMs);
      if (!current(batch)) return null;
      remember(pageNumber, canvas);
      retained = true;
      return canvas;
    } catch (error) {
      try { job?.task?.cancel?.(); } catch { /* Best-effort cancellation of our own render only. */ }
      throw error;
    } finally {
      if (activeRender === job) activeRender = null;
      if (!retained) releaseCanvas(canvas);
      // Never call PDFPageProxy.cleanup(): the reader may be rendering the same
      // page concurrently. Only this request's task and canvas belong to us.
    }
  }

  async function drain() {
    try {
      while (activeBatch && pdfDocument) {
        const batch = activeBatch;
        if (batch.index >= batch.pages.length) {
          activeBatch = null;
          batch.finish();
          continue;
        }
        const page = batch.pages[batch.index++];
        const cached = cache.get(page);
        if (cached) {
          cache.delete(page);
          cache.set(page, cached);
          notify(batch, "onThumbnail", page, cached);
          continue;
        }
        try {
          const canvas = await renderThumbnail(batch, page);
          if (canvas) notify(batch, "onThumbnail", page, canvas);
        } catch (error) {
          if (error?.name !== "AbortError") notify(batch, "onError", page, error);
        }
      }
    } finally {
      draining = false;
      if (activeBatch) startDrain();
    }
  }

  function startDrain() {
    if (draining) return;
    draining = true;
    // Cache hits follow the same asynchronous callback contract as rendering.
    Promise.resolve().then(drain);
  }

  function cancel() {
    generation += 1;
    const batch = activeBatch;
    activeBatch = null;
    try { activeRender?.task?.cancel?.(); } catch { /* The task may have already finished. */ }
    if (batch) {
      batch.controller.abort();
      batch.finish();
    }
  }

  function clear() {
    cancel();
    for (const canvas of cache.values()) releaseCanvas(canvas);
    cache.clear();
    pdfDocument = null;
  }

  function setDocument(nextDocument) {
    if (pdfDocument === nextDocument) return;
    clear();
    pdfDocument = nextDocument || null;
  }

  function request(pages, handlers = {}) {
    cancel();
    if (!pdfDocument) return Promise.resolve();
    const candidates = [...new Set(Array.from(pages || []).filter(
      (page) => Number.isInteger(page) && page >= 1 && page <= pdfDocument.numPages,
    ))];
    if (!candidates.length) return Promise.resolve();
    let finish;
    const completed = new Promise((resolve) => { finish = resolve; });
    activeBatch = { pages: candidates, index: 0, handlers, document: pdfDocument, generation, controller: new AbortController(), finish };
    startDrain();
    return completed;
  }

  return { setDocument, request, cancel, clear };
}
