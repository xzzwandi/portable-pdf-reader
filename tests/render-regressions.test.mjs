import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import {
  MAX_CANVAS_DIMENSION,
  MAX_CONTINUOUS_CANVAS_PIXELS,
  MAX_PAGED_CANVAS_PIXELS,
} from "../src/constants.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const noop = () => {};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function load(context, names) {
  for (const name of names) {
    const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(start, `Missing function ${name}`);
    const rest = source.slice(start.index + start[0].length);
    const end = /\n(?:async )?function \w+\(/.exec(rest);
    vm.runInContext(source.slice(start.index, start.index + start[0].length + end.index), context);
  }
}

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.style = {};
  }
  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  setAttribute() {}
  addEventListener(name, handler) { this.listeners[name] = handler; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith(".") ? child.className === selector.slice(1) : child.tagName === selector) return child;
      const found = child.querySelector?.(selector);
      if (found) return found;
    }
    return null;
  }
}

function failureContext() {
  let now = 10_000;
  const scheduled = [];
  const shell = new Element("article");
  shell.dataset.page = "4";
  const placeholder = new Element();
  placeholder.className = "page-placeholder";
  shell.append(placeholder);
  const context = vm.createContext({
    Date: { now: () => now },
    pdfTools: null, pdfDoc: { numPages: 10 }, renderToken: 1, documentOpenToken: 1,
    CONTINUOUS_PAGE_MAX_ATTEMPTS: 3, CONTINUOUS_PAGE_RETRY_DELAY_MS: 1500,
    CONTINUOUS_HEALTH_CHECK_INTERVAL_MS: 1500, CONTINUOUS_RENDER_TIMEOUT_MS: 60000,
    continuousPageFailures: new Map(), pendingContinuousPages: new Map(),
    continuousRenderPromises: new Map(), pageRenderTasks: new Map(),
    els: { continuousPages: { childElementCount: 1 } },
    document: { createElement: (tag) => new Element(tag) },
    isScrollMode: () => true, ensureContinuousPlaceholder: noop,
    getVisibleContinuousShells: () => [shell], getContinuousMaxRenderedPages: () => 3,
    getContinuousShellPageNumber: () => 4,
    scheduleContinuousPageRender: (page, token) => scheduled.push({ page, token }),
    scheduleContinuousHealthCheck: noop,
    recordDiagnosticEvent: noop, summarizeError: (error) => ({ message: error.message }),
  });
  load(context, ["canRetryContinuousPage", "clearContinuousPageFailure", "showContinuousPageFailure", "recordContinuousPageFailure", "checkVisibleContinuousPages"]);
  return { context, shell, scheduled, setNow: (value) => { now = value; } };
}

test("a persistently broken continuous page backs off, stops automatically, and can be retried manually", () => {
  const { context, shell, scheduled, setNow } = failureContext();
  context.recordContinuousPageFailure(4, shell, new Error("bad page"));
  for (let i = 0; i < 20; i++) context.checkVisibleContinuousPages();
  assert.equal(scheduled.length, 0, "health checks must respect the first retry delay");
  setNow(11_500);
  context.checkVisibleContinuousPages();
  assert.equal(scheduled.length, 1);
  context.recordContinuousPageFailure(4, shell, new Error("bad page again"));
  setNow(14_499);
  context.checkVisibleContinuousPages();
  assert.equal(scheduled.length, 1, "the second failure needs a longer delay");
  setNow(14_500);
  context.checkVisibleContinuousPages();
  assert.equal(scheduled.length, 2);
  context.recordContinuousPageFailure(4, shell, new Error("still broken"));
  setNow(1_000_000);
  for (let i = 0; i < 20; i++) context.checkVisibleContinuousPages();
  assert.equal(scheduled.length, 2, "exhausted pages must stay idle");
  const panel = shell.querySelector(".page-render-error");
  assert.match(panel.querySelector("p").textContent, /自动重试已停止/);
  const button = panel.querySelector("button");
  assert.equal(button.textContent, "重试本页");
  button.listeners.click();
  assert.equal(scheduled.length, 3);
  assert.equal(context.continuousPageFailures.has(4), false);
  assert.equal(shell.querySelector(".page-render-error"), null);
});

test("retry controls from a closed document cannot enqueue a page in the next document", () => {
  const { context, shell, scheduled } = failureContext();
  context.recordContinuousPageFailure(4, shell, new Error("bad page"));
  const retry = shell.querySelector("button");
  context.documentOpenToken += 1;
  retry.listeners.click();
  assert.equal(scheduled.length, 0);
});

test("actual continuous rendering errors consume the retry budget and a successful retry clears it", async () => {
  const { context, shell } = failureContext();
  let shouldFail = true;
  const canvas = { width: 10, height: 10 };
  Object.assign(context, {
    pdfDoc: { numPages: 10, getPage: async () => {
      if (shouldFail) throw new Error("Unreadable page stream");
      return { render: () => ({ promise: Promise.resolve() }) };
    } },
    continuousRenderRuns: new Map([[4, 1]]), continuousBlankRetries: new Map(),
    isContinuousShellNearViewport: () => true, getContinuousRenderViewports: () => 1,
    waitForPdfOperation: async (promise) => promise, PDF_RENDER_TIMEOUT_MS: 1000,
    isContinuousRenderCurrent: () => true, getScaledViewport: () => ({}),
    shouldRenderContinuousDirectToTarget: () => false,
    prepareCanvas: noop, noteSelfTestMetric: noop, isCanvasLikelyBlank: () => false,
    ensureContinuousCanvas: () => canvas, commitRenderedCanvas: noop,
    releaseCanvasBitmap: noop, releaseContinuousCanvas: noop, pruneContinuousPages: noop,
    console: { error: noop },
  });
  load(context, ["renderContinuousPageInternal"]);
  assert.equal(await context.renderContinuousPageInternal(4, shell, 1, 1, 1), false);
  assert.equal(context.continuousPageFailures.get(4).attempts, 1);
  assert.equal(shell.dataset.renderFailed, "true");
  assert.ok(shell.querySelector("button"));
  shouldFail = false;
  context.continuousRenderRuns.set(4, 2);
  assert.equal(await context.renderContinuousPageInternal(4, shell, 1, 2, 1), true);
  assert.equal(context.continuousPageFailures.has(4), false);
  assert.equal(shell.dataset.rendered, "true");
  assert.equal(shell.dataset.renderFailed, undefined);
});

test("continuous render failure is returned to the caller and does not commit progress", async () => {
  let saves = 0;
  const events = [];
  const context = vm.createContext({
    pdfTools: null, pdfDoc: { numPages: 10 }, renderToken: 0, documentOpenToken: 1,
    state: { page: 4, scrollPage: 4 }, scrollTrackingSuppressionDepth: 0,
    clamp, recordDiagnosticEvent: (name) => events.push(name), updateViewerMode: noop,
    updateControls: noop, showStatus: noop, hideStatus: noop,
    cancelCurrentRender: noop, releasePagedCanvasBitmap: noop, clearContinuousPages: noop,
    estimateContinuousPageSize: async () => ({ width: 1000, height: 1500 }),
    getAvailableCanvasWidth: () => 1000, lastLayoutWidth: 0,
    buildContinuousPlaceholders: noop, setupContinuousObserver: noop,
    restoreContinuousScrollPosition: noop, els: { canvasWrap: { scrollTop: 4000 } },
    renderContinuousPage: async () => false, waitForNextFrame: async () => {},
    shouldPrefetchContinuousNeighborPages: () => false, queueVisibleContinuousPages: noop,
    pruneContinuousPages: noop, saveReaderState: () => saves++, console,
  });
  load(context, ["renderContinuousDocument"]);
  assert.equal(await context.renderContinuousDocument(4, { restoreScroll: true }), false);
  assert.equal(saves, 0);
  assert.equal(events.includes("render-continuous-success"), false);
  assert.equal(context.scrollTrackingSuppressionDepth, 0);
});

test("a stale waiter cannot overwrite the render run of a newly opened document", async () => {
  let resolveOld;
  const previousRender = new Promise((resolve) => { resolveOld = resolve; });
  const oldShell = { dataset: {} };
  let shell = oldShell;
  let started = 0;
  const context = vm.createContext({
    pdfTools: null, pdfDoc: { numPages: 10 }, renderToken: 1, documentOpenToken: 1,
    clamp, canRetryContinuousPage: () => true, getContinuousShellByPageNumber: () => shell,
    continuousRenderPromises: new Map([[4, previousRender]]),
    continuousRenderRuns: new Map(), continuousRenderRunId: 0,
    renderContinuousPageInternal: async () => { started++; return true; }, console,
  });
  load(context, ["renderContinuousPage"]);
  const pending = context.renderContinuousPage(4, 1, { force: true });
  context.renderToken = 2;
  context.documentOpenToken = 2;
  context.continuousRenderRuns.set(4, 123);
  shell = { dataset: {} };
  resolveOld(false);
  assert.equal(await pending, false);
  assert.equal(started, 0);
  assert.equal(context.continuousRenderRuns.get(4), 123);
});

function pagedContext() {
  let width = 1000;
  let height = 2000;
  let newWidth = 1300;
  let newHeight = 2600;
  const wrap = {
    clientWidth: 1000, clientHeight: 800, scrollWidth: 1000, scrollLeft: 0, scrollTop: 950,
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
  };
  const canvas = {
    width: 1000, height: 2000, dataset: { page: "2" },
    getBoundingClientRect: () => ({ left: -wrap.scrollLeft, top: -wrap.scrollTop, width, height }),
  };
  const context = vm.createContext({
    pdfTools: null, pdfDoc: { numPages: 10, getPage: async () => ({ render: () => ({ promise: Promise.resolve() }) }) },
    state: { page: 2, zoom: 1 }, renderToken: 0, documentOpenToken: 1, renderTask: null,
    clamp, isScrollMode: () => false, CONTINUOUS_READING_MARKER_RATIO: 0.35,
    PDF_RENDER_TIMEOUT_MS: 1000, lastLayoutWidth: 0, els: { canvas, canvasWrap: wrap },
    updateViewerMode: noop, updateControls: noop, showStatus: noop, hideStatus: noop,
    cancelCurrentRender: noop, clearContinuousPages: noop, waitForPdfOperation: async (promise) => promise,
    getAvailableCanvasWidth: () => wrap.clientWidth, getScaledViewport: () => ({ width: newWidth, height: newHeight }),
    document: { createElement: () => ({}) }, prepareCanvas: noop,
    commitRenderedCanvas: () => { width = newWidth; height = newHeight; },
    releaseCanvasBitmap: noop, saveReaderState: noop, console,
  });
  load(context, ["capturePagedReadingAnchor", "restorePagedReadingAnchor", "renderPage"]);
  return { context, wrap, canvas, setSize: (w, h) => { newWidth = w; newHeight = h; } };
}

test("zooming the current page keeps the reading point while a real page turn resets scroll", async () => {
  const { context, wrap } = pagedContext();
  const before = context.capturePagedReadingAnchor();
  assert.equal(await context.renderPage(2), true);
  const after = context.capturePagedReadingAnchor();
  assert.ok(Math.abs(before.yRatio - after.yRatio) < 0.000001);
  assert.ok(Math.abs(before.xRatio - after.xRatio) < 0.000001);
  assert.ok(wrap.scrollTop > 950, "larger page must keep the same content at the reading marker");
  assert.equal(await context.renderPage(3), true);
  assert.equal(wrap.scrollTop, 0);
  assert.equal(wrap.scrollLeft, 0);
});

test("a fullscreen transition can preserve the anchor captured before the viewport changed", async () => {
  const { context, wrap, setSize } = pagedContext();
  const anchor = context.capturePagedReadingAnchor();
  wrap.clientHeight = 1100;
  wrap.clientWidth = 1200;
  setSize(1200, 2400);
  context.epubRendition = null;
  context.lastViewportChangeAt = 0;
  context.waitForNextFrame = async () => {};
  context.renderCurrentView = context.renderPage;
  load(context, ["syncFullscreenLayoutAfterFrame"]);
  await context.syncFullscreenLayoutAfterFrame(null, anchor);
  const after = context.capturePagedReadingAnchor();
  assert.ok(Math.abs(anchor.yRatio - after.yRatio) < 0.000001);
});

test("oversized PDF pages remain within canvas dimensions and pixel budgets in both modes", () => {
  let continuous = true;
  const context = vm.createContext({
    pdfTools: null, window: { devicePixelRatio: 3 }, clamp, isScrollMode: () => continuous,
    MAX_CANVAS_DIMENSION, MAX_CONTINUOUS_CANVAS_PIXELS, MAX_PAGED_CANVAS_PIXELS,
  });
  load(context, ["getCanvasOutputScale", "prepareCanvas"]);
  for (continuous of [true, false]) {
    for (const viewport of [{ width: 1000, height: 40000 }, { width: 50000, height: 50000 }, { width: 1000000, height: 1000000 }]) {
      const canvas = { style: {}, getContext: () => ({ setTransform: noop, fillRect: noop }) };
      context.prepareCanvas(canvas, viewport);
      assert.ok(canvas.width <= MAX_CANVAS_DIMENSION);
      assert.ok(canvas.height <= MAX_CANVAS_DIMENSION);
      assert.ok(canvas.width * canvas.height <= (continuous ? MAX_CONTINUOUS_CANVAS_PIXELS : MAX_PAGED_CANVAS_PIXELS));
    }
  }
});

test("PDF swipe navigation yields to zoom, panning, selected text and interactive content", () => {
  const { context, wrap } = pagedContext();
  let selected = false;
  context.window = { visualViewport: { scale: 1 }, getSelection: () => ({ isCollapsed: !selected }) };
  load(context, ["canTurnPdfPageWithSwipe"]);
  const pageBackground = { closest: () => null };
  assert.equal(context.canTurnPdfPageWithSwipe(pageBackground), true);
  context.state.zoom = 1.15;
  assert.equal(context.canTurnPdfPageWithSwipe(pageBackground), false);
  context.state.zoom = 1;
  wrap.scrollWidth = 1200;
  assert.equal(context.canTurnPdfPageWithSwipe(pageBackground), false);
  wrap.scrollWidth = 1000;
  selected = true;
  assert.equal(context.canTurnPdfPageWithSwipe(pageBackground), false);
  selected = false;
  assert.equal(context.canTurnPdfPageWithSwipe({ closest: () => ({}) }), false);
  context.window.visualViewport.scale = 2;
  assert.equal(context.canTurnPdfPageWithSwipe(pageBackground), false);
});

test("unlock text refresh cannot overlay an old page after navigation, mode changes, or relocking", async () => {
  for (const scenario of ["unchanged", "render-generation", "canvas-page", "mode", "locked", "document", "detached"]) {
    let resolvePage;
    const pendingPage = new Promise((resolve) => { resolvePage = resolve; });
    const canvas = { dataset: { page: "1" }, isConnected: true };
    const calls = [];
    const context = vm.createContext({
      pdfDoc: { getPage: () => pendingPage },
      pdfTools: { renderTextLayer: (args) => { calls.push(args); return Promise.resolve(true); } },
      documentOpenToken: 1, renderToken: 1, state: { page: 1, mode: "paged" },
      els: { canvas, lockOverlay: { hidden: true } },
      isScrollMode: () => false, getScaledViewport: () => ({ width: 500, height: 800 }),
    });
    load(context, ["refreshPdfTextLayers"]);
    context.refreshPdfTextLayers();
    if (scenario === "render-generation") context.renderToken++;
    if (scenario === "canvas-page") canvas.dataset.page = "2";
    if (scenario === "mode") context.state.mode = "scroll";
    if (scenario === "locked") context.els.lockOverlay.hidden = false;
    if (scenario === "document") context.documentOpenToken++;
    if (scenario === "detached") canvas.isConnected = false;
    const page = { pageNumber: 1 };
    resolvePage(page);
    await pendingPage;
    await Promise.resolve();
    assert.equal(calls.length, scenario === "unchanged" ? 1 : 0, scenario);
    if (scenario === "unchanged") {
      assert.equal(calls[0].page, page);
      assert.equal(calls[0].canvas, canvas);
    }
  }
});
