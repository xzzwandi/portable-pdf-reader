const BOOKMARK_KEY = "portable-pdf-reader-pdf-bookmarks";
const MAX_BOOKMARK_DOCUMENTS = 200;
const MAX_BOOKMARKS = 500;
const MAX_RESULTS = 300;
const MAX_TEXT_LAYERS = 16;
const MAX_PAGE_TEXT = 2_000_000;
const PDF_TOOL_TIMEOUT_MS = 25_000;

// Offsets refer to the original string, including when a ligature expands or
// Unicode case folding changes its length. This keeps highlights on the text.
export function normalizeSearchText(value) {
  const parts = [];
  const starts = [];
  const ends = [];
  let offset = 0;
  for (const character of String(value)) {
    const end = offset + character.length;
    for (const normalized of character.normalize("NFKC").toLowerCase()) {
      const part = /\s/u.test(normalized) ? " " : normalized;
      if (part === " " && parts[parts.length - 1] === " ") {
        ends[ends.length - 1] = end;
        continue;
      }
      parts.push(part);
      for (let index = 0; index < part.length; index++) {
        starts.push(offset);
        ends.push(end);
      }
    }
    offset = end;
  }
  return { text: parts.join(""), starts, ends };
}

export function findTextMatches(text, query, limit = MAX_RESULTS) {
  const needle = normalizeSearchText(query).text.trim();
  if (!needle || limit <= 0) return [];
  const normalized = normalizeSearchText(text);
  const matches = [];
  let offset = 0;
  while (matches.length < limit) {
    const found = normalized.text.indexOf(needle, offset);
    if (found < 0) break;
    matches.push({ start: normalized.starts[found], end: normalized.ends[found + needle.length - 1] });
    offset = found + needle.length;
  }
  return matches;
}

export function indexTextContent(content, { maxCharacters = MAX_PAGE_TEXT, maxItems = 100_000 } = {}) {
  let text = "";
  const spans = [];
  let truncated = false;
  for (const item of content?.items || []) {
    if (typeof item.str !== "string") continue;
    const remaining = maxCharacters - text.length;
    if (remaining <= 0 || spans.length >= maxItems) { truncated = true; break; }
    const value = item.str.slice(0, remaining);
    spans.push({ start: text.length, end: text.length + value.length });
    text += value;
    if (item.hasEOL && text.length < maxCharacters) text += "\n";
    if (value.length < item.str.length) { truncated = true; break; }
  }
  return { text, spans, truncated };
}

function abortError() {
  return new DOMException("PDF operation cancelled", "AbortError");
}

function timedOperation(promise, signal, timeoutMs = PDF_TOOL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); reject(abortError()); };
    // Register handlers even after cancellation so a rejected PDF.js operation
    // cannot become an unhandled rejection after a document is destroyed.
    Promise.resolve(promise).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error("PDF operation timed out")); }, timeoutMs);
  });
}

// Search one page at a time; do not retain a full-document text index or page
// proxies. A cancelled search cannot publish another result from an old book.
export async function* searchPdfDocument(doc, query, { signal, limit = MAX_RESULTS, timeoutMs } = {}) {
  if (!normalizeSearchText(query).text.trim()) return;
  let count = 0;
  let failedPages = 0;
  let truncatedPages = 0;
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    if (signal?.aborted) return;
    let results = [];
    try {
      const page = await timedOperation(doc.getPage(pageNumber), signal, timeoutMs);
      const content = await timedOperation(page.getTextContent(), signal, timeoutMs);
      if (signal?.aborted) return;
      const indexed = indexTextContent(content);
      truncatedPages += Number(indexed.truncated);
      const matches = findTextMatches(indexed.text, query, limit - count);
      results = matches.map((match) => {
        const snippetStart = Math.max(0, match.start - 45);
        const snippetEnd = Math.min(indexed.text.length, match.end + 80);
        return {
          page: pageNumber,
          ...match,
          snippet: indexed.text.slice(snippetStart, snippetEnd),
          snippetMatchStart: match.start - snippetStart,
          snippetMatchEnd: match.end - snippetStart,
          leading: snippetStart > 0,
          trailing: snippetEnd < indexed.text.length,
        };
      });
      count += results.length;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return;
      failedPages++;
      // A timed-out worker may still be busy. Do not queue the remaining book
      // behind it; report this page and every unread page as unavailable.
      if (error?.message === "PDF operation timed out") {
        failedPages += doc.numPages - pageNumber;
        yield { page: pageNumber, total: doc.numPages, results, count, failedPages, truncatedPages, limited: false, stopped: true };
        return;
      }
    }
    if (signal?.aborted) return;
    const limited = count >= limit;
    yield { page: pageNumber, total: doc.numPages, results, count, failedPages, truncatedPages, limited, stopped: false };
    if (limited) return;
    // Give page navigation and the cancel button a chance to run on large PDFs.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function resolvePdfDestination(doc, destination) {
  const explicit = typeof destination === "string" ? await doc.getDestination(destination) : destination;
  if (!Array.isArray(explicit) || !explicit.length) return null;
  const reference = explicit[0];
  const index = typeof reference === "number" ? reference : await doc.getPageIndex(reference);
  return Number.isInteger(index) && index >= 0 && index < doc.numPages ? index + 1 : null;
}

function cleanBookmarks(pages, pageCount = Infinity) {
  return [...new Set(Array.isArray(pages) ? pages.filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount) : [])]
    .sort((a, b) => a - b).slice(0, MAX_BOOKMARKS);
}

function bookmarkData(storage) {
  try {
    const raw = storage?.getItem(BOOKMARK_KEY);
    if (!raw || raw.length > 2_000_000) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((entry) => Array.isArray(entry) && typeof entry[0] === "string").slice(-MAX_BOOKMARK_DOCUMENTS) : [];
  } catch { return []; }
}

export function readPdfBookmarks(storage, documentId, pageCount) {
  if (!documentId) return [];
  return cleanBookmarks(bookmarkData(storage).find((entry) => entry[0] === documentId)?.[1], pageCount);
}

export function writePdfBookmarks(storage, documentId, pages) {
  if (!documentId || !storage) return false;
  const data = bookmarkData(storage).filter((entry) => entry[0] !== documentId);
  const clean = cleanBookmarks(pages);
  if (clean.length) data.push([documentId, clean]);
  try {
    storage.setItem(BOOKMARK_KEY, JSON.stringify(data.slice(-MAX_BOOKMARK_DOCUMENTS)));
    return true;
  } catch { return false; }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, action, className = "") {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

export function createPdfTools(options = {}) {
  let doc = null;
  let documentId = "";
  let generation = 0;
  let panelGeneration = 0;
  let kind = "outline";
  let previousFocus = null;
  let searchController = null;
  let searchQuery = "";
  let selectedMatch = null;
  let pendingMatchFocus = null;
  let bookmarks = [];
  let storage;
  try { storage = options.storage || window.localStorage; } catch { storage = null; }
  const layers = new Map();
  const overlay = element("div", "pdf-tools-overlay");
  overlay.id = "pdfToolsOverlay";
  overlay.hidden = true;
  const panel = element("section", "pdf-tools-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "pdfToolsTitle");
  panel.tabIndex = -1;
  const header = element("header", "pdf-tools-header");
  const title = element("h2", "", "PDF 工具");
  title.id = "pdfToolsTitle";
  header.append(title, button("关闭", () => close()));
  const tabs = element("div", "pdf-tools-tabs");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "PDF 工具");
  const tabButtons = new Map();
  for (const [key, label] of [["outline", "目录"], ["search", "搜索"], ["bookmarks", "书签"]]) {
    const tab = button(label, () => open(key));
    tabButtons.set(key, tab);
    tabs.append(tab);
  }
  const body = element("div", "pdf-tools-body");
  panel.append(header, tabs, body);
  overlay.append(panel);
  document.body.append(overlay);

  function notify(message) { options.showStatus?.(message); }
  function currentPage() { return Math.max(1, Math.min(doc?.numPages || 1, Math.round(options.getPage?.() || 1))); }
  function stopSearch() { searchController?.abort(); searchController = null; }
  function isCurrent(token, currentDoc = doc) { return token === generation && doc === currentDoc && Boolean(doc); }
  function syncDocument() {
    const nextDoc = options.getDocument ? options.getDocument() : doc;
    const nextId = options.getDocumentId ? options.getDocumentId() : documentId;
    if (nextDoc !== doc || nextId !== documentId) setDocument(nextDoc, nextId);
  }
  function close({ restoreFocus = true } = {}) {
    const wasOpen = !overlay.hidden;
    overlay.hidden = true;
    panelGeneration++;
    stopSearch();
    body.replaceChildren();
    if (wasOpen) options.onClose?.();
    if (wasOpen && restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  function clearTextLayers() {
    for (const canvas of [...layers.keys()]) removeTextLayer(canvas);
  }
  function clear() {
    generation++;
    close({ restoreFocus: false });
    clearTextLayers();
    doc = null;
    documentId = "";
    bookmarks = [];
    searchQuery = "";
    selectedMatch = null;
    pendingMatchFocus = null;
    window.getSelection?.()?.removeAllRanges();
  }
  function setDocument(nextDoc, nextId = "") {
    if (doc === nextDoc && documentId === (nextId || "")) return;
    clear();
    doc = nextDoc || null;
    documentId = nextId || "";
    bookmarks = readPdfBookmarks(storage, documentId, doc?.numPages);
  }

  async function navigate(page, match = null) {
    const token = generation;
    selectedMatch = match;
    pendingMatchFocus = match;
    close();
    try {
      await options.navigate?.(page);
      if (!isCurrent(token)) return;
      refreshHighlights();
      focusSelectedMatch();
    } catch { if (isCurrent(token)) notify("暂时无法跳到这一页，请重试。"); }
  }

  function message(text) {
    const node = element("p", "pdf-tools-message", text);
    body.append(node);
    return node;
  }

  async function showOutline(panelToken) {
    const token = generation;
    const activeDoc = doc;
    const status = message("正在读取目录…");
    const valid = () => isCurrent(token, activeDoc) && panelToken === panelGeneration && !overlay.hidden;
    try {
      const outline = await timedOperation(activeDoc.getOutline());
      if (!valid()) return;
      body.replaceChildren();
      if (!outline?.length) { message("这份 PDF 没有内置目录，可使用搜索或书签定位。"); return; }
      const list = element("ol", "pdf-outline-list");
      body.append(list);
      const queue = outline.map((item) => ({ item, depth: 0 })).reverse();
      let count = 0;
      while (queue.length && count < 4000) {
        const { item, depth } = queue.pop();
        const row = element("li");
        const link = button(String(item.title || "未命名章节").slice(0, 500), async () => {
          if (!valid()) return;
          link.disabled = true;
          try {
            const page = await timedOperation(resolvePdfDestination(activeDoc, item.dest));
            if (!valid()) return;
            if (page) await navigate(page);
            else notify("这一目录项没有可跳转的 PDF 页码。");
          } catch { if (valid()) notify("无法读取这一目录项，请重试。"); }
          finally { link.disabled = false; }
        });
        link.style.paddingInlineStart = `${14 + Math.min(depth, 12) * 16}px`;
        if (!item.dest) link.disabled = true;
        row.append(link);
        list.append(row);
        count++;
        if (depth < 32 && Array.isArray(item.items)) {
          for (let index = item.items.length - 1; index >= 0; index--) queue.push({ item: item.items[index], depth: depth + 1 });
        }
      }
      if (queue.length) message("目录过长，已显示前 4000 项。");
    } catch {
      if (valid()) {
        status.textContent = "目录读取失败。";
        body.append(button("重试", () => open("outline")));
      }
    }
  }

  function showSearch(panelToken) {
    const form = element("form", "pdf-search-form");
    const input = element("input");
    input.type = "search";
    input.id = "pdfSearchInput";
    input.placeholder = "在这份 PDF 中搜索";
    input.setAttribute("aria-label", "搜索 PDF 正文");
    input.maxLength = 200;
    input.value = searchQuery;
    input.autocomplete = "off";
    input.spellcheck = false;
    const submit = button("搜索", () => {});
    submit.type = "submit";
    const cancel = button("停止", () => {
      stopSearch();
      cancel.hidden = true;
      submit.disabled = false;
      status.textContent += " · 已停止";
    });
    cancel.hidden = true;
    form.append(input, submit, cancel);
    body.append(form);
    const status = message("输入词语后搜索。扫描件需要先识别文字。");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const list = element("ol", "pdf-search-results");
    body.append(list);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      stopSearch();
      searchQuery = input.value.trim();
      selectedMatch = null;
      pendingMatchFocus = null;
      refreshHighlights();
      list.replaceChildren();
      if (!searchQuery) { status.textContent = "请输入要搜索的词语。"; input.focus(); return; }
      const token = generation;
      const activeDoc = doc;
      const controller = new AbortController();
      searchController = controller;
      const valid = () => !controller.signal.aborted && isCurrent(token, activeDoc) && panelToken === panelGeneration;
      cancel.hidden = false;
      submit.disabled = true;
      status.textContent = "正在搜索…";
      let last;
      try {
        for await (const progress of searchPdfDocument(activeDoc, searchQuery, { signal: controller.signal })) {
          if (!valid()) return;
          last = progress;
          for (const result of progress.results) {
            const row = element("li");
            const link = button("", () => navigate(result.page, result));
            link.append(element("strong", "", `第 ${result.page} 页`));
            const snippet = element("span", "pdf-search-snippet");
            snippet.append(document.createTextNode(`${result.leading ? "…" : ""}${result.snippet.slice(0, result.snippetMatchStart)}`));
            snippet.append(element("mark", "", result.snippet.slice(result.snippetMatchStart, result.snippetMatchEnd)));
            snippet.append(document.createTextNode(`${result.snippet.slice(result.snippetMatchEnd)}${result.trailing ? "…" : ""}`));
            link.append(snippet);
            row.append(link);
            list.append(row);
          }
          status.textContent = `正在搜索 ${progress.page} / ${progress.total} 页 · 找到 ${progress.count} 处`;
        }
        if (!valid()) return;
        let summary = last?.limited ? `已显示前 ${last.count} 处结果，请缩小搜索范围。` : `搜索完成 · 找到 ${last?.count || 0} 处`;
        if (last?.failedPages) summary += ` · ${last.failedPages} 页读取失败`;
        if (last?.truncatedPages) summary += ` · ${last.truncatedPages} 页文字过多，仅搜索部分内容`;
        if (!last?.count && !last?.failedPages) summary += "。扫描件可能没有可搜索的文字。";
        status.textContent = summary;
      } catch {
        if (valid()) status.textContent = "搜索失败，请重试。";
      } finally {
        if (valid()) { cancel.hidden = true; submit.disabled = false; searchController = null; }
      }
    });
    input.focus({ preventScroll: true });
  }

  function saveBookmarks() {
    if (!documentId) return;
    if (!writePdfBookmarks(storage, documentId, bookmarks)) notify("书签暂时保存在本次阅读中，设备存储不可用。");
  }

  function showBookmarks() {
    body.replaceChildren();
    const page = currentPage();
    const saved = bookmarks.includes(page);
    const toggle = button(saved ? `移除第 ${page} 页书签` : `收藏第 ${page} 页`, () => {
      if (saved) bookmarks = bookmarks.filter((entry) => entry !== page);
      else {
        if (bookmarks.length >= MAX_BOOKMARKS) { notify(`每份 PDF 最多保存 ${MAX_BOOKMARKS} 个书签。`); return; }
        bookmarks = cleanBookmarks([...bookmarks, page], doc.numPages);
      }
      saveBookmarks();
      showBookmarks();
      body.querySelector("button")?.focus({ preventScroll: true });
    }, saved ? "" : "primary");
    body.append(toggle);
    if (!documentId) message("这份文件尚未保存到书架，书签仅在本次阅读中保留。");
    if (!bookmarks.length) { message("还没有书签。收藏常看的页面，下次可以直接跳转。"); return; }
    const list = element("ol", "pdf-bookmark-list");
    for (const entry of bookmarks) {
      const row = element("li");
      const link = button(`第 ${entry} 页`, () => navigate(entry));
      if (entry === page) link.setAttribute("aria-current", "page");
      const remove = button("删除", () => {
        bookmarks = bookmarks.filter((candidate) => candidate !== entry);
        saveBookmarks();
        showBookmarks();
        body.querySelector("button")?.focus({ preventScroll: true });
      });
      remove.setAttribute("aria-label", `删除第 ${entry} 页书签`);
      row.append(link, remove);
      list.append(row);
    }
    body.append(list);
  }

  function open(nextKind = "outline") {
    syncDocument();
    if (!doc) { notify("请先打开一份 PDF。"); return; }
    stopSearch();
    kind = tabButtons.has(nextKind) ? nextKind : "outline";
    const wasClosed = overlay.hidden;
    if (wasClosed) previousFocus = document.activeElement;
    overlay.hidden = false;
    if (wasClosed) options.onOpen?.();
    const token = ++panelGeneration;
    body.replaceChildren();
    title.textContent = { outline: "PDF 目录", search: "搜索 PDF", bookmarks: "PDF 书签" }[kind];
    for (const [key, tab] of tabButtons) tab.setAttribute("aria-pressed", String(key === kind));
    if (kind === "outline") void showOutline(token);
    else if (kind === "search") showSearch(token);
    else showBookmarks();
    if (kind !== "search") panel.focus({ preventScroll: true });
  }

  function removeTextLayer(canvas) {
    const entry = layers.get(canvas);
    if (!entry) return;
    layers.delete(canvas);
    entry.controller.abort();
    try { entry.task?.cancel(); } catch { /* Already finished. */ }
    entry.overlay.replaceChildren();
    entry.overlay.remove();
    canvas.style.gridArea = entry.previousGridArea;
    entry.index = null;
    entry.task = null;
  }

  function paintHighlights(entry) {
    if (!entry.index || !entry.task) return;
    const divs = entry.task.textDivs;
    for (let index = 0; index < divs.length; index++) {
      divs[index].textContent = entry.task.textContentItemsStr[index];
    }
    if (!searchQuery) return;
    const matches = findTextMatches(entry.index.text, searchQuery);
    let spanIndex = 0;
    for (const match of matches) {
      while (spanIndex < entry.index.spans.length && entry.index.spans[spanIndex].end <= match.start) spanIndex++;
      for (let index = spanIndex; index < entry.index.spans.length; index++) {
        const span = entry.index.spans[index];
        if (span.start >= match.end) break;
        const div = divs[index];
        if (!div) continue;
        const selected = selectedMatch?.page === entry.page && selectedMatch.start === match.start;
        // Highlights wrap only text nodes, preserving PDF.js positioning and
        // native browser selection/copy even for matches across text items.
        const start = Math.max(match.start, span.start) - span.start;
        const end = Math.min(match.end, span.end) - span.start;
        let offset = 0;
        for (const node of [...div.childNodes]) {
          const length = node.textContent.length;
          if (node.nodeType === 3 && offset < end && offset + length > start) {
            const from = Math.max(0, start - offset);
            const to = Math.min(length, end - offset);
            const mark = element("mark", selected ? "pdf-text-match is-selected" : "pdf-text-match", node.textContent.slice(from, to));
            node.replaceWith(document.createTextNode(node.textContent.slice(0, from)), mark, document.createTextNode(node.textContent.slice(to)));
          }
          offset += length;
        }
      }
    }
  }
  function refreshHighlights() { for (const entry of layers.values()) paintHighlights(entry); }
  function focusSelectedMatch() {
    if (!pendingMatchFocus) return;
    for (const entry of layers.values()) {
      if (entry.page !== pendingMatchFocus.page) continue;
      const mark = entry.overlay.querySelector(".pdf-text-match.is-selected");
      if (mark) {
        // Consume before scrolling: scroll events can trigger page rendering.
        // Later zoom/resize renders keep the highlight without moving the view.
        pendingMatchFocus = null;
        mark.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        return;
      }
    }
  }

  async function renderTextLayer({ page, viewport, canvas }) {
    syncDocument();
    removeTextLayer(canvas);
    if (!doc || !canvas?.parentElement || !page || !viewport) return false;
    for (const [otherCanvas] of layers) if (!otherCanvas.isConnected) removeTextLayer(otherCanvas);
    while (layers.size >= MAX_TEXT_LAYERS) removeTextLayer(layers.keys().next().value);
    const token = generation;
    const textOverlay = element("div", "pdf-text-overlay");
    textOverlay.style.width = canvas.style.width || `${Math.floor(viewport.width)}px`;
    textOverlay.style.height = canvas.style.height || `${Math.floor(viewport.height)}px`;
    const container = element("div", "pdf-text-layer");
    container.style.setProperty("--scale-factor", String(viewport.scale));
    const entry = {
      overlay: textOverlay, container, task: null, index: null,
      previousGridArea: canvas.style.gridArea, page: page.pageNumber,
      controller: new AbortController(),
    };
    layers.set(canvas, entry);
    const valid = () => isCurrent(token) && layers.get(canvas) === entry && canvas.isConnected && !entry.controller.signal.aborted;
    let rendered = false;
    try {
      const [{ TextLayer }, content] = await Promise.all([
        import("../vendor/pdfjs/pdf.min.mjs"),
        timedOperation(page.getTextContent(), entry.controller.signal),
      ]);
      if (!valid()) return false;
      entry.index = indexTextContent(content, { maxCharacters: 500_000, maxItems: 20_000 });
      // Rendering enormous text layers can freeze mobile browsers. Keep the
      // existing bitmap readable and limit selection to the indexed prefix.
      const renderContent = entry.index.truncated ? {
        ...content,
        items: content.items.filter((item) => typeof item.str === "string").slice(0, entry.index.spans.length)
          .map((item, index) => ({ ...item, str: item.str.slice(0, entry.index.spans[index].end - entry.index.spans[index].start) })),
      } : content;
      canvas.style.gridArea = "1 / 1";
      textOverlay.append(container);
      canvas.insertAdjacentElement("afterend", textOverlay);
      entry.task = new TextLayer({ textContentSource: renderContent, container, viewport });
      await timedOperation(entry.task.render(), entry.controller.signal);
      if (!valid()) return false;
      paintHighlights(entry);
      focusSelectedMatch();
      rendered = true;
      return true;
    } catch {
      // Text extraction is optional: encrypted, malformed or image-only PDFs
      // must keep their successfully rendered canvas.
      return false;
    } finally {
      if ((!valid() || !rendered || !entry.container.childElementCount) && layers.get(canvas) === entry) removeTextLayer(canvas);
    }
  }

  function update() {
    syncDocument();
    for (const [canvas] of layers) if (!canvas.isConnected || canvas.hidden) removeTextLayer(canvas);
    if (!overlay.hidden && kind === "bookmarks") showBookmarks();
  }

  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll("button:not(:disabled), input:not(:disabled), [tabindex='0']")].filter((node) => !node.hidden);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

  return { open, close, isOpen: () => !overlay.hidden, setDocument, clear, renderTextLayer, removeTextLayer, clearTextLayers, update };
}
