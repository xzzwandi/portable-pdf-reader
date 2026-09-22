import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const noop = () => {};
function load(context, names) {
  for (const name of names) {
    const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(start, `Missing function ${name}`);
    const rest = source.slice(start.index + start[0].length);
    const end = /\n(?:async )?function \w+\(/.exec(rest);
    vm.runInContext(source.slice(start.index, start.index + start[0].length + end.index), context);
  }
}

function makeShell(page, top = 100, bottom = 500, rendered = false) {
  const shell = {
    dataset: { page: String(page), ...(rendered ? { rendered: "true", expectedInk: "true" } : {}) },
    canvas: rendered ? { width: 600, height: 800 } : null,
    getBoundingClientRect: () => ({ top, bottom, left: 0, right: 600 }),
    querySelector: () => shell.canvas,
  };
  return shell;
}

function setup(shells = [makeShell(8)]) {
  const rendered = [];
  const queued = [];
  const healthChecks = [];
  const layouts = [];
  const anchors = [];
  const wrap = {
    scrollTop: 1000, clientHeight: 600, offsetHeight: 600,
    style: { overflowY: "auto", scrollBehavior: "auto" },
    scrollTo({ top }) { this.scrollTop = top; },
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
  };
  let width = 1000;
  let context;
  context = vm.createContext({
    pdfDoc: { numPages: 120 }, pdfTools: null, epubRendition: null,
    state: { page: 3, mode: "scroll" }, renderToken: 1, documentOpenToken: 1,
    appFullscreen: true, fullscreenTransitionInProgress: false, fullscreenLayoutChangePending: false,
    scrollTrackingSuppressionDepth: 0, continuousScrollFrame: 0,
    continuousScrollIntent: 0, continuousScrollCorrectionFrame: 0, scrollStateTimer: null,
    resizeTimer: null, lastLayoutWidth: 1000, lastViewportChangeAt: 0,
    CONTINUOUS_READING_MARKER_RATIO: 0.35, continuousPinnedPages: new Set(),
    els: { canvasWrap: wrap, continuousPages: { querySelectorAll: () => shells } },
    window: { clearTimeout: noop, cancelAnimationFrame: noop, requestAnimationFrame: (fn) => { fn(); return 0; } },
    waitForNextFrame: async () => {}, wait: async () => {},
    isScrollMode: () => context.state.mode === "scroll",
    isScrollTrackingSuppressed: () => context.scrollTrackingSuppressionDepth > 0,
    getAvailableCanvasWidth: () => width,
    captureContinuousReadingAnchor: () => ({ page: 3, offsetRatio: 0.4, viewportRatio: 0.35 }),
    capturePagedReadingAnchor: () => null,
    restoreContinuousReadingAnchor: (anchor) => anchors.push(anchor),
    getContinuousPageNumberAtOffset: (offset) => Math.floor(offset / 200) + 1,
    ensureContinuousDomWindow: noop,
    getContinuousShellPageNumber: (shell) => Number(shell.dataset.page),
    isCanvasLikelyBlank: () => false,
    setAppFullscreen: (enabled) => { context.appFullscreen = enabled; },
    enterNativeFullscreen: async () => {}, exitNativeFullscreen: async () => {},
    syncFullscreenLayoutAfterFrame: async () => { layouts.push(width); context.lastLayoutWidth = width; },
    renderContinuousPage: async (page, token, options) => {
      rendered.push({ page, token, force: options.force });
      const shell = shells.find((candidate) => Number(candidate.dataset.page) === page);
      shell.dataset.rendered = "true";
      shell.canvas = { width: 600, height: 800 };
      return true;
    },
    updateCurrentPageFromScroll: () => {
      assert.equal(context.scrollTrackingSuppressionDepth, 0, "reconcile scroll after releasing suppression");
      queued.push(wrap.scrollTop);
    },
    scheduleContinuousHealthCheck: (delay) => healthChecks.push(delay),
  });
  load(context, ["getActuallyVisibleContinuousShells", "reconcileFullscreenViewport", "scheduleContinuousScrollUpdate", "cancelContinuousScrollCorrection", "applyContinuousScrollTopInstant", "pauseContinuousScrollForFullscreen", "toggleAppFullscreen", "handleNativeFullscreenExit"]);
  return { context, wrap, shells, rendered, queued, healthChecks, layouts, anchors, setWidth: (value) => { width = value; } };
}

for (const [label, handler, startFullscreen] of [
  ["enter fullscreen", "toggleAppFullscreen", false],
  ["exit with the fullscreen button", "toggleAppFullscreen", true],
  ["exit with the browser fullscreen control", "handleNativeFullscreenExit", true],
]) {
  test(`${label} repaints the final viewport even when its scroll event arrived during suppression`, async () => {
    const { context, wrap, rendered, queued, healthChecks } = setup();
    context.appFullscreen = startFullscreen;
    context.wait = async () => {
      assert.equal(wrap.style.overflowY, "hidden", "momentum remains paused throughout the fullscreen reflow");
      wrap.scrollTop = 1900;
      context.scheduleContinuousScrollUpdate();
      assert.equal(queued.length, 0, "the transition's scroll event is deliberately suppressed");
    };
    await context[handler]();
    assert.deepEqual(rendered.map((entry) => entry.page), [8]);
    assert.deepEqual(queued, [1900], "the final viewport must be replayed without another user gesture");
    assert.ok(healthChecks.includes(0));
    assert.equal(context.fullscreenTransitionInProgress, false);
    assert.equal(context.scrollTrackingSuppressionDepth, 0);
    assert.equal(wrap.style.overflowY, "auto", "normal scrolling is restored after the transition");
  });
}

test("a resize that arrives while visible pages are rendering triggers a final layout pass", async () => {
  const { context, layouts, setWidth } = setup();
  setWidth(1050);
  const render = context.renderContinuousPage;
  context.renderContinuousPage = async (...args) => {
    const result = await render(...args);
    setWidth(1200);
    context.fullscreenLayoutChangePending = true;
    return result;
  };
  await context.reconcileFullscreenViewport({ page: 3 }, null, 1);
  assert.deepEqual(layouts, [1050, 1200]);
  assert.equal(context.lastLayoutWidth, 1200);
  assert.equal(context.fullscreenLayoutChangePending, false);
});

test("continuous rebuild measures layout width after its placeholders restore the vertical scrollbar", async () => {
  let availableWidth = 375;
  let renderedWidth = 0;
  const context = vm.createContext({
    pdfDoc: { numPages: 120 }, pdfTools: null, state: { page: 8, scrollPage: 8 },
    renderToken: 1, documentOpenToken: 1, scrollTrackingSuppressionDepth: 0, lastLayoutWidth: 375,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    recordDiagnosticEvent: noop, updateViewerMode: noop, updateControls: noop,
    showStatus: noop, hideStatus: noop, cancelCurrentRender: noop, releasePagedCanvasBitmap: noop,
    clearContinuousPages: () => { availableWidth = 390; },
    estimateContinuousPageSize: async () => {
      assert.equal(availableWidth, 390, "the emptied document temporarily has no vertical scrollbar");
      return { width: availableWidth, height: 600 };
    },
    buildContinuousPlaceholders: () => { availableWidth = 375; },
    getAvailableCanvasWidth: () => availableWidth,
    setupContinuousObserver: noop, restoreContinuousScrollPosition: noop,
    els: { canvasWrap: { scrollTop: 2000 } },
    renderContinuousPage: async () => { renderedWidth = availableWidth; return true; },
    waitForNextFrame: async () => {}, shouldPrefetchContinuousNeighborPages: () => false,
    queueVisibleContinuousPages: noop, pruneContinuousPages: noop, saveReaderState: noop,
  });
  load(context, ["renderContinuousDocument"]);
  assert.equal(await context.renderContinuousDocument(8, { restoreScroll: true, throwOnError: true }), true);
  assert.equal(renderedWidth, 375);
  assert.equal(context.lastLayoutWidth, renderedWidth, "a stable viewport must not appear 15px out of date");
});

test("fullscreen completion waits for an actually visible missing canvas, regardless of estimated-page visibility", async () => {
  const visible = makeShell(8, 20, 500);
  const offscreen = makeShell(9, 900, 1300);
  const { context, rendered } = setup([visible, offscreen]);
  context.getVisibleContinuousShells = () => [];
  let finishRender;
  const gate = new Promise((resolve) => { finishRender = resolve; });
  const render = context.renderContinuousPage;
  context.renderContinuousPage = async (...args) => {
    assert.ok(context.continuousPinnedPages.has(8));
    await gate;
    return render(...args);
  };
  let completed = false;
  const pending = context.reconcileFullscreenViewport({ page: 3 }, null, 1).then(() => { completed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(visible.canvas, null);
  finishRender();
  await pending;
  assert.deepEqual(rendered.map((entry) => entry.page), [8]);
  assert.ok(visible.canvas.width > 1);
  assert.equal(offscreen.canvas, null);
  assert.equal(context.continuousPinnedPages.size, 0);
});

test("switching documents during fullscreen reconciliation cannot render or restore the old reading anchor", async () => {
  const { context, rendered, anchors } = setup();
  context.waitForNextFrame = async () => {
    context.pdfDoc = { numPages: 2 };
    context.documentOpenToken = 2;
    context.renderToken = 2;
  };
  await context.reconcileFullscreenViewport({ page: 100 }, null, 1);
  assert.equal(rendered.length, 0);
  assert.equal(anchors.length, 0);
});

test("a legitimate blank visible page is accepted without forcing another render", async () => {
  const blank = makeShell(8, 20, 500, true);
  blank.dataset.expectedInk = "false";
  const { context, rendered } = setup([blank]);
  context.isCanvasLikelyBlank = () => true;
  await context.reconcileFullscreenViewport({ page: 8 }, null, 1);
  await context.reconcileFullscreenViewport({ page: 8 }, null, 1);
  assert.equal(rendered.length, 0);
});

test("switching books while native fullscreen is pending cannot redraw the new book using the old anchor", async () => {
  const { context } = setup();
  context.appFullscreen = false;
  let redraws = 0;
  context.renderCurrentView = async () => { redraws++; };
  context.enterNativeFullscreen = async () => {
    context.pdfDoc = { numPages: 2 };
    context.documentOpenToken = 2;
    context.renderToken = 2;
  };
  load(context, ["syncFullscreenLayoutAfterFrame"]);
  await context.toggleAppFullscreen();
  assert.equal(redraws, 0);
});

for (const handler of ["toggleAppFullscreen", "handleNativeFullscreenExit"]) {
  test(`${handler} ignores the old anchor when a new document opens during its layout frame`, async () => {
    const { context, queued } = setup();
    let redraws = 0;
    context.renderCurrentView = async () => { redraws++; };
    context.waitForNextFrame = async () => {
      context.pdfDoc = { numPages: 2 };
      context.documentOpenToken = 2;
      context.renderToken = 2;
    };
    load(context, ["syncFullscreenLayoutAfterFrame"]);
    await context[handler]();
    assert.equal(redraws, 0);
    assert.equal(queued.length, 0, "a stale transition must not run final scroll bookkeeping on the new book");
    assert.equal(context.scrollTrackingSuppressionDepth, 0);
    assert.equal(context.fullscreenTransitionInProgress, false);
  });
}
