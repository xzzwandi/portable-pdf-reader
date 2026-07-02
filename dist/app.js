import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

const PDFJS_ROOT = new URL("./vendor/pdfjs/", import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_ROOT}pdf.worker.min.mjs`;

const DB_NAME = "portable-pdf-reader";
const DB_VERSION = 1;
const STORE_NAME = "documents";
const DOCUMENT_ID_PREFIX = "doc:";
const LAST_DOCUMENT_ID = "last-document";
const LOCK_KEY = "portable-pdf-reader-lock";
const PROGRESS_KEY = "portable-pdf-reader-document-progress";
const STATE_KEY = "portable-pdf-reader-state";
const APP_VERSION = "v16";
const DOCUMENT_FORMATS = {
  PDF: "pdf",
  EPUB: "epub",
};
const READ_MODES = {
  PAGED: "paged",
  SCROLL: "scroll",
};

const els = {
  canvas: document.querySelector("#pdfCanvas"),
  canvasWrap: document.querySelector("#canvasWrap"),
  continuousPages: document.querySelector("#continuousPages"),
  controls: document.querySelector("#controls"),
  appVersion: document.querySelector("#appVersion"),
  docName: document.querySelector("#docName"),
  edgeJumpGroup: document.querySelector("#edgeJumpGroup"),
  emptyOpenButton: document.querySelector("#emptyOpenButton"),
  emptyState: document.querySelector("#emptyState"),
  epubPane: document.querySelector("#epubPane"),
  epubViewer: document.querySelector("#epubViewer"),
  fileInput: document.querySelector("#fileInput"),
  fitButton: document.querySelector("#fitButton"),
  floatingLockButton: document.querySelector("#floatingLockButton"),
  jumpBottomButton: document.querySelector("#jumpBottomButton"),
  jumpTopButton: document.querySelector("#jumpTopButton"),
  libraryButton: document.querySelector("#libraryButton"),
  libraryCloseButton: document.querySelector("#libraryCloseButton"),
  libraryEmptyState: document.querySelector("#libraryEmptyState"),
  libraryList: document.querySelector("#libraryList"),
  libraryOverlay: document.querySelector("#libraryOverlay"),
  lockButton: document.querySelector("#lockButton"),
  lockCancelButton: document.querySelector("#lockCancelButton"),
  lockConfirmInput: document.querySelector("#lockConfirmInput"),
  lockDescription: document.querySelector("#lockDescription"),
  lockForm: document.querySelector("#lockForm"),
  lockOverlay: document.querySelector("#lockOverlay"),
  lockPasswordInput: document.querySelector("#lockPasswordInput"),
  lockSubmitButton: document.querySelector("#lockSubmitButton"),
  lockTitle: document.querySelector("#lockTitle"),
  nextButton: document.querySelector("#nextButton"),
  openButton: document.querySelector("#openButton"),
  pageInput: document.querySelector("#pageInput"),
  pageTotal: document.querySelector("#pageTotal"),
  pagedModeButton: document.querySelector("#pagedModeButton"),
  prevButton: document.querySelector("#prevButton"),
  scrollModeButton: document.querySelector("#scrollModeButton"),
  status: document.querySelector("#status"),
  viewerPane: document.querySelector("#viewerPane"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
};

let pdfDoc = null;
let epubBook = null;
let epubRendition = null;
let renderTask = null;
let pageObserver = null;
let lastViewportChangeAt = 0;
let renderToken = 0;
let lastLayoutWidth = 0;
let lockMode = "unlock";
let lockScrollY = 0;
let scrollTrackingSuppressionDepth = 0;
let statusTimer = null;
let resizeTimer = null;
let scrollStateTimer = null;
let touchStart = null;

const pageRenderTasks = new Map();

const state = {
  documentId: "",
  format: DOCUMENT_FORMATS.PDF,
  fileName: "",
  epubCfi: "",
  epubProgress: 0,
  page: 1,
  scrollOffsetRatio: 0,
  scrollPage: 1,
  scrollTop: 0,
  zoom: 1,
  mode: READ_MODES.PAGED,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isScrollMode() {
  return state.format === DOCUMENT_FORMATS.PDF && state.mode === READ_MODES.SCROLL;
}

function isPdfDocument() {
  return state.format === DOCUMENT_FORMATS.PDF;
}

function isEpubDocument() {
  return state.format === DOCUMENT_FORMATS.EPUB;
}

function isScrollTrackingSuppressed() {
  return scrollTrackingSuppressionDepth > 0;
}

function getLockConfig() {
  try {
    const config = JSON.parse(window.localStorage.getItem(LOCK_KEY) || "null");
    return config?.salt && config?.hash ? config : null;
  } catch {
    return null;
  }
}

function setLockConfig(config) {
  window.localStorage.setItem(LOCK_KEY, JSON.stringify(config));
}

function createSalt() {
  if (!window.crypto?.getRandomValues) {
    return hashString(`${Date.now()}:${Math.random()}`);
  }

  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  if (!window.crypto?.subtle) {
    return hashString(`${salt}:${password}:local-lock`);
  }

  const input = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await window.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function configureLockOverlay(mode) {
  lockMode = mode;
  els.lockPasswordInput.value = "";
  els.lockConfirmInput.value = "";
  els.lockConfirmInput.hidden = mode !== "setup";
  els.lockCancelButton.hidden = mode !== "setup";

  if (mode === "setup") {
    els.lockTitle.textContent = "设置密码";
    els.lockDescription.textContent = "设置后，打开这个阅读器需要先输入密码。";
    els.lockPasswordInput.placeholder = "设置密码，至少 4 位";
    els.lockPasswordInput.autocomplete = "new-password";
    els.lockSubmitButton.textContent = "保存并锁定";
  } else {
    els.lockTitle.textContent = "密码锁";
    els.lockDescription.textContent = "输入密码后继续阅读。";
    els.lockPasswordInput.placeholder = "输入密码";
    els.lockPasswordInput.autocomplete = "current-password";
    els.lockSubmitButton.textContent = "解锁";
  }
}

function freezePageBehindLock() {
  if (document.body.classList.contains("is-reader-locked")) {
    return;
  }

  lockScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.documentElement.classList.add("is-reader-locked");
  document.body.classList.add("is-reader-locked");
  document.body.style.top = `-${lockScrollY}px`;
}

function releasePageBehindLock() {
  if (!document.body.classList.contains("is-reader-locked")) {
    return;
  }

  document.documentElement.classList.remove("is-reader-locked");
  document.body.classList.remove("is-reader-locked");
  document.body.style.top = "";
  window.scrollTo(0, lockScrollY);
}

function showLockOverlay(mode = "unlock") {
  configureLockOverlay(mode);
  closeLibrary();
  els.floatingLockButton.hidden = true;
  freezePageBehindLock();
  els.lockOverlay.hidden = false;
  window.setTimeout(() => els.lockPasswordInput.focus(), 40);
}

function hideLockOverlay() {
  els.lockOverlay.hidden = true;
  releasePageBehindLock();
  els.floatingLockButton.hidden = false;
}

function lockReader() {
  if (!getLockConfig()) {
    showLockOverlay("setup");
    return;
  }

  persistReaderPositionNow();
  showLockOverlay("unlock");
}

async function handleLockSubmit(event) {
  event.preventDefault();

  const password = els.lockPasswordInput.value;

  if (password.length < 4) {
    showStatus("密码至少 4 位。");
    return;
  }

  if (lockMode === "setup") {
    if (password !== els.lockConfirmInput.value) {
      showStatus("两次输入的密码不一致。");
      return;
    }

    const salt = createSalt();
    const hash = await hashPassword(password, salt);
    setLockConfig({
      hash,
      salt,
      version: 1,
    });
    showStatus("密码锁已开启。");
    showLockOverlay("unlock");
    return;
  }

  const config = getLockConfig();

  if (!config) {
    hideLockOverlay();
    return;
  }

  const hash = await hashPassword(password, config.salt);

  if (hash !== config.hash) {
    showStatus("密码不对。");
    els.lockPasswordInput.select();
    return;
  }

  hideLockOverlay();
  showStatus("已解锁。");
  restoreReaderPositionAfterResume();
}

function showStatus(message, sticky = false) {
  window.clearTimeout(statusTimer);
  els.status.textContent = message;
  els.status.classList.add("show");

  if (!sticky) {
    statusTimer = window.setTimeout(() => {
      els.status.classList.remove("show");
    }, 2200);
  }
}

function hideStatus() {
  window.clearTimeout(statusTimer);
  els.status.classList.remove("show");
}

function readSavedState() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}");
    state.documentId = typeof saved.documentId === "string" ? saved.documentId : "";
    state.format =
      saved.format === DOCUMENT_FORMATS.EPUB ? DOCUMENT_FORMATS.EPUB : DOCUMENT_FORMATS.PDF;
    state.fileName = typeof saved.fileName === "string" ? saved.fileName : "";
    state.epubCfi = typeof saved.epubCfi === "string" ? saved.epubCfi : "";
    state.epubProgress = Number.isFinite(saved.epubProgress) ? saved.epubProgress : 0;
    state.page = Number.isFinite(saved.page) ? saved.page : 1;
    state.scrollPage = Number.isFinite(saved.scrollPage) ? saved.scrollPage : state.page;
    state.scrollOffsetRatio = Number.isFinite(saved.scrollOffsetRatio)
      ? saved.scrollOffsetRatio
      : 0;
    state.scrollTop = Number.isFinite(saved.scrollTop) ? saved.scrollTop : 0;
    state.zoom = Number.isFinite(saved.zoom) ? saved.zoom : 1;
    state.mode = saved.mode === READ_MODES.SCROLL ? READ_MODES.SCROLL : READ_MODES.PAGED;
  } catch {
    state.documentId = "";
    state.format = DOCUMENT_FORMATS.PDF;
    state.fileName = "";
    state.epubCfi = "";
    state.epubProgress = 0;
    state.page = 1;
    state.scrollPage = 1;
    state.scrollOffsetRatio = 0;
    state.scrollTop = 0;
    state.zoom = 1;
    state.mode = READ_MODES.PAGED;
  }
}

function saveReaderState() {
  try {
    if (isScrollMode()) {
      captureContinuousScrollPosition();
    }

    window.localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        documentId: state.documentId,
        epubCfi: state.epubCfi,
        epubProgress: state.epubProgress,
        fileName: state.fileName,
        format: state.format,
        mode: state.mode,
        page: state.page,
        scrollOffsetRatio: state.scrollOffsetRatio,
        scrollPage: state.scrollPage,
        scrollTop: state.scrollTop,
        zoom: state.zoom,
        savedAt: Date.now(),
      }),
    );
    saveDocumentProgress();
  } catch {
    // Some private browsing modes disable persistent storage.
  }
}

function openDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("这个浏览器不支持本地数据库。"));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("数据库打开失败。"));
  });
}

async function withStore(mode, callback) {
  const db = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = callback(store);

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("数据库操作失败。"));
      tx.onabort = () => reject(tx.error || new Error("数据库操作中断。"));
    });
  } finally {
    db.close();
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("数据库请求失败。"));
  });
}

function hashString(input) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function createDocumentId(name, size, lastModified = 0) {
  return `${DOCUMENT_ID_PREFIX}${hashString(`${name}|${size}|${lastModified}`)}`;
}

function isLibraryDocument(record) {
  return Boolean(record?.blob && typeof record.id === "string" && record.id.startsWith(DOCUMENT_ID_PREFIX));
}

function getDocumentFormatFromName(name = "") {
  return name.toLowerCase().endsWith(".epub") ? DOCUMENT_FORMATS.EPUB : DOCUMENT_FORMATS.PDF;
}

function getDocumentFormatFromFile(file) {
  if (file?.type === "application/epub+zip" || file?.name?.toLowerCase().endsWith(".epub")) {
    return DOCUMENT_FORMATS.EPUB;
  }

  if (file?.type === "application/pdf" || file?.name?.toLowerCase().endsWith(".pdf")) {
    return DOCUMENT_FORMATS.PDF;
  }

  return "";
}

function getDocumentFormat(record = {}) {
  if (record.format === DOCUMENT_FORMATS.EPUB || record.type === "application/epub+zip") {
    return DOCUMENT_FORMATS.EPUB;
  }

  if (record.format === DOCUMENT_FORMATS.PDF || record.type === "application/pdf") {
    return DOCUMENT_FORMATS.PDF;
  }

  return getDocumentFormatFromName(record.name || "");
}

function getProgressMap() {
  try {
    return JSON.parse(window.localStorage.getItem(PROGRESS_KEY) || "{}");
  } catch {
    return {};
  }
}

function readDocumentProgress(documentId) {
  const progress = getProgressMap()[documentId];
  return progress && typeof progress === "object" ? progress : null;
}

function saveDocumentProgress() {
  if (!state.documentId) {
    return;
  }

  try {
    const progressMap = getProgressMap();
    progressMap[state.documentId] = {
      epubCfi: state.epubCfi,
      epubProgress: state.epubProgress,
      fileName: state.fileName,
      format: state.format,
      mode: state.mode,
      page: state.page,
      scrollOffsetRatio: state.scrollOffsetRatio,
      scrollPage: state.scrollPage,
      scrollTop: state.scrollTop,
      updatedAt: Date.now(),
      zoom: state.zoom,
    };
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressMap));
  } catch {
    // Keep reading even if browser storage is temporarily unavailable.
  }
}

function deleteDocumentProgress(documentId) {
  try {
    const progressMap = getProgressMap();
    delete progressMap[documentId];
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressMap));
  } catch {
    // Best effort cleanup.
  }
}

function applyDocumentProgress(documentId, fallbackPage = 1) {
  const progress = readDocumentProgress(documentId);

  state.format =
    progress?.format === DOCUMENT_FORMATS.EPUB ? DOCUMENT_FORMATS.EPUB : state.format;
  state.epubCfi = typeof progress?.epubCfi === "string" ? progress.epubCfi : "";
  state.epubProgress = Number.isFinite(progress?.epubProgress) ? progress.epubProgress : 0;
  state.page = clamp(progress?.page || fallbackPage, 1, Number.MAX_SAFE_INTEGER);
  state.scrollPage = clamp(progress?.scrollPage || state.page, 1, Number.MAX_SAFE_INTEGER);
  state.scrollOffsetRatio = Number.isFinite(progress?.scrollOffsetRatio)
    ? progress.scrollOffsetRatio
    : 0;
  state.scrollTop = Number.isFinite(progress?.scrollTop) ? progress.scrollTop : 0;
  state.zoom = clamp(progress?.zoom || state.zoom || 1, 0.6, 2.6);

  if (progress?.mode === READ_MODES.SCROLL || progress?.mode === READ_MODES.PAGED) {
    state.mode = progress.mode;
  }
}

function formatFileSize(size = 0) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function getStoredDocument(documentId) {
  if (!documentId) {
    return null;
  }

  return withStore("readonly", (store) => requestToPromise(store.get(documentId)));
}

async function putStoredDocument(record) {
  return withStore("readwrite", (store) => requestToPromise(store.put(record)));
}

async function deleteStoredDocument(documentId) {
  return withStore("readwrite", (store) => requestToPromise(store.delete(documentId)));
}

async function getAllStoredRecords() {
  return withStore("readonly", (store) => requestToPromise(store.getAll()));
}

async function migrateLegacyDocument() {
  const legacy = await getStoredDocument(LAST_DOCUMENT_ID).catch(() => null);

  if (!legacy?.blob) {
    return null;
  }

  const id = createDocumentId(legacy.name || "未命名.pdf", legacy.size || legacy.blob.size || 0, 0);
  const existing = await getStoredDocument(id).catch(() => null);

  if (existing?.blob) {
    await deleteStoredDocument(LAST_DOCUMENT_ID).catch(() => {});
    return existing;
  }

  const record = {
    id,
    name: legacy.name || "未命名.pdf",
    size: legacy.size || legacy.blob.size || 0,
    type: legacy.type || "application/pdf",
    updatedAt: legacy.updatedAt || Date.now(),
    lastOpenedAt: legacy.updatedAt || Date.now(),
    blob: legacy.blob,
  };

  await putStoredDocument(record);
  await deleteStoredDocument(LAST_DOCUMENT_ID).catch(() => {});
  return record;
}

async function readLibraryDocuments() {
  await migrateLegacyDocument();
  const records = await getAllStoredRecords();

  return records
    .filter(isLibraryDocument)
    .sort((a, b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0));
}

async function saveDocumentFile(file) {
  const format = getDocumentFormatFromFile(file);
  const fallbackName = format === DOCUMENT_FORMATS.EPUB ? "未命名.epub" : "未命名.pdf";
  const type = format === DOCUMENT_FORMATS.EPUB ? "application/epub+zip" : "application/pdf";
  const id = createDocumentId(file.name || fallbackName, file.size, file.lastModified || 0);
  const existing = await getStoredDocument(id).catch(() => null);
  const blob = file.slice(0, file.size, file.type || type);
  const now = Date.now();
  const record = {
    id,
    format,
    name: file.name || fallbackName,
    size: file.size,
    type: file.type || type,
    updatedAt: now,
    lastOpenedAt: now,
    blob,
  };

  await putStoredDocument(record);

  if (!existing) {
    deleteDocumentProgress(id);
  }

  return record;
}

async function touchStoredDocument(documentId) {
  const record = await getStoredDocument(documentId).catch(() => null);

  if (!record?.blob) {
    return;
  }

  await putStoredDocument({
    ...record,
    lastOpenedAt: Date.now(),
  });
}

function isSupportedDocumentFile(file) {
  return Boolean(getDocumentFormatFromFile(file));
}

function setReaderVisible(visible) {
  els.emptyState.hidden = visible;
  els.viewerPane.hidden = !visible;
  els.controls.hidden = !visible;

  if (visible) {
    updateViewerMode();
  }
}

function updateViewerMode() {
  const epubMode = isEpubDocument();
  const scrollMode = isScrollMode();
  els.canvasWrap.hidden = epubMode;
  els.epubPane.hidden = !epubMode;
  els.canvas.hidden = scrollMode || epubMode;
  els.continuousPages.hidden = !scrollMode;
  els.canvasWrap.classList.toggle("is-continuous", scrollMode);
}

function updateControls() {
  const hasDocument = Boolean(pdfDoc || epubBook);
  const epubMode = hasDocument && isEpubDocument();
  const total = pdfDoc?.numPages || 0;
  const pagedMode = !epubMode && state.mode === READ_MODES.PAGED;
  const scrollMode = !epubMode && state.mode !== READ_MODES.PAGED;

  els.docName.textContent = state.fileName || "未打开文件";
  els.prevButton.textContent = epubMode ? "上一章" : "上一页";
  els.nextButton.textContent = epubMode ? "下一章" : "下一页";
  els.prevButton.setAttribute("aria-label", epubMode ? "上一章" : "上一页");
  els.nextButton.setAttribute("aria-label", epubMode ? "下一章" : "下一页");
  els.pageInput.value = epubMode
    ? String(Math.round(clamp(state.epubProgress || 0, 0, 1) * 100))
    : String(hasDocument ? state.page : 1);
  els.pageInput.max = String(Math.max(total, 1));
  els.pageTotal.textContent = epubMode ? "%" : `/ ${total}`;

  els.prevButton.disabled = !hasDocument || (!epubMode && state.page <= 1);
  els.nextButton.disabled = !hasDocument || (!epubMode && state.page >= total);
  els.pageInput.disabled = !hasDocument || epubMode;
  els.zoomOutButton.disabled = !hasDocument || epubMode || state.zoom <= 0.6;
  els.zoomInButton.disabled = !hasDocument || epubMode || state.zoom >= 2.6;
  els.fitButton.disabled = !hasDocument || epubMode;
  els.edgeJumpGroup.hidden = !hasDocument || epubMode || !scrollMode;
  els.jumpTopButton.disabled = !hasDocument || epubMode || !scrollMode;
  els.jumpBottomButton.disabled = !hasDocument || epubMode || !scrollMode;
  els.pagedModeButton.disabled = epubMode;
  els.scrollModeButton.disabled = epubMode;

  els.pagedModeButton.classList.toggle("active", pagedMode);
  els.scrollModeButton.classList.toggle("active", scrollMode || epubMode);
  els.pagedModeButton.setAttribute("aria-pressed", String(pagedMode));
  els.scrollModeButton.setAttribute("aria-pressed", String(scrollMode || epubMode));
}

async function cancelCurrentRender() {
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }

  for (const task of pageRenderTasks.values()) {
    task.cancel();
  }
  pageRenderTasks.clear();
}

function clearContinuousPages() {
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }

  for (const task of pageRenderTasks.values()) {
    task.cancel();
  }
  pageRenderTasks.clear();
  els.continuousPages.replaceChildren();
}

async function closeCurrentDocument() {
  renderToken += 1;
  await cancelCurrentRender();
  clearContinuousPages();

  els.canvas.removeAttribute("width");
  els.canvas.removeAttribute("height");
  els.canvas.removeAttribute("style");
  els.epubViewer.replaceChildren();

  if (pdfDoc) {
    const oldDoc = pdfDoc;
    pdfDoc = null;
    await oldDoc.destroy().catch(() => {});
  }

  if (epubRendition) {
    const oldRendition = epubRendition;
    epubRendition = null;
    oldRendition.destroy?.();
  }

  if (epubBook) {
    const oldBook = epubBook;
    epubBook = null;
    oldBook.destroy?.();
  }
}

function getAvailableCanvasWidth() {
  const styles = window.getComputedStyle(els.canvasWrap);
  const left = Number.parseFloat(styles.paddingLeft) || 0;
  const right = Number.parseFloat(styles.paddingRight) || 0;
  return Math.max(240, els.canvasWrap.clientWidth - left - right);
}

function getScaledViewport(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const fitScale = getAvailableCanvasWidth() / baseViewport.width;
  const finalScale = clamp(fitScale * state.zoom, 0.2, 4);
  return page.getViewport({ scale: finalScale });
}

function prepareCanvas(canvas, viewport) {
  const outputScale = clamp(window.devicePixelRatio || 1, 1, 2.5);
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, viewport.width, viewport.height);

  return context;
}

async function renderPage(pageNumber) {
  if (!pdfDoc) {
    return;
  }

  const token = ++renderToken;
  const targetPage = clamp(Math.round(pageNumber), 1, pdfDoc.numPages);
  state.page = targetPage;
  state.scrollPage = targetPage;
  state.scrollOffsetRatio = 0;
  state.scrollTop = 0;
  updateViewerMode();
  updateControls();
  showStatus("正在渲染...", true);

  try {
    await cancelCurrentRender();
    clearContinuousPages();

    const page = await pdfDoc.getPage(targetPage);

    if (token !== renderToken || !pdfDoc) {
      return;
    }

    lastLayoutWidth = getAvailableCanvasWidth();
    const viewport = getScaledViewport(page);
    const context = prepareCanvas(els.canvas, viewport);

    renderTask = page.render({
      canvasContext: context,
      viewport,
    });

    await renderTask.promise;

    if (token !== renderToken) {
      return;
    }

    els.canvasWrap.scrollTop = 0;
    saveReaderState();
    hideStatus();
  } catch (error) {
    if (error?.name === "RenderingCancelledException") {
      return;
    }

    console.error(error);
    showStatus("PDF 渲染失败。", true);
  } finally {
    if (token === renderToken) {
      renderTask = null;
      updateControls();
    }
  }
}

async function estimateContinuousPageSize() {
  try {
    const page = await pdfDoc.getPage(clamp(state.page, 1, pdfDoc.numPages));
    const viewport = getScaledViewport(page);
    return {
      height: Math.max(420, Math.floor(viewport.height)),
      width: Math.max(240, Math.floor(viewport.width)),
    };
  } catch {
    return {
      height: Math.max(420, Math.floor(els.canvasWrap.clientHeight * 0.86)),
      width: Math.max(240, getAvailableCanvasWidth()),
    };
  }
}

function buildContinuousPlaceholders(estimatedSize) {
  const fragment = document.createDocumentFragment();

  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
    const shell = document.createElement("article");
    shell.className = "page-shell";
    shell.dataset.page = String(pageNumber);
    shell.style.minHeight = `${estimatedSize.height + 28}px`;

    const canvas = document.createElement("canvas");
    canvas.dataset.page = String(pageNumber);
    canvas.style.width = `${estimatedSize.width}px`;
    canvas.style.height = `${estimatedSize.height}px`;

    const label = document.createElement("div");
    label.className = "page-label";
    label.textContent = String(pageNumber);

    shell.append(canvas, label);
    fragment.append(shell);
  }

  els.continuousPages.append(fragment);
}

async function renderContinuousPage(pageNumber, token = renderToken) {
  if (!pdfDoc || token !== renderToken) {
    return;
  }

  const targetPage = clamp(Math.round(pageNumber), 1, pdfDoc.numPages);
  const shell = els.continuousPages.querySelector(`[data-page="${targetPage}"]`);

  if (!shell || shell.dataset.rendered === "true") {
    return;
  }

  const existingTask = pageRenderTasks.get(targetPage);

  if (existingTask) {
    await existingTask.promise.catch((error) => {
      if (error?.name !== "RenderingCancelledException") {
        console.error(error);
      }
    });
    return;
  }

  shell.dataset.rendering = "true";

  try {
    const page = await pdfDoc.getPage(targetPage);

    if (token !== renderToken || !pdfDoc) {
      return;
    }

    const canvas = shell.querySelector("canvas");
    const viewport = getScaledViewport(page);
    const context = prepareCanvas(canvas, viewport);

    shell.style.minHeight = `${Math.floor(viewport.height) + 28}px`;

    const task = page.render({
      canvasContext: context,
      viewport,
    });

    pageRenderTasks.set(targetPage, task);
    await task.promise;

    if (token !== renderToken) {
      return;
    }

    shell.dataset.rendered = "true";
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
    }
  } finally {
    pageRenderTasks.delete(targetPage);
    delete shell.dataset.rendering;
  }
}

function setupContinuousObserver(token) {
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }

  const shells = els.continuousPages.querySelectorAll(".page-shell");

  if (!("IntersectionObserver" in window)) {
    renderContinuousPage(state.page, token);
    renderContinuousPage(state.page + 1, token);
    return;
  }

  pageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const pageNumber = Number.parseInt(entry.target.dataset.page, 10);
          renderContinuousPage(pageNumber, token);
        }
      }
    },
    {
      root: els.canvasWrap,
      rootMargin: "900px 0px",
      threshold: 0.01,
    },
  );

  for (const shell of shells) {
    pageObserver.observe(shell);
  }
}

function getContinuousPageTop(shell) {
  return Math.max(0, shell.offsetTop - els.continuousPages.offsetTop - 8);
}

function getContinuousMaxScrollTop() {
  return Math.max(0, els.canvasWrap.scrollHeight - els.canvasWrap.clientHeight);
}

function getDocumentMaxScrollTop() {
  const scroller = document.scrollingElement || document.documentElement;
  return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function setContinuousScrollTop(top, edge = "") {
  const maxScrollTop = getContinuousMaxScrollTop();
  const targetTop = edge === "bottom" ? maxScrollTop : clamp(Math.round(top), 0, maxScrollTop);
  els.canvasWrap.scrollTop = targetTop;
  els.canvasWrap.scrollTo({
    top: targetTop,
    behavior: "auto",
  });

  if (maxScrollTop <= 2) {
    window.scrollTo({
      top: edge === "bottom" ? getDocumentMaxScrollTop() : 0,
      behavior: "auto",
    });
  }

  window.requestAnimationFrame(() => {
    if (Math.abs(els.canvasWrap.scrollTop - targetTop) > 4) {
      els.canvasWrap.scrollTop = targetTop;
      els.canvasWrap.scrollTo({
        top: targetTop,
        behavior: "auto",
      });
    }
    if (maxScrollTop <= 2) {
      window.scrollTo({
        top: edge === "bottom" ? getDocumentMaxScrollTop() : 0,
        behavior: "auto",
      });
    }
  });

  return targetTop;
}

function captureContinuousScrollPosition() {
  if (!pdfDoc || !isScrollMode() || !els.continuousPages.childElementCount) {
    return false;
  }

  const scrollTop = Math.max(0, els.canvasWrap.scrollTop);
  const marker = scrollTop + 8;
  let nextPage = state.scrollPage;
  let nextOffsetRatio = state.scrollOffsetRatio;

  for (const shell of els.continuousPages.children) {
    const pageNumber = Number.parseInt(shell.dataset.page, 10);
    const top = shell.offsetTop - els.continuousPages.offsetTop;
    const height = Math.max(shell.offsetHeight, 1);
    const bottom = top + height;

    if (bottom >= marker) {
      const offset = clamp(scrollTop - top, 0, height);
      nextPage = pageNumber;
      nextOffsetRatio = clamp(offset / height, 0, 0.98);
      break;
    }
  }

  const changed =
    nextPage !== state.scrollPage ||
    Math.abs(nextOffsetRatio - state.scrollOffsetRatio) > 0.002 ||
    Math.abs(scrollTop - state.scrollTop) > 12;

  state.scrollPage = nextPage;
  state.scrollOffsetRatio = nextOffsetRatio;
  state.scrollTop = scrollTop;

  return changed;
}

function restoreContinuousScrollPosition(options = {}) {
  if (!pdfDoc || !isScrollMode() || !els.continuousPages.childElementCount) {
    return false;
  }

  if (options.onlyIfNearTop && els.canvasWrap.scrollTop > 32) {
    return false;
  }

  const targetPage = clamp(Math.round(state.scrollPage || state.page), 1, pdfDoc.numPages);
  const shell = els.continuousPages.querySelector(`[data-page="${targetPage}"]`);

  if (!shell) {
    return false;
  }

  const height = Math.max(shell.offsetHeight, 1);
  const offset = clamp(state.scrollOffsetRatio || 0, 0, 0.98) * height;

  els.canvasWrap.scrollTo({
    top: getContinuousPageTop(shell) + offset,
    behavior: options.behavior || "auto",
  });

  renderContinuousPage(targetPage, renderToken);
  return true;
}

function isLikelyTransientTopJump() {
  if (!pdfDoc || !isScrollMode() || state.scrollPage <= 1 || els.canvasWrap.scrollTop > 32) {
    return false;
  }

  const recentlyChangedViewport = Date.now() - lastViewportChangeAt < 1600;
  const hadMeaningfulPosition = state.scrollTop > Math.max(360, els.canvasWrap.clientHeight * 0.65);

  return recentlyChangedViewport && hadMeaningfulPosition;
}

async function scrollToContinuousPage(pageNumber, options = {}) {
  const targetPage = clamp(Math.round(pageNumber), 1, pdfDoc.numPages);
  const shell = els.continuousPages.querySelector(`[data-page="${targetPage}"]`);

  if (!shell) {
    return;
  }

  if (options.renderFirst !== false) {
    renderContinuousPage(targetPage, renderToken);
  }

  els.canvasWrap.scrollTo({
    top: getContinuousPageTop(shell),
    behavior: options.behavior || "smooth",
  });
}

async function jumpToContinuousEdge(edge) {
  if (!pdfDoc || !isScrollMode()) {
    return;
  }

  const toBottom = edge === "bottom";
  const targetPage = toBottom ? pdfDoc.numPages : 1;
  showStatus(toBottom ? "正在跳到底部..." : "正在跳到顶部...");

  if (!els.continuousPages.childElementCount) {
    await renderContinuousDocument(targetPage, { behavior: "auto" });
  }

  await renderContinuousPage(targetPage, renderToken);
  await waitForNextFrame();

  const targetTop = toBottom ? getContinuousMaxScrollTop() : 0;
  const appliedTop = setContinuousScrollTop(targetTop, edge);

  state.page = targetPage;
  state.scrollPage = targetPage;
  state.scrollOffsetRatio = toBottom ? 0.98 : 0;
  state.scrollTop = appliedTop;
  updateControls();

  window.clearTimeout(scrollStateTimer);
  scrollStateTimer = window.setTimeout(() => {
    if (!pdfDoc || !isScrollMode()) {
      return;
    }

    if (toBottom) {
      const currentBottom = getContinuousMaxScrollTop();
      if (Math.abs(els.canvasWrap.scrollTop - currentBottom) > 24) {
        setContinuousScrollTop(currentBottom, edge);
      }
    }

    captureContinuousScrollPosition();
    state.page = toBottom ? pdfDoc.numPages : 1;
    updateControls();
    saveReaderState();
    showStatus(toBottom ? "已到底部。" : "已到顶部。");
  }, 520);
}

function handleContinuousEdgeJump(edge) {
  jumpToContinuousEdge(edge).catch((error) => {
    console.error(error);
    showStatus("跳转失败，请再点一次。", true);
  });
}

async function renderContinuousDocument(pageNumber = state.page, options = {}) {
  if (!pdfDoc) {
    return;
  }

  const token = ++renderToken;
  let releasedScrollTracking = false;
  scrollTrackingSuppressionDepth += 1;
  const releaseScrollTracking = () => {
    if (!releasedScrollTracking) {
      scrollTrackingSuppressionDepth = Math.max(0, scrollTrackingSuppressionDepth - 1);
      releasedScrollTracking = true;
    }
  };
  const shouldRestoreScroll = options.restoreScroll === true;
  const targetPage = clamp(
    Math.round(shouldRestoreScroll ? state.scrollPage || pageNumber : pageNumber),
    1,
    pdfDoc.numPages,
  );
  state.page = targetPage;
  updateViewerMode();
  updateControls();
  showStatus("正在准备连续滚动...", true);

  try {
    await cancelCurrentRender();
    clearContinuousPages();

    const estimatedSize = await estimateContinuousPageSize();

    if (token !== renderToken || !pdfDoc) {
      return;
    }

    lastLayoutWidth = getAvailableCanvasWidth();
    buildContinuousPlaceholders(estimatedSize);
    setupContinuousObserver(token);

    if (shouldRestoreScroll) {
      restoreContinuousScrollPosition({ behavior: "auto" });
    } else {
      await scrollToContinuousPage(targetPage, {
        behavior: options.behavior || "auto",
        renderFirst: false,
      });
    }

    const scrollTopAfterInitialPosition = els.canvasWrap.scrollTop;
    await renderContinuousPage(targetPage, token);

    if (token !== renderToken) {
      return;
    }

    const userMovedDuringRender =
      Math.abs(els.canvasWrap.scrollTop - scrollTopAfterInitialPosition) > 24;

    if (!userMovedDuringRender) {
      if (shouldRestoreScroll) {
        restoreContinuousScrollPosition({ behavior: "auto" });
      } else {
        await scrollToContinuousPage(targetPage, {
          behavior: "auto",
          renderFirst: false,
        });
      }
    }

    renderContinuousPage(targetPage - 1, token);
    renderContinuousPage(targetPage + 1, token);
    releaseScrollTracking();
    saveReaderState();
    hideStatus();
  } catch (error) {
    if (error?.name === "RenderingCancelledException") {
      return;
    }

    console.error(error);
    showStatus("连续滚动模式准备失败。", true);
  } finally {
    releaseScrollTracking();

    if (token === renderToken) {
      updateControls();
    }
  }
}

async function renderCurrentView(pageNumber = state.page, options = {}) {
  if (isScrollMode()) {
    await renderContinuousDocument(pageNumber, options);
  } else {
    await renderPage(pageNumber);
  }
}

async function goToPage(pageNumber) {
  if (isEpubDocument()) {
    return;
  }

  if (!pdfDoc) {
    return;
  }

  const targetPage = clamp(Math.round(pageNumber), 1, pdfDoc.numPages);

  if (isScrollMode()) {
    state.page = targetPage;
    state.scrollPage = targetPage;
    state.scrollOffsetRatio = 0;
    updateControls();
    saveReaderState();

    if (!els.continuousPages.childElementCount) {
      await renderContinuousDocument(targetPage);
      return;
    }

    await scrollToContinuousPage(targetPage);
    return;
  }

  await renderPage(targetPage);
}

async function setReadMode(mode) {
  if (isEpubDocument()) {
    return;
  }

  if (mode !== READ_MODES.PAGED && mode !== READ_MODES.SCROLL) {
    return;
  }

  if (state.mode === mode) {
    return;
  }

  state.mode = mode;
  if (mode === READ_MODES.SCROLL) {
    state.scrollPage = state.page;
    state.scrollOffsetRatio = 0;
    state.scrollTop = 0;
  }
  saveReaderState();
  updateViewerMode();
  updateControls();

  if (!pdfDoc) {
    return;
  }

  if (isScrollMode()) {
    await renderContinuousDocument(state.page, { restoreScroll: false });
  } else {
    await renderPage(state.page);
  }
}

function updateCurrentPageFromScroll() {
  if (
    isScrollTrackingSuppressed() ||
    !pdfDoc ||
    !isScrollMode() ||
    !els.continuousPages.childElementCount
  ) {
    return;
  }

  if (isLikelyTransientTopJump()) {
    restoreContinuousScrollPosition({
      behavior: "auto",
      onlyIfNearTop: true,
    });
    return;
  }

  const positionChanged = captureContinuousScrollPosition();
  const marker = els.canvasWrap.scrollTop + els.canvasWrap.clientHeight * 0.35;
  let currentPage = state.page;

  for (const shell of els.continuousPages.children) {
    const pageNumber = Number.parseInt(shell.dataset.page, 10);
    const top = shell.offsetTop - els.continuousPages.offsetTop;

    if (top <= marker) {
      currentPage = pageNumber;
    } else {
      break;
    }
  }

  const pageChanged = currentPage !== state.page;

  if (pageChanged) {
    state.page = currentPage;
  }

  if (positionChanged || pageChanged) {
    updateControls();
  }

  if (positionChanged || pageChanged) {
    window.clearTimeout(scrollStateTimer);
    scrollStateTimer = window.setTimeout(saveReaderState, 300);
  }
}

function estimateEpubProgress(location) {
  const percentage = location?.start?.percentage;

  if (Number.isFinite(percentage)) {
    return clamp(percentage, 0, 1);
  }

  const index = Number.isFinite(location?.start?.index) ? location.start.index : state.page - 1;
  const total = Math.max(epubBook?.spine?.length || 1, 1);

  return clamp(index / total, 0, 1);
}

function updateEpubLocation(location) {
  if (!location?.start) {
    return;
  }

  state.epubCfi = location.start.cfi || state.epubCfi;
  state.epubProgress = estimateEpubProgress(location);
  state.page = Number.isFinite(location.start.index) ? location.start.index + 1 : state.page;
  updateControls();

  window.clearTimeout(scrollStateTimer);
  scrollStateTimer = window.setTimeout(saveReaderState, 300);
}

async function loadEpubFromBlob(blob, meta = {}) {
  await closeCurrentDocument();
  state.format = DOCUMENT_FORMATS.EPUB;
  setReaderVisible(true);
  updateViewerMode();
  showStatus("正在打开 EPUB...", true);

  try {
    if (typeof window.ePub !== "function") {
      throw new Error("EPUB 引擎没有加载。");
    }

    const buffer = await blob.arrayBuffer();
    const book = window.ePub();
    await book.open(buffer, "binary");

    epubBook = book;
    epubRendition = book.renderTo(els.epubViewer, {
      allowScriptedContent: false,
      flow: "scrolled-doc",
      height: "100%",
      spread: "none",
      width: "100%",
    });

    epubRendition.themes.default({
      body: {
        "font-family":
          'ui-serif, "Iowan Old Style", "Songti SC", "Noto Serif CJK SC", serif',
        "line-height": "1.72",
        "padding": "0 6%",
      },
      p: {
        "line-height": "1.72",
      },
    });

    epubRendition.on("relocated", updateEpubLocation);

    state.documentId = meta.id || state.documentId;
    state.fileName = meta.name || state.fileName || "未命名.epub";
    state.epubProgress = clamp(state.epubProgress || 0, 0, 1);
    state.page = clamp(state.page || 1, 1, epubBook.spine?.length || Number.MAX_SAFE_INTEGER);

    updateControls();
    await epubRendition.display(state.epubCfi || undefined);
    const location = epubRendition.currentLocation?.();

    if (location) {
      updateEpubLocation(location);
    }

    saveReaderState();
    hideStatus();
  } catch (error) {
    console.error(error);
    await closeCurrentDocument();
    state.format = DOCUMENT_FORMATS.PDF;
    setReaderVisible(false);
    updateViewerMode();
    showStatus("这个 EPUB 暂时打不开。", true);
  }
}

async function navigateEpub(direction) {
  if (!epubRendition) {
    return;
  }

  try {
    if (direction === "prev") {
      await epubRendition.prev();
    } else {
      await epubRendition.next();
    }

    const location = epubRendition.currentLocation?.();
    if (location) {
      updateEpubLocation(location);
    }
  } catch (error) {
    console.error(error);
    showStatus("EPUB 跳转失败。", true);
  }
}

async function loadPdfFromBlob(blob, meta = {}, requestedPage = 1) {
  await closeCurrentDocument();
  state.format = DOCUMENT_FORMATS.PDF;
  state.epubCfi = "";
  state.epubProgress = 0;
  setReaderVisible(true);
  updateViewerMode();
  showStatus("正在打开 PDF...", true);

  try {
    const buffer = await blob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({
      data: buffer,
      cMapPacked: true,
      cMapUrl: `${PDFJS_ROOT}cmaps/`,
      standardFontDataUrl: `${PDFJS_ROOT}standard_fonts/`,
      wasmUrl: `${PDFJS_ROOT}image_decoders/`,
    });
    const loadedDoc = await loadingTask.promise;

    pdfDoc = loadedDoc;
    state.documentId = meta.id || state.documentId;
    state.fileName = meta.name || state.fileName || "未命名.pdf";
    state.page = clamp(requestedPage, 1, pdfDoc.numPages);
    state.scrollPage = clamp(state.scrollPage || state.page, 1, pdfDoc.numPages);
    state.zoom = clamp(state.zoom || 1, 0.6, 2.6);

    updateControls();
    await renderCurrentView(state.page, { behavior: "auto", restoreScroll: true });
  } catch (error) {
    console.error(error);
    await closeCurrentDocument();
    setReaderVisible(false);
    showStatus("这个 PDF 暂时打不开。", true);
  }
}

async function openDocumentRecord(record, options = {}) {
  if (!record?.blob) {
    showStatus("这个文件记录不可用。");
    return;
  }

  if (pdfDoc || epubBook) {
    persistReaderPositionNow();
  }

  const format = getDocumentFormat(record);
  state.documentId = record.id;
  state.format = format;
  state.fileName = record.name || (format === DOCUMENT_FORMATS.EPUB ? "未命名.epub" : "未命名.pdf");

  if (options.resetProgress) {
    state.page = 1;
    state.scrollPage = 1;
    state.scrollOffsetRatio = 0;
    state.scrollTop = 0;
    state.epubCfi = "";
    state.epubProgress = 0;
    state.zoom = 1;
  } else {
    applyDocumentProgress(record.id, options.fallbackPage || 1);
  }

  if (format === DOCUMENT_FORMATS.EPUB) {
    await loadEpubFromBlob(record.blob, { id: record.id, name: state.fileName });
  } else {
    await loadPdfFromBlob(record.blob, { id: record.id, name: state.fileName }, state.page);
  }

  await touchStoredDocument(record.id).catch(() => {});
  saveReaderState();
  renderLibraryList();
}

async function openDocumentFromLibrary(documentId) {
  const record = await getStoredDocument(documentId).catch(() => null);

  if (!record?.blob) {
    showStatus("这个文件已经不在本机存储里。");
    renderLibraryList();
    return;
  }

  closeLibrary();
  await openDocumentRecord(record);
}

async function handleFileSelection(file) {
  if (!isSupportedDocumentFile(file)) {
    showStatus("请选择 PDF 或 EPUB 文件。");
    return;
  }

  try {
    const record = await saveDocumentFile(file);
    deleteDocumentProgress(record.id);
    await openDocumentRecord(record, { resetProgress: true });
    showStatus("已加入书架。");
  } catch (error) {
    console.error(error);
    const format = getDocumentFormatFromFile(file);
    showStatus("文件已选择，但保存到书架失败。", true);

    if (format === DOCUMENT_FORMATS.EPUB) {
      await loadEpubFromBlob(file, { name: file.name || "未命名.epub" });
    } else {
      await loadPdfFromBlob(file, { name: file.name || "未命名.pdf" }, 1);
    }
  }
}

async function restoreLastDocument() {
  readSavedState();
  updateViewerMode();
  updateControls();

  try {
    let record = state.documentId ? await getStoredDocument(state.documentId) : null;

    if (!record?.blob) {
      const documents = await readLibraryDocuments();
      record = documents[0] || null;
    }

    if (!record?.blob) {
      renderLibraryList();
      return;
    }

    state.documentId = record.id;
    state.format = getDocumentFormat(record);
    state.fileName =
      record.name || (state.format === DOCUMENT_FORMATS.EPUB ? "未命名.epub" : "未命名.pdf");
    applyDocumentProgress(record.id, state.page || 1);
    showStatus("正在恢复上次阅读...", true);
    if (state.format === DOCUMENT_FORMATS.EPUB) {
      await loadEpubFromBlob(record.blob, { id: record.id, name: state.fileName });
    } else {
      await loadPdfFromBlob(record.blob, { id: record.id, name: state.fileName }, state.page);
    }
    renderLibraryList();
  } catch (error) {
    console.warn(error);
  }
}

function closeLibrary() {
  els.libraryOverlay.hidden = true;
}

async function openLibrary() {
  await renderLibraryList();
  els.libraryOverlay.hidden = false;
}

async function deleteDocumentFromLibrary(documentId) {
  const isActiveDocument = documentId === state.documentId;

  if (isActiveDocument) {
    await closeCurrentDocument();
    state.documentId = "";
    state.format = DOCUMENT_FORMATS.PDF;
    state.fileName = "";
    state.epubCfi = "";
    state.epubProgress = 0;
    state.page = 1;
    state.scrollPage = 1;
    state.scrollOffsetRatio = 0;
    state.scrollTop = 0;
    state.zoom = 1;
    setReaderVisible(false);
    updateControls();
  }

  await deleteStoredDocument(documentId).catch(() => {});
  deleteDocumentProgress(documentId);
  saveReaderState();
  await renderLibraryList();
  showStatus("已从书架删除。");
}

async function renderLibraryList() {
  try {
    const documents = await readLibraryDocuments();
    const fragment = document.createDocumentFragment();

    els.libraryEmptyState.hidden = documents.length > 0;

    for (const record of documents) {
      const progress = readDocumentProgress(record.id);
      const item = document.createElement("article");
      const openButton = document.createElement("button");
      const name = document.createElement("span");
      const meta = document.createElement("span");
      const deleteButton = document.createElement("button");
      const format = getDocumentFormat(record);
      const page = progress?.page || 1;
      const progressLabel =
        format === DOCUMENT_FORMATS.EPUB
          ? `${Math.round(clamp(progress?.epubProgress || 0, 0, 1) * 100)}%`
          : `第 ${page} 页`;
      const isActive = record.id === state.documentId;

      item.className = "library-item";
      item.classList.toggle("active", isActive);

      openButton.className = "library-open";
      openButton.type = "button";

      name.className = "library-name";
      name.textContent =
        record.name || (format === DOCUMENT_FORMATS.EPUB ? "未命名.epub" : "未命名.pdf");

      meta.className = "library-meta";
      meta.textContent = `${isActive ? "正在阅读 · " : ""}${format.toUpperCase()} · ${progressLabel} · ${formatFileSize(record.size || record.blob?.size || 0)}`;

      deleteButton.className = "library-delete";
      deleteButton.type = "button";
      deleteButton.textContent = "删除";

      openButton.append(name, meta);
      openButton.addEventListener("click", () => openDocumentFromLibrary(record.id));
      deleteButton.addEventListener("click", () => deleteDocumentFromLibrary(record.id));

      item.append(openButton, deleteButton);
      fragment.append(item);
    }

    els.libraryList.replaceChildren(fragment);
  } catch (error) {
    console.warn(error);
    els.libraryList.replaceChildren();
    els.libraryEmptyState.hidden = false;
    els.libraryEmptyState.textContent = "书架暂时打不开。";
  }
}

function persistReaderPositionNow() {
  if (!pdfDoc && !epubBook) {
    return;
  }

  window.clearTimeout(scrollStateTimer);

  if (isScrollMode()) {
    captureContinuousScrollPosition();
  }

  saveReaderState();
}

function restoreReaderPositionAfterResume() {
  if (!pdfDoc || !isScrollMode() || state.scrollTop <= 32) {
    return;
  }

  const restoreIfNeeded = () => {
    if (!pdfDoc || !isScrollMode() || !els.continuousPages.childElementCount) {
      return;
    }

    if (els.canvasWrap.scrollTop <= 32) {
      restoreContinuousScrollPosition({
        behavior: "auto",
        onlyIfNearTop: true,
      });
    }
  };

  window.requestAnimationFrame(restoreIfNeeded);
  window.setTimeout(restoreIfNeeded, 80);
  window.setTimeout(restoreIfNeeded, 260);
}

function openFilePicker() {
  if (!els.lockOverlay.hidden) {
    return;
  }

  els.fileInput.value = "";
  els.fileInput.click();
}

function preventLockScroll(event) {
  if (!els.lockOverlay.hidden) {
    event.preventDefault();
  }
}

function wireEvents() {
  els.openButton.addEventListener("click", openFilePicker);
  els.emptyOpenButton.addEventListener("click", openFilePicker);
  els.floatingLockButton.addEventListener("click", lockReader);
  els.libraryButton.addEventListener("click", openLibrary);
  els.libraryCloseButton.addEventListener("click", closeLibrary);
  els.lockButton.addEventListener("click", lockReader);
  els.lockCancelButton.addEventListener("click", hideLockOverlay);
  els.lockForm.addEventListener("submit", handleLockSubmit);
  els.lockOverlay.addEventListener("touchmove", preventLockScroll, { passive: false });
  els.lockOverlay.addEventListener("wheel", preventLockScroll, { passive: false });
  els.libraryOverlay.addEventListener("click", (event) => {
    if (event.target === els.libraryOverlay) {
      closeLibrary();
    }
  });

  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files?.[0];
    if (file) {
      handleFileSelection(file);
    }
  });

  els.prevButton.addEventListener("click", () => {
    if (isEpubDocument()) {
      navigateEpub("prev");
      return;
    }

    goToPage(state.page - 1);
  });
  els.nextButton.addEventListener("click", () => {
    if (isEpubDocument()) {
      navigateEpub("next");
      return;
    }

    goToPage(state.page + 1);
  });
  els.jumpTopButton.addEventListener("click", () => handleContinuousEdgeJump("top"));
  els.jumpBottomButton.addEventListener("click", () => handleContinuousEdgeJump("bottom"));
  els.pagedModeButton.addEventListener("click", () => setReadMode(READ_MODES.PAGED));
  els.scrollModeButton.addEventListener("click", () => setReadMode(READ_MODES.SCROLL));

  els.pageInput.addEventListener("change", () => {
    if (isEpubDocument()) {
      updateControls();
      return;
    }

    const page = Number.parseInt(els.pageInput.value, 10);
    if (Number.isFinite(page)) {
      goToPage(page);
    } else {
      updateControls();
    }
  });

  els.pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      els.pageInput.blur();
    }
  });

  els.zoomOutButton.addEventListener("click", () => {
    if (isScrollMode()) {
      captureContinuousScrollPosition();
    }

    state.zoom = clamp(Number((state.zoom - 0.15).toFixed(2)), 0.6, 2.6);
    renderCurrentView(state.page, { behavior: "auto", restoreScroll: isScrollMode() });
  });

  els.zoomInButton.addEventListener("click", () => {
    if (isScrollMode()) {
      captureContinuousScrollPosition();
    }

    state.zoom = clamp(Number((state.zoom + 0.15).toFixed(2)), 0.6, 2.6);
    renderCurrentView(state.page, { behavior: "auto", restoreScroll: isScrollMode() });
  });

  els.fitButton.addEventListener("click", () => {
    if (isScrollMode()) {
      captureContinuousScrollPosition();
    }

    state.zoom = 1;
    renderCurrentView(state.page, { behavior: "auto", restoreScroll: isScrollMode() });
  });

  els.canvasWrap.addEventListener("scroll", updateCurrentPageFromScroll, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistReaderPositionNow();
      return;
    }

    lastViewportChangeAt = Date.now();
    restoreReaderPositionAfterResume();
  });

  window.addEventListener("pagehide", persistReaderPositionNow);
  window.addEventListener("beforeunload", persistReaderPositionNow);
  window.addEventListener("pageshow", () => {
    lastViewportChangeAt = Date.now();
    restoreReaderPositionAfterResume();
  });
  window.addEventListener("focus", () => {
    lastViewportChangeAt = Date.now();
    restoreReaderPositionAfterResume();
  });

  window.addEventListener("resize", () => {
    lastViewportChangeAt = Date.now();
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (epubRendition) {
        epubRendition.resize("100%", "100%", state.epubCfi || undefined);
        return;
      }

      if (!pdfDoc) {
        return;
      }

      if (isScrollMode()) {
        const nextLayoutWidth = getAvailableCanvasWidth();

        if (lastLayoutWidth && Math.abs(nextLayoutWidth - lastLayoutWidth) < 8) {
          restoreReaderPositionAfterResume();
          return;
        }

        captureContinuousScrollPosition();
        renderCurrentView(state.page, { behavior: "auto", restoreScroll: true });
        return;
      }

      renderCurrentView(state.page, { behavior: "auto" });
    }, 180);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.lockOverlay.hidden && lockMode === "setup") {
      hideLockOverlay();
      return;
    }

    if (event.key === "Escape" && !els.libraryOverlay.hidden) {
      closeLibrary();
      return;
    }

    if ((!pdfDoc && !epubBook) || event.target === els.pageInput) {
      return;
    }

    if (event.key === "ArrowLeft") {
      if (isEpubDocument()) {
        navigateEpub("prev");
      } else {
        goToPage(state.page - 1);
      }
    }

    if (event.key === "ArrowRight") {
      if (isEpubDocument()) {
        navigateEpub("next");
      } else {
        goToPage(state.page + 1);
      }
    }
  });

  els.canvasWrap.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches[0];
      touchStart = {
        x: touch.clientX,
        y: touch.clientY,
      };
    },
    { passive: true },
  );

  els.canvasWrap.addEventListener(
    "touchend",
    (event) => {
      if (!touchStart || !pdfDoc || isScrollMode()) {
        touchStart = null;
        return;
      }

      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      touchStart = null;

      if (Math.abs(dx) > 72 && Math.abs(dy) < 48) {
        goToPage(dx < 0 ? state.page + 1 : state.page - 1);
      }
    },
    { passive: true },
  );
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (!["http:", "https:"].includes(window.location.protocol)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn(error);
  }
}

function initializeLock() {
  if (getLockConfig()) {
    showLockOverlay("unlock");
  }
}

function initializeVersionBadge() {
  els.appVersion.textContent = APP_VERSION;
}

initializeVersionBadge();
wireEvents();
setReaderVisible(false);
updateViewerMode();
updateControls();
initializeLock();
registerServiceWorker();
restoreLastDocument();
