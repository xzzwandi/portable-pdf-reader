import { createPdfThumbnailCache } from "./pdf-thumbnails.js?v=119";

const THUMBNAIL_DELAY_MS = 100;
const NEARBY_RADIUS = 50;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, action) {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

export function createPdfNavigator(options = {}) {
  const thumbnails = createPdfThumbnailCache({ maxDimension: 640, cacheLimit: 12 });
  let doc = null;
  let documentId = "";
  let generation = 0;
  let previewPage = 1;
  let nearbyCenter = 1;
  let rangeMode = "all";
  let rangeDragging = false;
  let drag = null;
  let ignorePointerClickUntil = 0;
  let previousFocus = null;
  let inertTarget = null;
  let previousInert = false;
  let entryPosition = null;
  let entryPage = 1;
  let returnPosition = null;
  let returnPage = 1;
  let operation = null;
  let thumbnailTimer = 0;
  let thumbnailBatch = 0;
  const tiles = new Map();

  const overlay = element("div", "pdf-navigator-overlay");
  overlay.id = "pdfNavigatorOverlay";
  overlay.hidden = true;
  const panel = element("section", "pdf-navigator-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "pdfNavigatorTitle");
  panel.tabIndex = -1;
  const header = element("header", "pdf-navigator-header");
  const title = element("h2", "", "页面预览");
  title.id = "pdfNavigatorTitle";
  const closeButton = button("关闭", "pdf-navigator-close", () => close());
  closeButton.setAttribute("aria-label", "关闭页面预览");
  const reading = element("p", "pdf-navigator-reading");
  const heading = element("div", "pdf-navigator-heading");
  heading.append(title, reading);
  header.append(heading, closeButton);
  const modes = element("div", "pdf-navigator-modes");
  const rangeLabel = element("label", "pdf-navigator-range-label", "快速跨页");
  rangeLabel.htmlFor = "pdfNavigatorRange";
  const modeButtons = element("div", "pdf-navigator-mode-buttons");
  modeButtons.setAttribute("role", "group");
  modeButtons.setAttribute("aria-label", "预览范围");
  const allButton = button("全书", "", () => setRangeMode("all"));
  const nearButton = button("附近", "", () => setRangeMode("near"));
  modeButtons.append(allButton, nearButton);
  modes.append(rangeLabel, modeButtons);
  const middle = element("div", "pdf-navigator-middle");
  const strip = element("div", "pdf-navigator-strip");
  strip.setAttribute("role", "group");
  strip.setAttribute("aria-label", "相邻页面缩略图，可上下拖动预览");
  const sliderColumn = element("div", "pdf-navigator-slider-column");
  const rangeStart = element("span", "pdf-navigator-range-end");
  const slider = element("input", "pdf-navigator-range");
  slider.id = "pdfNavigatorRange";
  slider.type = "range";
  slider.step = "1";
  slider.setAttribute("aria-orientation", "vertical");
  slider.setAttribute("orient", "vertical");
  const rangeEnd = element("span", "pdf-navigator-range-end");
  sliderColumn.append(rangeStart, slider, rangeEnd);
  middle.append(strip, sliderColumn);
  const footer = element("footer", "pdf-navigator-footer");
  const previewLabel = element("label", "pdf-navigator-preview-label", "预览页码");
  previewLabel.htmlFor = "pdfNavigatorPageInput";
  const fineControls = element("div", "pdf-navigator-fine-controls");
  const previousButton = button("↑", "", () => selectPage(previewPage - 1));
  previousButton.setAttribute("aria-label", "预览上一页");
  const input = element("input", "pdf-navigator-page-input");
  input.id = "pdfNavigatorPageInput";
  input.type = "number";
  input.inputMode = "numeric";
  input.min = "1";
  input.step = "1";
  input.setAttribute("aria-label", "预览页码");
  const nextButton = button("↓", "", () => selectPage(previewPage + 1));
  nextButton.setAttribute("aria-label", "预览下一页");
  fineControls.append(previousButton, input, nextButton);
  const hint = element("p", "pdf-navigator-hint", "上下拖动小图，点前往再跳转");
  const goButton = button("前往第 1 页", "pdf-navigator-go", () => void commit());
  const status = element("p", "pdf-navigator-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  footer.append(previewLabel, fineControls, hint, goButton, status);
  panel.append(header, modes, middle, footer);
  overlay.append(panel);
  const returnButton = button("返回原位", "pdf-navigator-return", () => void restore());
  returnButton.id = "pdfNavigatorReturnButton";
  returnButton.hidden = true;
  document.body.append(overlay, returnButton);

  function totalPages() { return Math.max(1, Math.floor(doc?.numPages || 1)); }
  function clampPage(value) { return Math.min(totalPages(), Math.max(1, Math.round(Number(value) || 1))); }
  function currentPage() { return clampPage(options.getPage?.() || 1); }
  function available() { return Boolean(doc && doc.numPages > 0 && (options.isAvailable?.() ?? true)); }
  function notify(message) { options.showStatus?.(message); }
  function setStatus(message = "") {
    status.textContent = message;
    status.hidden = !message;
  }
  function stopThumbnails() {
    window.clearTimeout(thumbnailTimer);
    thumbnailTimer = 0;
    thumbnailBatch++;
    thumbnails.cancel();
  }
  function releaseTiles() {
    for (const tile of tiles.values()) {
      const canvas = tile.frame.querySelector("canvas");
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
    tiles.clear();
    strip.replaceChildren();
  }
  function abortOperation() {
    operation?.controller.abort();
    operation = null;
  }
  function syncDocument() {
    const nextDoc = options.getDocument ? options.getDocument() : doc;
    const nextId = options.getDocumentId ? options.getDocumentId() || "" : documentId;
    if (nextDoc !== doc || nextId !== documentId) setDocument(nextDoc, nextId);
    if (options.isAvailable && !options.isAvailable()) {
      // Temporary host transitions (for example fullscreen) hide navigation,
      // but must not erase a return point from the same document.
      if (!overlay.hidden) close({ restoreFocus: false });
      updateReturnButton();
      return false;
    }
    return available();
  }
  function sameOperation(active) {
    return operation === active && !active.controller.signal.aborted && active.generation === generation &&
      doc === active.doc && documentId === active.documentId && available() &&
      (!options.getDocument || options.getDocument() === active.doc) &&
      (!options.getDocumentId || (options.getDocumentId() || "") === active.documentId);
  }
  function updateReturnButton() {
    returnButton.hidden = !available() || !returnPosition || !overlay.hidden;
    returnButton.disabled = Boolean(operation);
    returnButton.textContent = operation?.kind === "restore" ? "正在返回…" : `返回第 ${returnPage} 页`;
    returnButton.setAttribute("aria-label", `返回第 ${returnPage} 页原来的阅读位置`);
  }
  function releaseInert() {
    if (inertTarget) inertTarget.inert = previousInert;
    inertTarget = null;
  }
  function close({ restoreFocus = true } = {}) {
    const wasOpen = !overlay.hidden;
    overlay.hidden = true;
    abortOperation();
    stopThumbnails();
    drag = null;
    rangeDragging = false;
    releaseTiles();
    entryPosition = null;
    setStatus();
    releaseInert();
    if (wasOpen) options.onClose?.();
    if (wasOpen && restoreFocus && previousFocus?.isConnected && !previousFocus.closest?.("[inert]")) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
    updateReturnButton();
  }
  function clear() {
    generation++;
    returnPosition = null;
    close({ restoreFocus: false });
    thumbnails.clear();
    doc = null;
    documentId = "";
    previewPage = nearbyCenter = entryPage = returnPage = 1;
    rangeMode = "all";
    reading.textContent = "";
    input.value = "";
    returnButton.hidden = true;
    returnButton.textContent = "返回原位";
  }
  function setDocument(nextDoc, nextId = "") {
    if (doc === nextDoc && documentId === (nextId || "")) return;
    clear();
    doc = nextDoc || null;
    documentId = nextId || "";
    thumbnails.setDocument(doc);
  }
  function open() {
    if (!syncDocument()) { notify("请先打开一份 PDF。"); return false; }
    if (!overlay.hidden) return true;
    if (operation) return false;
    previousFocus = document.activeElement;
    overlay.hidden = false;
    try {
      // The host stops reading momentum before we capture the return point.
      options.onOpen?.();
      if (!available() || overlay.hidden) { close({ restoreFocus: false }); return false; }
      entryPage = currentPage();
      entryPosition = options.capturePosition?.() || { page: entryPage };
      previewPage = nearbyCenter = entryPage;
      inertTarget = document.querySelector(".app-shell");
      if (inertTarget) { previousInert = Boolean(inertTarget.inert); inertTarget.inert = true; }
      setStatus();
      renderControls();
      renderTiles();
      updateReturnButton();
      closeButton.focus({ preventScroll: true });
      return true;
    } catch {
      close();
      notify("暂时无法打开页面预览，请重试。");
      return false;
    }
  }

  function rangeBounds() {
    return rangeMode === "near"
      ? [Math.max(1, nearbyCenter - NEARBY_RADIUS), Math.min(totalPages(), nearbyCenter + NEARBY_RADIUS)]
      : [1, totalPages()];
  }
  function setRangeMode(mode) {
    if (operation) return;
    rangeDragging = false;
    rangeMode = mode;
    nearbyCenter = previewPage;
    renderControls();
  }
  function renderControls({ keepInput = false } = {}) {
    const busy = Boolean(operation);
    const [start, end] = rangeBounds();
    reading.textContent = `正在读 ${currentPage()} / ${totalPages()}`;
    rangeLabel.textContent = rangeMode === "near" ? "前后 50 页" : "快速跨页";
    allButton.setAttribute("aria-pressed", String(rangeMode === "all"));
    nearButton.setAttribute("aria-pressed", String(rangeMode === "near"));
    allButton.disabled = nearButton.disabled = busy;
    slider.min = String(start);
    slider.max = String(end);
    slider.value = String(previewPage);
    slider.disabled = busy || start === end;
    slider.setAttribute("aria-valuetext", `预览第 ${previewPage} 页，共 ${totalPages()} 页`);
    slider.setAttribute("aria-label", rangeMode === "near" ? `附近页面预览，从第 ${start} 到 ${end} 页` : "全书页面预览");
    rangeStart.textContent = String(start);
    rangeEnd.textContent = String(end);
    input.max = String(totalPages());
    if (!keepInput) input.value = String(previewPage);
    input.disabled = busy;
    previousButton.disabled = busy || previewPage <= 1;
    nextButton.disabled = busy || previewPage >= totalPages();
    goButton.disabled = busy;
    goButton.textContent = busy ? "正在前往…" : `前往第 ${previewPage} 页`;
    panel.setAttribute("aria-busy", String(busy));
    for (const tile of tiles.values()) tile.button.disabled = busy;
  }
  function selectPage(value, { keepInput = false } = {}) {
    if (operation || overlay.hidden || !available()) return;
    const next = clampPage(value);
    const [start, end] = rangeBounds();
    if (rangeMode === "near" && !rangeDragging && (next < start || next > end)) nearbyCenter = next;
    const changed = next !== previewPage;
    previewPage = next;
    setStatus();
    renderControls({ keepInput });
    if (changed || !tiles.size) renderTiles();
  }
  function renderTiles() {
    const focusWasTile = Boolean(document.activeElement?.closest?.(".pdf-navigator-thumbnail"));
    stopThumbnails();
    releaseTiles();
    for (const page of [previewPage - 1, previewPage, previewPage + 1]) {
      if (page < 1 || page > totalPages()) {
        const empty = element("div", "pdf-navigator-thumbnail-placeholder");
        empty.setAttribute("aria-hidden", "true");
        strip.append(empty);
        continue;
      }
      const tile = element("button", `pdf-navigator-thumbnail${page === previewPage ? " is-selected" : ""}`);
      tile.type = "button";
      tile.dataset.page = String(page);
      tile.setAttribute("aria-label", `预览第 ${page} 页`);
      tile.setAttribute("aria-pressed", String(page === previewPage));
      const frame = element("span", "pdf-navigator-thumbnail-frame");
      frame.setAttribute("aria-hidden", "true");
      frame.append(element("span", "pdf-navigator-thumbnail-message", "正在准备…"));
      const label = element("span", "pdf-navigator-thumbnail-label", page === previewPage ? `预览 ${page}` : String(page));
      tile.append(frame, label);
      strip.append(tile);
      tiles.set(page, { button: tile, frame });
    }
    if (focusWasTile) tiles.get(previewPage)?.button.focus({ preventScroll: true });
    const batch = thumbnailBatch;
    const token = generation;
    const activeDoc = doc;
    thumbnailTimer = window.setTimeout(() => {
      thumbnailTimer = 0;
      if (overlay.hidden || token !== generation || batch !== thumbnailBatch || !available()) return;
      const pages = [...tiles.keys()].sort((a, b) => Math.abs(a - previewPage) - Math.abs(b - previewPage));
      const valid = () => !overlay.hidden && token === generation && batch === thumbnailBatch && available() &&
        doc === activeDoc && (!options.getDocument || options.getDocument() === activeDoc);
      const request = thumbnails.request(pages, {
        onThumbnail(page, sourceCanvas) {
          const tile = tiles.get(page);
          if (!valid() || !tile || !sourceCanvas?.width || !sourceCanvas?.height) return;
          try {
            const canvas = document.createElement("canvas");
            canvas.width = sourceCanvas.width;
            canvas.height = sourceCanvas.height;
            const context = canvas.getContext("2d", { alpha: false });
            if (!context) throw new Error("No canvas context");
            context.drawImage(sourceCanvas, 0, 0);
            const previous = tile.frame.querySelector("canvas");
            if (previous) { previous.width = 0; previous.height = 0; }
            tile.frame.replaceChildren(canvas);
          } catch { tile.frame.replaceChildren(element("span", "pdf-navigator-thumbnail-message", "预览暂不可用")); }
        },
        onError(page) {
          const tile = tiles.get(page);
          if (valid() && tile) tile.frame.replaceChildren(element("span", "pdf-navigator-thumbnail-message", "预览暂不可用"));
        },
      });
      Promise.resolve(request).catch(() => {
        if (!valid()) return;
        for (const tile of tiles.values()) {
          if (!tile.frame.querySelector("canvas")) tile.frame.replaceChildren(element("span", "pdf-navigator-thumbnail-message", "预览暂不可用"));
        }
      });
    }, THUMBNAIL_DELAY_MS);
  }

  async function commit() {
    if (!syncDocument() || operation || overlay.hidden) return;
    selectPage(input.value);
    const page = previewPage;
    if (page === currentPage()) { close(); return; }
    const position = entryPosition;
    const fromPage = entryPage;
    const active = { kind: "navigate", controller: new AbortController(), generation, doc, documentId };
    operation = active;
    renderControls();
    setStatus("正在打开预览页…");
    try {
      const success = await options.navigate?.(page, { signal: active.controller.signal });
      if (!sameOperation(active)) return;
      if (success !== true) { setStatus("这一页暂时打不开，请重试。"); return; }
      if (position && fromPage !== page) {
        returnPosition = position;
        returnPage = fromPage;
      }
      operation = null;
      close();
      notify(`已前往第 ${page} 页。`);
    } catch (error) {
      if (sameOperation(active) && error?.name !== "AbortError") setStatus("跳转失败，请重试。");
    } finally {
      if (operation === active) {
        operation = null;
        if (!overlay.hidden) renderControls();
        updateReturnButton();
      }
    }
  }

  async function restore() {
    if (operation || !syncDocument() || !returnPosition || !overlay.hidden) return;
    const position = returnPosition;
    const page = returnPage;
    const active = { kind: "restore", controller: new AbortController(), generation, doc, documentId };
    operation = active;
    updateReturnButton();
    try {
      const success = await options.restorePosition?.(position, { signal: active.controller.signal });
      if (!sameOperation(active)) return;
      if (success === true) {
        returnPosition = null;
        notify(`已返回第 ${page} 页原来的位置。`);
      } else notify("暂时无法返回原位，请重试。");
    } catch (error) {
      if (sameOperation(active) && error?.name !== "AbortError") notify("返回原位失败，请重试。");
    } finally {
      if (operation === active) { operation = null; updateReturnButton(); }
    }
  }

  function update() {
    if (!syncDocument()) return;
    if (!overlay.hidden) renderControls({ keepInput: document.activeElement === input });
    updateReturnButton();
  }

  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (Number.isInteger(value) && value >= 1 && value <= totalPages()) selectPage(value, { keepInput: true });
  });
  input.addEventListener("change", () => selectPage(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); selectPage(input.value); goButton.focus(); }
  });
  slider.addEventListener("pointerdown", () => { rangeDragging = true; });
  slider.addEventListener("input", () => selectPage(slider.value));
  const endRangeDrag = () => { rangeDragging = false; };
  slider.addEventListener("change", endRangeDrag);
  slider.addEventListener("pointerup", endRangeDrag);
  slider.addEventListener("pointercancel", endRangeDrag);
  slider.addEventListener("blur", endRangeDrag);
  slider.addEventListener("keydown", (event) => {
    // Top-to-bottom means page numbers increase on ArrowDown in every browser.
    const delta = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, PageDown: 10, PageUp: -10 }[event.key];
    const [start, end] = rangeBounds();
    if (delta || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      rangeDragging = true;
      selectPage(event.key === "Home" ? start : event.key === "End" ? end : Math.max(start, Math.min(end, previewPage + delta)));
      rangeDragging = false;
    }
  });
  strip.addEventListener("pointerdown", (event) => {
    if (operation || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag = {
      id: event.pointerId, y: event.clientY, start: previewPage, moved: false,
      page: Number(event.target.closest?.("[data-page]")?.dataset.page) || null,
      step: Math.max(40, Math.min(80, strip.clientHeight / 5)),
    };
    try { strip.setPointerCapture(event.pointerId); } catch { /* Capture is optional. */ }
  });
  strip.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id || operation) return;
    const dy = event.clientY - drag.y;
    if (Math.abs(dy) > 9) drag.moved = true;
    if (drag.moved) { event.preventDefault(); selectPage(drag.start - Math.round(dy / drag.step)); }
  });
  strip.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const finished = drag;
    drag = null;
    ignorePointerClickUntil = Date.now() + 500;
    if (!finished.moved && finished.page) selectPage(finished.page);
    try { strip.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
  });
  strip.addEventListener("pointercancel", () => { drag = null; ignorePointerClickUntil = Date.now() + 500; });
  strip.addEventListener("click", (event) => {
    if (event.detail !== 0 && Date.now() < ignorePointerClickUntil) return;
    const page = Number(event.target.closest?.("[data-page]")?.dataset.page);
    if (page) selectPage(page);
  });
  overlay.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === overlay) close();
  });
  for (const type of ["pointerdown", "pointerup", "touchstart", "touchend"]) {
    overlay.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
  }
  overlay.addEventListener("touchmove", (event) => {
    event.stopPropagation();
    if (event.target === overlay || event.target.closest?.(".pdf-navigator-strip")) event.preventDefault();
  }, { passive: false });
  overlay.addEventListener("wheel", (event) => {
    event.stopPropagation();
    if (!middle.contains(event.target) || middle.scrollHeight <= middle.clientHeight) event.preventDefault();
  }, { passive: false });
  overlay.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll("button:not(:disabled), input:not(:disabled)")].filter((node) => !node.hidden);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  });

  return { open, close, isOpen: () => !overlay.hidden, update, clear, setDocument };
}
