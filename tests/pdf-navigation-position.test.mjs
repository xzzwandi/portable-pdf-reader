import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const noop = () => {};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function load(context, names) {
  for (const name of names) {
    const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(start, `Missing function ${name}`);
    const rest = source.slice(start.index + start[0].length);
    const end = /\n(?:async )?function \w+\(/.exec(rest);
    assert.ok(end, `Missing function boundary after ${name}`);
    vm.runInContext(source.slice(start.index, start.index + start[0].length + end.index), context);
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup(mode = "scroll", firstRender = null) {
  const values = new Map();
  const writes = [];
  const renders = [];
  let context;
  const wrap = {
    scrollLeft: 216, scrollTop: mode === "scroll" ? 8430 : 330,
    clientWidth: 360, clientHeight: 600, scrollWidth: 900,
    getBoundingClientRect: () => ({ left: 20, top: 50, width: 360, height: 600 }),
  };
  const pageHeight = () => 600 * context.state.zoom;
  const shell = (page) => ({
    dataset: { page: String(page) },
    getBoundingClientRect() {
      const top = 50 + (page - 1) * pageHeight() - wrap.scrollTop;
      return { top, bottom: top + pageHeight(), height: pageHeight() };
    },
  });
  const canvas = {
    dataset: { page: "10" }, width: 900, height: 1350,
    getBoundingClientRect: () => ({
      left: 20 - wrap.scrollLeft, top: 50 - wrap.scrollTop,
      width: 600 * context.state.zoom, height: 900 * context.state.zoom,
    }),
  };
  context = vm.createContext({
    console, clamp, AbortController,
    state: { documentId: "doc:origin", format: "pdf", mode, zoom: 1.5,
      page: 10, scrollPage: 10, scrollOffsetRatio: 0.6, scrollTop: wrap.scrollTop },
    pdfDoc: { numPages: 1200 }, documentOpenToken: 4, renderToken: 7,
    pdfNavigationIntent: 0, pdfNavigationTransaction: null,
    fullscreenTransitionInProgress: false, scrollTrackingSuppressionDepth: 0,
    scrollStateTimer: null, continuousProgrammaticScrollTarget: 0, continuousProgrammaticScrollUntil: 0,
    READ_MODES: { PAGED: "paged", SCROLL: "scroll" }, CONTINUOUS_READING_MARKER_RATIO: 0.35,
    STATE_KEY: "state", PROGRESS_KEY: "progress",
    els: { canvasWrap: wrap, canvas, continuousPages: { childElementCount: 1 }, lockOverlay: { hidden: true } },
    window: { clearTimeout: noop, localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem(key, value) { values.set(key, value); writes.push({ key, value: JSON.parse(value) }); },
    } },
    isScrollMode: () => context.state.mode === "scroll",
    isDeferredPdfProgressSaveGuardActive: () => false,
    clearContinuousScrollUpdate: noop, cancelContinuousScrollCorrection: noop,
    pauseContinuousScrollForFullscreen: () => noop,
    waitForNextFrame: async () => {}, cancelCurrentRender: noop,
    updateControls: noop, queueVisibleContinuousPages: noop, scheduleContinuousHealthCheck: noop,
    getActuallyVisibleContinuousShells: () => [shell(Math.floor((wrap.scrollTop + 210) / pageHeight()) + 1)],
    getContinuousShellPageNumber: (value) => Number(value.dataset.page),
    getContinuousShellByPageNumber: shell, ensureContinuousDomWindow: noop,
    setContinuousScrollTop: (top) => { wrap.scrollTop = top; }, scheduleContinuousPageRender: noop,
    captureContinuousScrollPosition() {
      const page = Math.floor(wrap.scrollTop / pageHeight()) + 1;
      context.state.scrollPage = page;
      context.state.scrollOffsetRatio = (wrap.scrollTop - (page - 1) * pageHeight()) / pageHeight();
      context.state.scrollTop = wrap.scrollTop;
    },
  });
  load(context, [
    "captureContinuousReadingAnchor", "restoreContinuousReadingAnchor",
    "capturePagedReadingAnchor", "restorePagedReadingAnchor",
    "capturePdfNavigationPosition", "isPdfNavigationPositionCurrent", "cancelPdfNavigationForInput",
    "waitForPdfNavigationRender", "assignPdfNavigationPosition", "finishPdfNavigationPosition",
    "applyPdfNavigationPosition", "navigatePdfFromPreview", "restorePdfNavigationPosition",
    "getProgressMap", "saveDocumentProgress", "saveReaderState",
  ]);
  context.renderCurrentView = (page, options) => {
    const viewToken = ++context.renderToken;
    const activeDoc = context.pdfDoc;
    const openToken = context.documentOpenToken;
    const index = renders.length;
    renders.push({ page, options, zoom: context.state.zoom, mode: context.state.mode });
    wrap.scrollWidth = 600 * context.state.zoom;
    return (async () => {
      const rendered = index === 0 && firstRender ? await firstRender.promise : await Promise.resolve(true);
      // Match the production renderer's ownership checks and internal save.
      if (viewToken !== context.renderToken || activeDoc !== context.pdfDoc || openToken !== context.documentOpenToken) return false;
      canvas.dataset.page = String(page);
      if (context.isScrollMode() && options.continuousAnchor) context.restoreContinuousReadingAnchor(options.continuousAnchor);
      if (!context.isScrollMode() && options.pagedAnchor) context.restorePagedReadingAnchor(options.pagedAnchor);
      context.saveReaderState({ commitProgress: options.commitProgress !== false });
      return rendered;
    })();
  };
  return { context, wrap, values, writes, renders };
}

for (const mode of ["scroll", "paged"]) {
  test(`${mode} navigation captures without changing state and restores zoom and both scroll axes`, async () => {
    const { context, wrap, writes } = setup(mode);
    const before = JSON.stringify(context.state);
    const originalTop = wrap.scrollTop;
    const originalLeft = wrap.scrollLeft;
    const position = context.capturePdfNavigationPosition();
    assert.equal(JSON.stringify(context.state), before);
    assert.equal(position.document, context.pdfDoc);
    assert.equal(position.page, 10);
    assert.equal(position.zoom, 1.5);
    assert.equal(position.horizontalRatio, 0.4);
    assert.deepEqual(writes, []);

    context.state.mode = mode === "scroll" ? "paged" : "scroll";
    context.state.zoom = 2;
    context.state.page = 500;
    wrap.scrollTop = 0;
    wrap.scrollLeft = 0;
    assert.equal(await context.restorePdfNavigationPosition(position), true);
    assert.equal(context.state.mode, mode);
    assert.equal(context.state.zoom, 1.5);
    assert.equal(context.state.page, 10);
    assert.ok(Math.abs(wrap.scrollTop - originalTop) < 0.001);
    assert.ok(Math.abs(wrap.scrollLeft - originalLeft) < 0.001);
    assert.deepEqual(writes.map((entry) => entry.key), ["state", "progress"]);
    assert.equal(writes[0].value.page, 10);
    assert.equal(writes[0].value.zoom, 1.5);
    assert.equal(context.scrollTrackingSuppressionDepth, 0);
    assert.equal(context.pdfNavigationTransaction, null);
  });
}

test("wrong documents, stale generations, locked readers and already-aborted navigation cannot change state", async () => {
  for (const failure of ["document", "id", "generation", "locked", "abort"]) {
    const { context, writes, renders } = setup();
    const position = context.capturePdfNavigationPosition();
    const controller = new AbortController();
    if (failure === "document") position.document = { numPages: 1200 };
    if (failure === "id") position.documentId = "doc:other";
    if (failure === "generation") position.documentToken--;
    if (failure === "locked") context.els.lockOverlay.hidden = false;
    if (failure === "abort") controller.abort();
    const before = JSON.stringify(context.state);
    assert.equal(await context.restorePdfNavigationPosition(position, { signal: controller.signal }), false, failure);
    assert.equal(JSON.stringify(context.state), before, failure);
    assert.deepEqual(renders, [], failure);
    assert.deepEqual(writes, [], failure);
  }
});

test("switching books while a navigation render is pending never saves or restores the old book", async () => {
  const gate = deferred();
  const { context, writes, renders } = setup("scroll", gate);
  const pending = context.navigatePdfFromPreview(900);
  assert.equal(context.scrollTrackingSuppressionDepth, 1);
  assert.deepEqual(writes, []);
  context.pdfDoc = { numPages: 20 };
  context.documentOpenToken++;
  context.renderToken++;
  context.state = { documentId: "doc:new", page: 3, mode: "paged", zoom: 1 };
  const newState = JSON.stringify(context.state);
  // The old transaction must not suppress saves from the newly opened book.
  context.saveReaderState();
  const writesBeforeCompletion = writes.length;
  gate.resolve(true);
  assert.equal(await pending, false);
  assert.equal(JSON.stringify(context.state), newState);
  assert.equal(writes.length, writesBeforeCompletion);
  assert.deepEqual(renders.map((entry) => entry.page), [900]);
  assert.equal(context.scrollTrackingSuppressionDepth, 0);
  assert.equal(context.pdfNavigationTransaction, null);
});

test("aborting a pending navigation restores the original pixels and saves only the original position", async () => {
  const gate = deferred();
  const { context, wrap, writes, renders } = setup("scroll", gate);
  const originTop = wrap.scrollTop;
  const originLeft = wrap.scrollLeft;
  const controller = new AbortController();
  const pending = context.navigatePdfFromPreview(900, { signal: controller.signal });
  controller.abort();
  assert.equal(await pending, false);
  assert.deepEqual(renders.map((entry) => entry.page), [900, 10]);
  assert.equal(context.state.page, 10);
  assert.equal(context.state.zoom, 1.5);
  assert.equal(wrap.scrollTop, originTop);
  assert.equal(wrap.scrollLeft, originLeft);
  assert.deepEqual(writes.map((entry) => entry.key), ["state", "progress"]);
  assert.equal(writes[0].value.page, 10);
  gate.resolve(true);
  await Promise.resolve();
  assert.equal(writes.length, 2, "the cancelled destination cannot save when its render eventually settles");
  assert.equal(context.scrollTrackingSuppressionDepth, 0);
});

test("a newer navigation owns the final view and balances both transactions' scroll suppression", async () => {
  const gate = deferred();
  const { context, writes, renders } = setup("scroll", gate);
  const first = context.navigatePdfFromPreview(900);
  const second = context.navigatePdfFromPreview(300);
  assert.equal(await second, true);
  gate.resolve(true);
  assert.equal(await first, false);
  assert.equal(context.state.page, 300);
  assert.deepEqual(renders.map((entry) => entry.page), [900, 300]);
  assert.deepEqual(writes.filter((entry) => entry.key === "state").map((entry) => entry.value.page), [300]);
  assert.equal(context.scrollTrackingSuppressionDepth, 0);
  assert.equal(context.pdfNavigationTransaction, null);
});

test("ordinary user input cancels a pending navigation without allowing its late renderer to save", async () => {
  const gate = deferred();
  const { context, writes, renders } = setup("paged", gate);
  const pending = context.navigatePdfFromPreview(900);
  context.cancelPdfNavigationForInput();
  assert.equal(context.scrollTrackingSuppressionDepth, 0);
  // Cancellation must settle even if getPage() never provides the destination.
  assert.equal(await pending, false);
  await Promise.resolve();
  assert.deepEqual(renders.map((entry) => entry.page), [900, 10]);
  assert.equal(context.state.page, 10);
  assert.ok(writes.filter((entry) => entry.key === "state").every((entry) => entry.value.page === 10));
  const settledWrites = writes.length;
  gate.resolve(true);
  await Promise.resolve();
  assert.equal(writes.length, settledWrites);
});

test("locking during navigation retires the pending renderer and never saves its destination", async () => {
  const gate = deferred();
  const { context, writes } = setup("paged", gate);
  const controller = new AbortController();
  Object.assign(context, {
    closeReaderTools: noop, pdfNavigator: { clear: () => controller.abort() },
    pdfTools: { clear: noop }, configureLockOverlay: noop,
    closeImagePreview: noop, closeLibrary: noop, closeToc: noop, freezePageBehindLock: noop,
  });
  context.els.floatingLockButton = {};
  context.window.setTimeout = noop;
  load(context, ["showLockOverlay"]);
  const pending = context.navigatePdfFromPreview(900, { signal: controller.signal });
  context.showLockOverlay();
  assert.equal(await pending, false);
  assert.equal(context.els.lockOverlay.hidden, false);
  assert.equal(context.state.page, 10);
  const settledWrites = writes.length;
  assert.ok(writes.filter((entry) => entry.key === "state").every((entry) => entry.value.page === 10));
  gate.resolve(true);
  await Promise.resolve();
  assert.equal(writes.length, settledWrites);
  assert.equal(context.scrollTrackingSuppressionDepth, 0);
  assert.equal(context.pdfNavigationTransaction, null);
});
