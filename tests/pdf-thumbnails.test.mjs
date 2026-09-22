import assert from "node:assert/strict";
import test from "node:test";
import { createPdfThumbnailCache } from "../src/pdf-thumbnails.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const noop = () => {};
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  const canvases = [];
  const loads = [];
  const renders = [];
  let cleanupCalls = 0;
  const createCanvas = () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ canvas }) };
    canvases.push(canvas);
    return canvas;
  };
  const page = (number, render = null, width = 612, height = 792) => ({
    pageNumber: number,
    getViewport: ({ scale }) => ({ width: width * scale, height: height * scale, scale }),
    cleanup: () => { cleanupCalls++; throw new Error("Thumbnail code must never clean up a shared PDF page"); },
    render(args) {
      renders.push({ page: number, canvas: args.canvasContext.canvas, viewport: args.viewport });
      return render ? render(args) : { promise: Promise.resolve(), cancel: noop };
    },
  });
  const doc = {
    numPages: 100,
    getPage(number) { loads.push(number); return Promise.resolve(page(number)); },
  };
  const cache = createPdfThumbnailCache({ createCanvas, ...options });
  cache.setDocument(doc);
  return { cache, doc, page, canvases, loads, renders, cleanupCount: () => cleanupCalls };
}

test("thumbnail work follows caller priority, renders serially, and never prefetches unrequested pages", async () => {
  const { cache, doc, page, canvases, loads, renders, cleanupCount } = fixture();
  const controls = new Map();
  let active = 0;
  let peak = 0;
  doc.getPage = (number) => {
    loads.push(number);
    const control = deferred();
    controls.set(number, control);
    return Promise.resolve(page(number, () => {
      active++;
      peak = Math.max(peak, active);
      return { promise: control.promise.finally(() => active--), cancel: noop };
    }));
  };
  const received = [];
  const pending = cache.request([4, 2, 4, 6, 0, 101, 2.5, "3"], { onThumbnail: (number) => received.push(number) });
  await flush();
  assert.deepEqual(loads, [4]);
  controls.get(4).resolve();
  await flush();
  assert.deepEqual(loads, [4, 2]);
  controls.get(2).resolve();
  await flush();
  assert.deepEqual(loads, [4, 2, 6]);
  controls.get(6).resolve();
  await pending;
  assert.equal(peak, 1);
  assert.deepEqual(received, [4, 2, 6]);
  assert.equal(cleanupCount(), 0);
  assert.equal(new Set(renders.map((entry) => entry.canvas)).size, 3);
  assert.ok(canvases.every((canvas) => Math.max(canvas.width, canvas.height) <= 320));
  cache.clear();
});

test("rapid dragging supersedes a stalled getPage without publishing its eventual result", async () => {
  const { cache, doc, page, loads, renders } = fixture();
  const slow = deferred();
  doc.getPage = (number) => { loads.push(number); return number === 1 ? slow.promise : Promise.resolve(page(number)); };
  const obsolete = [];
  const first = cache.request([1, 2], { onThumbnail: (number) => obsolete.push(number), onError: (number) => obsolete.push(number) });
  await flush();
  const latest = [];
  await cache.request([7], { onThumbnail: (number) => latest.push(number) });
  await first;
  slow.resolve(page(1));
  await flush();
  assert.deepEqual(loads, [1, 7]);
  assert.deepEqual(renders.map((entry) => entry.page), [7]);
  assert.deepEqual(obsolete, []);
  assert.deepEqual(latest, [7]);
  cache.clear();
});

test("superseding an active render cancels only the thumbnail task and discards late completion", async () => {
  const { cache, doc, page, canvases, cleanupCount } = fixture();
  const slow = deferred();
  const mainWork = deferred();
  const mainCanvas = { width: 1200, height: 1600 };
  let thumbnailCancels = 0;
  let mainReaderCancels = 0;
  const sharedPage = page(1, ({ canvasContext }) => canvasContext.canvas === mainCanvas
    ? { promise: mainWork.promise, cancel: () => mainReaderCancels++ }
    : { promise: slow.promise, cancel: () => thumbnailCancels++ });
  const mainReaderTask = sharedPage.render({ canvasContext: { canvas: mainCanvas }, viewport: sharedPage.getViewport({ scale: 2 }) });
  doc.getPage = (number) => Promise.resolve(number === 1 ? sharedPage : page(number));
  const obsolete = [];
  const first = cache.request([1], { onThumbnail: (number) => obsolete.push(number), onError: (number) => obsolete.push(number) });
  await flush();
  const abandonedCanvas = canvases[0];
  const latest = [];
  await cache.request([2], { onThumbnail: (number) => latest.push(number) });
  await first;
  assert.ok(thumbnailCancels >= 1);
  assert.equal(mainReaderCancels, 0);
  assert.equal(mainReaderTask.promise, mainWork.promise);
  assert.equal(cleanupCount(), 0);
  assert.equal(mainCanvas.width, 1200);
  assert.equal(abandonedCanvas.width, 0);
  assert.equal(abandonedCanvas.height, 0);
  slow.resolve();
  await flush();
  assert.deepEqual(obsolete, []);
  assert.deepEqual(latest, [2]);
  mainWork.resolve();
  cache.clear();
});

test("changing books releases cached bitmaps and suppresses all results from the previous document", async () => {
  const { cache, doc, page, canvases } = fixture();
  await cache.request([1]);
  const cached = canvases[0];
  const late = deferred();
  doc.getPage = () => late.promise;
  const obsolete = [];
  const first = cache.request([2], { onThumbnail: (number) => obsolete.push(number), onError: (number) => obsolete.push(number) });
  await flush();
  const newDoc = { numPages: 3, getPage: (number) => Promise.resolve(page(number)) };
  cache.setDocument(newDoc);
  assert.equal(cached.width, 0);
  assert.equal(cached.height, 0);
  const current = [];
  await cache.request([2], { onThumbnail: (number, canvas) => current.push({ number, canvas }) });
  await first;
  late.reject(new Error("old document was destroyed"));
  await flush();
  assert.deepEqual(obsolete, []);
  assert.equal(current.length, 1);
  assert.equal(current[0].number, 2);
  assert.ok(current[0].canvas.width > 0);
  cache.clear();
  assert.ok(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test("LRU eviction releases backing stores while cancel and setting the same document retain cache hits", async () => {
  const { cache, doc, canvases, loads } = fixture({ cacheLimit: 2 });
  await cache.request([1, 2]);
  const [one, two] = canvases;
  let cachedOne;
  await cache.request([1], { onThumbnail: (_page, canvas) => { cachedOne = canvas; } });
  assert.equal(cachedOne, one);
  await cache.request([3]);
  assert.equal(two.width, 0, "least recently used page 2 must be evicted");
  assert.ok(one.width > 0);
  cache.cancel();
  cache.setDocument(doc);
  await cache.request([1, 3]);
  assert.deepEqual(loads, [1, 2, 3]);
  await cache.request([2]);
  assert.deepEqual(loads, [1, 2, 3, 2]);
  assert.equal(one.width, 0);
  assert.equal(canvases.filter((canvas) => canvas.width > 0).length, 2);
  cache.clear();
  assert.ok(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test("even cached callbacks are asynchronous and cancel prevents a queued cache-hit callback", async () => {
  const { cache, loads } = fixture();
  await cache.request([1]);
  let insideRequest = true;
  let callbacks = 0;
  const pending = cache.request([1], { onThumbnail: () => { assert.equal(insideRequest, false); callbacks++; } });
  assert.equal(callbacks, 0);
  insideRequest = false;
  await pending;
  assert.equal(callbacks, 1);
  const cancelled = cache.request([1], { onThumbnail: () => callbacks++ });
  cache.cancel();
  await cancelled;
  await flush();
  assert.equal(callbacks, 1);
  assert.deepEqual(loads, [1]);
  cache.clear();
});

test("getPage failures, render failures and both operation timeouts do not block subsequent candidates", { timeout: 2000 }, async () => {
  const { cache, doc, page, canvases, cleanupCount } = fixture({ timeoutMs: 10 });
  const stalledGetPage = deferred();
  const stalledRender = deferred();
  let timeoutCancels = 0;
  doc.getPage = (number) => {
    if (number === 1) return Promise.reject(new Error("bad page reference"));
    if (number === 2) return Promise.resolve(page(number, () => ({ promise: Promise.reject(new Error("bad content stream")), cancel: noop })));
    if (number === 4) return stalledGetPage.promise;
    if (number === 5) return Promise.resolve(page(number, () => ({ promise: stalledRender.promise, cancel: () => timeoutCancels++ })));
    return Promise.resolve(page(number));
  };
  const failures = [];
  const received = [];
  await cache.request([1, 2, 3, 4, 5, 6], {
    onThumbnail: (number) => received.push(number),
    onError: (number, error) => failures.push({ number, name: error.name }),
  });
  assert.deepEqual(received, [3, 6]);
  assert.deepEqual(failures.map((failure) => failure.number), [1, 2, 4, 5]);
  assert.equal(failures.find((failure) => failure.number === 4).name, "TimeoutError");
  assert.equal(failures.find((failure) => failure.number === 5).name, "TimeoutError");
  assert.ok(timeoutCancels >= 1);
  assert.equal(canvases.filter((canvas) => canvas.width > 0).length, 2);
  assert.equal(cleanupCount(), 0);
  stalledGetPage.resolve(page(4));
  stalledRender.resolve();
  await flush();
  assert.deepEqual(received, [3, 6]);
  cache.clear();
});

test("clear cancels an in-flight render and a request cannot restart until a document is set", async () => {
  const { cache, doc, page, canvases } = fixture();
  const stalled = deferred();
  let cancels = 0;
  doc.getPage = () => Promise.resolve(page(1, () => ({ promise: stalled.promise, cancel: () => cancels++ })));
  let callbacks = 0;
  const pending = cache.request([1], { onThumbnail: () => callbacks++, onError: () => callbacks++ });
  await flush();
  cache.clear();
  await pending;
  await cache.request([1], { onThumbnail: () => callbacks++ });
  stalled.resolve();
  await flush();
  assert.ok(cancels >= 1);
  assert.equal(callbacks, 0);
  assert.ok(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test("thumbnail dimensions stay bounded for huge, tall and tiny PDF pages", async () => {
  const { cache, doc, page } = fixture({ maxDimension: 96 });
  const sizes = [[100000, 100000], [20, 100000], [1, 2]];
  doc.getPage = (number) => Promise.resolve(page(number, null, ...sizes[number - 1]));
  const dimensions = [];
  await cache.request([1, 2, 3], { onThumbnail: (_number, canvas) => dimensions.push([canvas.width, canvas.height]) });
  assert.equal(dimensions.length, 3);
  assert.ok(dimensions.every(([width, height]) => width >= 1 && height >= 1 && Math.max(width, height) <= 96));
  cache.clear();
});

test("default cache holds at most 24 thumbnails and malformed candidates never load a page", async () => {
  const { cache, canvases, loads } = fixture();
  await cache.request(Array.from({ length: 30 }, (_value, index) => index + 1));
  assert.equal(canvases.filter((canvas) => canvas.width > 0).length, 24);
  assert.ok(canvases.every((canvas) => Math.max(canvas.width, canvas.height) <= 320));
  assert.ok(canvases.slice(0, 6).every((canvas) => canvas.width === 0 && canvas.height === 0));
  await cache.request([NaN, Infinity, -1, 0, 101, "1", null]);
  assert.equal(loads.length, 30);
  cache.clear();
});

test("full-page previews render at 640px while a twelve-entry cache remains bounded and releases evicted bitmaps", async () => {
  const { cache, doc, page, canvases, loads } = fixture({ maxDimension: 640, cacheLimit: 12 });
  doc.getPage = (number) => {
    loads.push(number);
    return Promise.resolve(page(number, null, 1000, 1000));
  };
  const receivedSizes = [];
  await cache.request(Array.from({ length: 15 }, (_value, index) => index + 1), {
    onThumbnail: (_number, canvas) => receivedSizes.push([canvas.width, canvas.height]),
  });
  assert.ok(receivedSizes.every(([width, height]) => width === 640 && height === 640));
  const retained = canvases.filter((canvas) => canvas.width > 0);
  assert.equal(retained.length, 12);
  assert.equal(retained.reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0), 19_660_800);
  assert.ok(canvases.slice(0, 3).every((canvas) => canvas.width === 0 && canvas.height === 0));
  let cached;
  await cache.request([15], { onThumbnail: (_number, canvas) => { cached = canvas; } });
  assert.equal(cached, canvases[14]);
  assert.equal(loads.length, 15);
  cache.clear();
  assert.ok(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test("oversized preview configuration cannot allocate canvases larger than the 640px hard limit", async () => {
  const { cache, doc, page } = fixture({ maxDimension: 4096, cacheLimit: 1 });
  doc.getPage = (number) => Promise.resolve(page(number, null, 100_000, 100_000));
  let dimensions;
  await cache.request([1], { onThumbnail: (_number, canvas) => { dimensions = [canvas.width, canvas.height]; } });
  assert.deepEqual(dimensions, [640, 640]);
  cache.clear();
});
