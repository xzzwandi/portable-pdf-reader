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
    vm.runInContext(source.slice(start.index, start.index + start[0].length + end.index), context);
  }
}

function setup() {
  const frames = new Map();
  const cancelled = [];
  const timers = [];
  let nextFrame = 0;
  let context;
  const shells = [];
  const wrap = {
    scrollTop: 0, clientHeight: 600, style: { scrollBehavior: "auto" },
    scrollTo({ top }) { this.scrollTop = top; },
    getBoundingClientRect: () => ({ top: 50, bottom: 650, height: 600 }),
  };
  context = vm.createContext({
    pdfDoc: { numPages: 20 }, state: { page: 10, scrollPage: 10, scrollTop: 5000 },
    renderToken: 1, documentOpenToken: 1, continuousScrollIntent: 0, continuousScrollCorrectionFrame: 0,
    continuousScrollFrame: 0, continuousWindowUpdating: false, scrollTrackingSuppressionDepth: 0,
    continuousEstimatedPageWidth: 0, continuousEstimatedShellHeight: 0,
    continuousBasePageAspectRatio: 0, continuousPageAspectRatios: new Map(),
    continuousPageHeightTree: null, continuousPageHeightOverrides: new Map(),
    continuousDomWindowStart: 1, continuousDomWindowEnd: 20,
    CONTINUOUS_PAGE_GAP_PX: 14, CONTINUOUS_READING_MARKER_RATIO: 0.35,
    clamp, isScrollMode: () => true,
    els: {
      canvasWrap: wrap,
      continuousPages: { childElementCount: 20, querySelectorAll: () => shells },
    },
    window: {
      requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
      cancelAnimationFrame: (id) => { cancelled.push(id); frames.delete(id); },
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
      scrollTo: noop,
    },
    isScrollTrackingSuppressed: () => context.scrollTrackingSuppressionDepth > 0,
    getAvailableCanvasWidth: () => 400,
    getContinuousMaxScrollTop: () => Math.max(0, context.getContinuousDocumentHeight() - wrap.clientHeight),
    getDocumentMaxScrollTop: () => 0,
    updateContinuousSpacerSizes: noop,
    ensureContinuousDomWindow: noop,
    scheduleContinuousPageRender: noop,
    getContinuousShellPageNumber: (shell) => Number(shell.dataset.page),
    getContinuousShellByPageNumber: (page) => shells.find((shell) => Number(shell.dataset.page) === page),
  });
  load(context, [
    "resetContinuousPageMetrics", "addContinuousPageHeightDelta", "getContinuousPageHeightDelta",
    "getContinuousPageHeight", "getContinuousPageTopOffset", "getContinuousDocumentHeight",
    "getContinuousPageNumberAtOffset", "updateContinuousPageHeight", "getActuallyVisibleContinuousShells",
    "cancelContinuousScrollCorrection", "applyContinuousScrollTopInstant", "setContinuousScrollTop",
    "captureContinuousReadingAnchor", "restoreContinuousReadingAnchor", "restoreReaderPositionAfterResume",
  ]);
  context.resetContinuousPageMetrics({ width: 400, height: 600 });
  for (let page = 1; page <= 20; page++) {
    shells.push({
      dataset: { page: String(page) },
      getBoundingClientRect() {
        const top = 50 + context.getContinuousPageTopOffset(page) - wrap.scrollTop;
        const height = context.getContinuousPageHeight(page);
        return { top, bottom: top + height, height };
      },
    });
  }
  return { context, wrap, shells, frames, cancelled, timers };
}

test("late rendering of a taller preceding page preserves page 10 instead of jumping back to page 9", () => {
  const { context, wrap } = setup();
  wrap.scrollTop = context.getContinuousPageTopOffset(10) + 200 - wrap.clientHeight * 0.35;
  const before = context.captureContinuousReadingAnchor();
  const originalTop = wrap.scrollTop;
  assert.equal(before.page, 10);
  // The old code left scrollTop unchanged after discovering the extra 1000px.
  context.updateContinuousPageHeight(9, context.getContinuousPageHeight(9) + 1000);
  const after = context.captureContinuousReadingAnchor();
  assert.equal(wrap.scrollTop, originalTop + 1000);
  assert.equal(after.page, 10);
  assert.ok(Math.abs(after.offsetRatio - before.offsetRatio) < 0.000001);
});

test("a taller page 9 preserves the page 10 reading marker even while the viewport still shows page 9", () => {
  const { context, wrap } = setup();
  const page10Top = context.getContinuousPageTopOffset(10);
  wrap.scrollTop = page10Top - 150;
  assert.equal(context.getContinuousPageNumberAtOffset(wrap.scrollTop), 9);
  const before = context.captureContinuousReadingAnchor();
  assert.equal(before.page, 10);
  assert.ok(before.offsetRatio > 0);
  const originalTop = wrap.scrollTop;
  context.updateContinuousPageHeight(9, context.getContinuousPageHeight(9) + 1000);
  const after = context.captureContinuousReadingAnchor();
  assert.equal(wrap.scrollTop, originalTop + 1000);
  assert.equal(after.page, 10);
  assert.ok(Math.abs(after.offsetRatio - before.offsetRatio) < 0.000001);
});

test("changing the height of the page containing the reading marker preserves its relative reading position", () => {
  const { context, wrap } = setup();
  const originalHeight = context.getContinuousPageHeight(10);
  wrap.scrollTop = context.getContinuousPageTopOffset(10) + originalHeight * 0.6 - wrap.clientHeight * 0.35;
  const before = context.captureContinuousReadingAnchor();
  assert.equal(before.page, 10);
  assert.ok(Math.abs(before.offsetRatio - 0.6) < 0.000001);
  const originalTop = wrap.scrollTop;
  context.updateContinuousPageHeight(10, originalHeight + 1000);
  const grown = context.captureContinuousReadingAnchor();
  assert.ok(Math.abs(wrap.scrollTop - (originalTop + 600)) < 0.000001);
  assert.equal(grown.page, 10);
  assert.ok(Math.abs(grown.offsetRatio - before.offsetRatio) < 0.000001);
  context.updateContinuousPageHeight(10, originalHeight);
  const shrunk = context.captureContinuousReadingAnchor();
  assert.ok(Math.abs(wrap.scrollTop - originalTop) < 0.000001);
  assert.equal(shrunk.page, 10);
  assert.ok(Math.abs(shrunk.offsetRatio - before.offsetRatio) < 0.000001);
});

test("shrinking an earlier page preserves the reading point while changing a later page does not scroll", () => {
  const { context, wrap } = setup();
  context.updateContinuousPageHeight(9, 1628);
  wrap.scrollTop = context.getContinuousPageTopOffset(10) + 200 - wrap.clientHeight * 0.35;
  const before = context.captureContinuousReadingAnchor();
  const originalTop = wrap.scrollTop;
  context.updateContinuousPageHeight(9, 628);
  assert.equal(wrap.scrollTop, originalTop - 1000);
  assert.equal(context.captureContinuousReadingAnchor().page, before.page);
  assert.ok(Math.abs(context.captureContinuousReadingAnchor().offsetRatio - before.offsetRatio) < 0.000001);
  const stableTop = wrap.scrollTop;
  context.updateContinuousPageHeight(15, 1628);
  assert.equal(wrap.scrollTop, stableTop);
});

test("rebuilding at another width retains measured page shapes and the original base estimate", () => {
  const { context, wrap } = setup();
  context.continuousPageAspectRatios.set(9, 4);
  context.continuousPageAspectRatios.set(10, 1.5);
  context.resetContinuousPageMetrics({ width: 400, height: 600 });
  wrap.scrollTop = context.getContinuousPageTopOffset(10) + 200 - wrap.clientHeight * 0.35;
  const anchor = context.captureContinuousReadingAnchor();
  // The page used to estimate the new layout may have a very different shape.
  context.resetContinuousPageMetrics({ width: 500, height: 300 });
  assert.equal(context.getContinuousPageHeight(9), 2028);
  assert.equal(context.getContinuousPageHeight(10), 778);
  assert.equal(context.getContinuousPageHeight(8), 778);
  context.restoreContinuousReadingAnchor(anchor);
  const after = context.captureContinuousReadingAnchor();
  assert.equal(after.page, anchor.page);
  assert.ok(Math.abs(after.offsetRatio - anchor.offsetRatio) < 1 / context.getContinuousPageHeight(10));
  context.resetContinuousPageMetrics({ width: 400, height: 1600 });
  assert.equal(context.getContinuousPageHeight(9), 1628);
  assert.equal(context.getContinuousPageHeight(8), 628);
});

for (const reason of ["document", "render", "user-input"]) {
  test(`an old scroll correction cannot overwrite the current reading position after ${reason} changes`, () => {
    const { context, wrap, frames, cancelled } = setup();
    context.setContinuousScrollTop(1000);
    const [id, oldCallback] = [...frames][0];
    wrap.scrollTop = 5000;
    if (reason === "document") context.documentOpenToken++;
    if (reason === "render") context.renderToken++;
    if (reason === "user-input") context.cancelContinuousScrollCorrection();
    // Also invoke a callback that the browser had already dequeued for the frame.
    oldCallback();
    assert.equal(wrap.scrollTop, 5000);
    if (reason === "user-input") assert.ok(cancelled.includes(id));
  });
}

test("a current scroll correction still restores the requested offset if the browser transiently resets it", () => {
  const { context, wrap, frames } = setup();
  context.setContinuousScrollTop(1000);
  wrap.scrollTop = 0;
  [...frames.values()][0]();
  assert.equal(wrap.scrollTop, 1000);
});

test("capturing and restoring an anchor uses the real visible page when the height model disagrees", () => {
  const { context, wrap, shells } = setup();
  wrap.scrollTop = 7000;
  // Physical layout puts page 10 at the marker; the stale model says page 12.
  shells.splice(0, shells.length, {
    dataset: { page: "10" },
    getBoundingClientRect: () => ({ top: 7050 - wrap.scrollTop, bottom: 7650 - wrap.scrollTop, height: 600 }),
  });
  assert.notEqual(context.getContinuousPageNumberAtOffset(wrap.scrollTop + 210), 10);
  const anchor = context.captureContinuousReadingAnchor();
  assert.equal(anchor.page, 10);
  assert.equal(anchor.offsetRatio, 0.35);
  wrap.scrollTop = 7200;
  assert.equal(context.restoreContinuousReadingAnchor(anchor), true);
  assert.equal(wrap.scrollTop, 7000);
});

test("delayed resume callbacks cannot restore an old position after user input or a new render", () => {
  for (const reason of ["user-input", "render", "document", "suppressed"]) {
    const { context, wrap, frames, timers } = setup();
    let restored = 0;
    context.restoreContinuousScrollPosition = () => restored++;
    wrap.scrollTop = 0;
    context.restoreReaderPositionAfterResume();
    if (reason === "user-input") context.cancelContinuousScrollCorrection();
    if (reason === "render") context.renderToken++;
    if (reason === "document") context.documentOpenToken++;
    if (reason === "suppressed") context.scrollTrackingSuppressionDepth++;
    for (const callback of frames.values()) callback();
    for (const timer of timers) timer.callback();
    assert.equal(restored, 0, reason);
    assert.deepEqual(timers.map((timer) => timer.delay), [80, 260]);
  }
});
