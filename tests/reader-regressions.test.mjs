import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { createExportBlob, releaseExportBlob, transferExportBlobCleanup, MAX_MEMORY_EXPORT_BYTES } from "../src/export-blobs.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
function load(context, names) {
  context.pdfTools ??= null;
  context.pdfNavigator ??= null;
  for (const name of names) {
    const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(start, `Missing function ${name}`);
    const rest = source.slice(start.index + start[0].length);
    const end = /\n(?:async )?function \w+\(/.exec(rest);
    vm.runInContext(source.slice(start.index, start.index + start[0].length + end.index), context);
  }
}
const noop = () => {};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

test("a blank first page completes before the open operation returns", async () => {
  let committed = 0;
  let released = 0;
  let rendered = 0;
  const context = vm.createContext({
    state: { page: 1 }, renderToken: 0, documentOpenToken: 1, renderTask: null,
    pdfDoc: { numPages: 3, getPage: async () => ({ render: () => { rendered++; return { promise: Promise.resolve() }; } }) },
    clamp, PDF_RENDER_TIMEOUT_MS: 1000, lastLayoutWidth: 0,
    document: { createElement: () => ({ width: 10, height: 10 }) },
    els: { canvas: {}, canvasWrap: {} },
    waitForPdfOperation: async (promise) => promise,
    updateViewerMode: noop, updateControls: noop, showStatus: noop, hideStatus: noop,
    cancelCurrentRender: noop, clearContinuousPages: noop,
    getAvailableCanvasWidth: () => 10, getScaledViewport: () => ({}), prepareCanvas: () => ({}),
    commitRenderedCanvas: () => committed++, releaseCanvasBitmap: () => released++,
    saveReaderState: noop, isDocumentOpenCurrent: () => true,
    // Blankness must not turn a successful PDF.js render into a failed open.
    isCanvasLikelyBlank: () => true,
  });
  load(context, ["renderPage", "renderInitialPdfView"]);
  context.renderCurrentView = context.renderPage;
  assert.equal(await context.renderInitialPdfView(1), true);
  assert.equal(rendered, 1);
  assert.equal(committed, 1);
  assert.equal(released, 1);
});

test("continuous health checks accept blank content and cap lost-ink recovery", async () => {
  let recoveries = 0;
  const canvas = { width: 10, height: 10 };
  const shell = { dataset: { rendered: "true", expectedInk: "false" }, querySelector: () => canvas };
  const context = vm.createContext({
    pdfDoc: {}, isScrollMode: () => true, els: { continuousPages: { childElementCount: 1 } },
    renderToken: 1, documentOpenToken: 1,
    getVisibleContinuousShells: () => [shell], getContinuousMaxRenderedPages: () => 3,
    getContinuousShellPageNumber: () => 1, isCanvasLikelyBlank: () => true,
    continuousBlankRetries: new Map(), pendingContinuousPages: new Map(),
    continuousRenderPromises: new Map(), pageRenderTasks: new Map(), continuousRenderRuns: new Map([[1, 1]]),
    getContinuousBlankRetryLimit: () => 3, recoverContinuousPageRender: () => recoveries++,
    scheduleContinuousHealthCheck: noop, CONTINUOUS_HEALTH_CHECK_INTERVAL_MS: 1500,
    CONTINUOUS_RENDER_TIMEOUT_MS: 60000,
  });
  load(context, ["checkVisibleContinuousPages"]);
  for (let i = 0; i < 5; i++) context.checkVisibleContinuousPages();
  assert.equal(recoveries, 0);
  shell.dataset.expectedInk = "true";
  for (let i = 0; i < 5; i++) context.checkVisibleContinuousPages();
  assert.equal(recoveries, 3);
  Object.assign(context, {
    pdfDoc: { getPage: async () => ({ render: () => ({ promise: Promise.resolve() }) }) },
    isContinuousShellNearViewport: () => true, getContinuousRenderViewports: () => 1,
    waitForPdfOperation: async (promise) => promise, PDF_RENDER_TIMEOUT_MS: 1000,
    isContinuousRenderCurrent: () => true, getScaledViewport: () => ({}),
    shouldRenderContinuousDirectToTarget: () => false,
    document: { createElement: () => canvas }, prepareCanvas: () => ({}), noteSelfTestMetric: noop,
    ensureContinuousCanvas: () => canvas, commitRenderedCanvas: noop, releaseCanvasBitmap: noop,
    pruneContinuousPages: noop,
  });
  load(context, ["renderContinuousPageInternal"]);
  assert.equal(await context.renderContinuousPageInternal(1, shell, 1, 1, 1), true);
  context.checkVisibleContinuousPages();
  assert.equal(recoveries, 3, "successful blank render must not reset exhausted recovery budget");
});

function temporaryContext(format) {
  const values = new Map();
  const context = vm.createContext({
    console: { error: noop, warn: noop },
    state: { documentId: "doc:old-book", fileName: "old.pdf", page: 88, scrollPage: 88, zoom: 1, mode: "paged", epubCfi: "old-cfi" },
    pdfDoc: { numPages: 100 }, epubBook: null, activePdfLoadingTask: null, activePdfRangeFailurePromise: null,
    pdfNavigationTransaction: null,
    DOCUMENT_FORMATS: { PDF: "pdf", EPUB: "epub" }, STATE_KEY: "state", PROGRESS_KEY: "progress", PDF_LOAD_TIMEOUT_MS: 1000,
    EncryptedDocumentSource: class {}, BlobDocumentSource: class { constructor(blob) { this.blob = blob; this.length = blob.size; } },
    beginDocumentOpen: () => 1, isDocumentOpenCurrent: () => true,
    isScrollMode: () => false, isDeferredPdfProgressSaveGuardActive: () => false,
    window: { localStorage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }, clearTimeout: noop },
    clamp, waitForPdfOperation: async (promise) => promise,
    getDocumentFormatFromFile: () => format, getFallbackDocumentName: () => `unnamed.${format}`,
    isSupportedDocumentFile: () => true, isEncryptedBackupFile: () => false,
    getLockConfig: () => null, sessionPassword: "", scrollStateTimer: null,
    saveDocumentFile: async () => { throw new DOMException("Storage full", "QuotaExceededError"); },
    createPdfLoadingTaskFromSource: async () => ({ promise: Promise.resolve({ numPages: 10 }) }),
  });
  for (const name of ["recordDiagnosticEvent", "summarizeFile", "summarizeError", "rememberOpenDiagnostic", "showStatus", "hideStatus", "updateControls", "updateViewerMode", "setReaderVisible", "destroyPdfLoadingTask"]) context[name] = noop;
  context.closeCurrentDocument = async () => { context.pdfDoc = null; };
  load(context, ["getProgressMap", "saveDocumentProgress", "saveReaderState", "persistReaderPositionNow", "loadPdfFromSource", "loadPdfFromBlob", "openTemporaryDocument", "handleFileSelection"]);
  context.renderInitialPdfViewWithFallback = async () => { context.saveReaderState(); return true; };
  context.loadEpubFromBlob = async (blob, meta) => {
    assert.equal(meta.id, "");
    assert.equal(context.state.epubCfi, "");
    context.saveReaderState();
    return true;
  };
  return { context, values };
}

for (const format of ["pdf", "epub"]) {
  test(`quota fallback for ${format} preserves the previous book and last-document state`, async () => {
    const { context, values } = temporaryContext(format);
    assert.equal(await context.handleFileSelection({ name: `new.${format}`, size: 1024 }), true);
    assert.equal(context.state.documentId, "");
    context.state.page = 5;
    context.saveReaderState();
    assert.equal(JSON.parse(values.get("progress"))["doc:old-book"].page, 88);
    assert.equal(JSON.parse(values.get("state")).documentId, "doc:old-book");
    assert.equal(JSON.parse(values.get("state")).page, 88);
  });
}

test("file-open failures are not overwritten by a success message", async () => {
  const { context } = temporaryContext("pdf");
  let status = "";
  context.showStatus = (message) => { status = message; };
  context.saveDocumentFile = async () => ({ id: "doc:broken" });
  context.deleteDocumentProgress = noop;
  context.openDocumentRecord = async () => { status = "PDF failed to open"; return false; };
  assert.equal(await context.handleFileSelection({ name: "broken.pdf", size: 10 }), false);
  assert.equal(status, "PDF failed to open");
});

test("a large library reads its progress map once", async () => {
  let reads = 0;
  const element = () => ({ dataset: {}, classList: { toggle: noop }, append: noop, replaceChildren: noop });
  const context = vm.createContext({
    els: { libraryOverlay: { hidden: false }, libraryList: element(), libraryEmptyState: {} },
    libraryListDirty: true, libraryRenderRequestId: 0, libraryRecordCache: new Map(),
    performance, waitForNextFrame: async () => {},
    readLibraryDocuments: async () => Array.from({ length: 1000 }, (_, i) => ({ id: `doc:${i}` })),
    getProgressMap: () => { reads++; return {}; },
    document: { createElement: element, createDocumentFragment: element }, state: {},
    getDocumentFormat: () => "pdf", DOCUMENT_FORMATS: { EPUB: "epub" },
    getImmediateRecordDisplayName: () => "test.pdf", isRecordNameEncrypted: () => false,
    isRecordEncrypted: () => false, formatFileSize: () => "1 MB", getStoredPayloadSize: () => 0,
    recordDiagnosticEvent: noop, resolveLibraryRecordNames: async () => {}, console,
  });
  load(context, ["renderLibraryList"]);
  await context.renderLibraryList();
  assert.equal(context.libraryRecordCache.size, 1000);
  assert.equal(context.libraryListDirty, false);
  assert.equal(reads, 1);
});

test("small exports preserve bytes and reject incomplete or oversized payloads", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const blob = await createExportBlob([bytes.subarray(1), new Uint8Array([4]).buffer], { size: 3, type: "application/pdf" });
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([2, 3, 4]));
  assert.equal(blob.type, "application/pdf");
  await assert.rejects(createExportBlob([bytes], { size: 4 }), /expected 4/);
  await assert.rejects(createExportBlob([bytes], { size: 2 }), /exceeds/);
});

test("unsupported large-file storage fails before reading the document into memory", async () => {
  const originalWorker = globalThis.Worker;
  globalThis.Worker = undefined;
  let reads = 0;
  async function* chunks() {
    reads++;
    yield new Uint8Array(1);
  }
  try {
    await assert.rejects(
      createExportBlob(chunks(), { size: MAX_MEMORY_EXPORT_BYTES + 1 }),
      (error) => /HTTPS/.test(error.userMessage),
    );
    assert.equal(reads, 0);
  } finally {
    globalThis.Worker = originalWorker;
  }
});

test("large exports await partial file writes, preserve source buffers and clean up on success/failure", async () => {
  const originalWorker = globalThis.Worker;
  const files = new Map();
  let writes = 0;
  let failWrite = false;
  globalThis.Worker = class {
    constructor() {
      const worker = this;
      const scope = vm.createContext({
        navigator: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => ({
          async *entries() { yield* []; },
          removeEntry: async (name) => { files.delete(name); },
          getFileHandle: async (name) => {
            const chunks = [];
            files.set(name, chunks);
            return {
              createSyncAccessHandle: async () => ({
                write: (bytes) => {
                  if (failWrite) throw new DOMException("Full", "QuotaExceededError");
                  writes++;
                  const length = Math.min(bytes.length, 256 * 1024);
                  chunks.push(bytes.slice(0, length));
                  return length;
                }, flush: noop, close: noop,
              }),
              getFile: async () => new Blob(chunks),
            };
          },
        }) }) } },
        crypto, Uint8Array, self: { postMessage: (data) => queueMicrotask(() => worker.onmessage?.({ data })) },
      });
      vm.runInContext(fs.readFileSync(new URL("../src/export-worker.js", import.meta.url), "utf8"), scope);
      this.scope = scope;
    }
    postMessage(data, transfer) {
      const copy = structuredClone(data, { transfer });
      queueMicrotask(() => this.scope.self.onmessage({ data: copy }));
    }
    terminate() {}
  };
  try {
    const sourceChunk = new Uint8Array(1024 * 1024).fill(37);
    async function* chunks() {
      for (let i = 0; i < 32; i++) yield sourceChunk;
      yield new Uint8Array([91]);
    }
    const blob = await createExportBlob(chunks(), { size: MAX_MEMORY_EXPORT_BYTES + 1 });
    assert.equal(sourceChunk.byteLength, 1024 * 1024);
    assert.equal(new Uint8Array(await blob.slice(0, 1).arrayBuffer())[0], 37);
    assert.equal(new Uint8Array(await blob.slice(-1).arrayBuffer())[0], 91);
    assert.equal(writes, 129, "worker must handle short writes");
    const backupBlob = new Blob(["header", blob]);
    transferExportBlobCleanup(blob, backupBlob);
    await releaseExportBlob(blob);
    assert.equal(files.size, 1, "wrapped export must keep its backing file alive");
    await releaseExportBlob(backupBlob);
    assert.equal(files.size, 0);
    failWrite = true;
    await assert.rejects(createExportBlob(chunks(), { size: MAX_MEMORY_EXPORT_BYTES + 1 }), { name: "QuotaExceededError" });
    assert.equal(files.size, 0, "failed export must remove its incomplete file");
  } finally {
    globalThis.Worker = originalWorker;
  }
});
