import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as encryption from "../src/encryption.js";
import * as backups from "../src/encrypted-backups.js";
import { EncryptedDocumentSource } from "../src/pdf-sources.js";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const workerSource = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const noop = () => {};

function load(context, names) {
  for (const name of names) {
    const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(appSource);
    assert.ok(start, `Missing function ${name}`);
    const rest = appSource.slice(start.index + start[0].length);
    const end = /\n(?:async )?function \w+\(/.exec(rest);
    assert.ok(end, `Missing end of function ${name}`);
    vm.runInContext(appSource.slice(start.index, start.index + start[0].length + end.index), context);
  }
}

test("a same-password backup authenticates every body chunk before replacing the saved book", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { crypto: webcrypto };
  try {
    const plain = new Uint8Array(41).fill(65);
    const metadata = {
      version: 1, algorithm: "AES-GCM", keyAlgorithm: "PBKDF2-SHA256",
      salt: "000102030405060708090a0b0c0d0e0f", noncePrefix: "01020304",
      chunkSize: 16, originalSize: plain.length, iterations: 1, tagLength: 128,
    };
    const original = {
      id: "doc:backup-integrity", name: "saved.pdf", format: "pdf",
      type: "application/pdf", size: plain.length, encrypted: true, encryption: metadata,
    };
    const key = await encryption.deriveRecordEncryptionKey(original, "test-password");
    original.encryptedName = await encryption.encryptRecordName(original, key, metadata);
    const encryptedChunks = [];
    for (let chunkIndex = 0; chunkIndex < 3; chunkIndex += 1) {
      encryptedChunks.push(await webcrypto.subtle.encrypt({
        name: "AES-GCM", iv: encryption.createChunkIv(metadata, chunkIndex),
        additionalData: encryption.createChunkAad(original, metadata, chunkIndex), tagLength: 128,
      }, key, plain.subarray(chunkIndex * metadata.chunkSize, (chunkIndex + 1) * metadata.chunkSize)));
    }
    original.blob = new Blob(encryptedChunks);
    const validBackup = await backups.createEncryptedBackupBlob(original);
    const damagedBytes = new Uint8Array(await validBackup.arrayBuffer());
    damagedBytes[damagedBytes.length - 1] ^= 1;
    const damaged = await backups.parseEncryptedBackupFile(new Blob([damagedBytes]));
    let stored = original;
    let writes = 0;
    let progressDeletions = 0;
    const verified = [];
    const context = vm.createContext({
      ...encryption, EncryptedDocumentSource,
      getStoredDocument: async () => stored,
      putStoredDocument: async (record) => { writes += 1; stored = record; },
      hasStoredDocumentPayload: (record) => Boolean(record?.blob),
      isEncryptedRecordStoredInChunks: () => false,
      recordDiagnosticEvent: noop, summarizeRecordForDiagnostics: noop,
      deleteDocumentProgress: () => progressDeletions += 1,
      waitForNextFrame: async () => {},
    });
    load(context, ["verifyEncryptedBackupRecord", "verifyEncryptedBackupPayload",
      "createEncryptedDocumentSourceWithKey", "saveImportedEncryptedBackupRecord"]);

    // A valid encrypted filename and unchanged body length must not conceal a bad final chunk.
    await assert.rejects(context.saveImportedEncryptedBackupRecord(
      damaged, "test-password", "test-password", ({ chunkIndex }) => verified.push(chunkIndex),
    ), (error) => /正文已损坏/.test(error.userMessage));
    assert.deepEqual(verified, [1, 2]);
    assert.equal(writes, 0);
    assert.equal(stored, original);
    assert.equal(progressDeletions, 0);

    const valid = await backups.parseEncryptedBackupFile(validBackup);
    verified.length = 0;
    await context.saveImportedEncryptedBackupRecord(
      valid, "test-password", "test-password", ({ chunkIndex }) => verified.push(chunkIndex),
    );
    assert.deepEqual(verified, [1, 2, 3]);
    assert.equal(writes, 1);
    assert.equal(progressDeletions, 0, "replacing a valid backup preserves existing progress");
    assert.deepEqual(new Uint8Array(await stored.blob.arrayBuffer()),
      new Uint8Array(await original.blob.arrayBuffer()));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

for (const originalSize of [0, 41]) {
  test(`XChaCha v2 backup validation authenticates ${originalSize} plaintext bytes including the final tag`, async () => {
    const previousWindow = globalThis.window;
    globalThis.window = { crypto: webcrypto };
    try {
      const sodium = await encryption.ensureSodiumReady();
      const key = new Uint8Array(32).fill(9);
      const metadata = {
        version: 2, algorithm: "XCHACHA20-POLY1305", keyAlgorithm: "ARGON2ID13",
        salt: "000102030405060708090a0b0c0d0e0f",
        noncePrefix: "000102030405060708090a0b0c0d0e0f",
        chunkSize: 16, originalSize, tagLength: 128,
      };
      const record = { id: `doc:xchacha-${originalSize}`, name: "test.pdf", format: "pdf",
        encrypted: true, encryption: metadata, size: originalSize };
      record.encryptedName = await encryption.encryptRecordName(record, key, metadata);
      const totalChunks = Math.max(1, Math.ceil(originalSize / metadata.chunkSize));
      const plain = new Uint8Array(originalSize).fill(65);
      const chunks = [];
      for (let index = 0; index < totalChunks; index += 1) {
        chunks.push(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
          plain.subarray(index * metadata.chunkSize, (index + 1) * metadata.chunkSize),
          encryption.createChunkAad(record, metadata, index), null,
          encryption.createChunkNonce(metadata, index), key,
        ));
      }
      record.blob = new Blob(chunks);
      const backup = await backups.createEncryptedBackupBlob(record);
      const parsed = await backups.parseEncryptedBackupFile(backup);
      const context = vm.createContext({
        ...encryption, EncryptedDocumentSource, isEncryptedRecordStoredInChunks: () => false,
        waitForNextFrame: async () => {},
      });
      load(context, ["createEncryptedDocumentSourceWithKey", "verifyEncryptedBackupPayload"]);
      const verified = [];
      await context.verifyEncryptedBackupPayload(parsed, key, ({ chunkIndex }) => verified.push(chunkIndex));
      assert.equal(verified.length, totalChunks);
      const damagedBytes = new Uint8Array(await backup.arrayBuffer());
      damagedBytes[damagedBytes.length - 1] ^= 1;
      const damaged = await backups.parseEncryptedBackupFile(new Blob([damagedBytes]));
      await assert.rejects(context.verifyEncryptedBackupPayload(damaged, key),
        (error) => /正文已损坏/.test(error.userMessage));
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });
}

for (const format of ["pdf", "epub"]) {
  test(`selecting a saved ${format} resumes without rewriting or re-encrypting it`, async () => {
    const progress = { page: 88, scrollPage: 88, scrollOffsetRatio: 0.4, scrollTop: 9876,
      zoom: 1.6, mode: "scroll", epubCfi: "epubcfi(/6/4!/4/2:50)", epubProgress: 0.7, format };
    const values = new Map();
    let writes = 0;
    let encryptions = 0;
    let fileReads = 0;
    const file = { name: `saved.${format}`, size: 12345, lastModified: 123,
      slice: () => { fileReads += 1; return new Blob(["content"]); } };
    const context = vm.createContext({
      DOCUMENT_ID_PREFIX: "doc:", DOCUMENT_FORMATS: { PDF: "pdf", EPUB: "epub" },
      READ_MODES: { PAGED: "paged", SCROLL: "scroll" }, PROGRESS_KEY: "progress",
      state: { page: 1, zoom: 1, mode: "paged" }, sessionPassword: "test-password",
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      getDocumentFormatFromFile: () => format,
      getLockConfig: () => ({ enabled: true }),
      hasStoredDocumentPayload: (record) => Boolean(record?.blob),
      putStoredDocument: async () => writes += 1,
      encryptDocumentRecord: async (record) => { encryptions += 1; return record; },
      isEncryptedBackupFile: () => false, isSupportedDocumentFile: () => true,
      recordDiagnosticEvent: noop, summarizeFile: noop, summarizeRecordForDiagnostics: noop,
      showStatus: noop, console,
      window: { localStorage: {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      } },
    });
    load(context, ["hashString", "createDocumentId", "getProgressMap", "readDocumentProgress",
      "deleteDocumentProgress", "applyDocumentProgress", "saveDocumentFile", "handleFileSelection"]);
    const id = context.createDocumentId(file.name, file.size, file.lastModified);
    const saved = { id, format, blob: new Blob(["saved ciphertext"]), encrypted: true };
    context.getStoredDocument = async () => saved;
    values.set("progress", JSON.stringify({ [id]: progress }));
    context.openDocumentRecord = async (record, options = {}) => {
      context.state.documentId = record.id;
      if (options.resetProgress) context.state.page = 1;
      else context.applyDocumentProgress(record.id);
      return true;
    };
    assert.equal(await context.handleFileSelection(file), true);
    assert.equal(context.state.page, 88);
    assert.equal(context.state.scrollOffsetRatio, 0.4);
    assert.equal(context.state.zoom, 1.6);
    assert.equal(context.state.mode, "scroll");
    assert.equal(context.state.epubCfi, progress.epubCfi);
    assert.deepEqual(JSON.parse(values.get("progress"))[id], progress);
    assert.equal(writes, 0);
    assert.equal(encryptions, 0);
    assert.equal(fileReads, 0);

    // A fresh import must use the explicit first-page/100%-zoom reset even when another book is open.
    context.getStoredDocument = async () => null;
    let freshOpenOptions;
    context.openDocumentRecord = async (record, options) => { freshOpenOptions = options; return true; };
    await context.handleFileSelection(file);
    assert.equal(freshOpenOptions.resetProgress, true);
    assert.equal(JSON.parse(values.get("progress"))[id], undefined);
  });
}

test("failed deletion preserves the current document and its progress", async () => {
  const state = { documentId: "doc:active", fileName: "saved.pdf", page: 88 };
  const originalState = { ...state };
  const events = [];
  let fail = true;
  const context = vm.createContext({
    state, DOCUMENT_FORMATS: { PDF: "pdf" },
    deleteStoredDocument: async () => {
      if (fail) throw new Error("Database transaction aborted");
      events.push("storage-deleted");
    },
    closeCurrentDocument: async () => events.push("reader-closed"),
    deleteDocumentProgress: () => events.push("progress-deleted"),
    setReaderVisible: noop, updateControls: noop, saveReaderState: noop,
    renderLibraryList: async () => {}, showStatus: (message) => events.push(message),
  });
  load(context, ["deleteDocumentFromLibrary"]);
  await assert.rejects(context.deleteDocumentFromLibrary(state.documentId), /transaction aborted/);
  assert.deepEqual(state, originalState);
  assert.deepEqual(events, []);
  fail = false;
  await context.deleteDocumentFromLibrary(state.documentId);
  assert.deepEqual(events, ["storage-deleted", "reader-closed", "progress-deleted", "已从书架删除。"]);
  assert.equal(state.documentId, "");
});

function serviceWorkerContext({ download, cacheNames = [] } = {}) {
  const handlers = new Map();
  const events = [];
  const context = vm.createContext({
    self: {
      addEventListener: (type, handler) => handlers.set(type, handler),
      skipWaiting: async () => events.push("skip-waiting"),
      clients: { claim: async () => events.push("claim") },
    },
    caches: {
      open: async () => ({ addAll: download }),
      keys: async () => cacheNames,
      delete: async (key) => { events.push(`delete:${key}`); return true; },
    },
  });
  vm.runInContext(workerSource, context);
  return {
    events,
    dispatch(type) {
      let pending;
      handlers.get(type)({ waitUntil: (promise) => pending = promise });
      return pending;
    },
  };
}

test("a failed offline shell download rejects installation without replacing the working worker", async () => {
  const worker = serviceWorkerContext({ download: async (urls) => {
    assert.ok(urls.some((url) => /^\.\/app\.js/.test(url)));
    throw new Error("Essential script download failed");
  } });
  await assert.rejects(worker.dispatch("install"), /Essential script/);
  assert.deepEqual(worker.events, []);
});

test("a new service worker waits for the complete shell and removes only its own old caches", async () => {
  let finishDownload;
  const downloaded = new Promise((resolve) => finishDownload = resolve);
  const currentCache = /const CACHE_NAME = "([^"]+)"/.exec(workerSource)[1];
  const oldCache = "portable-pdf-reader-v-old-test";
  const worker = serviceWorkerContext({
    download: () => downloaded,
    cacheNames: [currentCache, oldCache, "unrelated-app-cache"],
  });
  const install = worker.dispatch("install");
  await Promise.resolve();
  assert.deepEqual(worker.events, []);
  finishDownload();
  await install;
  assert.deepEqual(worker.events, ["skip-waiting"]);
  await worker.dispatch("activate");
  assert.deepEqual(worker.events, ["skip-waiting", `delete:${oldCache}`, "claim"]);
});
