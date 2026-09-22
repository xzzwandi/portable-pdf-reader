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
function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}
function lifecycleContext() {
  const context = vm.createContext({
    renderToken: 1, documentOpenToken: 1, renderTask: null, continuousQueueOwner: null,
    pdfDoc: {}, isScrollMode: () => true,
    clearContinuousHealthTimer: noop, clearContinuousCleanupTimer: noop, clearContinuousScrollUpdate: noop,
    pendingContinuousPages: new Map(), pageRenderTasks: new Map(), continuousRenderPromises: new Map(),
    continuousRenderRuns: new Map(), continuousPinnedPages: new Set(), continuousBlankRetries: new Map(),
    continuousPageFailures: new Map(), continuousPageHeightOverrides: new Map(),
    pageObserver: null, pdfTools: null,
    els: { continuousPages: { querySelectorAll: () => [], replaceChildren: noop } },
  });
  load(context, ["cancelCurrentRender", "clearContinuousPages", "runContinuousRenderQueue"]);
  return context;
}

for (const reset of ["cancelCurrentRender", "clearContinuousPages"]) {
  test(`${reset} lets a replacement queue run while the old page load is pending`, async () => {
    const context = lifecycleContext();
    const oldPage = deferred();
    const currentPage = deferred();
    const starts = [];
    const timers = [];
    Object.assign(context, {
      window: { setTimeout: (callback) => timers.push(callback) },
      getNextQueuedContinuousPage() {
        const item = context.pendingContinuousPages.entries().next().value;
        if (!item) return null;
        context.pendingContinuousPages.delete(item[0]);
        return { pageNumber: item[0], token: item[1] };
      },
      async renderContinuousPageWithTimeout(page, token) {
        starts.push([page, token]);
        if (token === 1) await oldPage.promise;
        else if (page === 9) await currentPage.promise;
      },
    });
    context.pendingContinuousPages.set(2, 1);
    const retiredRun = context.runContinuousRenderQueue();
    context.renderToken = 2;
    context[reset]();
    context.pendingContinuousPages.set(9, 2);
    const activeRun = context.runContinuousRenderQueue();
    const activeOwner = context.continuousQueueOwner;
    assert.deepEqual(starts, [[2, 1], [9, 2]], "new layout must not wait for the old getPage() or its timeout");

    oldPage.resolve();
    await retiredRun;
    assert.equal(context.continuousQueueOwner, activeOwner, "old finally must not unlock the active queue");
    assert.equal(timers.length, 0, "retired queue must not schedule a competing runner");

    context.pendingContinuousPages.set(10, 2);
    await context.runContinuousRenderQueue();
    assert.equal(starts.length, 2, "only the active owner may drain pending work");
    currentPage.resolve();
    await activeRun;
    assert.deepEqual(starts, [[2, 1], [9, 2], [10, 2]]);
    assert.equal(context.continuousQueueOwner, null);
  });
}

test("continuous rebuild releases every bitmap and text layer before detaching the DOM", () => {
  const context = lifecycleContext();
  const canvases = [{ width: 2400, height: 3600 }, { width: 2400, height: 3600 }];
  let textCleared = false;
  let detached = false;
  let disconnected = false;
  let cancelled = 0;
  Object.assign(context, {
    continuousQueueOwner: {},
    pageObserver: { disconnect: () => { disconnected = true; } },
    pdfTools: { clearTextLayers: () => { textCleared = true; } },
    els: { continuousPages: {
      querySelectorAll: (selector) => { assert.equal(selector, "canvas"); return canvases; },
      replaceChildren() {
        assert.equal(textCleared, true);
        assert.equal(disconnected, true);
        assert.ok(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
        detached = true;
      },
    } },
  });
  context.pageRenderTasks.set(1, { cancel() { cancelled++; throw new Error("already stopped"); } });
  context.pageRenderTasks.set(2, { cancel() { cancelled++; } });
  context.pendingContinuousPages.set(2, 1);
  context.continuousRenderPromises.set(1, Promise.resolve());
  context.clearContinuousPages();
  assert.equal(cancelled, 2, "one failed cancellation must not interrupt bitmap cleanup");
  assert.equal(detached, true);
  assert.equal(context.continuousQueueOwner, null);
  assert.equal(context.pendingContinuousPages.size, 0);
  assert.equal(context.continuousRenderPromises.size, 0);
  assert.equal(context.pageRenderTasks.size, 0);
});

for (const generationKey of ["renderToken", "documentOpenToken"]) {
  test(`a retired render cannot prune the new view after ${generationKey} changes`, async () => {
    const context = lifecycleContext();
    const loadingPage = deferred();
    let pruned = 0;
    let cleaned = 0;
    const shell = { dataset: { page: "4", renderRunId: "1" } };
    const newTask = {};
    Object.assign(context, {
      pdfDoc: { getPage: () => loadingPage.promise }, PDF_RENDER_TIMEOUT_MS: 60_000,
      waitForPdfOperation: (promise) => promise,
      isContinuousRenderCurrent: (page, target, token, run) => token === context.renderToken && context.continuousRenderRuns.get(page) === run,
      releaseCanvasBitmap: noop,
      pruneContinuousPages: () => pruned++,
      console: { error: noop },
    });
    context.continuousRenderRuns.set(4, 1);
    load(context, ["renderContinuousPageInternal"]);
    const retired = context.renderContinuousPageInternal(4, shell, 1, 1, 1, { force: true });
    context[generationKey] = 2;
    context.continuousRenderRuns.set(4, 2);
    context.pageRenderTasks.set(4, newTask);
    loadingPage.resolve({ cleanup: () => cleaned++ });
    assert.equal(await retired, false);
    assert.equal(pruned, 0);
    assert.equal(cleaned, 1, "old PDF page resources are still cleaned up");
    assert.equal(context.continuousRenderRuns.get(4), 2);
    assert.equal(context.pageRenderTasks.get(4), newTask);
  });
}

function scrollInputContext() {
  const domUpdates = [];
  const queued = [];
  const frames = [];
  const cancelledFrames = [];
  const context = vm.createContext({
    renderToken: 2, documentOpenToken: 3, continuousScrollIntent: 5,
    continuousScrollCorrectionFrame: 7, continuousScrollFrame: 0,
    continuousProgrammaticScrollTarget: 12, continuousProgrammaticScrollUntil: 2200,
    scrollTrackingSuppressionDepth: 0, scrollStateTimer: null,
    Date: { now: () => 1500 },
    state: { page: 12 }, pdfDoc: { numPages: 100 }, isScrollMode: () => true,
    CONTINUOUS_READING_MARKER_RATIO: 0.35,
    els: { canvasWrap: { scrollTop: 20_000, clientHeight: 700 }, continuousPages: { childElementCount: 24 } },
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    window: {
      cancelAnimationFrame: (id) => cancelledFrames.push(id),
      requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
      clearTimeout: noop, setTimeout: () => 1,
    },
    getContinuousPageNumberAtOffset: () => 50,
    captureContinuousReadingAnchor: () => ({ page: 50 }),
    captureContinuousScrollPosition: () => true,
    ensureContinuousDomWindow: (page) => domUpdates.push(page),
    getContinuousShellByPageNumber: () => ({}),
    getContinuousPageTop: () => 1000,
    scheduleContinuousPageRender: noop,
    queueVisibleContinuousPages: (token) => queued.push(token),
    pruneContinuousPages: noop, updateControls: noop, saveReaderState: noop,
    isLikelyTransientTopJump: () => false,
  });
  context.isScrollTrackingSuppressed = () => context.scrollTrackingSuppressionDepth > 0;
  context.applyContinuousScrollTopInstant = (top) => { context.els.canvasWrap.scrollTop = top; };
  load(context, ["cancelContinuousScrollCorrection", "handleContinuousScrollInput", "updateCurrentPageFromScroll", "scheduleContinuousScrollUpdate", "scrollToContinuousPage"]);
  return { context, domUpdates, queued, frames, cancelledFrames };
}

test("real reader input cancels the old jump's 1.2-second tracking guard and updates the new visible page", () => {
  const { context, domUpdates, queued, cancelledFrames } = scrollInputContext();
  context.updateCurrentPageFromScroll();
  assert.equal(domUpdates.length, 0, "the active programmatic jump initially owns position tracking");

  context.handleContinuousScrollInput();
  context.updateCurrentPageFromScroll();
  assert.equal(context.continuousProgrammaticScrollTarget, 0);
  assert.equal(context.continuousProgrammaticScrollUntil, 0);
  assert.equal(context.continuousScrollIntent, 6);
  assert.deepEqual(cancelledFrames, [7]);
  assert.deepEqual(domUpdates, [50], "the far-away viewport must replace the old DOM window immediately");
  assert.equal(context.state.page, 50);
  assert.deepEqual(queued, [2], "the newly visible pages must be queued without waiting for another gesture");
});

test("input during an awaited page jump replays the suppressed scroll update when the jump releases tracking", async () => {
  const { context, domUpdates, queued, frames } = scrollInputContext();
  const pendingFrame = deferred();
  context.waitForNextFrame = () => pendingFrame.promise;
  const jump = context.scrollToContinuousPage(12, { renderFirst: false });
  assert.equal(context.scrollTrackingSuppressionDepth, 1);
  assert.deepEqual(domUpdates, [12]);

  context.handleContinuousScrollInput();
  context.els.canvasWrap.scrollTop = 20_000;
  context.scheduleContinuousScrollUpdate();
  assert.equal(frames.length, 0, "the real scroll event arrives while the old jump still suppresses tracking");
  pendingFrame.resolve();
  await jump;
  assert.equal(context.scrollTrackingSuppressionDepth, 0);
  assert.equal(context.els.canvasWrap.scrollTop, 20_000, "the retired jump must not restore its old offset");
  assert.equal(frames.length, 1, "the jump's finally must schedule the missed position update");
  frames.shift()();
  assert.deepEqual(domUpdates, [12, 50]);
  assert.equal(context.state.page, 50);
  assert.deepEqual(queued, [2]);
});
