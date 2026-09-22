import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import {
  findTextMatches, indexTextContent, normalizeSearchText,
  readPdfBookmarks, resolvePdfDestination, searchPdfDocument, writePdfBookmarks,
} from "../src/pdf-tools.js";

test("PDF search spans text items and line breaks without corrupting original offsets", () => {
  const indexed = indexTextContent({ items: [
    { str: "Hello " }, { type: "beginMarkedContent" }, { str: "ofﬁce", hasEOL: true },
    { str: "World 😀世界" },
  ] });
  assert.equal(indexed.text, "Hello ofﬁce\nWorld 😀世界");
  const [match] = findTextMatches(indexed.text, "OFFICE world");
  assert.equal(indexed.text.slice(match.start, match.end), "ofﬁce\nWorld");
  const [unicodeMatch] = findTextMatches(indexed.text, "😀世界");
  assert.equal(indexed.text.slice(unicodeMatch.start, unicodeMatch.end), "😀世界");
  assert.equal(normalizeSearchText("Ａ\t \nB").text, "a b");
  assert.deepEqual(findTextMatches(indexed.text, "   "), []);
  const prefix = indexTextContent({ items: [{ str: "" }, { str: "a" }, { str: "huge text" }] }, { maxCharacters: 4 });
  assert.deepEqual(prefix.spans, [{ start: 0, end: 0 }, { start: 0, end: 1 }, { start: 1, end: 4 }]);
  assert.equal(prefix.text, "ahug");
  assert.equal(prefix.truncated, true);
  assert.equal(indexTextContent({ items: [{ str: "" }, { str: "" }, { str: "" }] }, { maxItems: 2 }).truncated, true);
});

test("PDF search keeps scanning after a malformed page and returns usable snippets", async () => {
  const visited = [];
  const doc = { numPages: 3, async getPage(page) {
    visited.push(page);
    if (page === 2) throw new Error("bad content stream");
    return { getTextContent: async () => ({ items: [{ str: `Page ${page}: needle needle` }] }) };
  } };
  const progress = [];
  for await (const update of searchPdfDocument(doc, "needle")) progress.push(update);
  assert.deepEqual(visited, [1, 2, 3]);
  assert.equal(progress.at(-1).count, 4);
  assert.equal(progress.at(-1).failedPages, 1);
  const result = progress[0].results[0];
  assert.equal(result.page, 1);
  assert.equal(result.snippet.slice(result.snippetMatchStart, result.snippetMatchEnd), "needle");
});

test("cancelling a pending text extraction returns immediately and never reads another page", async () => {
  let release;
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const content = new Promise((resolve) => { release = resolve; });
  let pagesRead = 0;
  const doc = { numPages: 10, async getPage() {
    pagesRead++;
    return { getTextContent() { started(); return content; } };
  } };
  const controller = new AbortController();
  const iterator = searchPdfDocument(doc, "secret", { signal: controller.signal });
  const next = iterator.next();
  await waiting;
  controller.abort();
  assert.deepEqual(await next, { value: undefined, done: true });
  release({ items: [{ str: "secret from old document" }] });
  await Promise.resolve();
  assert.equal(pagesRead, 1);
});

test("PDF result limits and stalled worker failures bound background work", async () => {
  const visited = [];
  const doc = { numPages: 100, async getPage(page) {
    visited.push(page);
    return { getTextContent: async () => ({ items: [{ str: "x x x x" }] }) };
  } };
  const progress = [];
  for await (const update of searchPdfDocument(doc, "x", { limit: 3 })) progress.push(update);
  assert.deepEqual(visited, [1]);
  assert.equal(progress[0].count, 3);
  assert.equal(progress[0].limited, true);

  const stalled = [];
  const hanging = { numPages: 20, getPage(page) { stalled.push(page); return new Promise(() => {}); } };
  const failed = [];
  for await (const update of searchPdfDocument(hanging, "x", { timeoutMs: 5 })) failed.push(update);
  assert.deepEqual(stalled, [1]);
  assert.equal(failed[0].failedPages, 20);
  assert.equal(failed[0].stopped, true);
});

test("PDF destinations resolve named targets, references and zero-based page indexes", async () => {
  const reference = { num: 12, gen: 0 };
  const doc = {
    numPages: 10,
    getDestination: async (name) => name === "chapter" ? [reference, { name: "XYZ" }, 0, 100, null] : null,
    getPageIndex: async (ref) => { assert.equal(ref, reference); return 4; },
  };
  assert.equal(await resolvePdfDestination(doc, "chapter"), 5);
  assert.equal(await resolvePdfDestination(doc, [0]), 1);
  assert.equal(await resolvePdfDestination(doc, [9]), 10);
  assert.equal(await resolvePdfDestination(doc, [10]), null);
  assert.equal(await resolvePdfDestination(doc, "missing"), null);
});

test("PDF bookmarks persist only page numbers per document and tolerate corrupt storage", () => {
  let raw = "invalid JSON";
  const storage = { getItem: () => raw, setItem: (key, value) => { raw = value; } };
  assert.deepEqual(readPdfBookmarks(storage, "doc:one", 10), []);
  assert.equal(writePdfBookmarks(storage, "doc:one", [3, 1, 3, 0, -1, "secret", 1.2]), true);
  assert.deepEqual(JSON.parse(raw), [["doc:one", [1, 3]]]);
  assert.equal(writePdfBookmarks(storage, "doc:two", [8, 99]), true);
  assert.deepEqual(readPdfBookmarks(storage, "doc:one", 10), [1, 3]);
  assert.deepEqual(readPdfBookmarks(storage, "doc:two", 10), [8]);
  const saved = raw;
  assert.equal(writePdfBookmarks(storage, "", [2]), false);
  assert.equal(raw, saved, "temporary documents do not overwrite a saved document's bookmarks");
  assert.equal(writePdfBookmarks(storage, "doc:one", []), true);
  assert.deepEqual(readPdfBookmarks(storage, "doc:one", 10), []);
  assert.equal(writePdfBookmarks({ getItem() { throw Error(); }, setItem() { throw Error(); } }, "doc:one", [1]), false);
});

test("a selected search result scrolls only once, preserving the reading position on redraw", () => {
  const source = fs.readFileSync(new URL("../src/pdf-tools.js", import.meta.url), "utf8");
  const start = source.indexOf("  function focusSelectedMatch()");
  const end = source.indexOf("  async function renderTextLayer(", start);
  assert.ok(start > 0 && end > start);
  let scrolls = 0;
  const layers = new Map();
  const context = vm.createContext({ layers, pendingMatchFocus: { page: 2, start: 5 } });
  vm.runInContext(source.slice(start, end), context);
  context.focusSelectedMatch();
  assert.notEqual(context.pendingMatchFocus, null, "wait for a rendered result before consuming focus");
  const layer = () => ({ page: 2, overlay: { querySelector: () => ({ scrollIntoView: () => scrolls++ }) } });
  layers.set("canvas", layer());
  context.focusSelectedMatch();
  assert.equal(scrolls, 1);
  assert.equal(context.pendingMatchFocus, null);
  layers.set("canvas", layer()); // Resize/zoom creates a new text-layer entry.
  context.focusSelectedMatch();
  assert.equal(scrolls, 1, "a recreated layer must not scroll back to an old result");
  context.pendingMatchFocus = { page: 2, start: 5 }; // Explicitly select it again.
  context.focusSelectedMatch();
  assert.equal(scrolls, 2);
});
