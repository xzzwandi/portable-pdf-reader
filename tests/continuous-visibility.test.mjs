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

function makeShell(page, { top = 0, bottom = 200, near = true, distance = page, rendered = true } = {}) {
  const shell = {
    dataset: { page: String(page), ...(rendered ? { rendered: "true" } : {}) },
    canvas: rendered ? { width: 600, height: 800 } : null,
    near,
    distance,
    getBoundingClientRect: () => ({ top, bottom }),
    querySelector: (selector) => selector === "canvas" ? shell.canvas : null,
  };
  return shell;
}

function setup(shells, maxPages = 3) {
  const released = [];
  let cleanupScheduled = 0;
  const context = vm.createContext({
    pdfTools: null, pdfDoc: {}, state: { page: 1, scrollPage: 1 },
    continuousPinnedPages: new Set(), pageRenderTasks: new Map(),
    continuousRenderPromises: new Map(), pendingContinuousPages: new Map(),
    isScrollMode: () => true,
    els: {
      canvasWrap: { getBoundingClientRect: () => ({ top: 0, bottom: 1000 }) },
      continuousPages: {
        childElementCount: shells.length,
        querySelectorAll: (selector) => selector.includes("data-rendered")
          ? shells.filter((shell) => shell.dataset.rendered === "true") : shells,
      },
    },
    getContinuousShellPageNumber: (shell) => Number(shell.dataset.page),
    getContinuousShellByPageNumber: (page) => shells.find((shell) => Number(shell.dataset.page) === page),
    isContinuousShellNearViewport: (shell) => shell.near,
    getContinuousRenderViewports: () => 1,
    getContinuousShellDistance: (shell) => shell.distance,
    getContinuousMaxRenderedPages: () => maxPages,
    releaseContinuousCanvas: (shell) => {
      released.push(Number(shell.dataset.page));
      shell.canvas = null;
      delete shell.dataset.rendered;
    },
    scheduleContinuousPdfCleanup: () => cleanupScheduled++,
  });
  load(context, ["getActuallyVisibleContinuousShells", "isPinnedContinuousPage", "pruneContinuousPages"]);
  return { context, released, cleanupCount: () => cleanupScheduled };
}

test("four actually visible pages survive a three-page mobile cache limit", () => {
  const visible = [1, 2, 3, 4].map((page) => makeShell(page, { top: (page - 1) * 240, bottom: page * 240 }));
  const prefetched = makeShell(5, { top: 1050, bottom: 1290 });
  const { context, released } = setup([...visible, prefetched]);
  context.pruneContinuousPages();
  assert.deepEqual(released, [5]);
  assert.ok(visible.every((shell) => shell.canvas && shell.dataset.rendered === "true"));
});

test("actual visibility protects both canvas and pending render when estimated page positions disagree", () => {
  const visible = makeShell(12, { top: 50, bottom: 850, near: false });
  const distant = makeShell(15, { top: 2000, bottom: 2600, near: false });
  const { context, released } = setup([visible, distant]);
  const cancelled = [];
  context.pageRenderTasks.set(12, { cancel: () => cancelled.push(12) });
  context.pageRenderTasks.set(15, { cancel: () => cancelled.push(15) });
  context.pageRenderTasks.set(99, { cancel: () => cancelled.push(99) });
  context.pruneContinuousPages();
  assert.deepEqual(cancelled, [15, 99]);
  assert.deepEqual(released, [15]);
  assert.equal(context.pageRenderTasks.has(12), true);
  assert.ok(visible.canvas);
});

test("fullscreen pins and current reading pages are preserved even when their count exceeds the cache limit", () => {
  const shells = [1, 2, 3, 4].map((page) => makeShell(page, { top: 2000 + page * 300, bottom: 2300 + page * 300, near: false }));
  const { context, released } = setup(shells);
  context.state.page = 1;
  context.state.scrollPage = 2;
  context.continuousPinnedPages.add(3);
  context.continuousPinnedPages.add(4);
  context.pruneContinuousPages();
  assert.deepEqual(released, []);
  assert.ok(shells.every((shell) => shell.canvas));
});

test("only the nearest offscreen prefetch pages fill the remaining cache budget", () => {
  const visible = makeShell(1, { top: 100, bottom: 700 });
  const near = [2, 3, 4, 5].map((page) => makeShell(page, { top: 1100 + page * 300, bottom: 1400 + page * 300, distance: page }));
  const far = makeShell(6, { top: 5000, bottom: 5600, near: false });
  const { context, released, cleanupCount } = setup([visible, ...near, far]);
  context.pruneContinuousPages();
  assert.deepEqual(released.sort((a, b) => a - b), [4, 5, 6]);
  assert.ok(visible.canvas);
  assert.ok(near[0].canvas && near[1].canvas);
  assert.equal(cleanupCount(), 1);
});

test("a completed visible render retains its canvas through its own finally cleanup", async () => {
  const shells = [1, 2, 3, 4].map((page) => makeShell(page, {
    top: (page - 1) * 240,
    bottom: page * 240,
    rendered: page !== 4,
    distance: page * 100,
  }));
  const target = shells[3];
  const { context, released } = setup(shells);
  Object.assign(context, {
    pdfDoc: { getPage: async () => ({ render: () => ({ promise: Promise.resolve() }) }) },
    renderToken: 1, documentOpenToken: 1,
    continuousRenderRuns: new Map([[4, 1]]), continuousBlankRetries: new Map(),
    waitForPdfOperation: async (promise) => promise, PDF_RENDER_TIMEOUT_MS: 1000,
    isContinuousRenderCurrent: () => true,
    getScaledViewport: () => ({ width: 600, height: 800 }),
    shouldRenderContinuousDirectToTarget: () => true,
    ensureContinuousCanvas: (shell) => (shell.canvas ||= { width: 600, height: 800 }),
    prepareCanvas: noop, noteSelfTestMetric: noop,
    isCanvasLikelyBlank: () => false, scheduleContinuousHealthCheck: noop,
    releaseCanvasBitmap: noop,
  });
  load(context, ["renderContinuousPageInternal"]);
  assert.equal(await context.renderContinuousPageInternal(4, target, 1, 1, 1, { force: true }), true);
  assert.equal(target.dataset.rendered, "true");
  assert.ok(target.canvas?.width > 1, "success must not be followed by reclaiming the page still on screen");
  assert.deepEqual(released, []);
});
