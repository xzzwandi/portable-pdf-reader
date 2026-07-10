import sodium from "./vendor/libsodium/libsodium-wrappers.mjs";
import {
  AES_GCM_ENCRYPTION_VERSION,
  AES_GCM_IV_BYTES,
  AES_GCM_NONCE_PREFIX_BYTES,
  APP_VERSION,
  ARGON2ID13_KEY_ALGORITHM,
  CONTINUOUS_BLANK_RETRY_LIMIT,
  CONTINUOUS_CLEANUP_IDLE_MS,
  CONTINUOUS_HEALTH_CHECK_DELAY_MS,
  CONTINUOUS_HEALTH_CHECK_INTERVAL_MS,
  CONTINUOUS_KEEP_VIEWPORTS,
  CONTINUOUS_MAX_RENDERED_PAGES,
  CONTINUOUS_OBSERVER_MARGIN,
  CONTINUOUS_RENDER_TIMEOUT_MS,
  CONTINUOUS_RENDER_VIEWPORTS,
  CHUNK_STORE_NAME,
  DB_NAME,
  DB_VERSION,
  DOCUMENT_FORMATS,
  DOCUMENT_ID_PREFIX,
  ENCRYPTED_BACKUP_EXTENSION,
  ENCRYPTED_BACKUP_MAGIC,
  ENCRYPTED_NAME_VERSION,
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_CHUNK_SIZE,
  ENCRYPTION_KDF_ITERATIONS,
  ENCRYPTION_KEY_ALGORITHM,
  ENCRYPTION_VERSION,
  FULLSCREEN_EPUB_SWIPE_DISTANCE,
  FULLSCREEN_EPUB_SWIPE_MAX_DRIFT,
  LAST_DOCUMENT_ID,
  LOCK_KEY,
  MAX_CANVAS_DIMENSION,
  MAX_CONTINUOUS_CANVAS_PIXELS,
  MAX_PAGED_CANVAS_PIXELS,
  METADATA_STORE_NAME,
  PAGED_BLANK_RETRY_DELAY_MS,
  PAGED_BLANK_RETRY_LIMIT,
  PBKDF2_KEY_ALGORITHM,
  PDF_LOAD_TIMEOUT_MS,
  PDF_RANGE_CHUNK_SIZE,
  PDF_RENDER_TIMEOUT_MS,
  PROGRESS_KEY,
  READ_MODES,
  STATE_KEY,
  STORE_NAME,
  TOC_ITEM_ESTIMATED_HEIGHT,
  TOC_RENDER_BATCH_SIZE,
  TOC_RENDER_SCROLL_THRESHOLD,
  XCHACHA20_POLY1305_ALGORITHM,
  XCHACHA_NONCE_BYTES,
  XCHACHA_NONCE_PREFIX_BYTES,
  XCHACHA_TAG_BYTES,
} from "./src/constants.js?v=111";
import {
  bytesToHex,
  createChunkAad,
  createChunkNonce,
  decryptRecordName,
  deriveEncryptionKey,
  deriveRecordEncryptionKey,
  encryptRecordName,
  ensureSodiumReady,
  getDocumentFormat,
  getEncryptedPayloadOffset,
  getEncryptedPayloadSize,
  getEncryptionOriginalSize,
  getEncryptionTagBytes,
  getExpectedEncryptedPayloadSize,
  getFallbackDocumentName,
  getPlainRecordName,
  isCurrentRecordEncryption,
  isRecordEncrypted,
  isRecordNameEncrypted,
  isSodiumEncryptionAvailable,
  isWebCryptoEncryptionAvailable,
  normalizeEncryptedRecordPayload,
  randomBytes,
  recordNeedsEncryptionMigration,
  withDetectedEncryptedPayloadLocation,
  withPayloadOnlyEncryptedBlob,
  withoutEncryptedPayloadLocation,
  withoutPlainRecordName,
} from "./src/encryption.js?v=111";
import {
  clamp,
  wait,
  waitForNextFrame,
} from "./src/utils.js?v=111";
import {
  createEncryptedBackupBlob,
  parseEncryptedBackupFile,
} from "./src/encrypted-backups.js?v=111";
import {
  BlobDocumentSource,
  EncryptedDocumentSource,
  createPdfLoadingTaskFromSource,
  setPdfSourceDiagnosticHandler,
  setPdfSourceMetricHandler,
} from "./src/pdf-sources.js?v=111";

const els = {
  canvas: document.querySelector("#pdfCanvas"),
  canvasWrap: document.querySelector("#canvasWrap"),
  continuousPages: document.querySelector("#continuousPages"),
  controls: document.querySelector("#controls"),
  appVersion: document.querySelector("#appVersion"),
  backupCancelButton: document.querySelector("#backupCancelButton"),
  backupConfirmInput: document.querySelector("#backupConfirmInput"),
  backupCurrentButton: document.querySelector("#backupCurrentButton"),
  backupDescription: document.querySelector("#backupDescription"),
  backupForm: document.querySelector("#backupForm"),
  backupOverlay: document.querySelector("#backupOverlay"),
  backupPasswordInput: document.querySelector("#backupPasswordInput"),
  backupProgress: document.querySelector("#backupProgress"),
  backupProgressText: document.querySelector("#backupProgressText"),
  backupSubmitButton: document.querySelector("#backupSubmitButton"),
  backupTitle: document.querySelector("#backupTitle"),
  docName: document.querySelector("#docName"),
  diagnosticsCloseButton: document.querySelector("#diagnosticsCloseButton"),
  diagnosticsOverlay: document.querySelector("#diagnosticsOverlay"),
  diagnosticsSelectButton: document.querySelector("#diagnosticsSelectButton"),
  diagnosticsText: document.querySelector("#diagnosticsText"),
  edgeJumpGroup: document.querySelector("#edgeJumpGroup"),
  emptyOpenButton: document.querySelector("#emptyOpenButton"),
  emptyState: document.querySelector("#emptyState"),
  encryptionDescription: document.querySelector("#encryptionDescription"),
  encryptionForm: document.querySelector("#encryptionForm"),
  encryptionLaterButton: document.querySelector("#encryptionLaterButton"),
  encryptionOverlay: document.querySelector("#encryptionOverlay"),
  encryptionPasswordInput: document.querySelector("#encryptionPasswordInput"),
  encryptionProgress: document.querySelector("#encryptionProgress"),
  encryptionProgressText: document.querySelector("#encryptionProgressText"),
  encryptionStartButton: document.querySelector("#encryptionStartButton"),
  epubPane: document.querySelector("#epubPane"),
  epubViewer: document.querySelector("#epubViewer"),
  fileInput: document.querySelector("#fileInput"),
  fitButton: document.querySelector("#fitButton"),
  floatingFullscreenButton: document.querySelector("#floatingFullscreenButton"),
  floatingLockButton: document.querySelector("#floatingLockButton"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  imageCloseButton: document.querySelector("#imageCloseButton"),
  imageOverlay: document.querySelector("#imageOverlay"),
  imagePreview: document.querySelector("#imagePreview"),
  jumpBottomButton: document.querySelector("#jumpBottomButton"),
  jumpTopButton: document.querySelector("#jumpTopButton"),
  libraryButton: document.querySelector("#libraryButton"),
  libraryCloseButton: document.querySelector("#libraryCloseButton"),
  libraryEmptyState: document.querySelector("#libraryEmptyState"),
  libraryList: document.querySelector("#libraryList"),
  libraryOverlay: document.querySelector("#libraryOverlay"),
  lockCancelButton: document.querySelector("#lockCancelButton"),
  lockConfirmInput: document.querySelector("#lockConfirmInput"),
  lockDescription: document.querySelector("#lockDescription"),
  lockForm: document.querySelector("#lockForm"),
  lockMessage: document.querySelector("#lockMessage"),
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
  runtimeLogButton: document.querySelector("#runtimeLogButton"),
  scrollModeButton: document.querySelector("#scrollModeButton"),
  status: document.querySelector("#status"),
  statusDiagnosticsButton: document.querySelector("#statusDiagnosticsButton"),
  statusText: document.querySelector("#statusText"),
  tocButton: document.querySelector("#tocButton"),
  tocCloseButton: document.querySelector("#tocCloseButton"),
  tocEmptyState: document.querySelector("#tocEmptyState"),
  tocList: document.querySelector("#tocList"),
  tocOverlay: document.querySelector("#tocOverlay"),
  viewerPane: document.querySelector("#viewerPane"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
};

let pdfDoc = null;
let pdfObjectUrl = "";
let epubBook = null;
let epubRendition = null;
let epubAtEnd = false;
let epubAtStart = false;
let epubLastKnownIndex = 0;
let epubNavigationInProgress = false;
let epubLoadingTimer = null;
let epubPendingTargetIndex = null;
let epubPendingTargetTimer = null;
let epubRecentTargetIndex = null;
let epubRecentTargetUntil = 0;
const epubImageRepairTasks = new Set();
let renderTask = null;
let pageObserver = null;
let lastViewportChangeAt = 0;
let renderToken = 0;
let lastLayoutWidth = 0;
let lockMode = "unlock";
let lockScrollY = 0;
let sessionPassword = "";
const encryptionKeyCache = new Map();
let encryptionPromptDismissed = false;
let encryptionMigrationInProgress = false;
let backupOperationInProgress = false;
let pendingBackupRequest = null;
let documentOpenToken = 0;
let libraryOpenRequestId = 0;
let activePdfLoadingTask = null;
let activePdfRangeFailurePromise = null;
let restoreAttempted = false;
let scrollTrackingSuppressionDepth = 0;
let statusTimer = null;
const RECENT_DIAGNOSTIC_EVENT_LIMIT = 120;
const DIAGNOSTIC_STRING_LIMIT = 4000;
const RUNTIME_LOG_KEY = "portable-pdf-reader-runtime-log";
const RUNTIME_LOG_LIMIT = 500;
const RUNTIME_LOG_FLUSH_DELAY_MS = 650;
const recentDiagnosticEvents = [];
const runtimeLogSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let runtimeLogEntries = [];
let runtimeLogLoadError = null;
let runtimeLogSequence = 0;
let runtimeLogFlushTimer = null;
let diagnosticsBuildPromise = null;
let latestDiagnosticsText = "";
let latestOpenDiagnostic = null;
let deferredPdfProgressSaveGuard = null;
let resizeTimer = null;
let scrollStateTimer = null;
let touchStart = null;
let epubPaneTouchStart = null;
let overlayTouchY = 0;
let appFullscreen = false;
let syncingNativeFullscreen = false;
let epubTocEntriesCache = null;
let epubSectionHrefIndex = null;
let tocEntries = [];
let tocActiveIndex = null;
let tocWindowStart = 0;
let tocWindowEnd = 0;

const pageRenderTasks = new Map();
const continuousRenderPromises = new Map();
const pendingContinuousPages = new Map();
const continuousPinnedPages = new Set();
const continuousRenderRuns = new Map();
const continuousBlankRetries = new Map();
const pagedBlankRetries = new Map();
const libraryRecordCache = new Map();
const recordDisplayNameCache = new Map();
let libraryListDirty = true;
let libraryRenderRequestId = 0;
let continuousQueueRunning = false;
let continuousRenderRunId = 0;
let continuousHealthTimer = null;
let continuousCleanupTimer = null;
let continuousScrollFrame = 0;
let continuousProgrammaticScrollTarget = 0;
let continuousProgrammaticScrollUntil = 0;
const CONTINUOUS_PAGE_GAP_PX = 14;
const CONTINUOUS_DOM_WINDOW_PAGES = 36;
const CONTINUOUS_CONSTRAINED_DOM_WINDOW_PAGES = 22;
let continuousEstimatedPageWidth = 0;
let continuousEstimatedShellHeight = 0;
let continuousPageHeightTree = null;
const continuousPageHeightOverrides = new Map();
let continuousDomWindowStart = 0;
let continuousDomWindowEnd = 0;
let continuousWindowUpdating = false;
const IDB_CHUNK_WRITE_BATCH_SIZE = 8;
const PREPARED_CHUNK_STORAGE_FLAG = "__preparedChunkStorage";

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

function isScrollMode() {
  return state.format === DOCUMENT_FORMATS.PDF && state.mode === READ_MODES.SCROLL;
}

function isPdfDocument() {
  return state.format === DOCUMENT_FORMATS.PDF;
}

function isEpubDocument() {
  return state.format === DOCUMENT_FORMATS.EPUB;
}

function isDocumentOpenCurrent(openToken) {
  return openToken === documentOpenToken;
}

async function destroyPdfLoadingTask(loadingTask) {
  try {
    await loadingTask?.destroy?.();
  } catch {
    // Best-effort cancellation for stale PDF.js loading tasks.
  }
}

function beginDocumentOpen() {
  documentOpenToken += 1;
  activePdfRangeFailurePromise = null;
  deferredPdfProgressSaveGuard = null;
  interruptCurrentRender();

  if (activePdfLoadingTask) {
    destroyPdfLoadingTask(activePdfLoadingTask);
    activePdfLoadingTask = null;
  }

  return documentOpenToken;
}

function isDeferredPdfProgressSaveGuardActive() {
  return Boolean(
    deferredPdfProgressSaveGuard &&
      deferredPdfProgressSaveGuard.openToken === documentOpenToken &&
      deferredPdfProgressSaveGuard.documentId === state.documentId,
  );
}

function clearDeferredPdfProgressSaveGuard(documentId, openToken) {
  if (
    deferredPdfProgressSaveGuard &&
    deferredPdfProgressSaveGuard.documentId === documentId &&
    deferredPdfProgressSaveGuard.openToken === openToken
  ) {
    deferredPdfProgressSaveGuard = null;
  }
}

function getEpubChapterTotal() {
  return Math.max(epubBook?.spine?.length || state.page || 1, 1);
}

function getEpubProgressPercent() {
  return Math.round(clamp(state.epubProgress || 0, 0, 1) * 100);
}

function isScrollTrackingSuppressed() {
  return scrollTrackingSuppressionDepth > 0;
}

function getLockConfig() {
  try {
    const config = JSON.parse(window.localStorage.getItem(LOCK_KEY) || "null");

    if (
      config?.version === 3 &&
      config?.hashAlgorithm === ARGON2ID13_KEY_ALGORITHM &&
      typeof config?.passwordHash === "string" &&
      config.passwordHash.startsWith("$argon2id$")
    ) {
      return config;
    }

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
  const input = new TextEncoder().encode(`${salt}:${password}`);

  if (!window.crypto?.subtle) {
    try {
      const sodiumApi = await ensureSodiumReady();
      return bytesToHex(sodiumApi.crypto_hash_sha256(input));
    } catch (error) {
      console.warn(error);
      return hashString(`${salt}:${password}:local-lock`);
    }
  }

  const digest = await window.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hashLegacyLocalPassword(password, salt) {
  return hashString(`${salt}:${password}:local-lock`);
}

async function getLegacyPasswordHashCandidates(password, salt) {
  const hashes = [await hashPassword(password, salt), hashLegacyLocalPassword(password, salt)];
  return [...new Set(hashes)];
}

function isCurrentLockConfig(config = {}) {
  return (
    config?.version === 3 &&
    config?.hashAlgorithm === ARGON2ID13_KEY_ALGORITHM &&
    typeof config?.passwordHash === "string" &&
    config.passwordHash.startsWith("$argon2id$")
  );
}

async function createCurrentLockConfig(password) {
  const sodiumApi = await ensureSodiumReady();
  const passwordHash = sodiumApi.crypto_pwhash_str(
    password,
    sodiumApi.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodiumApi.crypto_pwhash_MEMLIMIT_INTERACTIVE,
  );

  return {
    hashAlgorithm: ARGON2ID13_KEY_ALGORITHM,
    passwordHash,
    version: 3,
  };
}

async function verifyCurrentLockPassword(password, config) {
  const sodiumApi = await ensureSodiumReady();
  return sodiumApi.crypto_pwhash_str_verify(config.passwordHash, password);
}

async function upgradeLegacyLockConfig(password) {
  const config = await createCurrentLockConfig(password);
  setLockConfig(config);
  recordDiagnosticEvent("lock-config-upgraded", {
    hashAlgorithm: config.hashAlgorithm,
    version: config.version,
  });
  return config;
}

function setSessionPassword(password) {
  const nextPassword = password || "";

  if (nextPassword !== sessionPassword) {
    encryptionKeyCache.clear();
    recordDisplayNameCache.clear();
  }

  sessionPassword = nextPassword;
}

function clearSessionPassword() {
  sessionPassword = "";
  encryptionKeyCache.clear();
  recordDisplayNameCache.clear();
}

async function verifyLockPassword(password, options = {}) {
  const config = getLockConfig();

  if (!config) {
    return true;
  }

  if (isCurrentLockConfig(config)) {
    return verifyCurrentLockPassword(password, config);
  }

  const valid = (await getLegacyPasswordHashCandidates(password, config.salt)).includes(config.hash);

  if (valid && options.upgradeLegacy !== false) {
    try {
      await upgradeLegacyLockConfig(password);
    } catch (error) {
      console.warn("Legacy lock configuration could not be upgraded.", error);
      recordDiagnosticEvent("lock-config-upgrade-error", {
        error: summarizeError(error),
      });
    }
  }

  return valid;
}

function getEncryptionKeyCacheId(record = {}, password = "") {
  return JSON.stringify([
    password,
    record.id || "",
    record.encryption?.version || "",
    record.encryption?.algorithm || "",
    record.encryption?.keyAlgorithm || "",
    record.encryption?.salt || "",
    record.encryption?.iterations || "",
    record.encryption?.keyLength || "",
    record.encryption?.opsLimit || "",
    record.encryption?.memLimit || "",
  ]);
}

async function getEncryptionKeyForRecord(record, password = sessionPassword) {
  if (!isRecordEncrypted(record)) {
    return null;
  }

  if (!password) {
    throw new Error("Encrypted document is locked.");
  }

  const cacheId = getEncryptionKeyCacheId(record, password);

  if (encryptionKeyCache.has(cacheId)) {
    return encryptionKeyCache.get(cacheId);
  }

  const key = await deriveEncryptionKey(password, record.encryption);
  encryptionKeyCache.set(cacheId, key);
  return key;
}

async function getRecordDisplayName(record = {}) {
  if (isRecordNameEncrypted(record)) {
    if (!sessionPassword) {
      return getFallbackDocumentName(getDocumentFormat(record));
    }

    const cacheKey = [
      record.id || "",
      record.encryption?.salt || "",
      record.encryptedName?.nonce || record.encryptedName?.iv || "",
      record.updatedAt || 0,
    ].join("|");
    const cachedName = recordDisplayNameCache.get(cacheKey);

    if (cachedName) {
      return cachedName;
    }

    try {
      const key = await getEncryptionKeyForRecord(record);
      const displayName = await decryptRecordName(record, key);
      recordDisplayNameCache.set(cacheKey, displayName);
      return displayName;
    } catch (error) {
      console.warn(error);
      return getFallbackDocumentName(getDocumentFormat(record));
    }
  }

  return getPlainRecordName(record);
}

function getImmediateRecordDisplayName(record = {}) {
  if (!isRecordNameEncrypted(record)) {
    return getPlainRecordName(record);
  }

  const cacheKey = [
    record.id || "",
    record.encryption?.salt || "",
    record.encryptedName?.nonce || record.encryptedName?.iv || "",
    record.updatedAt || 0,
  ].join("|");

  return recordDisplayNameCache.get(cacheKey) || getFallbackDocumentName(getDocumentFormat(record));
}

async function resolveLibraryRecordNames(entries, renderId) {
  const startedAt = performance.now();

  for (const { element, record } of entries) {
    if (renderId !== libraryRenderRequestId) {
      return;
    }

    await waitForNextFrame();
    const displayName = await getRecordDisplayName(record);

    if (renderId !== libraryRenderRequestId) {
      return;
    }

    if (element.isConnected) {
      element.textContent = displayName;
    }
  }

  recordDiagnosticEvent("library-names-resolved", {
    documentCount: entries.length,
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}

function getRecordOpeningLabel(record = {}) {
  if (record.name) {
    return record.name;
  }

  return getFallbackDocumentName(getDocumentFormat(record));
}

function configureLockOverlay(mode) {
  lockMode = mode;
  els.lockPasswordInput.value = "";
  els.lockConfirmInput.value = "";
  els.lockConfirmInput.hidden = mode !== "setup";
  els.lockCancelButton.hidden = mode !== "setup";
  setLockMessage("");

  if (mode === "setup") {
    els.lockTitle.textContent = "设置密码";
    els.lockDescription.textContent = "设置后，打开这个阅读器需要先输入密码。";
    els.lockPasswordInput.placeholder = "设置密码，至少 4 位";
    els.lockPasswordInput.autocomplete = "off";
    els.lockSubmitButton.textContent = "保存并锁定";
  } else {
    els.lockTitle.textContent = "密码锁";
    els.lockDescription.textContent = "输入密码后继续阅读。";
    els.lockPasswordInput.placeholder = "输入密码";
    els.lockPasswordInput.autocomplete = "off";
    els.lockSubmitButton.textContent = "解锁";
  }
}

function setLockMessage(message = "") {
  if (!els.lockMessage) {
    return;
  }

  els.lockMessage.textContent = message;
  els.lockMessage.hidden = !message;
}

function setLockBusy(busy) {
  els.lockSubmitButton.disabled = busy;
  els.lockPasswordInput.disabled = busy;
  els.lockConfirmInput.disabled = busy;
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
  closeImagePreview();
  closeLibrary();
  closeToc();
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
  clearSessionPassword();
  showLockOverlay("unlock");
}

async function handleLockSubmit(event) {
  event.preventDefault();
  setLockMessage("");

  const password = els.lockPasswordInput.value;

  if (password.length < 4) {
    setLockMessage("密码至少 4 位。");
    return;
  }

  setLockBusy(true);

  if (lockMode === "setup") {
    try {
      if (password !== els.lockConfirmInput.value) {
        setLockMessage("两次输入的密码不一致。");
        return;
      }

      setLockConfig(await createCurrentLockConfig(password));
      clearSessionPassword();
      stripStoredPlainFileNames();
      showStatus("密码锁已开启。");
      showLockOverlay("unlock");
    } catch (error) {
      console.error(error);
      setLockMessage("密码锁设置失败，请再试一次。");
    } finally {
      setLockBusy(false);
    }
    return;
  }

  if (!getLockConfig()) {
    setLockBusy(false);
    hideLockOverlay();
    return;
  }

  try {
    if (!(await verifyLockPassword(password))) {
      setLockMessage("密码不对。");
      els.lockPasswordInput.select();
      return;
    }

    setSessionPassword(password);
    hideLockOverlay();
    showStatus("已解锁。");
    restoreReaderPositionAfterResume();
    handleUnlockedSession().catch((error) => console.warn(error));
  } catch (error) {
    console.error(error);
    setLockMessage("解锁失败，请再试一次。");
  } finally {
    setLockBusy(false);
  }
}

function summarizeError(error, depth = 0) {
  if (!error) {
    return null;
  }

  if (typeof error === "string") {
    return { message: error };
  }

  const summary = {
    message: typeof error.message === "string" ? error.message : String(error),
    name: typeof error.name === "string" ? error.name : error.constructor?.name || "Error",
  };

  if (typeof error.stack === "string") {
    summary.stack = error.stack.split("\n").slice(0, 10).join("\n");
  }

  if (error.cause && depth < 2) {
    summary.cause = summarizeError(error.cause, depth + 1);
  }

  return summary;
}

function sanitizeDiagnosticValue(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") {
    if (value.length > DIAGNOSTIC_STRING_LIMIT) {
      return {
        length: value.length,
        truncated: true,
        value: value.slice(0, DIAGNOSTIC_STRING_LIMIT),
      };
    }

    return value;
  }

  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof File !== "undefined" && value instanceof File) {
    return {
      kind: "File",
      lastModified: value.lastModified,
      name: value.name,
      size: value.size,
      type: value.type,
    };
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return {
      kind: value.constructor?.name || "Blob",
      size: value.size,
      type: value.type,
    };
  }

  if (value instanceof Error || typeof value.message === "string") {
    return summarizeError(value);
  }

  if (depth >= 5) {
    return "[MaxDepth]";
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    if (Array.isArray(value)) {
      return value.slice(0, 80).map((item) => sanitizeDiagnosticValue(item, depth + 1, seen));
    }

    const output = {};
    const entries = Object.entries(value).slice(0, 100);

    for (const [key, entryValue] of entries) {
      const lowerKey = key.toLowerCase();

      if (
        lowerKey.includes("password") ||
        lowerKey === "key" ||
        lowerKey === "hash" ||
        lowerKey === "secret" ||
        lowerKey === "sessionpassword"
      ) {
        output[key] = "[Redacted]";
        continue;
      }

      output[key] = sanitizeDiagnosticValue(entryValue, depth + 1, seen);
    }

    return output;
  }

  return String(value);
}

function summarizeRuntimeReaderState() {
  return {
    activePdfLoadingTask: Boolean(activePdfLoadingTask),
    continuous: {
      pending: pendingContinuousPages.size,
      renderPromises: continuousRenderPromises.size,
      renderTasks: pageRenderTasks.size,
    },
    documentId: state.documentId || "",
    documentOpenToken,
    epubOpen: Boolean(epubBook),
    format: state.format,
    mode: state.mode,
    page: state.page,
    pdfOpen: Boolean(pdfDoc),
    renderToken,
    scrollPage: state.scrollPage,
    zoom: state.zoom,
  };
}

function summarizeRuntimeMemory() {
  const memory = performance?.memory;

  if (!memory) {
    return null;
  }

  return {
    jsHeapSizeLimit: memory.jsHeapSizeLimit || 0,
    totalJSHeapSize: memory.totalJSHeapSize || 0,
    usedJSHeapSize: memory.usedJSHeapSize || 0,
  };
}

function normalizeRuntimeLogEntries(value) {
  const entries = Array.isArray(value?.entries)
    ? value.entries
    : Array.isArray(value)
      ? value
      : [];

  return entries.slice(-RUNTIME_LOG_LIMIT);
}

function loadRuntimeLogEntries() {
  try {
    const raw = window.localStorage.getItem(RUNTIME_LOG_KEY);
    runtimeLogEntries = raw ? normalizeRuntimeLogEntries(JSON.parse(raw)) : [];
    runtimeLogSequence = runtimeLogEntries.reduce(
      (max, entry) => Math.max(max, Number.isFinite(entry?.seq) ? entry.seq : 0),
      0,
    );
  } catch (error) {
    runtimeLogEntries = [];
    runtimeLogLoadError = summarizeError(error);
  }
}

function flushRuntimeLogEntries() {
  window.clearTimeout(runtimeLogFlushTimer);
  runtimeLogFlushTimer = null;

  try {
    window.localStorage.setItem(
      RUNTIME_LOG_KEY,
      JSON.stringify({
        appVersion: APP_VERSION,
        entries: runtimeLogEntries.slice(-RUNTIME_LOG_LIMIT),
        flushedAt: new Date().toISOString(),
        kind: "portable-pdf-reader-runtime-log",
        sessionId: runtimeLogSessionId,
      }),
    );
  } catch (error) {
    runtimeLogLoadError = summarizeError(error);
  }
}

function scheduleRuntimeLogFlush() {
  if (runtimeLogFlushTimer) {
    return;
  }

  runtimeLogFlushTimer = window.setTimeout(flushRuntimeLogEntries, RUNTIME_LOG_FLUSH_DELAY_MS);
}

function appendRuntimeLogEvent(type, detail = {}) {
  try {
    runtimeLogSequence += 1;
    runtimeLogEntries.push({
      appVersion: APP_VERSION,
      at: new Date().toISOString(),
      detail: sanitizeDiagnosticValue(detail),
      memory: summarizeRuntimeMemory(),
      reader: summarizeRuntimeReaderState(),
      seq: runtimeLogSequence,
      sessionId: runtimeLogSessionId,
      t: Math.round(performance?.now?.() || 0),
      type,
      visibilityState: document.visibilityState,
    });

    if (runtimeLogEntries.length > RUNTIME_LOG_LIMIT) {
      runtimeLogEntries.splice(0, runtimeLogEntries.length - RUNTIME_LOG_LIMIT);
    }

    scheduleRuntimeLogFlush();
  } catch {
    // Runtime logging must never affect reading.
  }
}

function recordDiagnosticEvent(type, detail = {}) {
  try {
    const sanitizedDetail = sanitizeDiagnosticValue(detail);

    recentDiagnosticEvents.push({
      at: new Date().toISOString(),
      detail: sanitizedDetail,
      type,
    });

    if (recentDiagnosticEvents.length > RECENT_DIAGNOSTIC_EVENT_LIMIT) {
      recentDiagnosticEvents.splice(0, recentDiagnosticEvents.length - RECENT_DIAGNOSTIC_EVENT_LIMIT);
    }

    appendRuntimeLogEvent(type, sanitizedDetail);
  } catch {
    // Diagnostics must never break normal reader behavior.
  }
}

function rememberOpenDiagnostic(update = {}) {
  latestOpenDiagnostic = sanitizeDiagnosticValue({
    ...(latestOpenDiagnostic || {}),
    ...update,
    updatedAt: new Date().toISOString(),
  });
  recordDiagnosticEvent(update.phase || "open-diagnostic", update);
}

function summarizeBlob(blob) {
  if (!blob) {
    return null;
  }

  return {
    constructor: blob.constructor?.name || "Blob",
    size: blob.size,
    type: blob.type,
  };
}

function summarizeFile(file) {
  if (!file) {
    return null;
  }

  return {
    lastModified: file.lastModified,
    name: file.name || "",
    size: file.size,
    type: file.type || "",
  };
}

function summarizeEncryptionForDiagnostics(encryption = {}) {
  if (!encryption || typeof encryption !== "object") {
    return null;
  }

  return {
    algorithm: encryption.algorithm,
    chunkSize: encryption.chunkSize,
    keyAlgorithm: encryption.keyAlgorithm,
    noncePrefixLength: typeof encryption.noncePrefix === "string" ? encryption.noncePrefix.length : null,
    originalSize: encryption.originalSize,
    saltLength: typeof encryption.salt === "string" ? encryption.salt.length : null,
    tagBytes: getEncryptionTagBytes(encryption),
    tagLength: encryption.tagLength,
    version: encryption.version,
  };
}

function summarizeEncryptedNameForDiagnostics(encryptedName = {}) {
  if (!encryptedName || typeof encryptedName !== "object") {
    return null;
  }

  return {
    algorithm: encryptedName.algorithm,
    dataLength: typeof encryptedName.data === "string" ? encryptedName.data.length : null,
    ivLength: typeof encryptedName.iv === "string" ? encryptedName.iv.length : null,
    nonceLength: typeof encryptedName.nonce === "string" ? encryptedName.nonce.length : null,
    version: encryptedName.version,
  };
}

function summarizeRecordForDiagnostics(record = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const encrypted = isRecordEncrypted(record);
  const encryptedPayloadOffset = encrypted ? getEncryptedPayloadOffset(record) : null;
  const encryptedPayloadSize = encrypted ? getEncryptedPayloadSize(record) : null;
  const expectedEncryptedPayloadSize = encrypted ? getExpectedEncryptedPayloadSize(record) : null;
  const chunkedStorage = isEncryptedRecordStoredInChunks(record) ? record.encryptedChunkStorage : null;
  const blobSize = getStoredPayloadSize(record);

  return {
    blob: summarizeBlob(record.blob) || (chunkedStorage
      ? {
          constructor: "IndexedDBChunks",
          size: chunkedStorage.payloadSize,
          type: record.blobType || record.type || "application/octet-stream",
        }
      : null),
    blobBytesLength: getStoredBlobBytesLength(record.blobBytes),
    blobStorage: chunkedStorage
      ? "chunks"
      : getStoredBlobBytesLength(record.blobBytes) > 0 ? "array-buffer" : "blob",
    chunkedStorage,
    encrypted,
    encryptedName: summarizeEncryptedNameForDiagnostics(record.encryptedName),
    encryptedPayloadOffset,
    encryptedPayloadSize,
    expectedEncryptedPayloadSize,
    format: getDocumentFormat(record),
    hasPlainName: typeof record.name === "string" && record.name.length > 0,
    id: record.id,
    lastOpenedAt: record.lastOpenedAt,
    nameLength: typeof record.name === "string" ? record.name.length : null,
    payloadSizeMatchesExpected: encrypted ? encryptedPayloadSize === expectedEncryptedPayloadSize : null,
    payloadWithinBlob: encrypted ? encryptedPayloadOffset + encryptedPayloadSize <= blobSize : null,
    recordNameEncrypted: isRecordNameEncrypted(record),
    size: record.size,
    type: record.type,
    updatedAt: record.updatedAt,
    encryption: summarizeEncryptionForDiagnostics(record.encryption),
  };
}

function bytesToDiagnosticAscii(bytes) {
  return Array.from(bytes, (byte) => (
    byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : "."
  )).join("");
}

async function readBlobSample(blob, offset = 0, length = 32) {
  if (!blob?.slice) {
    return null;
  }

  try {
    const safeOffset = clamp(Math.floor(offset), 0, blob.size || 0);
    const safeEnd = clamp(Math.ceil(safeOffset + length), safeOffset, blob.size || 0);
    const bytes = new Uint8Array(await blob.slice(safeOffset, safeEnd).arrayBuffer());

    return {
      ascii: bytesToDiagnosticAscii(bytes),
      hex: bytesToHex(bytes),
      length: bytes.byteLength,
      offset: safeOffset,
    };
  } catch (error) {
    return {
      error: summarizeError(error),
      offset,
      requestedLength: length,
    };
  }
}

function createBytesSample(bytes, offset = 0, length = 32) {
  const safeOffset = clamp(Math.floor(offset), 0, bytes.byteLength || 0);
  const safeEnd = clamp(Math.ceil(safeOffset + length), safeOffset, bytes.byteLength || 0);
  const sample = bytes.subarray(safeOffset, safeEnd);

  return {
    ascii: bytesToDiagnosticAscii(sample),
    hex: bytesToHex(sample),
    length: sample.byteLength,
    offset: safeOffset,
  };
}

async function readRecordBlobSamples(record = {}) {
  if (!record?.blob) {
    if (!isEncryptedRecordStoredInChunks(record)) {
      return null;
    }

    try {
      const firstChunk = new Uint8Array(await readStoredDocumentChunkBytes(record, 0));
      const lastChunkIndex = Math.max(0, Math.floor(record.encryptedChunkStorage.chunkCount) - 1);
      const lastChunk = new Uint8Array(await readStoredDocumentChunkBytes(record, lastChunkIndex));
      return {
        chunkPrefix: createBytesSample(firstChunk, 0, 32),
        chunkTail: createBytesSample(lastChunk, Math.max(0, lastChunk.byteLength - 32), 32),
      };
    } catch (error) {
      return {
        error: summarizeError(error),
        storage: record.encryptedChunkStorage,
      };
    }
  }

  const samples = {
    blobPrefix: await readBlobSample(record.blob, 0, 32),
  };

  if (isRecordEncrypted(record)) {
    const payloadOffset = getEncryptedPayloadOffset(record);
    const payloadSize = getEncryptedPayloadSize(record);
    samples.payloadPrefix = await readBlobSample(record.blob, payloadOffset, 32);
    samples.payloadTail = await readBlobSample(
      record.blob,
      Math.max(payloadOffset, payloadOffset + payloadSize - 32),
      Math.min(32, payloadSize),
    );
  }

  return samples;
}

function readLocalStorageJsonSummary(key) {
  let raw = null;

  try {
    raw = window.localStorage.getItem(key);
  } catch (error) {
    return {
      error: summarizeError(error),
      key,
      readable: false,
    };
  }

  if (!raw) {
    return {
      key,
      rawLength: 0,
      value: null,
    };
  }

  try {
    return {
      key,
      rawLength: raw.length,
      value: JSON.parse(raw),
    };
  } catch (error) {
    return {
      error: summarizeError(error),
      key,
      rawLength: raw.length,
      value: null,
    };
  }
}

function summarizeReaderForDiagnostics() {
  return {
    activePdfLoadingTask: Boolean(activePdfLoadingTask),
    activePdfRangeFailurePromise: Boolean(activePdfRangeFailurePromise),
    appFullscreen,
    canvas: {
      height: els.canvas.height || 0,
      styleHeight: els.canvas.style.height || "",
      styleWidth: els.canvas.style.width || "",
      width: els.canvas.width || 0,
    },
    continuousPages: {
      children: els.continuousPages.childElementCount,
      domWindowEnd: continuousDomWindowEnd,
      domWindowStart: continuousDomWindowStart,
      lowMemoryMode: isConstrainedContinuousRendering(),
      maxCanvasPixels: MAX_CONTINUOUS_CANVAS_PIXELS,
      maxRenderedPages: getContinuousMaxRenderedPages(),
      pending: pendingContinuousPages.size,
      renderPromises: continuousRenderPromises.size,
      renderTasks: pageRenderTasks.size,
    },
    documentOpenToken,
    epubOpen: Boolean(epubBook),
    pdfOpen: Boolean(pdfDoc),
    pdfPages: pdfDoc?.numPages || 0,
    renderToken,
    state: { ...state },
  };
}

async function buildDiagnosticsReport() {
  flushRuntimeLogEntries();
  const documentId = latestOpenDiagnostic?.documentId || state.documentId || "";
  let record = null;
  let storedRecordError = null;

  if (documentId) {
    try {
      record = await getStoredDocument(documentId);
    } catch (error) {
      storedRecordError = summarizeError(error);
    }
  }

  const progressMap = getProgressMap();

  return {
    appVersion: APP_VERSION,
    generatedAt: new Date().toISOString(),
    kind: "portable-pdf-reader-diagnostics",
    latestOpenDiagnostic,
    libraryRecord: {
      blobSamples: record ? await readRecordBlobSamples(record) : null,
      error: storedRecordError,
      summary: record ? summarizeRecordForDiagnostics(record) : null,
    },
    localStorage: {
      progressEntryCount: Object.keys(progressMap).length,
      progressForDocument: documentId ? progressMap[documentId] || null : null,
      state: readLocalStorageJsonSummary(STATE_KEY),
    },
    lock: {
      configured: Boolean(getLockConfig()),
      encryptionKeyCacheEntries: encryptionKeyCache.size,
      sessionUnlocked: Boolean(sessionPassword),
    },
    page: {
      href: window.location.href,
      userAgent: navigator.userAgent,
      visibilityState: document.visibilityState,
      viewport: {
        devicePixelRatio: window.devicePixelRatio || 1,
        height: window.innerHeight,
        width: window.innerWidth,
      },
    },
    reader: summarizeReaderForDiagnostics(),
    recentEvents: [...recentDiagnosticEvents],
    runtimeLog: {
      entries: runtimeLogEntries.slice(-RUNTIME_LOG_LIMIT),
      loadError: runtimeLogLoadError,
      limit: RUNTIME_LOG_LIMIT,
      sessionId: runtimeLogSessionId,
      storageKey: RUNTIME_LOG_KEY,
    },
    selectedDocumentId: documentId,
    status: getStatusText(),
  };
}

async function prepareDiagnosticsText(trigger = {}) {
  const build = (async () => {
    try {
      recordDiagnosticEvent("diagnostics-build-start", trigger);
      const report = await buildDiagnosticsReport();
      latestDiagnosticsText = JSON.stringify(report, null, 2);
      recordDiagnosticEvent("diagnostics-build-success", {
        bytes: latestDiagnosticsText.length,
        documentId: report.selectedDocumentId,
      });
    } catch (error) {
      recordDiagnosticEvent("diagnostics-build-error", { error: summarizeError(error) });
      latestDiagnosticsText = JSON.stringify(
        {
          appVersion: APP_VERSION,
          error: summarizeError(error),
          generatedAt: new Date().toISOString(),
          kind: "portable-pdf-reader-diagnostics",
          latestOpenDiagnostic,
          recentEvents: [...recentDiagnosticEvents],
          status: getStatusText(),
        },
        null,
        2,
      );
    }

    return latestDiagnosticsText;
  })();

  diagnosticsBuildPromise = build;
  return build;
}

function prepareDiagnosticsForFailure(detail = {}) {
  prepareDiagnosticsText({
    ...detail,
    trigger: "failure-status",
  }).catch((error) => {
    console.warn(error);
  });
}

function copyTextUsingExecCommand(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy") === true;
  } finally {
    textarea.remove();
  }
}

async function writeTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      if (copyTextUsingExecCommand(text)) {
        return;
      }

      throw error;
    }
  }

  if (copyTextUsingExecCommand(text)) {
    return;
  }

  throw new Error("Browser clipboard APIs are unavailable.");
}

function selectDiagnosticsText() {
  if (!els.diagnosticsText) {
    return;
  }

  els.diagnosticsText.focus();
  els.diagnosticsText.select();
  els.diagnosticsText.setSelectionRange(0, els.diagnosticsText.value.length);
}

function showDiagnosticsManualCopy(text) {
  if (!els.diagnosticsOverlay || !els.diagnosticsText) {
    return;
  }

  els.diagnosticsText.value = text || latestDiagnosticsText || "";
  els.diagnosticsOverlay.hidden = false;
  updatePanelScrollLock();
  window.setTimeout(selectDiagnosticsText, 0);
}

function hideDiagnosticsManualCopy() {
  if (!els.diagnosticsOverlay) {
    return;
  }

  els.diagnosticsOverlay.hidden = true;
  updatePanelScrollLock();
}

async function copyDiagnosticsToClipboard() {
  const documentId = latestOpenDiagnostic?.documentId || state.documentId || "";

  try {
    recordDiagnosticEvent("diagnostics-copy-start", {
      documentId,
    });
    let text = latestDiagnosticsText;

    if (!text) {
      showStatus("诊断信息还在生成，请稍后再点一次。", true, { diagnostics: true });
      text = await (diagnosticsBuildPromise || prepareDiagnosticsText({
        documentId,
        trigger: "copy-click",
      }));
    }

    await writeTextToClipboard(text);
    recordDiagnosticEvent("diagnostics-copy-success", {
      bytes: text.length,
      documentId,
    });
    showStatus("诊断信息已复制到剪切板。", true);
  } catch (error) {
    console.error(error);
    recordDiagnosticEvent("diagnostics-copy-error", {
      documentId,
      error: summarizeError(error),
    });
    const text = latestDiagnosticsText || await prepareDiagnosticsText({
      documentId,
      error: summarizeError(error),
      trigger: "copy-error",
    });
    showDiagnosticsManualCopy(text);
    showStatus("自动复制失败，已展开诊断信息。", true, { diagnostics: true });
  }
}

async function copyRuntimeLogToClipboard() {
  const documentId = latestOpenDiagnostic?.documentId || state.documentId || "";

  try {
    recordDiagnosticEvent("runtime-log-copy-start", {
      documentId,
      runtimeLogEntries: runtimeLogEntries.length,
      trigger: "button",
    });
    const text = await prepareDiagnosticsText({
      documentId,
      runtimeLogEntries: runtimeLogEntries.length,
      trigger: "runtime-log-button",
    });
    await writeTextToClipboard(text);
    recordDiagnosticEvent("runtime-log-copy-success", {
      bytes: text.length,
      documentId,
    });
    showStatus("运行日志已复制到剪切板。", true);
  } catch (error) {
    console.error(error);
    recordDiagnosticEvent("runtime-log-copy-error", {
      documentId,
      error: summarizeError(error),
    });
    const text = latestDiagnosticsText || await prepareDiagnosticsText({
      documentId,
      error: summarizeError(error),
      trigger: "runtime-log-copy-error",
    });
    showDiagnosticsManualCopy(text);
    showStatus("自动复制失败，已展开运行日志。", true, { diagnostics: true });
  }
}

function getStatusText() {
  return els.statusText?.textContent || els.status?.textContent || "";
}

function installRuntimeLogHooks() {
  loadRuntimeLogEntries();
  recordDiagnosticEvent("app-session-start", {
    href: window.location.href,
    sessionId: runtimeLogSessionId,
    userAgent: navigator.userAgent,
  });

  window.addEventListener("error", (event) => {
    recordDiagnosticEvent("window-error", {
      colno: event.colno,
      error: summarizeError(event.error),
      filename: event.filename,
      lineno: event.lineno,
      message: event.message,
    });
    flushRuntimeLogEntries();
  });

  window.addEventListener("unhandledrejection", (event) => {
    recordDiagnosticEvent("window-unhandledrejection", {
      reason: summarizeError(event.reason),
    });
    flushRuntimeLogEntries();
  });
}

function showStatus(message, sticky = false, options = {}) {
  recordDiagnosticEvent("status", {
    diagnostics: options.diagnostics === true,
    message,
    sticky,
  });
  window.clearTimeout(statusTimer);
  const showDiagnostics = options.diagnostics === true;

  if (els.statusText) {
    els.statusText.textContent = message;
  } else {
    els.status.textContent = message;
  }

  if (els.statusDiagnosticsButton) {
    els.statusDiagnosticsButton.hidden = !showDiagnostics;
  }

  els.status.classList.toggle("has-action", showDiagnostics);
  els.status.classList.add("show");

  if (!sticky) {
    statusTimer = window.setTimeout(() => {
      els.status.classList.remove("show");
    }, 2200);
  }
}

function showDiagnosticFailureStatus(message, detail = {}) {
  recordDiagnosticEvent("status-failure", {
    message,
    ...detail,
  });
  showStatus(message, true, { diagnostics: true });
  prepareDiagnosticsForFailure({
    message,
    ...detail,
  });
}

function hideStatus() {
  window.clearTimeout(statusTimer);
  if (els.statusDiagnosticsButton) {
    els.statusDiagnosticsButton.hidden = true;
  }
  els.status.classList.remove("has-action");
  els.status.classList.remove("show");
}

function openImagePreview(src, alt = "") {
  if (!src) {
    return;
  }

  closeLibrary();
  closeToc();
  els.imagePreview.src = src;
  els.imagePreview.alt = alt || "EPUB 图片";
  els.imageOverlay.hidden = false;
  document.documentElement.classList.add("is-image-previewing");
  document.body.classList.add("is-image-previewing");
}

function closeImagePreview() {
  if (els.imageOverlay.hidden) {
    return;
  }

  els.imageOverlay.hidden = true;
  els.imagePreview.removeAttribute("src");
  els.imagePreview.alt = "";
  document.documentElement.classList.remove("is-image-previewing");
  document.body.classList.remove("is-image-previewing");
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

function saveReaderState(options = {}) {
  try {
    if (isScrollMode()) {
      captureContinuousScrollPosition();
    }

    const commitProgress =
      options.commitProgress !== false && !isDeferredPdfProgressSaveGuardActive();

    window.localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        documentId: state.documentId,
        epubCfi: state.epubCfi,
        epubProgress: state.epubProgress,
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

    if (commitProgress) {
      saveDocumentProgress();
    }
  } catch {
    // Some private browsing modes disable persistent storage.
  }
}

function stripStoredPlainFileNames() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}");

    if (saved && typeof saved === "object" && "fileName" in saved) {
      delete saved.fileName;
      window.localStorage.setItem(STATE_KEY, JSON.stringify(saved));
    }
  } catch {
    // Best effort privacy cleanup.
  }

  try {
    const progressMap = getProgressMap();
    let changed = false;

    for (const progress of Object.values(progressMap)) {
      if (progress && typeof progress === "object" && "fileName" in progress) {
        delete progress.fileName;
        changed = true;
      }
    }

    if (changed) {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressMap));
    }
  } catch {
    // Best effort privacy cleanup.
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
      if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
        const chunkStore = db.createObjectStore(CHUNK_STORE_NAME, {
          keyPath: ["storageId", "chunkIndex"],
        });
        chunkStore.createIndex("documentId", "documentId", { unique: false });
      }
      if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
        db.createObjectStore(METADATA_STORE_NAME, { keyPath: "id" });
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

async function withChunkStore(mode, callback) {
  const db = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE_NAME, mode);
      const store = tx.objectStore(CHUNK_STORE_NAME);
      const result = callback(store);

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("Chunk store operation failed."));
      tx.onabort = () => reject(tx.error || new Error("Chunk store operation was aborted."));
    });
  } finally {
    db.close();
  }
}

async function withMetadataStore(mode, callback) {
  const db = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE_NAME, mode);
      const store = tx.objectStore(METADATA_STORE_NAME);
      const result = callback(store);

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("Metadata store operation failed."));
      tx.onabort = () => reject(tx.error || new Error("Metadata store operation was aborted."));
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

function getStoredBlobBytesLength(blobBytes) {
  if (blobBytes instanceof ArrayBuffer) {
    return blobBytes.byteLength;
  }

  if (ArrayBuffer.isView(blobBytes)) {
    return blobBytes.byteLength;
  }

  return 0;
}

function isEncryptedRecordStoredInChunks(record = {}) {
  if (!record || typeof record !== "object") {
    return false;
  }

  return (
    isRecordEncrypted(record) &&
    record.encryptedChunkStorage?.version === 1 &&
    typeof record.encryptedChunkStorage?.storageId === "string" &&
    record.encryptedChunkStorage.storageId.length > 0 &&
    Number.isFinite(record.encryptedChunkStorage?.payloadSize) &&
    Number.isFinite(record.encryptedChunkStorage?.chunkCount)
  );
}

function getStoredPayloadSize(record = {}) {
  if (isEncryptedRecordStoredInChunks(record)) {
    return Math.max(0, Math.floor(record.encryptedChunkStorage.payloadSize));
  }

  return record.blob?.size || getStoredBlobBytesLength(record.blobBytes) || record.blobSize || 0;
}

function hasStoredDocumentPayload(record = {}) {
  if (!record || typeof record !== "object") {
    return false;
  }

  return Boolean(record?.blob || getStoredBlobBytesLength(record?.blobBytes) || isEncryptedRecordStoredInChunks(record));
}

function getEncryptedStorageChunkBytes(record = {}) {
  const plainChunkSize = Math.max(1, Math.floor(record.encryption?.chunkSize || ENCRYPTION_CHUNK_SIZE));
  return plainChunkSize + getEncryptionTagBytes(record.encryption);
}

function createDocumentChunkStorageId(documentId = "") {
  return `${documentId}|${Date.now().toString(36)}|${Math.random().toString(36).slice(2)}`;
}

async function deleteDocumentChunksFromStore(chunksStore, documentId) {
  if (!documentId) {
    return;
  }

  const index = chunksStore.index("documentId");
  await new Promise((resolve, reject) => {
    const request = index.openKeyCursor(IDBKeyRange.only(documentId));

    request.onerror = () => reject(request.error || new Error("Chunk store request failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      chunksStore.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}

async function deleteStoredDocumentChunks(documentId) {
  return withChunkStore("readwrite", (chunksStore) =>
    deleteDocumentChunksFromStore(chunksStore, documentId),
  );
}

async function deleteStoredDocumentChunksByStorageId(storageId) {
  if (!storageId) {
    return;
  }

  return withChunkStore("readwrite", (chunksStore) =>
    new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(
        [storageId, 0],
        [storageId, Number.MAX_SAFE_INTEGER],
      );
      const request = chunksStore.openKeyCursor(range);

      request.onerror = () => reject(request.error || new Error("Chunk store request failed."));
      request.onsuccess = () => {
        const cursor = request.result;

        if (!cursor) {
          resolve();
          return;
        }

        chunksStore.delete(cursor.primaryKey);
        cursor.continue();
      };
    }),
  );
}

async function deleteStoredDocumentChunksExcept(documentId, keptStorageId) {
  if (!documentId) {
    return;
  }

  return withChunkStore("readwrite", (chunksStore) => {
    const index = chunksStore.index("documentId");
    const request = index.openKeyCursor(IDBKeyRange.only(documentId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }

      const primaryKey = Array.isArray(cursor.primaryKey) ? cursor.primaryKey : [];
      if (!keptStorageId || primaryKey[0] !== keptStorageId) {
        chunksStore.delete(cursor.primaryKey);
      }
      cursor.continue();
    };
  });
}

async function putStoredDocumentChunks(chunks) {
  if (!chunks?.length) {
    return;
  }

  return withChunkStore("readwrite", (chunksStore) => {
    for (const chunk of chunks) {
      chunksStore.put(chunk);
    }
  });
}

async function flushStoredDocumentChunkBatch(chunks) {
  if (!chunks.length) {
    return;
  }

  const batch = chunks.splice(0, chunks.length);
  await putStoredDocumentChunks(batch);
}

async function putStoredDocumentChunksFromBlob(source) {
  if (!source?.blob || !source.chunkCount) {
    return;
  }

  recordDiagnosticEvent("chunk-storage-write-start", {
    chunkCount: source.chunkCount,
    documentId: source.documentId,
    payloadSize: source.payloadSize,
    storageChunkBytes: source.storageChunkBytes,
    storageId: source.storageId,
  });

  const pendingChunks = [];

  try {
    for (let chunkIndex = 0; chunkIndex < source.chunkCount; chunkIndex += 1) {
      const chunkStart = source.payloadOffset + chunkIndex * source.storageChunkBytes;
      const chunkEnd = Math.min(source.payloadOffset + source.payloadSize, chunkStart + source.storageChunkBytes);
      const bytes = await source.blob.slice(chunkStart, chunkEnd).arrayBuffer();

      pendingChunks.push({
        byteLength: bytes.byteLength,
        bytes,
        chunkIndex,
        documentId: source.documentId,
        storageId: source.storageId,
        updatedAt: source.updatedAt,
      });

      if (
        pendingChunks.length >= IDB_CHUNK_WRITE_BATCH_SIZE ||
        chunkIndex === source.chunkCount - 1
      ) {
        await flushStoredDocumentChunkBatch(pendingChunks);
      }

      recordDiagnosticEvent("chunk-storage-write-chunk", {
        byteLength: bytes.byteLength,
        chunkIndex,
        chunkCount: source.chunkCount,
        documentId: source.documentId,
        storageId: source.storageId,
      });
    }
  } catch (error) {
    await deleteStoredDocumentChunksByStorageId(source.storageId).catch(() => {});
    throw error;
  }

  recordDiagnosticEvent("chunk-storage-write-success", {
    chunkCount: source.chunkCount,
    documentId: source.documentId,
    payloadSize: source.payloadSize,
    storageId: source.storageId,
  });
}

async function readStoredDocumentChunkBytes(record, chunkIndex) {
  const storageId = record?.encryptedChunkStorage?.storageId;

  if (!storageId) {
    throw new Error("Encrypted document chunk storage is unavailable.");
  }

  const chunk = await withChunkStore("readonly", (chunksStore) =>
    requestToPromise(chunksStore.get([storageId, chunkIndex])),
  );
  const length = getStoredBlobBytesLength(chunk?.bytes);

  if (!length) {
    recordDiagnosticEvent("chunk-storage-read-missing", {
      chunkIndex,
      documentId: record?.id,
      storageId,
    });
    throw new Error(`Encrypted document chunk ${chunkIndex} is missing.`);
  }

  recordDiagnosticEvent("chunk-storage-read-success", {
    byteLength: length,
    chunkIndex,
    documentId: record?.id,
    storageId,
  });
  return chunk.bytes;
}

async function countStoredDocumentChunks(record = {}) {
  if (!isEncryptedRecordStoredInChunks(record)) {
    return 0;
  }

  const storageId = record.encryptedChunkStorage.storageId;

  return withChunkStore("readonly", (chunksStore) => {
    const index = chunksStore.index("documentId");

    return new Promise((resolve, reject) => {
      let count = 0;
      const request = index.openKeyCursor(IDBKeyRange.only(record.id));

      request.onerror = () => reject(request.error || new Error("Chunk store request failed."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(count);
          return;
        }

        const primaryKey = Array.isArray(cursor.primaryKey) ? cursor.primaryKey : [];
        if (primaryKey[0] === storageId) {
          count += 1;
        }
        cursor.continue();
      };
    });
  });
}

async function materializeStoredRecordBlob(record = {}) {
  if (record.blob instanceof Blob) {
    return record;
  }

  if (!isEncryptedRecordStoredInChunks(record)) {
    return record;
  }

  const parts = [];
  const chunkCount = Math.max(0, Math.floor(record.encryptedChunkStorage.chunkCount));
  const chunkSize = Math.max(1, Math.floor(record.encryptedChunkStorage.chunkSize || 0));
  const payloadSize = Math.max(0, Math.floor(record.encryptedChunkStorage.payloadSize || 0));

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const bytes = await readStoredDocumentChunkBytes(record, chunkIndex);
    const byteLength = getStoredBlobBytesLength(bytes);
    const expectedLength = Math.min(
      chunkSize,
      Math.max(0, payloadSize - chunkIndex * chunkSize),
    );

    if (byteLength !== expectedLength) {
      throw new Error(
        `Encrypted document chunk ${chunkIndex} has ${byteLength} bytes; expected ${expectedLength}.`,
      );
    }

    parts.push(bytes);
  }

  const materializedBlob = new Blob(parts, {
    type: record.blobType || record.type || "application/octet-stream",
  });

  if (materializedBlob.size !== payloadSize) {
    throw new Error(
      `Encrypted document payload has ${materializedBlob.size} bytes; expected ${payloadSize}.`,
    );
  }

  const materializedRecord = {
    ...record,
    blob: materializedBlob,
  };
  delete materializedRecord.encryptedChunkStorage;
  delete materializedRecord.encryptedPayloadOffset;
  delete materializedRecord.encryptedPayloadSize;
  delete materializedRecord[PREPARED_CHUNK_STORAGE_FLAG];
  return materializedRecord;
}

async function createStoredEncryptedBackupBlob(record = {}) {
  const materializedRecord = await materializeStoredRecordBlob(record);
  return createVerifiedEncryptedBackupBlob(materializedRecord, {
    payloadBlob: materializedRecord.blob,
  });
}

async function createVerifiedEncryptedBackupBlob(record = {}, options = {}) {
  const backupBlob = await createEncryptedBackupBlob(record, options);
  const parsedRecord = await parseEncryptedBackupFile(backupBlob);
  const expectedPayloadSize = getEncryptedPayloadSize(record);

  if (
    parsedRecord.id !== record.id ||
    parsedRecord.encryption?.salt !== record.encryption?.salt ||
    getEncryptedPayloadSize(parsedRecord) !== expectedPayloadSize
  ) {
    throw new Error("Encrypted backup verification failed before download.");
  }

  return backupBlob;
}

function reviveStoredDocumentRecord(record) {
  if (!record || typeof record !== "object") {
    return record;
  }

  const blobBytesLength = getStoredBlobBytesLength(record.blobBytes);

  if (!blobBytesLength) {
    return record;
  }

  const { blobBytes, ...rest } = record;

  return {
    ...rest,
    blob: new Blob([blobBytes], {
      type: record.blobType || record.type || "application/octet-stream",
    }),
  };
}

async function ensureEncryptedRecordStoredInChunks(record, reason = "open") {
  if (!isRecordEncrypted(record) || isEncryptedRecordStoredInChunks(record)) {
    return record;
  }

  const normalizedRecord = await normalizeEncryptedRecordPayload(record);

  if (isEncryptedRecordStoredInChunks(normalizedRecord) || !(normalizedRecord.blob instanceof Blob)) {
    return normalizedRecord;
  }

  if (!normalizedRecord.id) {
    return normalizedRecord;
  }

  recordDiagnosticEvent("encrypted-chunk-migration-start", {
    documentId: normalizedRecord.id,
    reason,
    record: summarizeRecordForDiagnostics(normalizedRecord),
  });

  try {
    await putStoredDocument(normalizedRecord);

    const storedRecord = await getStoredDocument(normalizedRecord.id).catch(() => null);

    if (isEncryptedRecordStoredInChunks(storedRecord)) {
      recordDiagnosticEvent("encrypted-chunk-migration-success", {
        documentId: normalizedRecord.id,
        reason,
        record: summarizeRecordForDiagnostics(storedRecord),
      });
      return storedRecord;
    }

    recordDiagnosticEvent("encrypted-chunk-migration-unavailable", {
      documentId: normalizedRecord.id,
      reason,
      record: summarizeRecordForDiagnostics(storedRecord || normalizedRecord),
    });
  } catch (error) {
    console.warn(error);
    recordDiagnosticEvent("encrypted-chunk-migration-error", {
      documentId: normalizedRecord.id,
      error: summarizeError(error),
      reason,
    });
  }

  return normalizedRecord;
}

async function prepareDocumentRecordForStorage(record) {
  if (!record || typeof record !== "object") {
    return { chunkSource: null, cleanupStorageId: "", replaceChunks: false, storageRecord: record };
  }

  if (!isRecordEncrypted(record)) {
    return { chunkSource: null, cleanupStorageId: "", replaceChunks: true, storageRecord: record };
  }

  if (isEncryptedRecordStoredInChunks(record) && !(record.blob instanceof Blob)) {
    const storageRecord = { ...record };
    const preparedChunkStorage = storageRecord[PREPARED_CHUNK_STORAGE_FLAG] === true;
    delete storageRecord[PREPARED_CHUNK_STORAGE_FLAG];
    return {
      chunkSource: null,
      cleanupStorageId: preparedChunkStorage
        ? storageRecord.encryptedChunkStorage.storageId
        : "",
      replaceChunks: preparedChunkStorage,
      storageRecord,
    };
  }

  if (!(record.blob instanceof Blob)) {
    return { chunkSource: null, cleanupStorageId: "", replaceChunks: false, storageRecord: record };
  }

  const payloadOffset = getEncryptedPayloadOffset(record);
  const payloadSize = getEncryptedPayloadSize(record);
  const storageChunkBytes = getEncryptedStorageChunkBytes(record);
  const chunkCount = Math.max(1, Math.ceil(payloadSize / storageChunkBytes));
  const storageId = createDocumentChunkStorageId(record.id || "");
  const now = Date.now();

  const storageRecord = {
    ...record,
    blobSize: payloadSize,
    blobType: record.blob.type || "application/octet-stream",
    encryptedChunkStorage: {
      chunkCount,
      chunkSize: storageChunkBytes,
      payloadSize,
      storageId,
      version: 1,
    },
  };
  delete storageRecord.blob;
  delete storageRecord.blobBytes;
  delete storageRecord.encryptedPayloadOffset;
  delete storageRecord.encryptedPayloadSize;
  return {
    chunkSource: {
      blob: record.blob,
      chunkCount,
      documentId: record.id,
      payloadOffset,
      payloadSize,
      storageChunkBytes,
      storageId,
      updatedAt: now,
    },
    cleanupStorageId: storageId,
    replaceChunks: true,
    storageRecord,
  };
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
  return Boolean(hasStoredDocumentPayload(record) && typeof record.id === "string" && record.id.startsWith(DOCUMENT_ID_PREFIX));
}

function isLibraryMetadataRecord(record) {
  return Boolean(
    record?.metadataVersion === 1 &&
    record.hasPayload !== false &&
    typeof record.id === "string" &&
    record.id.startsWith(DOCUMENT_ID_PREFIX),
  );
}

function cloneJsonValue(value) {
  if (!value || typeof value !== "object") {
    return value || null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function createLibraryMetadataRecord(record = {}) {
  if (!record || typeof record !== "object" || typeof record.id !== "string") {
    return null;
  }

  if (!record.id.startsWith(DOCUMENT_ID_PREFIX) || !hasStoredDocumentPayload(record)) {
    return null;
  }

  const encrypted = isRecordEncrypted(record);
  const metadata = {
    blobSize: getStoredPayloadSize(record),
    blobType: record.blobType || record.blob?.type || record.type || "application/octet-stream",
    encrypted,
    encryptedChunkStorage: cloneJsonValue(record.encryptedChunkStorage),
    encryptedName: cloneJsonValue(record.encryptedName),
    encryption: encrypted ? cloneJsonValue(record.encryption) : null,
    format: getDocumentFormat(record),
    hasPayload: true,
    id: record.id,
    lastOpenedAt: record.lastOpenedAt || record.updatedAt || 0,
    metadataVersion: 1,
    plainNameStored: encrypted && typeof record.name === "string" && record.name.length > 0,
    recordNameEncrypted: isRecordNameEncrypted(record),
    size: record.size || getStoredPayloadSize(record),
    type: record.type || record.blobType || record.blob?.type || "application/octet-stream",
    updatedAt: record.updatedAt || 0,
  };

  if (!encrypted) {
    metadata.name = getPlainRecordName(record);
  }

  return metadata;
}

function recordNeedsEncryptionMigrationSummary(record = {}) {
  if (!isRecordEncrypted(record)) {
    return true;
  }

  if (!isCurrentRecordEncryption(record)) {
    return false;
  }

  return !isRecordNameEncrypted(record) || Boolean(record.name) || Boolean(record.plainNameStored);
}

function getDocumentFormatFromName(name = "") {
  return name.toLowerCase().endsWith(".epub") ? DOCUMENT_FORMATS.EPUB : DOCUMENT_FORMATS.PDF;
}

function getDocumentFormatFromFile(file) {
  if (isEncryptedBackupFile(file)) {
    return "encrypted-backup";
  }

  if (file?.type === "application/epub+zip" || file?.name?.toLowerCase().endsWith(".epub")) {
    return DOCUMENT_FORMATS.EPUB;
  }

  if (file?.type === "application/pdf" || file?.name?.toLowerCase().endsWith(".pdf")) {
    return DOCUMENT_FORMATS.PDF;
  }

  return "";
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

  const record = await withStore("readonly", (store) => requestToPromise(store.get(documentId)));
  return reviveStoredDocumentRecord(record);
}

async function putStoredDocument(record) {
  const {
    chunkSource,
    cleanupStorageId,
    replaceChunks,
    storageRecord,
  } = await prepareDocumentRecordForStorage(record);
  let result;

  try {
    if (chunkSource) {
      await putStoredDocumentChunksFromBlob(chunkSource);
    }

    result = await withStore("readwrite", (store) => requestToPromise(store.put(storageRecord)));
  } catch (error) {
    if (cleanupStorageId) {
      await deleteStoredDocumentChunksByStorageId(cleanupStorageId).catch(() => {});
    }
    throw error;
  }

  await putLibraryMetadataForRecord(storageRecord).catch((error) => {
    console.warn(error);
    recordDiagnosticEvent("library-metadata-write-error", {
      documentId: storageRecord?.id || "",
      error: summarizeError(error),
    });
  });

  if (replaceChunks) {
    await deleteStoredDocumentChunksExcept(
      storageRecord.id,
      storageRecord.encryptedChunkStorage?.storageId || "",
    ).catch((error) => console.warn(error));
  }

  return result;
}

async function deleteStoredDocument(documentId) {
  const result = await withStore("readwrite", (store) => requestToPromise(store.delete(documentId)));
  await deleteStoredDocumentChunks(documentId).catch((error) => console.warn(error));
  await deleteLibraryMetadata(documentId).catch((error) => console.warn(error));
  return result;
}

async function getAllStoredRecords() {
  return withStore("readonly", (store) => {
    const records = [];

    return new Promise((resolve, reject) => {
      const request = store.openCursor();

      request.onerror = () => reject(request.error || new Error("Database cursor request failed."));
      request.onsuccess = () => {
        const cursor = request.result;

        if (!cursor) {
          resolve(records);
          return;
        }

        records.push(reviveStoredDocumentRecord(cursor.value));
        cursor.continue();
      };
    });
  });
}

async function countLibraryDocumentKeys() {
  return withStore("readonly", (store) =>
    new Promise((resolve, reject) => {
      let count = 0;
      const request = store.openKeyCursor();

      request.onerror = () => reject(request.error || new Error("Document key cursor request failed."));
      request.onsuccess = () => {
        const cursor = request.result;

        if (!cursor) {
          resolve(count);
          return;
        }

        if (typeof cursor.key === "string" && cursor.key.startsWith(DOCUMENT_ID_PREFIX)) {
          count += 1;
        }
        cursor.continue();
      };
    }),
  );
}

async function readLibraryMetadataRecords() {
  const records = await withMetadataStore("readonly", (store) => {
    const results = [];

    return new Promise((resolve, reject) => {
      const request = store.openCursor();

      request.onerror = () => reject(request.error || new Error("Metadata cursor request failed."));
      request.onsuccess = () => {
        const cursor = request.result;

        if (!cursor) {
          resolve(results);
          return;
        }

        if (isLibraryMetadataRecord(cursor.value)) {
          results.push(cursor.value);
        }
        cursor.continue();
      };
    });
  });

  return records.sort((a, b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0));
}

async function putLibraryMetadataRecords(records = []) {
  const metadataRecords = records.map(createLibraryMetadataRecord).filter(Boolean);

  if (!metadataRecords.length) {
    return [];
  }

  return withMetadataStore("readwrite", (store) =>
    Promise.all(metadataRecords.map((metadata) => requestToPromise(store.put(metadata)))),
  );
}

async function replaceLibraryMetadataRecords(records = []) {
  const metadataRecords = records.map(createLibraryMetadataRecord).filter(Boolean);

  return withMetadataStore("readwrite", (store) => {
    const requests = [requestToPromise(store.clear())];

    for (const metadata of metadataRecords) {
      requests.push(requestToPromise(store.put(metadata)));
    }

    return Promise.all(requests);
  });
}

async function putLibraryMetadataForRecord(record = {}) {
  return putLibraryMetadataRecords([record]);
}

async function deleteLibraryMetadata(documentId) {
  if (!documentId) {
    return;
  }

  return withMetadataStore("readwrite", (store) => requestToPromise(store.delete(documentId)));
}

async function migrateLegacyDocument() {
  const legacy = await getStoredDocument(LAST_DOCUMENT_ID).catch(() => null);

  if (!legacy?.blob) {
    return null;
  }

  const id = createDocumentId(legacy.name || "未命名.pdf", legacy.size || legacy.blob.size || 0, 0);
  const existing = await getStoredDocument(id).catch(() => null);

  if (hasStoredDocumentPayload(existing)) {
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
  const startedAt = performance.now();
  await migrateLegacyDocument();
  const metadataRecords = await readLibraryMetadataRecords();
  const documentKeyCount = await countLibraryDocumentKeys();

  if (metadataRecords.length > 0 && metadataRecords.length === documentKeyCount) {
    recordDiagnosticEvent("library-metadata-read", {
      documentCount: metadataRecords.length,
      documentKeyCount,
      elapsedMs: Math.round(performance.now() - startedAt),
      encryptedCount: metadataRecords.filter(isRecordEncrypted).length,
    });
    return metadataRecords;
  }

  const records = await getAllStoredRecords();
  const documents = records
    .filter(isLibraryDocument)
    .sort((a, b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0));
  const metadataDocuments = documents.map(createLibraryMetadataRecord).filter(Boolean);

  await replaceLibraryMetadataRecords(documents).catch((error) => {
    console.warn(error);
    recordDiagnosticEvent("library-metadata-rebuild-error", {
      error: summarizeError(error),
    });
  });

  recordDiagnosticEvent("library-documents-read", {
    documentCount: documents.length,
    documentKeyCount,
    elapsedMs: Math.round(performance.now() - startedAt),
    encryptedCount: documents.filter(isRecordEncrypted).length,
    fromFallback: true,
    legacyByteRecordCount: documents.filter((record) => getStoredBlobBytesLength(record.blobBytes) > 0).length,
    recordCount: records.length,
  });

  return metadataDocuments.length ? metadataDocuments : documents;
}

async function saveDocumentFile(file) {
  const format = getDocumentFormatFromFile(file);
  const fallbackName = format === DOCUMENT_FORMATS.EPUB ? "未命名.epub" : "未命名.pdf";
  const type = format === DOCUMENT_FORMATS.EPUB ? "application/epub+zip" : "application/pdf";
  const id = createDocumentId(file.name || fallbackName, file.size, file.lastModified || 0);
  const existing = await getStoredDocument(id).catch(() => null);
  const blob = file.slice(0, file.size, file.type || type);
  const now = Date.now();
  let record = {
    id,
    format,
    name: file.name || fallbackName,
    size: file.size,
    type: file.type || type,
    updatedAt: now,
    lastOpenedAt: now,
    blob,
  };

  if (getLockConfig() && sessionPassword) {
    record = await encryptDocumentRecord(record, sessionPassword);
  }

  await putStoredDocument(record);

  if (!existing) {
    deleteDocumentProgress(id);
  }

  return record;
}

async function touchStoredDocument(documentId, replacementRecord = null) {
  const record =
    replacementRecord?.id === documentId
      ? replacementRecord
      : await getStoredDocument(documentId).catch(() => null);

  if (!hasStoredDocumentPayload(record)) {
    return;
  }

  await putLibraryMetadataForRecord({
    ...record,
    lastOpenedAt: Date.now(),
  });
}

function isSupportedDocumentFile(file) {
  return Boolean(getDocumentFormatFromFile(file));
}

function isEncryptedBackupFile(file) {
  return Boolean(file?.name?.toLowerCase().endsWith(ENCRYPTED_BACKUP_EXTENSION));
}

function createEncryptedBackupFileName(record = {}) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `portable-reader-${hashString(record.id || String(Date.now()))}-${APP_VERSION}-${timestamp}${ENCRYPTED_BACKUP_EXTENSION}`;
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function importEncryptedBackupFile(file) {
  const record = await parseEncryptedBackupFile(file);
  return importEncryptedBackupRecordWithCurrentPassword(record);
}

async function verifyEncryptedBackupRecord(record, password) {
  const key = await deriveRecordEncryptionKey(record, password);
  await decryptRecordName(record, key);
  return key;
}

function createEncryptionMetadata(originalSize) {
  return {
    algorithm: ENCRYPTION_ALGORITHM,
    chunkSize: ENCRYPTION_CHUNK_SIZE,
    encryptedAt: Date.now(),
    keyAlgorithm: ENCRYPTION_KEY_ALGORITHM,
    memLimit: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    noncePrefix: bytesToHex(randomBytes(XCHACHA_NONCE_PREFIX_BYTES)),
    opsLimit: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    originalSize,
    salt: bytesToHex(randomBytes(sodium.crypto_pwhash_SALTBYTES)),
    tagLength: sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES * 8,
    version: ENCRYPTION_VERSION,
  };
}

async function encryptDocumentFromSource(record, source, plainName, password, onProgress = () => {}) {
  const sodiumApi = await ensureSodiumReady();
  const originalSize = getEncryptionOriginalSize(record);
  const encryption = createEncryptionMetadata(originalSize);
  const key = await deriveEncryptionKey(password, encryption);
  const nameRecord = { ...record, name: plainName, size: originalSize };
  const encryptedName = await encryptRecordName(nameRecord, key, encryption);
  const totalChunks = Math.max(1, Math.ceil(originalSize / encryption.chunkSize));
  const storageId = createDocumentChunkStorageId(record.id || "");
  const storageChunkBytes = encryption.chunkSize + getEncryptionTagBytes(encryption);
  const payloadSize = originalSize + totalChunks * getEncryptionTagBytes(encryption);
  const updatedAt = Date.now();
  const pendingChunks = [];

  try {
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const begin = chunkIndex * encryption.chunkSize;
      const end = Math.min(begin + encryption.chunkSize, originalSize);
      const plainBytes = await source.readRange(begin, end);
      const encryptedBytes = sodiumApi.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plainBytes,
        createChunkAad(record, encryption, chunkIndex),
        null,
        createChunkNonce(encryption, chunkIndex),
        key,
      );
      const expectedEncryptedLength = plainBytes.byteLength + getEncryptionTagBytes(encryption);

      if (encryptedBytes.byteLength !== expectedEncryptedLength) {
        throw new Error(
          `Encrypted chunk ${chunkIndex} has ${encryptedBytes.byteLength} bytes; expected ${expectedEncryptedLength}.`,
        );
      }

      const storedBytes = encryptedBytes.slice().buffer;

      pendingChunks.push({
        byteLength: storedBytes.byteLength,
        bytes: storedBytes,
        chunkIndex,
        documentId: record.id,
        storageId,
        updatedAt,
      });

      if (
        pendingChunks.length >= IDB_CHUNK_WRITE_BATCH_SIZE ||
        chunkIndex === totalChunks - 1
      ) {
        await flushStoredDocumentChunkBatch(pendingChunks);
        await waitForNextFrame();
      }

      onProgress({
        chunkIndex: chunkIndex + 1,
        totalChunks,
      });
    }
  } catch (error) {
    await deleteStoredDocumentChunksByStorageId(storageId).catch(() => {});
    throw error;
  }

  const encryptedRecord = {
    ...withoutEncryptedPayloadLocation(withoutPlainRecordName(record)),
    [PREPARED_CHUNK_STORAGE_FLAG]: true,
    blobSize: payloadSize,
    blobType: "application/octet-stream",
    encrypted: true,
    encryptedChunkStorage: {
      chunkCount: totalChunks,
      chunkSize: storageChunkBytes,
      payloadSize,
      storageId,
      version: 1,
    },
    encryptedName,
    encryption,
    size: originalSize,
    updatedAt,
  };
  delete encryptedRecord.blob;
  delete encryptedRecord.blobBytes;
  return encryptedRecord;
}

async function reencryptEncryptedRecord(record, oldPassword, newPassword, onProgress = () => {}) {
  const oldKey = await verifyEncryptedBackupRecord(record, oldPassword);
  const plainName = await decryptRecordName(record, oldKey);
  const source = createEncryptedDocumentSourceWithKey(record, oldKey);
  return encryptDocumentFromSource(record, source, plainName, newPassword, onProgress);
}

async function saveImportedEncryptedBackupRecord(
  record,
  backupPassword,
  targetPassword,
  onProgress = () => {},
) {
  const existing = await getStoredDocument(record.id).catch(() => null);
  let recordToSave = record;
  recordDiagnosticEvent("encrypted-backup-save-start", {
    backupPasswordMatchesTarget: backupPassword === targetPassword,
    existing: hasStoredDocumentPayload(existing),
    record: summarizeRecordForDiagnostics(record),
  });

  if (backupPassword === targetPassword) {
    await verifyEncryptedBackupRecord(record, backupPassword);
    recordToSave = await withPayloadOnlyEncryptedBlob(await withDetectedEncryptedPayloadLocation(record));
  } else {
    recordToSave = await reencryptEncryptedRecord(record, backupPassword, targetPassword, onProgress);
  }

  recordToSave = {
    ...recordToSave,
    lastOpenedAt: Date.now(),
  };

  await putStoredDocument(recordToSave);
  recordDiagnosticEvent("encrypted-backup-save-success", {
    record: summarizeRecordForDiagnostics(recordToSave),
  });

  if (!existing) {
    deleteDocumentProgress(recordToSave.id);
  }

  return (await getStoredDocument(recordToSave.id).catch(() => null)) || recordToSave;
}

async function exportEncryptedDocumentBackup(documentId) {
  let record = await getStoredDocument(documentId).catch(() => null);

  if (!hasStoredDocumentPayload(record)) {
    showStatus("这个文件已经不在本机存储里。");
    await renderLibraryList();
    return;
  }

  if (!isRecordEncrypted(record) || !isRecordNameEncrypted(record)) {
    showStatus("这个文件还没有加密，不能导出加密备份。", true);
    return;
  }

  try {
    showStatus("正在准备导出加密文件...", true);
    const backupBlob = await createStoredEncryptedBackupBlob(record);
    triggerDownload(backupBlob, createEncryptedBackupFileName(record));
    showStatus("已开始导出加密文件。");
  } catch (error) {
    console.error(error);
    showStatus("加密文件导出失败。", true);
  }
}

function updateBackupPromptState({ busy = false, progress = 0, text = "" } = {}) {
  backupOperationInProgress = busy;
  els.backupCancelButton.disabled = busy;
  els.backupCurrentButton.disabled = busy;
  els.backupPasswordInput.disabled = busy;
  els.backupConfirmInput.disabled = busy;
  els.backupSubmitButton.disabled = busy;
  els.backupProgress.hidden = !busy;
  els.backupProgressText.hidden = !busy && !text;
  els.backupProgress.value = clamp(progress, 0, 100);
  els.backupProgressText.textContent = text;
}

function hideBackupPrompt(options = {}) {
  if (backupOperationInProgress && !options.force) {
    return;
  }

  pendingBackupRequest = null;
  els.backupOverlay.hidden = true;
  els.backupPasswordInput.value = "";
  els.backupConfirmInput.value = "";
  updateBackupPromptState();
  updatePanelScrollLock();
}

function showBackupExportPrompt(record) {
  if (!hasStoredDocumentPayload(record)) {
    return;
  }

  if (!isRecordEncrypted(record) || !isRecordNameEncrypted(record)) {
    showStatus("这个文件还没有加密，不能导出加密备份。", true);
    return;
  }

  closeLibrary();
  closeToc();
  els.backupTitle.textContent = "导出加密文件";
  els.backupDescription.textContent = "可以直接使用当前书架密码导出，也可以另设备份密码导出。";
  els.backupCurrentButton.hidden = false;
  els.backupConfirmInput.hidden = false;
  els.backupConfirmInput.required = true;
  els.backupPasswordInput.placeholder = "输入新的备份密码";
  els.backupSubmitButton.textContent = "用备份密码导出";
  els.backupPasswordInput.value = "";
  els.backupConfirmInput.value = "";
  pendingBackupRequest = {
    mode: "export",
    record,
  };
  updateBackupPromptState();
  els.backupOverlay.hidden = false;
  updatePanelScrollLock();
}

function showBackupImportPasswordPrompt(record) {
  els.backupTitle.textContent = "输入备份密码";
  els.backupDescription.textContent = "这个加密备份不是用当前书架密码导出的，请输入备份文件的密码。";
  els.backupCurrentButton.hidden = true;
  els.backupConfirmInput.hidden = true;
  els.backupConfirmInput.required = false;
  els.backupPasswordInput.placeholder = "输入备份密码";
  els.backupSubmitButton.textContent = "导入并转换到当前密码";
  els.backupPasswordInput.value = "";
  els.backupConfirmInput.value = "";
  pendingBackupRequest = {
    mode: "import",
    record,
  };
  updateBackupPromptState();
  els.backupOverlay.hidden = false;
  updatePanelScrollLock();
  window.setTimeout(() => els.backupPasswordInput.focus(), 40);
}

async function exportEncryptedDocumentBackupWithCurrentPassword(record) {
  try {
    updateBackupPromptState({
      busy: true,
      progress: 100,
      text: "正在准备导出...",
    });
    const backupBlob = await createStoredEncryptedBackupBlob(record);
    triggerDownload(backupBlob, createEncryptedBackupFileName(record));
    hideBackupPrompt({ force: true });
    showStatus("已开始导出加密文件。");
  } catch (error) {
    console.error(error);
    updateBackupPromptState();
    showStatus("加密文件导出失败。", true);
  }
}

async function exportEncryptedDocumentBackupWithPassword(record, backupPassword) {
  if (!sessionPassword) {
    showStatus("请先解锁书架，再另设备份密码导出。", true);
    return;
  }

  let backupRecord = null;

  try {
    updateBackupPromptState({
      busy: true,
      progress: 0,
      text: "正在用备份密码重新加密...",
    });
    backupRecord = await reencryptEncryptedRecord(
      record,
      sessionPassword,
      backupPassword,
      ({ chunkIndex, totalChunks }) => {
        updateBackupPromptState({
          busy: true,
          progress: Math.round((chunkIndex / Math.max(1, totalChunks)) * 100),
          text: `正在重新加密 ${chunkIndex}/${totalChunks}`,
        });
      },
    );
    const backupBlob = await createStoredEncryptedBackupBlob(backupRecord);
    triggerDownload(backupBlob, createEncryptedBackupFileName(record));
    hideBackupPrompt({ force: true });
    showStatus("已开始导出加密文件。");
  } catch (error) {
    console.error(error);
    updateBackupPromptState();
    showStatus("加密文件导出失败，请确认当前书架密码可用。", true);
  } finally {
    const storageId = backupRecord?.encryptedChunkStorage?.storageId || "";

    if (storageId && backupRecord?.[PREPARED_CHUNK_STORAGE_FLAG] === true) {
      await deleteStoredDocumentChunksByStorageId(storageId).catch(() => {});
    }
  }
}

async function importEncryptedBackupRecordWithCurrentPassword(record) {
  if (!sessionPassword) {
    showStatus("请先解锁书架，再导入加密备份。", true);
    return null;
  }

  return saveImportedEncryptedBackupRecord(record, sessionPassword, sessionPassword);
}

async function importEncryptedBackupRecordWithBackupPassword(record, backupPassword) {
  if (!sessionPassword) {
    showStatus("请先解锁书架，再导入加密备份。", true);
    return null;
  }

  updateBackupPromptState({
    busy: true,
    progress: 0,
    text: "正在转换到当前书架密码...",
  });
  return saveImportedEncryptedBackupRecord(
    record,
    backupPassword,
    sessionPassword,
    ({ chunkIndex, totalChunks }) => {
      updateBackupPromptState({
        busy: true,
        progress: Math.round((chunkIndex / Math.max(1, totalChunks)) * 100),
        text: `正在转换 ${chunkIndex}/${totalChunks}`,
      });
    },
  );
}

async function handleBackupCurrentExport() {
  if (backupOperationInProgress || pendingBackupRequest?.mode !== "export") {
    return;
  }

  await exportEncryptedDocumentBackupWithCurrentPassword(pendingBackupRequest.record);
}

async function handleBackupSubmit(event) {
  event.preventDefault();

  if (backupOperationInProgress || !pendingBackupRequest) {
    return;
  }

  const password = els.backupPasswordInput.value;

  if (password.length < 4) {
    showStatus("密码至少 4 位。");
    els.backupPasswordInput.select();
    return;
  }

  if (pendingBackupRequest.mode === "export") {
    if (password !== els.backupConfirmInput.value) {
      showStatus("两次输入的密码不一致。");
      els.backupConfirmInput.select();
      return;
    }

    await exportEncryptedDocumentBackupWithPassword(pendingBackupRequest.record, password);
    return;
  }

  try {
    const record = await importEncryptedBackupRecordWithBackupPassword(
      pendingBackupRequest.record,
      password,
    );

    if (!record) {
      updateBackupPromptState();
      return;
    }

    hideBackupPrompt({ force: true });
    const opened = await openDocumentRecord(record, { resetProgress: true });
    await renderLibraryList();
    if (opened) {
      showStatus("已导入加密文件。");
    } else {
      showDiagnosticFailureStatus("已导入加密文件，但这个 PDF 暂时打不开。", {
        documentId: record.id,
        phase: "backup-password-import-open-failed",
        record: summarizeRecordForDiagnostics(record),
      });
    }
  } catch (error) {
    console.error(error);
    updateBackupPromptState();
    showStatus("备份密码不对，或文件已经损坏。", true);
    els.backupPasswordInput.select();
  }
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

function updateFullscreenButtons() {
  const hasDocument = Boolean(pdfDoc || epubBook);
  const fullscreenLabel = appFullscreen ? "退出全屏" : "全屏";

  els.fullscreenButton.textContent = fullscreenLabel;
  els.fullscreenButton.disabled = !hasDocument;
  els.fullscreenButton.classList.toggle("active", appFullscreen);
  els.fullscreenButton.setAttribute("aria-pressed", String(appFullscreen));
  els.fullscreenButton.setAttribute("aria-label", fullscreenLabel);
  els.floatingFullscreenButton.hidden = !appFullscreen || !hasDocument;
  els.floatingFullscreenButton.textContent = appFullscreen ? "退" : "全";
  els.floatingFullscreenButton.setAttribute("aria-label", fullscreenLabel);
  els.floatingFullscreenButton.setAttribute("aria-pressed", String(appFullscreen));
}

function syncFullscreenLayoutAfterFrame() {
  window.requestAnimationFrame(() => {
    lastViewportChangeAt = Date.now();

    if (epubRendition) {
      epubRendition.resize("100%", "100%", state.epubCfi || undefined);
      return;
    }

    if (!pdfDoc) {
      return;
    }

    if (isScrollMode()) {
      renderCurrentView(state.page, { behavior: "auto", restoreScroll: true });
      return;
    }

    renderCurrentView(state.page, { behavior: "auto" });
  });
}

function setAppFullscreen(enabled, options = {}) {
  const nextFullscreen = Boolean(enabled);

  if (appFullscreen === nextFullscreen) {
    updateFullscreenButtons();
    return;
  }

  if (pdfDoc && isScrollMode()) {
    captureContinuousScrollPosition();
  }

  appFullscreen = nextFullscreen;
  document.documentElement.classList.toggle("is-app-fullscreen", appFullscreen);
  document.body.classList.toggle("is-app-fullscreen", appFullscreen);
  updateFullscreenButtons();
  updateControls();

  if (options.syncLayout !== false) {
    syncFullscreenLayoutAfterFrame();
  }
}

async function enterNativeFullscreen() {
  const root = document.documentElement;

  if (!root.requestFullscreen || document.fullscreenElement) {
    return;
  }

  syncingNativeFullscreen = true;

  try {
    await root.requestFullscreen();
  } catch {
    // App-level fullscreen still works when native fullscreen is unavailable.
  } finally {
    syncingNativeFullscreen = false;
  }
}

async function exitNativeFullscreen() {
  if (!document.exitFullscreen || !document.fullscreenElement) {
    return;
  }

  syncingNativeFullscreen = true;

  try {
    await document.exitFullscreen();
  } catch {
    // Best effort only.
  } finally {
    syncingNativeFullscreen = false;
  }
}

async function toggleAppFullscreen() {
  const nextFullscreen = !appFullscreen;
  setAppFullscreen(nextFullscreen);

  if (nextFullscreen) {
    await enterNativeFullscreen();
  } else {
    await exitNativeFullscreen();
  }
}

function updateControls() {
  const hasDocument = Boolean(pdfDoc || epubBook);
  const epubMode = hasDocument && isEpubDocument();
  const total = pdfDoc?.numPages || 0;
  const epubTotal = getEpubChapterTotal();
  const epubPercent = getEpubProgressPercent();
  const pagedMode = !epubMode && state.mode === READ_MODES.PAGED;
  const scrollMode = !epubMode && state.mode !== READ_MODES.PAGED;
  const showEdgeJumps = hasDocument && (epubMode || scrollMode);
  const fullscreenEpubMode = epubMode && appFullscreen;

  els.docName.textContent = state.fileName || "未打开文件";
  els.prevButton.textContent = epubMode ? "上一章" : "上一页";
  els.nextButton.textContent = epubMode ? "下一章" : "下一页";
  els.prevButton.setAttribute("aria-label", epubMode ? "上一章" : "上一页");
  els.nextButton.setAttribute("aria-label", epubMode ? "下一章" : "下一页");
  els.pageInput.value = epubMode
    ? String(clamp(state.page || 1, 1, epubTotal))
    : String(hasDocument ? state.page : 1);
  els.pageInput.max = String(epubMode ? epubTotal : Math.max(total, 1));
  els.pageTotal.textContent = epubMode ? `章 / ${epubTotal} · ${epubPercent}%` : `/ ${total}`;

  els.prevButton.disabled =
    !hasDocument || (epubMode ? epubNavigationInProgress || epubAtStart : state.page <= 1);
  els.nextButton.disabled =
    !hasDocument || (epubMode ? epubNavigationInProgress || epubAtEnd : state.page >= total);
  els.pageInput.disabled = !hasDocument || epubMode;
  els.zoomOutButton.disabled = !hasDocument || epubMode || state.zoom <= 0.6;
  els.zoomInButton.disabled = !hasDocument || epubMode || state.zoom >= 2.6;
  els.fitButton.disabled = !hasDocument || epubMode;
  updateFullscreenButtons();
  els.tocButton.hidden = !epubMode;
  els.tocButton.disabled = !epubMode || epubNavigationInProgress;
  els.edgeJumpGroup.hidden = !showEdgeJumps;
  els.edgeJumpGroup.setAttribute(
    "aria-label",
    fullscreenEpubMode ? "章节切换" : "连续模式跳转",
  );
  els.jumpTopButton.setAttribute("aria-label", fullscreenEpubMode ? "上一章" : "跳到顶部");
  els.jumpBottomButton.setAttribute("aria-label", fullscreenEpubMode ? "下一章" : "跳到底部");
  els.jumpTopButton.disabled =
    !showEdgeJumps || (epubMode && (epubNavigationInProgress || (fullscreenEpubMode && epubAtStart)));
  els.jumpBottomButton.disabled =
    !showEdgeJumps || (epubMode && (epubNavigationInProgress || (fullscreenEpubMode && epubAtEnd)));
  els.pagedModeButton.disabled = epubMode;
  els.scrollModeButton.disabled = epubMode;

  els.pagedModeButton.classList.toggle("active", pagedMode);
  els.scrollModeButton.classList.toggle("active", scrollMode || epubMode);
  els.pagedModeButton.setAttribute("aria-pressed", String(pagedMode));
  els.scrollModeButton.setAttribute("aria-pressed", String(scrollMode || epubMode));
}

function cancelCurrentRender() {
  clearContinuousHealthTimer();
  clearContinuousCleanupTimer();

  if (renderTask) {
    try {
      renderTask.cancel();
    } catch {
      // PDF.js cancellation is best effort.
    }
    renderTask = null;
  }

  for (const task of pageRenderTasks.values()) {
    try {
      task.cancel();
    } catch {
      // PDF.js cancellation is best effort.
    }
  }
  pageRenderTasks.clear();
  continuousRenderPromises.clear();
  continuousRenderRuns.clear();
}

function interruptCurrentRender() {
  cancelCurrentRender();
  pendingContinuousPages.clear();
}

function clearContinuousPages() {
  clearContinuousHealthTimer();
  clearContinuousCleanupTimer();
  clearContinuousScrollUpdate();

  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }

  for (const task of pageRenderTasks.values()) {
    task.cancel();
  }
  pageRenderTasks.clear();
  continuousRenderPromises.clear();
  pendingContinuousPages.clear();
  continuousPinnedPages.clear();
  continuousRenderRuns.clear();
  continuousBlankRetries.clear();
  pagedBlankRetries.clear();
  els.continuousPages.replaceChildren();
  continuousEstimatedPageWidth = 0;
  continuousEstimatedShellHeight = 0;
  continuousPageHeightTree = null;
  continuousPageHeightOverrides.clear();
  continuousDomWindowStart = 0;
  continuousDomWindowEnd = 0;
  continuousWindowUpdating = false;
  continuousProgrammaticScrollTarget = 0;
  continuousProgrammaticScrollUntil = 0;
}

async function closeCurrentDocument() {
  renderToken += 1;
  setEpubLoading(false);
  closeImagePreview();
  closeToc();
  setAppFullscreen(false, { syncLayout: false });

  if (activePdfLoadingTask) {
    destroyPdfLoadingTask(activePdfLoadingTask);
    activePdfLoadingTask = null;
  }

  activePdfRangeFailurePromise = null;

  await cancelCurrentRender();
  clearContinuousPages();

  els.canvas.removeAttribute("width");
  els.canvas.removeAttribute("height");
  els.canvas.removeAttribute("style");
  els.epubViewer.replaceChildren();
  pagedBlankRetries.clear();
  resetEpubTocCache();
  epubAtEnd = false;
  epubAtStart = false;
  epubLastKnownIndex = 0;

  if (pdfDoc) {
    const oldDoc = pdfDoc;
    pdfDoc = null;
    await oldDoc.destroy().catch(() => {});
  }

  if (pdfObjectUrl) {
    URL.revokeObjectURL(pdfObjectUrl);
    pdfObjectUrl = "";
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

function isConstrainedContinuousRendering() {
  if (!isScrollMode()) {
    return false;
  }

  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches === true;
  return window.innerWidth <= 720 || (coarsePointer && (window.devicePixelRatio || 1) >= 2);
}

function getContinuousRenderViewports() {
  return isConstrainedContinuousRendering() ? 0.9 : CONTINUOUS_RENDER_VIEWPORTS;
}

function getContinuousKeepViewports() {
  return isConstrainedContinuousRendering() ? 1.3 : CONTINUOUS_KEEP_VIEWPORTS;
}

function getContinuousMaxRenderedPages() {
  return isConstrainedContinuousRendering() ? 3 : CONTINUOUS_MAX_RENDERED_PAGES;
}

function getContinuousObserverMargin() {
  return isConstrainedContinuousRendering() ? "360px 0px" : CONTINUOUS_OBSERVER_MARGIN;
}

function getContinuousBlankRetryLimit() {
  return isConstrainedContinuousRendering() ? 1 : CONTINUOUS_BLANK_RETRY_LIMIT;
}

function shouldRenderContinuousDirectToTarget() {
  return isConstrainedContinuousRendering();
}

function shouldPrefetchContinuousNeighborPages() {
  return !isConstrainedContinuousRendering();
}

function getScaledViewport(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const fitScale = getAvailableCanvasWidth() / baseViewport.width;
  const finalScale = clamp(fitScale * state.zoom, 0.2, 4);
  return page.getViewport({ scale: finalScale });
}

function getCanvasOutputScale(viewport) {
  const dpr = clamp(window.devicePixelRatio || 1, 1, isScrollMode() ? 1.6 : 2.5);
  const maxPixels = isScrollMode() ? MAX_CONTINUOUS_CANVAS_PIXELS : MAX_PAGED_CANVAS_PIXELS;
  const viewportPixels = Math.max(viewport.width * viewport.height, 1);
  const pixelScale = Math.sqrt(maxPixels / viewportPixels);
  const dimensionScale = Math.min(
    MAX_CANVAS_DIMENSION / Math.max(viewport.width, 1),
    MAX_CANVAS_DIMENSION / Math.max(viewport.height, 1),
  );

  return Math.max(0.25, Math.min(dpr, pixelScale, dimensionScale));
}

function prepareCanvas(canvas, viewport) {
  const outputScale = getCanvasOutputScale(viewport);
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, viewport.width, viewport.height);

  return context;
}

function releaseCanvasBitmap(canvas, options = {}) {
  if (!canvas) {
    return;
  }

  canvas.width = 0;
  canvas.height = 0;
  canvas.removeAttribute("width");
  canvas.removeAttribute("height");

  if (options.removeStyle) {
    canvas.removeAttribute("style");
  }
}

function releasePagedCanvasBitmap() {
  releaseCanvasBitmap(els.canvas, { removeStyle: true });
}

function commitRenderedCanvas(sourceCanvas, targetCanvas) {
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  targetCanvas.style.width = sourceCanvas.style.width;
  targetCanvas.style.height = sourceCanvas.style.height;

  const context = targetCanvas.getContext("2d", { alpha: false });

  if (!context) {
    return;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(sourceCanvas, 0, 0);
}

async function waitForPdfOperation(promise, {
  failurePromise = activePdfRangeFailurePromise,
  label = "PDF operation",
  timeoutMs = PDF_RENDER_TIMEOUT_MS,
} = {}) {
  const pending = [promise];
  let timeoutId = 0;

  if (failurePromise) {
    pending.push(failurePromise);
  }

  if (timeoutMs > 0) {
    pending.push(new Promise((resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }));
  }

  try {
    return await Promise.race(pending);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function createEncryptedDocumentSourceWithKey(record, key) {
  const options = isEncryptedRecordStoredInChunks(record)
    ? {
        readEncryptedBytes: async ({ chunkIndex, expectedLength }) => {
          const bytes = await readStoredDocumentChunkBytes(record, chunkIndex);
          const byteLength = getStoredBlobBytesLength(bytes);

          if (byteLength !== expectedLength) {
            throw new Error(
              `Encrypted document chunk ${chunkIndex} has ${byteLength} bytes; expected ${expectedLength}.`,
            );
          }

          return bytes;
        },
      }
    : {};
  return new EncryptedDocumentSource(record, key, options);
}

async function createDocumentSourceFromRecord(record) {
  if (!isRecordEncrypted(record)) {
    return new BlobDocumentSource(record.blob);
  }

  if (!sessionPassword) {
    throw new Error("Encrypted document is locked.");
  }

  const payloadRecord = await ensureEncryptedRecordStoredInChunks(record, "source");
  const key = await getEncryptionKeyForRecord(payloadRecord);
  return createEncryptedDocumentSourceWithKey(payloadRecord, key);
}

async function encryptDocumentRecord(record, password, onProgress = () => {}) {
  if (isRecordEncrypted(record)) {
    if (!isCurrentRecordEncryption(record)) {
      onProgress({
        chunkIndex: 1,
        totalChunks: 1,
      });
      return record;
    }

    const key = await getEncryptionKeyForRecord(record, password);
    const encryptedName = isRecordNameEncrypted(record)
      ? record.encryptedName
      : await encryptRecordName(record, key, record.encryption);

    onProgress({
      chunkIndex: 1,
      totalChunks: 1,
    });

    return {
      ...withoutPlainRecordName(record),
      encryptedName,
    };
  }

  if (!record?.blob) {
    throw new Error("Document record has no blob.");
  }

  const source = new BlobDocumentSource(record.blob);
  return encryptDocumentFromSource(
    record,
    source,
    getPlainRecordName(record),
    password,
    onProgress,
  );
}

async function renderPage(pageNumber, options = {}) {
  if (!pdfDoc) {
    return false;
  }

  const token = ++renderToken;
  const documentToken = documentOpenToken;
  const targetPage = clamp(Math.round(pageNumber), 1, pdfDoc.numPages);
  const blankRetryCount = Math.max(0, Math.floor(options.blankRetryCount || 0));
  state.page = targetPage;
  state.scrollPage = targetPage;
  state.scrollOffsetRatio = 0;
  state.scrollTop = 0;
  updateViewerMode();
  updateControls();
  let page = null;
  showStatus("正在渲染...", true);

  try {
    await cancelCurrentRender();
    clearContinuousPages();

    page = await waitForPdfOperation(pdfDoc.getPage(targetPage), {
      label: `PDF page ${targetPage} load`,
      timeoutMs: PDF_RENDER_TIMEOUT_MS,
    });

    if (token !== renderToken || documentToken !== documentOpenToken || !pdfDoc) {
      return false;
    }

    lastLayoutWidth = getAvailableCanvasWidth();
    const viewport = getScaledViewport(page);
    const scratchCanvas = document.createElement("canvas");
    const context = prepareCanvas(scratchCanvas, viewport);

    renderTask = page.render({
      canvasContext: context,
      viewport,
    });

    await waitForPdfOperation(renderTask.promise, {
      label: `PDF page ${targetPage} render`,
      timeoutMs: PDF_RENDER_TIMEOUT_MS,
    });

    if (token !== renderToken || documentToken !== documentOpenToken) {
      return false;
    }

    if (isCanvasLikelyBlank(scratchCanvas) && blankRetryCount < PAGED_BLANK_RETRY_LIMIT) {
      pagedBlankRetries.set(targetPage, blankRetryCount + 1);
      window.setTimeout(() => {
        if (
          token === renderToken &&
          documentToken === documentOpenToken &&
          pdfDoc &&
          state.page === targetPage &&
          !isScrollMode()
        ) {
          renderPage(targetPage, {
            blankRetryCount: blankRetryCount + 1,
            commitProgress: options.commitProgress !== false,
          }).catch((error) => {
            console.error(error);
          });
        }
      }, PAGED_BLANK_RETRY_DELAY_MS);
      releaseCanvasBitmap(scratchCanvas, { removeStyle: true });
      return false;
    }

    pagedBlankRetries.delete(targetPage);
    commitRenderedCanvas(scratchCanvas, els.canvas);
    releaseCanvasBitmap(scratchCanvas, { removeStyle: true });
    els.canvasWrap.scrollTop = 0;
    saveReaderState({
      commitProgress: options.commitProgress !== false,
    });
    hideStatus();
    return true;
  } catch (error) {
    if (documentToken !== documentOpenToken) {
      return false;
    }

    if (error?.name === "RenderingCancelledException") {
      return false;
    }

    try {
      renderTask?.cancel?.();
    } catch {
      // Best-effort cancellation after a timed-out render.
    }
    if (options.throwOnError) {
      throw error;
    }
    recordDiagnosticEvent("pdf-render-page-error", {
      documentId: state.documentId,
      error: summarizeError(error),
      page: targetPage,
    });
    console.error(error);
    showDiagnosticFailureStatus("PDF 渲染失败。", {
      documentId: state.documentId,
      error: summarizeError(error),
      page: targetPage,
      phase: "render-page-error",
    });
    return false;
  } finally {
    try {
      page?.cleanup?.();
    } catch {
      // Best-effort PDF.js page cache cleanup.
    }

    if (token === renderToken) {
      renderTask = null;
      updateControls();
    }
  }
}

async function estimateContinuousPageSize() {
  let page = null;

  try {
    const targetPage = clamp(state.page, 1, pdfDoc.numPages);
    page = await waitForPdfOperation(pdfDoc.getPage(targetPage), {
      label: `PDF page ${targetPage} size`,
      timeoutMs: PDF_RENDER_TIMEOUT_MS,
    });
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
  } finally {
    try {
      page?.cleanup?.();
    } catch {
      // Best-effort PDF.js page cache cleanup.
    }
  }
}

function getContinuousDomWindowPageCount() {
  return isConstrainedContinuousRendering()
    ? CONTINUOUS_CONSTRAINED_DOM_WINDOW_PAGES
    : CONTINUOUS_DOM_WINDOW_PAGES;
}

function resetContinuousPageMetrics(estimatedSize = {}) {
  const pageCount = Math.max(0, pdfDoc?.numPages || 0);
  continuousEstimatedPageWidth = Math.max(240, Math.floor(estimatedSize.width || getAvailableCanvasWidth()));
  continuousEstimatedShellHeight = Math.max(320, Math.floor(estimatedSize.height || 420)) + 28;
  continuousPageHeightTree = new Float64Array(pageCount + 1);
  continuousPageHeightOverrides.clear();
  continuousDomWindowStart = 0;
  continuousDomWindowEnd = 0;
}

function addContinuousPageHeightDelta(pageNumber, delta) {
  if (!continuousPageHeightTree || !delta) {
    return;
  }

  for (
    let index = Math.max(1, Math.floor(pageNumber));
    index < continuousPageHeightTree.length;
    index += index & -index
  ) {
    continuousPageHeightTree[index] += delta;
  }
}

function getContinuousPageHeightDelta(pageCount) {
  if (!continuousPageHeightTree) {
    return 0;
  }

  let total = 0;

  for (
    let index = clamp(Math.floor(pageCount), 0, continuousPageHeightTree.length - 1);
    index > 0;
    index -= index & -index
  ) {
    total += continuousPageHeightTree[index];
  }

  return total;
}

function getContinuousPageHeight(pageNumber) {
  return (
    continuousPageHeightOverrides.get(Math.floor(pageNumber)) ||
    continuousEstimatedShellHeight ||
    448
  );
}

function getContinuousPageTopOffset(pageNumber) {
  const targetPage = clamp(Math.floor(pageNumber), 1, Math.max(1, pdfDoc?.numPages || 1));
  const precedingPages = targetPage - 1;
  return (
    precedingPages * (continuousEstimatedShellHeight + CONTINUOUS_PAGE_GAP_PX) +
    getContinuousPageHeightDelta(precedingPages)
  );
}

function getContinuousDocumentHeight() {
  const pageCount = Math.max(0, pdfDoc?.numPages || 0);

  if (!pageCount) {
    return 0;
  }

  return (
    pageCount * continuousEstimatedShellHeight +
    Math.max(0, pageCount - 1) * CONTINUOUS_PAGE_GAP_PX +
    getContinuousPageHeightDelta(pageCount)
  );
}

function getContinuousPageNumberAtOffset(offset) {
  const pageCount = Math.max(0, pdfDoc?.numPages || 0);

  if (!pageCount) {
    return 0;
  }

  const targetOffset = clamp(Math.floor(offset), 0, Math.max(0, getContinuousDocumentHeight() - 1));
  let low = 1;
  let high = pageCount;
  let result = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (getContinuousPageTopOffset(mid) <= targetOffset) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function updateContinuousSpacerSizes() {
  if (!pdfDoc || !continuousEstimatedShellHeight) {
    return;
  }

  const topSpacer = els.continuousPages.querySelector(".continuous-spacer-top");
  const bottomSpacer = els.continuousPages.querySelector(".continuous-spacer-bottom");

  if (topSpacer) {
    topSpacer.style.height = `${Math.max(
      0,
      getContinuousPageTopOffset(continuousDomWindowStart) - CONTINUOUS_PAGE_GAP_PX,
    )}px`;
  }

  if (bottomSpacer) {
    const lastPageBottom =
      getContinuousPageTopOffset(continuousDomWindowEnd) +
      getContinuousPageHeight(continuousDomWindowEnd);
    bottomSpacer.style.height = `${Math.max(
      0,
      getContinuousDocumentHeight() - lastPageBottom - CONTINUOUS_PAGE_GAP_PX,
    )}px`;
  }
}

function updateContinuousPageHeight(pageNumber, height) {
  const targetPage = Math.floor(pageNumber);

  if (
    !continuousPageHeightTree ||
    !Number.isFinite(targetPage) ||
    targetPage < 1 ||
    targetPage > (pdfDoc?.numPages || 0)
  ) {
    return;
  }

  const nextHeight = Math.max(1, Math.floor(height));
  const previousHeight = getContinuousPageHeight(targetPage);

  if (Math.abs(nextHeight - previousHeight) < 1) {
    return;
  }

  if (nextHeight === continuousEstimatedShellHeight) {
    continuousPageHeightOverrides.delete(targetPage);
  } else {
    continuousPageHeightOverrides.set(targetPage, nextHeight);
  }

  addContinuousPageHeightDelta(targetPage, nextHeight - previousHeight);
  updateContinuousSpacerSizes();
}

function createContinuousShell(pageNumber) {
  const shell = document.createElement("article");
  shell.className = "page-shell";
  shell.dataset.page = String(pageNumber);
  const pageHeight = Math.max(320, getContinuousPageHeight(pageNumber) - 28);
  setContinuousShellSize(shell, continuousEstimatedPageWidth, pageHeight);

  const placeholder = createContinuousPlaceholder(continuousEstimatedPageWidth, pageHeight);
  const label = document.createElement("div");
  label.className = "page-label";
  label.textContent = String(pageNumber);
  shell.append(placeholder, label);
  return shell;
}

function createContinuousSpacer(className) {
  const spacer = document.createElement("div");
  spacer.className = `continuous-spacer ${className}`;
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

function renderContinuousDomWindow(centerPage, options = {}) {
  if (!pdfDoc || !continuousEstimatedShellHeight || continuousWindowUpdating) {
    return false;
  }

  const pageCount = pdfDoc.numPages;
  const windowSize = Math.min(getContinuousDomWindowPageCount(), pageCount);
  const targetPage = clamp(Math.round(centerPage), 1, pageCount);
  const start = clamp(
    targetPage - Math.floor(windowSize / 2),
    1,
    Math.max(1, pageCount - windowSize + 1),
  );
  const end = Math.min(pageCount, start + windowSize - 1);

  if (options.force !== true && start === continuousDomWindowStart && end === continuousDomWindowEnd) {
    return false;
  }

  const currentScrollTop = Math.max(0, els.canvasWrap.scrollTop);
  const anchorPage = getContinuousPageNumberAtOffset(currentScrollTop + 8) || targetPage;
  const anchorHeight = Math.max(1, getContinuousPageHeight(anchorPage));
  const anchorRatio = clamp(
    (currentScrollTop - getContinuousPageTopOffset(anchorPage)) / anchorHeight,
    0,
    0.98,
  );
  const existingShells = new Map(
    Array.from(els.continuousPages.querySelectorAll(".page-shell")).map((shell) => [
      getContinuousShellPageNumber(shell),
      shell,
    ]),
  );

  continuousWindowUpdating = true;

  try {
    pageObserver?.disconnect();

    for (const [pageNumber, task] of pageRenderTasks) {
      if (pageNumber < start || pageNumber > end) {
        try {
          task.cancel();
        } catch {
          // PDF.js cancellation is best effort.
        }
        pageRenderTasks.delete(pageNumber);
        pendingContinuousPages.delete(pageNumber);
        continuousRenderRuns.delete(pageNumber);
      }
    }

    for (const [pageNumber, shell] of existingShells) {
      if (pageNumber < start || pageNumber > end) {
        releaseContinuousCanvas(shell);
      }
    }

    const fragment = document.createDocumentFragment();
    continuousDomWindowStart = start;
    continuousDomWindowEnd = end;

    if (start > 1) {
      fragment.append(createContinuousSpacer("continuous-spacer-top"));
    }

    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      fragment.append(existingShells.get(pageNumber) || createContinuousShell(pageNumber));
    }

    if (end < pageCount) {
      fragment.append(createContinuousSpacer("continuous-spacer-bottom"));
    }

    els.continuousPages.replaceChildren(fragment);
    updateContinuousSpacerSizes();

    if (options.preserveScroll !== false) {
      const preservedPage =
        anchorPage >= start && anchorPage <= end
          ? anchorPage
          : targetPage;
      const preservedRatio = preservedPage === anchorPage ? anchorRatio : 0;
      els.canvasWrap.scrollTop =
        getContinuousPageTopOffset(preservedPage) +
        preservedRatio * getContinuousPageHeight(preservedPage);
    }
  } finally {
    continuousWindowUpdating = false;
  }

  if (options.setupObserver !== false) {
    setupContinuousObserver(renderToken);
  }

  recordDiagnosticEvent("continuous-dom-window", {
    end,
    pageCount,
    start,
  });
  return true;
}

function ensureContinuousDomWindow(pageNumber, options = {}) {
  if (!pdfDoc || !continuousEstimatedShellHeight) {
    return false;
  }

  const targetPage = clamp(Math.round(pageNumber), 1, pdfDoc.numPages);
  const edgeBuffer = Math.max(3, Math.floor(getContinuousDomWindowPageCount() * 0.2));
  const insideSafeWindow =
    targetPage >= continuousDomWindowStart + edgeBuffer &&
    targetPage <= continuousDomWindowEnd - edgeBuffer;

  if (options.force !== true && insideSafeWindow) {
    return false;
  }

  return renderContinuousDomWindow(targetPage, options);
}

function buildContinuousPlaceholders(estimatedSize, targetPage = state.page) {
  resetContinuousPageMetrics(estimatedSize);
  renderContinuousDomWindow(targetPage, {
    force: true,
    preserveScroll: false,
    setupObserver: false,
  });
}

function setContinuousShellSize(shell, width, height) {
  const safeWidth = Math.max(240, Math.floor(width));
  const safeHeight = Math.max(320, Math.floor(height));
  shell.dataset.pageWidth = String(safeWidth);
  shell.dataset.pageHeight = String(safeHeight);
  shell.style.minHeight = `${safeHeight + 28}px`;
  updateContinuousPageHeight(getContinuousShellPageNumber(shell), safeHeight + 28);
}

function createContinuousPlaceholder(width, height) {
  const placeholder = document.createElement("div");
  placeholder.className = "page-placeholder";
  placeholder.style.width = `${Math.max(240, Math.floor(width))}px`;
  placeholder.style.height = `${Math.max(320, Math.floor(height))}px`;
  return placeholder;
}

function getContinuousShellPageNumber(shell) {
  return Number.parseInt(shell?.dataset?.page || "", 10);
}

function getContinuousShellByPageNumber(pageNumber) {
  const targetPage = Math.round(pageNumber);

  if (!Number.isFinite(targetPage) || targetPage < 1) {
    return null;
  }

  return els.continuousPages.querySelector(`[data-page="${targetPage}"]`);
}

function getContinuousShellTop(shell) {
  const pageNumber = getContinuousShellPageNumber(shell);
  return pageNumber
    ? getContinuousPageTopOffset(pageNumber)
    : Math.max(0, shell.offsetTop - els.continuousPages.offsetTop);
}

function getContinuousShellSize(shell) {
  return {
    width: Number.parseInt(shell.dataset.pageWidth || "", 10) || getAvailableCanvasWidth(),
    height:
      Number.parseInt(shell.dataset.pageHeight || "", 10) ||
      Math.max(420, Math.floor(els.canvasWrap.clientHeight * 0.86)),
  };
}

function ensureContinuousPlaceholder(shell) {
  let placeholder = shell.querySelector(".page-placeholder");

  if (placeholder) {
    return placeholder;
  }

  const { width, height } = getContinuousShellSize(shell);
  placeholder = createContinuousPlaceholder(width, height);
  shell.insertBefore(placeholder, shell.querySelector(".page-label"));
  return placeholder;
}

function ensureContinuousCanvas(shell, viewport) {
  setContinuousShellSize(shell, viewport.width, viewport.height);
  shell.querySelector(".page-placeholder")?.remove();

  let canvas = shell.querySelector("canvas");

  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.dataset.page = shell.dataset.page || "";
    shell.insertBefore(canvas, shell.querySelector(".page-label"));
  }

  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  return canvas;
}

function releaseContinuousCanvas(shell) {
  const canvas = shell.querySelector("canvas");

  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
    canvas.removeAttribute("width");
    canvas.removeAttribute("height");
    canvas.remove();
  }

  ensureContinuousPlaceholder(shell);
  delete shell.dataset.rendered;
  delete shell.dataset.rendering;
  delete shell.dataset.renderedAt;
  delete shell.dataset.renderStartedAt;
  delete shell.dataset.renderRunId;
}

function clearContinuousHealthTimer() {
  window.clearTimeout(continuousHealthTimer);
  continuousHealthTimer = null;
}

function clearContinuousCleanupTimer() {
  window.clearTimeout(continuousCleanupTimer);
  continuousCleanupTimer = null;
}

function clearContinuousScrollUpdate() {
  if (!continuousScrollFrame) {
    return;
  }

  window.cancelAnimationFrame(continuousScrollFrame);
  continuousScrollFrame = 0;
}

function scheduleContinuousPdfCleanup() {
  if (!pdfDoc || !isScrollMode()) {
    return;
  }

  clearContinuousCleanupTimer();
  continuousCleanupTimer = window.setTimeout(() => {
    continuousCleanupTimer = null;

    if (
      !pdfDoc ||
      !isScrollMode() ||
      pageRenderTasks.size ||
      continuousRenderPromises.size ||
      pendingContinuousPages.size
    ) {
      return;
    }

    try {
      const cleanupResult = pdfDoc.cleanup?.();
      cleanupResult?.catch?.(() => {});
    } catch {
      // Best-effort memory cleanup only.
    }
  }, CONTINUOUS_CLEANUP_IDLE_MS);
}

function getContinuousViewportWindow(extraViewports = getContinuousKeepViewports()) {
  const viewportHeight = Math.max(els.canvasWrap.clientHeight, 1);
  const scrollTop = Math.max(0, els.canvasWrap.scrollTop);
  const margin = viewportHeight * extraViewports;

  return {
    top: scrollTop - margin,
    bottom: scrollTop + viewportHeight + margin,
    center: scrollTop + viewportHeight / 2,
  };
}

function isPinnedContinuousPage(pageNumber) {
  return (
    continuousPinnedPages.has(pageNumber) ||
    pageNumber === state.page ||
    pageNumber === state.scrollPage
  );
}

function isContinuousShellNearViewport(
  shell,
  extraViewports = getContinuousKeepViewports(),
  windowBounds = getContinuousViewportWindow(extraViewports),
) {
  const top = getContinuousShellTop(shell);
  const bottom = top + Math.max(shell.offsetHeight, 1);
  return bottom >= windowBounds.top && top <= windowBounds.bottom;
}

function getContinuousShellDistance(shell, center = getContinuousViewportWindow(0).center) {
  const top = getContinuousShellTop(shell);
  const shellCenter = top + Math.max(shell.offsetHeight, 1) / 2;
  return Math.abs(shellCenter - center);
}

function getVisibleContinuousShells(extraViewports = 0.35) {
  const windowBounds = getContinuousViewportWindow(extraViewports);
  const shells = Array.from(els.continuousPages.querySelectorAll(".page-shell")).filter(
    (shell) => isContinuousShellNearViewport(shell, extraViewports, windowBounds),
  );

  const { center } = getContinuousViewportWindow(0);
  return shells.sort(
    (a, b) => getContinuousShellDistance(a, center) - getContinuousShellDistance(b, center),
  );
}

function isCanvasLikelyBlank(canvas) {
  if (!canvas || canvas.width < 2 || canvas.height < 2) {
    return true;
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return false;
  }

  const sampleColumns = 17;
  const sampleRows = 23;
  let nonWhitePixels = 0;

  try {
    for (let row = 0; row < sampleRows; row += 1) {
      const y = clamp(
        Math.floor(((row + 0.5) / sampleRows) * canvas.height),
        0,
        canvas.height - 1,
      );

      for (let column = 0; column < sampleColumns; column += 1) {
        const x = clamp(
          Math.floor(((column + 0.5) / sampleColumns) * canvas.width),
          0,
          canvas.width - 1,
        );
        const data = context.getImageData(x, y, 1, 1).data;

        if (data[3] > 0 && (data[0] < 245 || data[1] < 245 || data[2] < 245)) {
          nonWhitePixels += 1;

          if (nonWhitePixels >= 2) {
            return false;
          }
        }
      }
    }
  } catch {
    return false;
  }

  return true;
}

function isContinuousRenderCurrent(pageNumber, shell, token, runId) {
  return (
    token === renderToken &&
    Boolean(pdfDoc) &&
    continuousRenderRuns.get(pageNumber) === runId &&
    shell.dataset.renderRunId === String(runId)
  );
}

function recoverContinuousPageRender(pageNumber, shell, token) {
  if (!pdfDoc || token !== renderToken || !isScrollMode()) {
    return false;
  }

  const task = pageRenderTasks.get(pageNumber);

  try {
    task?.cancel?.();
  } catch {
    // PDF.js cancellation is best effort.
  }

  pageRenderTasks.delete(pageNumber);
  continuousRenderPromises.delete(pageNumber);
  continuousRenderRuns.delete(pageNumber);
  pendingContinuousPages.delete(pageNumber);
  releaseContinuousCanvas(shell);
  scheduleContinuousPageRender(pageNumber, token);
  return true;
}

function checkVisibleContinuousPages() {
  if (!pdfDoc || !isScrollMode() || !els.continuousPages.childElementCount) {
    return;
  }

  const token = renderToken;
  const now = Date.now();
  let hasUnsettledVisiblePage = false;

  for (const shell of getVisibleContinuousShells().slice(0, getContinuousMaxRenderedPages())) {
    const pageNumber = getContinuousShellPageNumber(shell);

    if (!Number.isFinite(pageNumber)) {
      continue;
    }

    if (shell.dataset.rendering === "true") {
      hasUnsettledVisiblePage = true;
      const startedAt = Number.parseInt(shell.dataset.renderStartedAt || "0", 10);

      if (startedAt && now - startedAt > CONTINUOUS_RENDER_TIMEOUT_MS) {
        recoverContinuousPageRender(pageNumber, shell, token);
      }

      continue;
    }

    if (shell.dataset.rendered === "true") {
      const canvas = shell.querySelector("canvas");

      if (!isCanvasLikelyBlank(canvas)) {
        continuousBlankRetries.delete(pageNumber);
        continue;
      }

      const retryCount = continuousBlankRetries.get(pageNumber) || 0;

      if (retryCount < getContinuousBlankRetryLimit()) {
        continuousBlankRetries.set(pageNumber, retryCount + 1);
        recoverContinuousPageRender(pageNumber, shell, token);
        hasUnsettledVisiblePage = true;
      }

      continue;
    }

    if (
      !pendingContinuousPages.has(pageNumber) &&
      !continuousRenderPromises.has(pageNumber) &&
      !pageRenderTasks.has(pageNumber)
    ) {
      scheduleContinuousPageRender(pageNumber, token);
    }

    hasUnsettledVisiblePage = true;
  }

  if (hasUnsettledVisiblePage || pendingContinuousPages.size || continuousRenderPromises.size) {
    scheduleContinuousHealthCheck(CONTINUOUS_HEALTH_CHECK_INTERVAL_MS);
  }
}

function scheduleContinuousHealthCheck(delay = CONTINUOUS_HEALTH_CHECK_DELAY_MS) {
  if (!pdfDoc || !isScrollMode() || !els.continuousPages.childElementCount) {
    return;
  }

  clearContinuousHealthTimer();
  continuousHealthTimer = window.setTimeout(() => {
    continuousHealthTimer = null;
    checkVisibleContinuousPages();
  }, delay);
}

function pruneContinuousPages() {
  if (!pdfDoc || !isScrollMode() || !els.continuousPages.childElementCount) {
    return;
  }

  for (const [pageNumber, task] of pageRenderTasks) {
    const shell = getContinuousShellByPageNumber(pageNumber);

    if (
      !shell ||
      (!isPinnedContinuousPage(pageNumber) &&
        !isContinuousShellNearViewport(shell, getContinuousRenderViewports()))
    ) {
      task.cancel();
      pageRenderTasks.delete(pageNumber);
    }
  }

  const renderedShells = Array.from(
    els.continuousPages.querySelectorAll('.page-shell[data-rendered="true"]'),
  );
  const keptShells = [];

  for (const shell of renderedShells) {
    if (
      isPinnedContinuousPage(getContinuousShellPageNumber(shell)) ||
      isContinuousShellNearViewport(shell)
    ) {
      keptShells.push(shell);
    } else {
      releaseContinuousCanvas(shell);
    }
  }

  const maxRenderedPages = getContinuousMaxRenderedPages();

  if (keptShells.length > maxRenderedPages) {
    keptShells
      .sort((a, b) => {
        const aPage = getContinuousShellPageNumber(a);
        const bPage = getContinuousShellPageNumber(b);
        const aPinned = isPinnedContinuousPage(aPage) ? 0 : 1;
        const bPinned = isPinnedContinuousPage(bPage) ? 0 : 1;

        if (aPinned !== bPinned) {
          return aPinned - bPinned;
        }

        return getContinuousShellDistance(a) - getContinuousShellDistance(b);
      })
      .slice(maxRenderedPages)
      .forEach((shell) => releaseContinuousCanvas(shell));
  }

  if (
    pageRenderTasks.size === 0 &&
    continuousRenderPromises.size === 0 &&
    pendingContinuousPages.size === 0
  ) {
    scheduleContinuousPdfCleanup();
  }
}

function getNextQueuedContinuousPage() {
  const candidates = [];

  for (const [pageNumber, token] of pendingContinuousPages) {
    const shell = getContinuousShellByPageNumber(pageNumber);

    if (
      token !== renderToken ||
      !shell ||
      shell.dataset.rendered === "true" ||
      shell.dataset.rendering === "true" ||
      continuousRenderPromises.has(pageNumber) ||
      pageRenderTasks.has(pageNumber)
    ) {
      pendingContinuousPages.delete(pageNumber);
      continue;
    }

    if (
      !isPinnedContinuousPage(pageNumber) &&
      !isContinuousShellNearViewport(shell, getContinuousRenderViewports())
    ) {
      pendingContinuousPages.delete(pageNumber);
      continue;
    }

    candidates.push({
      pageNumber,
      token,
      distance: getContinuousShellDistance(shell),
    });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const next = candidates[0];

  if (next) {
    pendingContinuousPages.delete(next.pageNumber);
  }

  return next;
}

async function runContinuousRenderQueue() {
  if (continuousQueueRunning) {
    return;
  }

  continuousQueueRunning = true;

  try {
    while (pendingContinuousPages.size && pdfDoc && isScrollMode()) {
      const next = getNextQueuedContinuousPage();

      if (!next) {
        break;
      }

      await renderContinuousPageWithTimeout(next.pageNumber, next.token);
    }
  } finally {
    continuousQueueRunning = false;

    if (pendingContinuousPages.size && pdfDoc && isScrollMode()) {
      window.setTimeout(runContinuousRenderQueue, 0);
    }
  }
}

async function renderContinuousPageWithTimeout(pageNumber, token) {
  let timeoutId = 0;
  const render = renderContinuousPage(pageNumber, token).catch((error) => {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
    }
  });
  const timeout = new Promise((resolve) => {
    timeoutId = window.setTimeout(() => resolve("timeout"), CONTINUOUS_RENDER_TIMEOUT_MS);
  });
  const result = await Promise.race([render, timeout]);

  window.clearTimeout(timeoutId);

  if (result !== "timeout") {
    return;
  }

  const shell = getContinuousShellByPageNumber(pageNumber);

  if (shell) {
    recoverContinuousPageRender(pageNumber, shell, token);
  }
}

function scheduleContinuousPageRender(pageNumber, token = renderToken) {
  if (!pdfDoc || token !== renderToken || !isScrollMode()) {
    return;
  }

  const targetPage = Math.round(pageNumber);

  if (!Number.isFinite(targetPage) || targetPage < 1 || targetPage > pdfDoc.numPages) {
    return;
  }

  const shell = getContinuousShellByPageNumber(targetPage);

  if (
    !shell ||
    shell.dataset.rendered === "true" ||
    shell.dataset.rendering === "true" ||
    continuousRenderPromises.has(targetPage) ||
    pageRenderTasks.has(targetPage) ||
    pendingContinuousPages.has(targetPage)
  ) {
    return;
  }

  clearContinuousCleanupTimer();
  pendingContinuousPages.set(targetPage, token);
  runContinuousRenderQueue();
  scheduleContinuousHealthCheck(CONTINUOUS_HEALTH_CHECK_INTERVAL_MS);
}

function queueVisibleContinuousPages(token = renderToken) {
  if (!pdfDoc || token !== renderToken || !isScrollMode() || !els.continuousPages.childElementCount) {
    return;
  }

  const shells = getVisibleContinuousShells(getContinuousRenderViewports());

  for (const shell of shells.slice(0, getContinuousMaxRenderedPages())) {
    scheduleContinuousPageRender(getContinuousShellPageNumber(shell), token);
  }

  scheduleContinuousHealthCheck();
}

async function renderContinuousPage(pageNumber, token = renderToken, options = {}) {
  if (!pdfDoc || token !== renderToken) {
    return false;
  }

  const targetPage = clamp(Math.round(pageNumber), 1, pdfDoc.numPages);
  let shell = getContinuousShellByPageNumber(targetPage);

  if (!shell && options.force) {
    ensureContinuousDomWindow(targetPage, { force: true });
    shell = getContinuousShellByPageNumber(targetPage);
  }

  if (!shell || (!options.force && shell.dataset.rendered === "true")) {
    return shell?.dataset.rendered === "true";
  }

  const existingRender = continuousRenderPromises.get(targetPage);

  if (existingRender) {
    await existingRender.catch((error) => {
      if (error?.name !== "RenderingCancelledException") {
        console.error(error);
      }
    });

    if (shell.dataset.rendered === "true" || !options.force) {
      return shell.dataset.rendered === "true";
    }

    if (continuousRenderPromises.get(targetPage) === existingRender) {
      continuousRenderPromises.delete(targetPage);
    }
  }

  const runId = (continuousRenderRunId += 1);
  continuousRenderRuns.set(targetPage, runId);
  shell.dataset.renderRunId = String(runId);

  const documentToken = documentOpenToken;
  const renderPromise = renderContinuousPageInternal(targetPage, shell, token, runId, documentToken, options);
  continuousRenderPromises.set(targetPage, renderPromise);

  try {
    return await renderPromise;
  } finally {
    if (continuousRenderPromises.get(targetPage) === renderPromise) {
      continuousRenderPromises.delete(targetPage);
    }

    if (
      pdfDoc &&
      isScrollMode() &&
      pageRenderTasks.size === 0 &&
      continuousRenderPromises.size === 0 &&
      pendingContinuousPages.size === 0
    ) {
      scheduleContinuousPdfCleanup();
    }
  }
}

async function retryInitialContinuousTargetRender(targetPage, token, documentToken, options = {}) {
  const maxAttempts = Math.max(1, getContinuousBlankRetryLimit() + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!pdfDoc || token !== renderToken || documentToken !== documentOpenToken || !isScrollMode()) {
      return false;
    }

    const shell = getContinuousShellByPageNumber(targetPage);

    if (!shell) {
      return false;
    }

    const canvas = shell.querySelector("canvas");

    if (shell.dataset.rendered === "true" && !isCanvasLikelyBlank(canvas)) {
      return true;
    }

    if (attempt > 0) {
      await wait(PAGED_BLANK_RETRY_DELAY_MS + 40);
    }

    const rendered = await renderContinuousPage(targetPage, token, {
      force: true,
      throwOnError: options.throwOnError,
    });

    if (rendered === true) {
      return true;
    }
  }

  return false;
}

async function renderContinuousPageInternal(targetPage, shell, token, runId, documentToken, options = {}) {
  if (!options.force && !isContinuousShellNearViewport(shell, getContinuousRenderViewports())) {
    return false;
  }

  shell.dataset.rendering = "true";
  shell.dataset.renderStartedAt = String(Date.now());
  let page = null;
  let task = null;

  try {
    page = await waitForPdfOperation(pdfDoc.getPage(targetPage), {
      label: `PDF page ${targetPage} load`,
      timeoutMs: PDF_RENDER_TIMEOUT_MS,
    });

    if (
      documentToken !== documentOpenToken ||
      !isContinuousRenderCurrent(targetPage, shell, token, runId)
    ) {
      return false;
    }

    if (!options.force && !isContinuousShellNearViewport(shell, getContinuousRenderViewports())) {
      releaseContinuousCanvas(shell);
      return;
    }

    const viewport = getScaledViewport(page);
    const directRender = shouldRenderContinuousDirectToTarget();
    const renderCanvas = directRender
      ? ensureContinuousCanvas(shell, viewport)
      : document.createElement("canvas");
    const context = prepareCanvas(renderCanvas, viewport);

    task = page.render({
      canvasContext: context,
      viewport,
    });

    pageRenderTasks.set(targetPage, task);
    await waitForPdfOperation(task.promise, {
      label: `PDF page ${targetPage} render`,
      timeoutMs: PDF_RENDER_TIMEOUT_MS,
    });

    if (
      documentToken !== documentOpenToken ||
      !isContinuousRenderCurrent(targetPage, shell, token, runId)
    ) {
      // A stale render can finish after a retry has reused the shell; leave the newer canvas alone.
      if (!directRender) {
        releaseCanvasBitmap(renderCanvas, { removeStyle: true });
      }
      return false;
    }

    if (isCanvasLikelyBlank(renderCanvas)) {
      const retryCount = continuousBlankRetries.get(targetPage) || 0;

      if (retryCount < getContinuousBlankRetryLimit()) {
        continuousBlankRetries.set(targetPage, retryCount + 1);
        releaseContinuousCanvas(shell);
        if (!directRender) {
          releaseCanvasBitmap(renderCanvas, { removeStyle: true });
        }
        window.setTimeout(() => {
          if (
            token === renderToken &&
            documentToken === documentOpenToken &&
            pdfDoc &&
            isScrollMode() &&
            shell.isConnected
          ) {
            scheduleContinuousPageRender(targetPage, token);
          }
        }, PAGED_BLANK_RETRY_DELAY_MS);
        return false;
      }
    }

    continuousBlankRetries.delete(targetPage);
    if (!directRender) {
      const canvas = ensureContinuousCanvas(shell, viewport);
      commitRenderedCanvas(renderCanvas, canvas);
      releaseCanvasBitmap(renderCanvas, { removeStyle: true });
    }
    shell.dataset.rendered = "true";
    shell.dataset.renderedAt = String(Date.now());
    scheduleContinuousHealthCheck(260);
    return true;
  } catch (error) {
    if (documentToken !== documentOpenToken) {
      return false;
    }

    try {
      task?.cancel?.();
    } catch {
      // Best-effort cancellation after a timed-out render.
    }

    if (
      documentToken === documentOpenToken &&
      isContinuousRenderCurrent(targetPage, shell, token, runId)
    ) {
      releaseContinuousCanvas(shell);
    }
    if (options.throwOnError) {
      throw error;
    }
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
    }
    return false;
  } finally {
    try {
      page?.cleanup?.();
    } catch {
      // Best-effort PDF.js page cache cleanup.
    }

    if (pageRenderTasks.get(targetPage) === task) {
      pageRenderTasks.delete(targetPage);
    }

    if (continuousRenderRuns.get(targetPage) === runId) {
      continuousRenderRuns.delete(targetPage);
      delete shell.dataset.rendering;
      delete shell.dataset.renderStartedAt;
      delete shell.dataset.renderRunId;
    }

    pruneContinuousPages();
  }
}

function setupContinuousObserver(token) {
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }

  const shells = els.continuousPages.querySelectorAll(".page-shell");

  if (!("IntersectionObserver" in window)) {
    scheduleContinuousPageRender(state.page, token);
    if (shouldPrefetchContinuousNeighborPages()) {
      scheduleContinuousPageRender(state.page + 1, token);
    }
    return;
  }

  pageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const pageNumber = Number.parseInt(entry.target.dataset.page, 10);
          scheduleContinuousPageRender(pageNumber, token);
        }
      }
    },
    {
      root: els.canvasWrap,
      rootMargin: getContinuousObserverMargin(),
      threshold: 0.01,
    },
  );

  for (const shell of shells) {
    pageObserver.observe(shell);
  }
}

function getContinuousPageTop(shell) {
  return Math.max(0, getContinuousShellTop(shell) - 8);
}

function getContinuousMaxScrollTop() {
  return Math.max(0, els.canvasWrap.scrollHeight - els.canvasWrap.clientHeight);
}

function setEpubLoading(loading, message = "正在排版...") {
  window.clearTimeout(epubLoadingTimer);
  epubNavigationInProgress = loading;

  if (loading) {
    els.epubPane.dataset.loadingText = message;
    els.epubPane.classList.add("is-loading");
    updateControls();
    return;
  }

  epubLoadingTimer = window.setTimeout(() => {
    els.epubPane.classList.remove("is-loading");
    delete els.epubPane.dataset.loadingText;
    updateControls();
  }, 120);
}

function getDocumentMaxScrollTop() {
  const scroller = document.scrollingElement || document.documentElement;
  return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

function getVisibleEpubIndex() {
  const total = getEpubChapterTotal();
  const visibleViews = epubRendition?.manager?.visible?.() || [];
  const container = getEpubScrollContainer();
  const indexedViews = visibleViews.filter((view) => Number.isFinite(view?.section?.index));

  if (visibleViews.length && container) {
    const containerRect = container.getBoundingClientRect();
    const marker = containerRect.top + containerRect.height * 0.35;
    let fallbackView = null;

    for (const view of visibleViews) {
      const rect = view.position?.();

      if (!rect || !Number.isFinite(view.section?.index)) {
        continue;
      }

      if (rect.top <= marker && rect.bottom >= marker) {
        return clamp(view.section.index, 0, total - 1);
      }

      if (!fallbackView && rect.bottom >= marker) {
        fallbackView = view;
      }
    }

    if (Number.isFinite(fallbackView?.section?.index)) {
      return clamp(fallbackView.section.index, 0, total - 1);
    }
  }

  if (indexedViews.length === 1) {
    return clamp(indexedViews[0].section.index, 0, total - 1);
  }

  return null;
}

function getCurrentEpubIndex() {
  const total = getEpubChapterTotal();
  const visibleIndex = getVisibleEpubIndex();

  if (Number.isFinite(visibleIndex)) {
    return clamp(visibleIndex, 0, total - 1);
  }

  if (Number.isFinite(epubLastKnownIndex)) {
    return clamp(epubLastKnownIndex, 0, total - 1);
  }

  const location = epubRendition?.currentLocation?.();
  const index = location?.start?.index;

  if (Number.isFinite(index)) {
    return clamp(index, 0, total - 1);
  }

  return clamp((state.page || 1) - 1, 0, total - 1);
}

function getEpubSectionAt(index) {
  return epubBook?.spine?.get?.(index) || null;
}

function getEpubSectionIndex(section) {
  return Number.isFinite(section?.index) ? section.index : null;
}

function rememberRecentEpubTarget(section, duration = 900) {
  const sectionIndex = getEpubSectionIndex(section);

  if (sectionIndex === null) {
    return;
  }

  epubRecentTargetIndex = sectionIndex;
  epubRecentTargetUntil = Date.now() + duration;
}

function setPendingEpubTarget(section, duration = 2500) {
  epubPendingTargetIndex = getEpubSectionIndex(section);
  window.clearTimeout(epubPendingTargetTimer);

  if (epubPendingTargetIndex !== null) {
    const targetIndex = epubPendingTargetIndex;
    epubPendingTargetTimer = window.setTimeout(() => {
      if (epubPendingTargetIndex === targetIndex) {
        epubPendingTargetIndex = null;
      }
    }, duration);
  }
}

function clearPendingEpubTarget(section = null) {
  const sectionIndex = getEpubSectionIndex(section);

  if (sectionIndex === null || epubPendingTargetIndex === sectionIndex) {
    epubPendingTargetIndex = null;
    window.clearTimeout(epubPendingTargetTimer);
    epubPendingTargetTimer = null;
  }
}

function setEpubLocationFromSection(section) {
  const sectionIndex = getEpubSectionIndex(section);

  if (sectionIndex === null) {
    return false;
  }

  const total = getEpubChapterTotal();
  state.page = clamp(sectionIndex + 1, 1, total);
  state.epubCfi =
    section.href ||
    (section.idref ? `#${section.idref}` : String(sectionIndex));
  state.epubProgress = clamp(sectionIndex / total, 0, 1);
  epubAtStart = sectionIndex === epubBook?.spine?.first?.()?.index;
  epubAtEnd = sectionIndex === epubBook?.spine?.last?.()?.index;
  epubLastKnownIndex = clamp(sectionIndex, 0, total - 1);
  updateControls();
  return true;
}

function findLinearEpubSection(startIndex, step) {
  const total = getEpubChapterTotal();

  for (
    let index = Math.round(startIndex);
    index >= 0 && index < total;
    index += step
  ) {
    const section = getEpubSectionAt(index);

    if (section?.linear) {
      return section;
    }
  }

  return null;
}

function getEpubNavigationBaseIndex() {
  const total = getEpubChapterTotal();

  if (epubPendingTargetIndex !== null) {
    return clamp(epubPendingTargetIndex, 0, total - 1);
  }

  return clamp(getCurrentEpubIndex(), 0, total - 1);
}

function getEpubChapterNavigationIndex() {
  const total = getEpubChapterTotal();

  if (epubPendingTargetIndex !== null) {
    return clamp(epubPendingTargetIndex, 0, total - 1);
  }

  return clamp(getCurrentEpubIndex(), 0, total - 1);
}

function getAdjacentEpubSection(direction) {
  const step = direction === "prev" ? -1 : 1;
  const currentIndex = getEpubNavigationBaseIndex();

  return findLinearEpubSection(currentIndex + step, step);
}

function getEpubDisplayTarget(section) {
  if (!section) {
    return undefined;
  }

  if (section.href) {
    return section.href;
  }

  if (section.idref) {
    return `#${section.idref}`;
  }

  return section.index;
}

function getEpubViewForSection(section) {
  if (!section) {
    return null;
  }

  const targetIndex = getEpubSectionIndex(section);
  const matchedView = epubRendition?.manager?.views?.find?.(section);

  if (matchedView) {
    return matchedView;
  }

  return getEpubVisibleViews().find((view) => view?.section?.index === targetIndex) || null;
}

function scrollToEpubSection(section, edge = "top") {
  const manager = epubRendition?.manager;
  const container = getEpubScrollContainer();
  const view = getEpubViewForSection(section);

  if (!manager || !container || !view) {
    return false;
  }

  const offset = view.offset?.();
  const viewHeight = typeof view.height === "function" ? view.height() : 0;
  const top =
    edge === "bottom"
      ? Math.max(0, (offset?.top || 0) + viewHeight - container.clientHeight)
      : offset?.top || 0;
  const targetTop = clamp(Math.round(top), 0, getEpubMaxScrollTop());

  if (typeof manager.scrollTo === "function") {
    manager.scrollTo(0, targetTop, true);
  } else {
    container.scrollTop = targetTop;
  }

  manager.scrollTop = targetTop;
  return true;
}

async function displayEpubSection(section) {
  const displayTask = Promise.resolve(epubRendition.display(getEpubDisplayTarget(section)))
    .then(() => true)
    .catch((error) => {
      console.warn(error);
      return false;
    });
  const displayed = await Promise.race([displayTask, waitForEpubSectionCurrent(section, 4200)]);

  if (!displayed && !isEpubSectionCurrent(section)) {
    return false;
  }

  await waitForNextFrame();
  await waitForNextFrame();
  await waitForEpubImageRepairs();
  await repairVisibleEpubImages(section, { attempts: 2 });

  if (scrollToEpubSection(section, "top")) {
    await waitForNextFrame();
    await repairVisibleEpubImages(section, { attempts: 1 });
  }

  await waitForNextFrame();
  return waitForEpubSectionCurrent(section);
}

function updateEpubLocationFromRendition(fallbackSection = null, options = {}) {
  const location = epubRendition?.currentLocation?.();
  const fallbackIndex = getEpubSectionIndex(fallbackSection);
  const locationIndex = location?.start?.index;
  const preferFallback =
    options.preferFallback &&
    fallbackIndex !== null &&
    (!Number.isFinite(locationIndex) || locationIndex !== fallbackIndex);

  if (location?.start && !preferFallback) {
    updateEpubLocation(location);
    return true;
  }

  if (fallbackSection && isEpubSectionCurrent(fallbackSection)) {
    return setEpubLocationFromSection(fallbackSection);
  }

  return false;
}

function getEpubScrollContainer() {
  return epubRendition?.manager?.container || null;
}

function getEpubMaxScrollTop() {
  const container = getEpubScrollContainer();

  if (!container) {
    return 0;
  }

  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function getEpubVisibleViews() {
  return epubRendition?.manager?.visible?.() || [];
}

function isEpubSectionVisible(section) {
  const targetIndex = getEpubSectionIndex(section);

  if (targetIndex === null) {
    return false;
  }

  return getEpubVisibleViews().some((view) => view?.section?.index === targetIndex);
}

function isEpubIframeDocumentForSection(section) {
  const hrefCandidates = getEpubSectionHrefCandidates(section);
  const idref = String(section?.idref || "");

  for (const iframe of els.epubViewer.querySelectorAll("iframe")) {
    const documentElement = iframe.contentDocument;

    if (!documentElement) {
      continue;
    }

    const identifier =
      documentElement.querySelector('meta[name="dc.identifier"]')?.getAttribute("content") || "";

    if (idref && identifier === idref) {
      return true;
    }

    const documentCandidates = [
      documentElement.baseURI,
      documentElement.URL,
      documentElement.location?.href,
      documentElement.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ]
      .map(normalizeEpubTocHref)
      .filter(Boolean);

    if (
      documentCandidates.some((documentHref) =>
        hrefCandidates.some((sectionHref) => epubTocHrefsMatch(documentHref, sectionHref)),
      )
    ) {
      return true;
    }
  }

  return false;
}

function isEpubSectionCurrent(section) {
  const targetIndex = getEpubSectionIndex(section);
  const visibleIndex = getVisibleEpubIndex();

  if (targetIndex === null) {
    return false;
  }

  if (isEpubIframeDocumentForSection(section)) {
    return true;
  }

  if (Number.isFinite(visibleIndex)) {
    return visibleIndex === targetIndex || isEpubSectionVisible(section);
  }

  return isEpubSectionVisible(section);
}

async function waitForEpubSectionCurrent(section, timeout = 1600) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (isEpubSectionCurrent(section)) {
      return true;
    }

    await waitForNextFrame();
    await wait(80);
  }

  return isEpubSectionCurrent(section);
}

function getPrimaryEpubView() {
  const visibleViews = getEpubVisibleViews();

  if (!visibleViews.length) {
    return null;
  }

  const container = getEpubScrollContainer();

  if (!container) {
    return visibleViews[0];
  }

  const containerRect = container.getBoundingClientRect();
  const marker = containerRect.top + containerRect.height * 0.35;

  return (
    visibleViews.find((view) => {
      const rect = view.position?.();
      return rect && rect.top <= marker && rect.bottom >= marker;
    }) || visibleViews[0]
  );
}

function getElementMaxScrollTop(element) {
  if (!element) {
    return 0;
  }

  return Math.max(0, (element.scrollHeight || 0) - (element.clientHeight || 0));
}

function addUniqueElement(elements, element) {
  if (element && !elements.includes(element)) {
    elements.push(element);
  }
}

function getEpubScrollTargets() {
  const manager = epubRendition?.manager;
  const targets = [];
  const primaryView = getPrimaryEpubView();
  const views = primaryView ? [primaryView, ...getEpubVisibleViews()] : getEpubVisibleViews();

  addUniqueElement(targets, manager?.container);
  addUniqueElement(targets, manager?.stage?.container);
  addUniqueElement(targets, manager?.stage?.element);
  addUniqueElement(targets, els.epubViewer);
  addUniqueElement(targets, document.scrollingElement || document.documentElement);

  for (const view of views) {
    addUniqueElement(targets, view?.element);

    const documentElement =
      view?.contents?.documentElement ||
      view?.document?.scrollingElement ||
      view?.document?.documentElement ||
      view?.iframe?.contentDocument?.scrollingElement ||
      view?.iframe?.contentDocument?.documentElement;
    const body = view?.contents?.content || view?.document?.body || view?.iframe?.contentDocument?.body;

    addUniqueElement(targets, documentElement);
    addUniqueElement(targets, body);
  }

  return targets;
}

function getEpubScrollSnapshot() {
  return getEpubScrollTargets().map((element) => ({
    element,
    top: element.scrollTop || 0,
  }));
}

function didEpubScrollMove(snapshot) {
  return snapshot.some(({ element, top }) => Math.abs((element.scrollTop || 0) - top) > 8);
}

async function scrollEpubViewMarkerToEdge(edge) {
  const view = getPrimaryEpubView();

  if (!view?.element) {
    return false;
  }

  const marker = document.createElement("span");
  const viewHeight = typeof view.height === "function" ? view.height() : view.element.offsetHeight || 0;
  const markerTop = edge === "bottom" ? Math.max(0, viewHeight - 1) : 0;
  const before = getEpubScrollSnapshot();

  marker.setAttribute("aria-hidden", "true");
  marker.style.cssText = [
    "position:absolute",
    "left:0",
    `top:${markerTop}px`,
    "width:1px",
    "height:1px",
    "pointer-events:none",
    "opacity:0",
  ].join(";");

  view.element.append(marker);
  marker.scrollIntoView({
    block: edge === "bottom" ? "end" : "start",
    inline: "nearest",
    behavior: "auto",
  });
  await waitForNextFrame();
  marker.remove();

  return didEpubScrollMove(before);
}

function scrollElementToEdge(element, edge) {
  const maxScrollTop = getElementMaxScrollTop(element);

  if (maxScrollTop <= 2) {
    return false;
  }

  const targetTop = edge === "bottom" ? maxScrollTop : 0;
  const beforeTop = element.scrollTop || 0;
  element.scrollTop = targetTop;

  if (typeof element.scrollTo === "function") {
    element.scrollTo({
      top: targetTop,
      behavior: "auto",
    });
  }

  const afterTop = element.scrollTop || 0;
  return Math.abs(afterTop - targetTop) <= 8 || Math.abs(afterTop - beforeTop) > 8;
}

async function setEpubScrollEdge(edge) {
  const manager = epubRendition?.manager;

  if (!manager) {
    return false;
  }

  getPrimaryEpubView()?.expand?.();
  manager.updateLayout?.();
  await waitForNextFrame();
  await waitForNextFrame();

  if (await scrollEpubViewMarkerToEdge(edge)) {
    await waitForNextFrame();
    epubRendition.reportLocation?.();
    updateEpubLocationFromRendition();
    return true;
  }

  for (const target of getEpubScrollTargets()) {
    if (scrollElementToEdge(target, edge)) {
      manager.scrollTop = target.scrollTop || 0;
      await waitForNextFrame();
      epubRendition.reportLocation?.();
      updateEpubLocationFromRendition();
      return true;
    }
  }

  const container = getEpubScrollContainer();
  const primaryView = getPrimaryEpubView();
  const viewOffset = primaryView?.offset?.();
  const viewHeight = typeof primaryView?.height === "function" ? primaryView.height() : 0;

  if (container && primaryView && viewHeight > container.clientHeight) {
    const targetTop =
      edge === "bottom" ? viewOffset.top + viewHeight - container.clientHeight : viewOffset.top || 0;
    container.scrollTop = Math.max(0, Math.round(targetTop));
    manager.scrollTop = container.scrollTop;
    await waitForNextFrame();
    epubRendition.reportLocation?.();
    updateEpubLocationFromRendition();
    return true;
  }

  return false;
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
  const nextPage = getContinuousPageNumberAtOffset(marker) || state.scrollPage;
  const top = getContinuousPageTopOffset(nextPage);
  const height = Math.max(getContinuousPageHeight(nextPage), 1);
  const offset = clamp(scrollTop - top, 0, height);
  const nextOffsetRatio = clamp(offset / height, 0, 0.98);

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
  ensureContinuousDomWindow(targetPage, {
    preserveScroll: false,
  });
  const shell = getContinuousShellByPageNumber(targetPage);

  if (!shell) {
    return false;
  }

  const height = Math.max(shell.offsetHeight, 1);
  const offset = clamp(state.scrollOffsetRatio || 0, 0, 0.98) * height;

  els.canvasWrap.scrollTo({
    top: getContinuousPageTop(shell) + offset,
    behavior: options.behavior || "auto",
  });

  scheduleContinuousPageRender(targetPage, renderToken);
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
  continuousProgrammaticScrollTarget = targetPage;
  continuousProgrammaticScrollUntil = Date.now() + 1_200;
  scrollTrackingSuppressionDepth += 1;

  try {
    ensureContinuousDomWindow(targetPage);
    const shell = getContinuousShellByPageNumber(targetPage);

    if (!shell) {
      return;
    }

    if (options.renderFirst !== false) {
      scheduleContinuousPageRender(targetPage, renderToken);
    }

    const targetTop = getContinuousPageTop(shell);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      els.canvasWrap.scrollTop = targetTop;
      els.canvasWrap.scrollTo({
        top: targetTop,
        behavior: attempt === 0 ? options.behavior || "smooth" : "auto",
      });
      await waitForNextFrame();

      if (Math.abs(els.canvasWrap.scrollTop - targetTop) <= 4) {
        break;
      }
    }

    queueVisibleContinuousPages(renderToken);
    pruneContinuousPages();
  } finally {
    scrollTrackingSuppressionDepth = Math.max(0, scrollTrackingSuppressionDepth - 1);
  }
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

  await renderContinuousPage(targetPage, renderToken, { force: true });
  await waitForNextFrame();
  pruneContinuousPages();

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

function scheduleContinuousScrollUpdate() {
  if (isScrollTrackingSuppressed() || continuousScrollFrame) {
    return;
  }

  continuousScrollFrame = window.requestAnimationFrame(() => {
    continuousScrollFrame = 0;
    updateCurrentPageFromScroll();
  });
}

async function renderInitialPdfView(openToken, options = {}) {
  const rendered = await renderCurrentView(state.page, {
    behavior: "auto",
    commitProgress: options.commitProgress !== false,
    restoreScroll: true,
    throwOnError: true,
  });

  if (rendered === true) {
    return true;
  }

  if (!isDocumentOpenCurrent(openToken)) {
    return false;
  }

  throw new Error(`Initial PDF page ${state.page} did not render.`);
}

async function renderInitialPdfViewWithFallback(openToken, options = {}) {
  try {
    return await renderInitialPdfView(openToken, options);
  } catch (error) {
    if (!isDocumentOpenCurrent(openToken)) {
      return false;
    }

    const canFallback =
      options.fallbackToFirstPageOnRenderError === true &&
      (state.page !== 1 || state.scrollPage !== 1 || state.mode !== READ_MODES.PAGED);

    if (!canFallback) {
      recordDiagnosticEvent("pdf-initial-render-error", {
        documentId: state.documentId,
        error: summarizeError(error),
        mode: state.mode,
        page: state.page,
        scrollPage: state.scrollPage,
      });
      throw error;
    }

    console.warn("Initial PDF render failed; retrying from page 1.", error);
    recordDiagnosticEvent("pdf-initial-render-fallback", {
      documentId: state.documentId,
      error: summarizeError(error),
      mode: state.mode,
      page: state.page,
      scrollPage: state.scrollPage,
    });
    state.mode = READ_MODES.PAGED;
    state.page = 1;
    state.scrollPage = 1;
    state.scrollOffsetRatio = 0;
    state.scrollTop = 0;
    updateControls();
    showStatus("恢复上次位置失败，正在从第一页打开 PDF...", true);

    const fallbackRendered = await renderCurrentView(1, {
      behavior: "auto",
      commitProgress: options.commitProgress !== false,
      restoreScroll: false,
      throwOnError: true,
    });

    if (fallbackRendered !== true) {
      throw new Error("Fallback PDF page 1 did not render.");
    }

    return true;
  }
}

function createDeferredPdfScrollRestoreState() {
  if (state.format !== DOCUMENT_FORMATS.PDF || state.mode !== READ_MODES.SCROLL) {
    return null;
  }

  return {
    page: state.page,
    scrollOffsetRatio: state.scrollOffsetRatio,
    scrollPage: state.scrollPage || state.page,
    scrollTop: state.scrollTop,
    zoom: state.zoom,
  };
}

function preparePagedPdfOpenForDeferredScrollRestore(restoreState) {
  if (!restoreState) {
    return;
  }

  const targetPage = clamp(
    Math.round(restoreState.scrollPage || restoreState.page || 1),
    1,
    Number.MAX_SAFE_INTEGER,
  );

  state.mode = READ_MODES.PAGED;
  state.page = targetPage;
  state.scrollPage = targetPage;
  state.scrollOffsetRatio = 0;
  state.scrollTop = 0;
}

function scheduleDeferredPdfScrollRestore(documentId, openToken, restoreState) {
  if (!restoreState) {
    return;
  }

  window.setTimeout(() => {
    restoreDeferredPdfScrollMode(documentId, openToken, restoreState).catch((error) => {
      console.error(error);
    });
  }, 0);
}

async function restoreDeferredPdfScrollMode(documentId, openToken, restoreState) {
  if (!restoreState || !isDocumentOpenCurrent(openToken) || state.documentId !== documentId || !pdfDoc) {
    clearDeferredPdfProgressSaveGuard(documentId, openToken);
    return;
  }

  const targetPage = clamp(
    Math.round(restoreState.scrollPage || restoreState.page || state.page || 1),
    1,
    pdfDoc.numPages,
  );
  const fallbackPage = clamp(Math.round(state.page || targetPage), 1, pdfDoc.numPages);
  continuousPinnedPages.add(targetPage);

  recordDiagnosticEvent("pdf-deferred-scroll-restore-start", {
    documentId,
    page: restoreState.page,
    scrollPage: restoreState.scrollPage,
    targetPage,
  });

  try {
    state.mode = READ_MODES.SCROLL;
    state.page = targetPage;
    state.scrollPage = targetPage;
    state.scrollOffsetRatio = Number.isFinite(restoreState.scrollOffsetRatio)
      ? restoreState.scrollOffsetRatio
      : 0;
    state.scrollTop = Number.isFinite(restoreState.scrollTop) ? restoreState.scrollTop : 0;
    state.zoom = clamp(restoreState.zoom || state.zoom || 1, 0.6, 2.6);
    updateViewerMode();
    updateControls();

    const rendered = await renderContinuousDocument(targetPage, {
      behavior: "auto",
      commitProgress: false,
      restoreScroll: true,
      suppressFailureStatus: true,
      throwOnError: false,
    });

    if (!isDocumentOpenCurrent(openToken) || state.documentId !== documentId) {
      clearDeferredPdfProgressSaveGuard(documentId, openToken);
      return;
    }

    if (rendered !== true) {
      throw new Error(`Deferred continuous PDF page ${targetPage} did not render.`);
    }

    const targetRendered = await waitForDeferredContinuousTargetRender(documentId, openToken, targetPage);
    if (!isDocumentOpenCurrent(openToken) || state.documentId !== documentId) {
      clearDeferredPdfProgressSaveGuard(documentId, openToken);
      return;
    }

    if (targetRendered !== true) {
      throw new Error(`Deferred continuous PDF page ${targetPage} did not finish rendering.`);
    }

    captureContinuousScrollPosition();
    clearDeferredPdfProgressSaveGuard(documentId, openToken);
    saveReaderState();
    recordDiagnosticEvent("pdf-deferred-scroll-restore-success", {
      documentId,
      targetRendered,
      targetPage,
    });
  } catch (error) {
    if (!isDocumentOpenCurrent(openToken) || state.documentId !== documentId || !pdfDoc) {
      clearDeferredPdfProgressSaveGuard(documentId, openToken);
      return;
    }

    console.warn("Deferred PDF scroll-mode restore failed; keeping paged mode.", error);
    recordDiagnosticEvent("pdf-deferred-scroll-restore-error", {
      documentId,
      error: summarizeError(error),
      targetPage,
    });

    state.mode = READ_MODES.PAGED;
    state.page = fallbackPage;
    state.scrollPage = fallbackPage;
    state.scrollOffsetRatio = 0;
    state.scrollTop = 0;
    updateViewerMode();
    updateControls();

    await renderPage(fallbackPage, { commitProgress: false }).catch((renderError) => {
      console.error(renderError);
    });
    window.clearTimeout(scrollStateTimer);
    scrollStateTimer = null;
    saveReaderState({ commitProgress: false });
    clearDeferredPdfProgressSaveGuard(documentId, openToken);
    showDiagnosticFailureStatus("已用分页模式打开，连续滚动恢复失败。", {
      documentId,
      error: summarizeError(error),
      page: targetPage,
      phase: "deferred-scroll-restore-error",
    });
  } finally {
    continuousPinnedPages.delete(targetPage);
  }
}

async function waitForDeferredContinuousTargetRender(documentId, openToken, targetPage) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isDocumentOpenCurrent(openToken) || state.documentId !== documentId || !pdfDoc || !isScrollMode()) {
      return false;
    }

    const shell = getContinuousShellByPageNumber(targetPage);

    if (shell?.dataset.rendered === "true") {
      return true;
    }

    if (
      shell &&
      shell.dataset.rendering !== "true" &&
      !pendingContinuousPages.has(targetPage) &&
      !continuousRenderPromises.has(targetPage) &&
      !pageRenderTasks.has(targetPage)
    ) {
      scheduleContinuousPageRender(targetPage, renderToken);
    }

    await wait(120);
  }

  return false;
}

async function renderContinuousDocument(pageNumber = state.page, options = {}) {
  if (!pdfDoc) {
    return false;
  }

  const token = ++renderToken;
  const documentToken = documentOpenToken;
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
  recordDiagnosticEvent("render-continuous-start", {
    options,
    pageNumber,
    shouldRestoreScroll,
    targetPage,
  });
  state.page = targetPage;
  updateViewerMode();
  updateControls();
  showStatus("正在准备连续滚动...", true);

  try {
    await cancelCurrentRender();
    releasePagedCanvasBitmap();
    clearContinuousPages();

    const estimatedSize = await estimateContinuousPageSize();

    if (token !== renderToken || documentToken !== documentOpenToken || !pdfDoc) {
      return false;
    }

    lastLayoutWidth = getAvailableCanvasWidth();
    buildContinuousPlaceholders(estimatedSize, targetPage);
    setupContinuousObserver(token);

    if (shouldRestoreScroll) {
      restoreContinuousScrollPosition({ behavior: "auto" });
    } else {
      await scrollToContinuousPage(targetPage, {
        behavior: options.behavior || "auto",
        renderFirst: false,
      });
    }

    if (!shouldRestoreScroll) {
      releaseScrollTracking();
    }
    const scrollTopAfterInitialPosition = els.canvasWrap.scrollTop;
    let renderedTargetPage = await renderContinuousPage(targetPage, token, {
      force: true,
      throwOnError: options.throwOnError,
    });

    if (options.throwOnError && renderedTargetPage !== true) {
      renderedTargetPage = await retryInitialContinuousTargetRender(targetPage, token, documentToken, {
        throwOnError: options.throwOnError,
      });
    }

    if (options.throwOnError && renderedTargetPage !== true) {
      throw new Error(`Continuous PDF page ${targetPage} did not render during initial open.`);
    }

    if (token !== renderToken || documentToken !== documentOpenToken) {
      return false;
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

    if (shouldRestoreScroll) {
      await waitForNextFrame();
      await waitForNextFrame();
    }

    if (shouldPrefetchContinuousNeighborPages()) {
      scheduleContinuousPageRender(targetPage - 1, token);
      scheduleContinuousPageRender(targetPage + 1, token);
    }
    queueVisibleContinuousPages(token);
    pruneContinuousPages();
    releaseScrollTracking();
    saveReaderState({
      commitProgress: options.commitProgress !== false,
    });
    hideStatus();
    recordDiagnosticEvent("render-continuous-success", {
      page: targetPage,
      renderedTargetPage,
    });
    return true;
  } catch (error) {
    if (documentToken !== documentOpenToken) {
      return false;
    }

    if (error?.name === "RenderingCancelledException") {
      return false;
    }

    if (options.throwOnError) {
      throw error;
    }
    if (!options.suppressFailureStatus) {
      recordDiagnosticEvent("pdf-continuous-render-error", {
        documentId: state.documentId,
        error: summarizeError(error),
        page: targetPage,
      });
      console.error(error);
      showDiagnosticFailureStatus("连续滚动模式准备失败。", {
        documentId: state.documentId,
        error: summarizeError(error),
        page: targetPage,
        phase: "render-continuous-error",
      });
    }
    return false;
  } finally {
    releaseScrollTracking();

    if (token === renderToken) {
      updateControls();
    }
  }
}

async function renderCurrentView(pageNumber = state.page, options = {}) {
  if (isScrollMode()) {
    return renderContinuousDocument(pageNumber, options);
  } else {
    return renderPage(pageNumber, options);
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
  recordDiagnosticEvent("go-to-page", {
    mode: state.mode,
    requestedPage: pageNumber,
    targetPage,
  });

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
    recordDiagnosticEvent("set-read-mode-same", {
      mode,
    });
    return;
  }

  recordDiagnosticEvent("set-read-mode", {
    from: state.mode,
    page: state.page,
    to: mode,
  });
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

  if (
    continuousProgrammaticScrollTarget &&
    Date.now() < continuousProgrammaticScrollUntil
  ) {
    const marker = els.canvasWrap.scrollTop + els.canvasWrap.clientHeight * 0.35;
    const markerPage = getContinuousPageNumberAtOffset(marker);

    if (Math.abs(markerPage - continuousProgrammaticScrollTarget) > 1) {
      return;
    }

    continuousProgrammaticScrollTarget = 0;
    continuousProgrammaticScrollUntil = 0;
  } else if (continuousProgrammaticScrollTarget) {
    continuousProgrammaticScrollTarget = 0;
    continuousProgrammaticScrollUntil = 0;
  }

  if (isLikelyTransientTopJump()) {
    restoreContinuousScrollPosition({
      behavior: "auto",
      onlyIfNearTop: true,
    });
    return;
  }

  const marker = els.canvasWrap.scrollTop + els.canvasWrap.clientHeight * 0.35;
  const currentPage = getContinuousPageNumberAtOffset(marker) || state.page;
  ensureContinuousDomWindow(currentPage);
  const positionChanged = captureContinuousScrollPosition();

  const pageChanged = currentPage !== state.page;

  if (pageChanged) {
    state.page = currentPage;
  }

  if (positionChanged || pageChanged) {
    updateControls();
  }

  queueVisibleContinuousPages(renderToken);
  pruneContinuousPages();

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

function isReplaceableEpubResource(value) {
  if (!value) {
    return false;
  }

  return !/^(?:blob:|data:|https?:|file:|about:|#)/i.test(value);
}

function getEpubSectionDirectory(section) {
  const url = section?.url || section?.href || "";
  const withoutHash = url.split("#")[0].split("?")[0];
  const index = withoutHash.lastIndexOf("/");

  return index >= 0 ? withoutHash.slice(0, index + 1) : "/";
}

function normalizeEpubArchivePath(path) {
  if (!path) {
    return "";
  }

  const cleanPath = path.split("#")[0].split("?")[0];
  const parts = [];

  for (const part of cleanPath.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return `/${parts.join("/")}`;
}

function resolveEpubResourcePath(value, section) {
  if (!value || /^(?:blob:|data:|https?:|file:|about:)/i.test(value)) {
    return "";
  }

  const decodedValue = window.decodeURIComponent(value.trim());

  if (decodedValue.startsWith("/")) {
    return normalizeEpubArchivePath(decodedValue);
  }

  return normalizeEpubArchivePath(`${getEpubSectionDirectory(section)}${decodedValue}`);
}

async function createEpubResourceUrl(value, section) {
  if (!epubBook?.archive || !isReplaceableEpubResource(value)) {
    return "";
  }

  const primaryPath = resolveEpubResourcePath(value, section);
  const candidates = [
    primaryPath,
    epubBook.resolve?.(value),
    normalizeEpubArchivePath(value),
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];

  for (const candidate of uniqueCandidates) {
    try {
      return await epubBook.archive.createUrl(candidate);
    } catch {
      // Try the next candidate; some EPUBs mix section-relative and package-relative paths.
    }
  }

  return "";
}

async function replaceEpubElementUrl(element, attributeName, section) {
  const value = element.getAttribute(attributeName);

  if (!isReplaceableEpubResource(value)) {
    return false;
  }

  const replacementUrl = await createEpubResourceUrl(value, section);

  if (!replacementUrl) {
    return false;
  }

  element.setAttribute(attributeName, replacementUrl);
  return true;
}

async function replaceEpubElementSrcset(element, attributeName, section) {
  const value = element.getAttribute(attributeName);

  if (!value) {
    return false;
  }

  const candidates = await Promise.all(
    String(value)
      .split(",")
      .map(async (candidate) => {
        const parts = candidate.trim().split(/\s+/).filter(Boolean);
        const source = parts.shift();

        if (!source || !isReplaceableEpubResource(source)) {
          return candidate.trim();
        }

        const replacementUrl = await createEpubResourceUrl(source, section);
        return replacementUrl ? [replacementUrl, ...parts].join(" ") : candidate.trim();
      }),
  );
  const nextValue = candidates.filter(Boolean).join(", ");

  if (!nextValue || nextValue === value) {
    return false;
  }

  element.setAttribute(attributeName, nextValue);
  return true;
}

function parsePositiveLength(value) {
  const match = String(value || "").match(/[\d.]+/);
  const number = match ? Number.parseFloat(match[0]) : 0;
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function getSvgImageHref(element) {
  return (
    element.getAttribute("href") ||
    element.getAttribute("xlink:href") ||
    element.getAttributeNS?.("http://www.w3.org/1999/xlink", "href") ||
    ""
  );
}

function getEpubImageSource(element) {
  if (!element) {
    return "";
  }

  if (element.getAttribute?.("data-portable-reader-generated-image") === "true") {
    return element.getAttribute("data-portable-reader-image-src") || element.getAttribute("src") || "";
  }

  if (element.tagName?.toLowerCase() === "image") {
    return getSvgImageHref(element);
  }

  return (
    element.currentSrc ||
    element.src ||
    element.getAttribute("src") ||
    getFirstSrcsetCandidate(element.getAttribute("srcset")) ||
    getFirstSrcsetCandidate(element.closest?.("picture")?.querySelector("source")?.getAttribute("srcset")) ||
    ""
  );
}

function getEpubImageAlt(element) {
  return (
    element?.getAttribute?.("alt") ||
    element?.getAttribute?.("title") ||
    element?.ownerSVGElement?.getAttribute?.("aria-label") ||
    "EPUB 图片"
  );
}

function isPreviewableImageSource(source) {
  return Boolean(source && !source.startsWith("#") && !isReplaceableEpubResource(source));
}

function getFirstSrcsetCandidate(value) {
  const firstCandidate = String(value || "")
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .find(Boolean);

  return firstCandidate || "";
}

async function resolveEpubImageSource(value, section) {
  if (!value || value.startsWith("#")) {
    return "";
  }

  if (isPreviewableImageSource(value)) {
    return value;
  }

  if (isReplaceableEpubResource(value)) {
    return createEpubResourceUrl(value, section);
  }

  return "";
}

function openBoundEpubImage(event) {
  event.preventDefault();
  event.stopPropagation();

  const target = event.currentTarget;
  openImagePreview(
    target.getAttribute("data-portable-reader-image-src"),
    target.getAttribute("data-portable-reader-image-alt") || "EPUB 图片",
  );
}

function handleBoundEpubImageKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  openBoundEpubImage(event);
}

function bindEpubImagePreview(element, source, alt) {
  const host = element?.ownerSVGElement || element;

  if (!host || !isPreviewableImageSource(source)) {
    return false;
  }

  host.setAttribute("data-portable-reader-image", "true");
  host.setAttribute("data-portable-reader-image-src", source);
  host.setAttribute("data-portable-reader-image-alt", alt || "EPUB 图片");
  host.setAttribute("role", "button");
  host.setAttribute("tabindex", "0");
  host.setAttribute("aria-label", "查看图片");
  host.style?.setProperty("cursor", "zoom-in", "important");

  if (host.getAttribute("data-portable-reader-image-bound") === "true") {
    return true;
  }

  host.setAttribute("data-portable-reader-image-bound", "true");
  host.addEventListener("click", openBoundEpubImage);
  host.addEventListener("keydown", handleBoundEpubImageKeydown);
  return true;
}

function findEpubPreviewTarget(target, documentElement) {
  let current = target;

  while (current && current !== documentElement.body && current !== documentElement.documentElement) {
    const tagName = current.tagName?.toLowerCase();

    if (tagName === "img" || tagName === "image" || current.dataset?.portableReaderImage === "true") {
      return current;
    }

    current = current.parentElement || current.ownerSVGElement;
  }

  return null;
}

function getBoundEpubImageSource(element) {
  if (!element) {
    return "";
  }

  if (element.getAttribute?.("data-portable-reader-image-src")) {
    return element.getAttribute("data-portable-reader-image-src");
  }

  if (element.tagName?.toLowerCase() === "svg") {
    return getEpubImageSource(element.querySelector("image"));
  }

  return getEpubImageSource(element);
}

function bindEpubDocumentPreviewHandler(documentElement) {
  if (!documentElement || documentElement.body?.dataset.portableReaderPreviewBound === "true") {
    return;
  }

  documentElement.body.dataset.portableReaderPreviewBound = "true";
  documentElement.addEventListener(
    "click",
    (event) => {
      const target = findEpubPreviewTarget(event.target, documentElement);

      if (!target) {
        return;
      }

      const source = getBoundEpubImageSource(target);

      if (!isPreviewableImageSource(source)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openImagePreview(source, target.getAttribute?.("data-portable-reader-image-alt") || "EPUB 图片");
    },
    true,
  );
}

function ensureEpubImageStyles(documentElement) {
  if (!documentElement || documentElement.getElementById("portable-reader-image-styles")) {
    return;
  }

  const style = documentElement.createElement("style");
  style.id = "portable-reader-image-styles";
  style.textContent = `
    html,
    body {
      max-width: none !important;
      overflow-x: hidden !important;
    }

    img[data-portable-reader-image],
    svg[data-portable-reader-image],
    img[data-portable-reader-generated-image] {
      cursor: zoom-in !important;
      -webkit-tap-highlight-color: rgba(8, 127, 111, 0.18);
    }

    img[data-portable-reader-image],
    svg[data-portable-reader-image],
    img[data-portable-reader-generated-image] {
      box-sizing: border-box !important;
      display: block !important;
      height: auto !important;
      left: 50% !important;
      margin: 1.15rem 0 1.55rem !important;
      max-height: none !important;
      max-width: none !important;
      min-width: min(72vw, 300px) !important;
      object-fit: contain !important;
      position: relative !important;
      transform: translateX(-50%) !important;
      width: min(calc(100vw - 24px), 760px) !important;
    }

    figure[data-portable-reader-generated-block] {
      box-sizing: border-box !important;
      display: block !important;
      left: 50% !important;
      margin: 1.15rem 0 1.55rem !important;
      max-width: none !important;
      min-width: min(72vw, 300px) !important;
      padding: 0 !important;
      position: relative !important;
      text-align: center !important;
      transform: translateX(-50%) !important;
      width: min(calc(100vw - 24px), 760px) !important;
    }

    figure[data-portable-reader-generated-block] > img {
      left: auto !important;
      margin: 0 auto !important;
      max-height: none !important;
      max-width: none !important;
      position: static !important;
      transform: none !important;
      width: 100% !important;
    }

    [data-portable-reader-original-hidden] {
      display: none !important;
    }

    [data-portable-reader-media-block] {
      display: block !important;
      left: auto !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      min-width: 0 !important;
      max-width: none !important;
      overflow: visible !important;
      text-align: center !important;
      transform: none !important;
      width: 100% !important;
    }
  `;
  (documentElement.head || documentElement.documentElement).appendChild(style);
}

function getEpubDocumentWidth(documentElement, element) {
  const view = documentElement?.defaultView;
  const frame = view?.frameElement;
  const body = documentElement?.body;
  const root = documentElement?.documentElement;
  const candidates = [
    view?.innerWidth,
    frame?.getBoundingClientRect?.().width,
    frame?.clientWidth,
    els.epubViewer?.clientWidth,
    root?.clientWidth,
    body?.clientWidth,
    body?.getBoundingClientRect?.().width,
    element?.closest?.("[data-portable-reader-media-block]")?.clientWidth,
    element?.parentElement?.clientWidth,
  ];

  return candidates.reduce((max, value) => {
    const width = Number.parseFloat(value);
    return Number.isFinite(width) && width > max ? width : max;
  }, 0);
}

function isTinyEpubImage(width, height) {
  const largestSide = Math.max(width || 0, height || 0);
  return Boolean(largestSide && largestSide <= 36);
}

function getElementMeasuredSize(element) {
  const rect = element?.getBoundingClientRect?.();

  return {
    height: rect?.height || parsePositiveLength(element?.getAttribute?.("height")),
    width: rect?.width || parsePositiveLength(element?.getAttribute?.("width")),
  };
}

function getEpubNonMediaText(element) {
  if (!element) {
    return "";
  }

  return Array.from(element.childNodes, (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tagName = node.tagName?.toLowerCase();

    if (
      tagName === "img" ||
      tagName === "image" ||
      tagName === "picture" ||
      tagName === "source" ||
      tagName === "svg" ||
      tagName === "br" ||
      tagName === "wbr" ||
      node.getAttribute?.("data-portable-reader-generated-block") === "true"
    ) {
      return "";
    }

    return node.textContent || "";
  })
    .join("")
    .replace(/\s+/g, "");
}

function getEpubImageTargetMetrics(documentElement, element) {
  const pageWidth = getEpubDocumentWidth(documentElement, element);
  const readableWidth = pageWidth || 360;
  const gutter = readableWidth < 420 ? 24 : 40;
  const maxWidth = Math.max(220, Math.min(readableWidth - gutter, 760));
  const targetWidth = maxWidth;
  const minWidth = Math.min(Math.max(readableWidth * 0.72, 240), targetWidth);

  return {
    minWidth,
    targetWidth,
  };
}

function widenEpubImageAncestors(element, documentElement) {
  let current = element?.parentElement || element?.ownerSVGElement?.parentElement;
  let depth = 0;

  while (current && current !== documentElement.body && depth < 6) {
    const nonMediaText = getEpubNonMediaText(current);
    const mediaCount = current.querySelectorAll("img,image,svg").length;
    const hasOnlyMedia = mediaCount > 0 && !nonMediaText;

    if (hasOnlyMedia) {
      current.setAttribute("data-portable-reader-media-block", "true");
      current.style.setProperty("display", "block", "important");
      current.style.setProperty("width", "100%", "important");
      current.style.setProperty("min-width", "0", "important");
      current.style.setProperty("max-width", "none", "important");
      current.style.setProperty("overflow", "visible", "important");
      current.style.setProperty("text-align", "center", "important");
      current.style.setProperty("margin-left", "0", "important");
      current.style.setProperty("margin-right", "0", "important");
    }

    current = current.parentElement;
    depth += 1;
  }
}

function applyExpandedEpubImageStyle(element, documentElement) {
  const { minWidth, targetWidth } = getEpubImageTargetMetrics(documentElement, element);

  element.setAttribute("data-portable-reader-image", "true");
  widenEpubImageAncestors(element, documentElement);
  element.style.setProperty("display", "block", "important");
  element.style.setProperty("box-sizing", "border-box", "important");
  element.style.setProperty("width", `${Math.round(targetWidth)}px`, "important");
  element.style.setProperty("min-width", `${Math.round(minWidth)}px`, "important");
  element.style.setProperty("max-width", "none", "important");
  element.style.setProperty("max-height", "none", "important");
  element.style.setProperty("height", "auto", "important");
  element.style.setProperty("object-fit", "contain", "important");
  element.style.setProperty("position", "relative", "important");
  element.style.setProperty("left", "50%", "important");
  element.style.setProperty("transform", "translateX(-50%)", "important");
  element.style.setProperty("margin", "1.15rem 0 1.55rem", "important");
}

function getEpubImageDisplayElement(element) {
  if (!element) {
    return null;
  }

  if (element.tagName?.toLowerCase() === "image") {
    return element.ownerSVGElement || null;
  }

  return element.closest?.("picture") || element;
}

function getExistingGeneratedImageBlock(displayElement) {
  const next = displayElement?.nextElementSibling;

  if (next?.getAttribute?.("data-portable-reader-generated-block") === "true") {
    return next;
  }

  return null;
}

function isEpubMediaOnlyContainer(element, documentElement) {
  if (!element || element === documentElement.body || element === documentElement.documentElement) {
    return false;
  }

  const nonMediaText = getEpubNonMediaText(element);
  const mediaCount = element.querySelectorAll("img,picture,image,svg").length;

  return mediaCount > 0 && !nonMediaText;
}

function getEpubImageHostElement(displayElement, documentElement) {
  let host = displayElement;
  let current = displayElement?.parentElement;
  let depth = 0;

  while (current && depth < 6) {
    if (!isEpubMediaOnlyContainer(current, documentElement)) {
      break;
    }

    host = current;
    current = current.parentElement;
    depth += 1;
  }

  return host;
}

function getEpubImagePlacementElement(hiddenElement, documentElement) {
  const body = documentElement?.body;
  let placement = hiddenElement;
  let current = hiddenElement?.parentElement;
  let depth = 0;

  while (current && current !== body && depth < 8) {
    const currentWidth = getElementMeasuredSize(current).width;
    const pageWidth = getEpubDocumentWidth(documentElement, current);
    const isNarrowWrapper = Boolean(currentWidth && pageWidth && currentWidth < pageWidth * 0.62);

    if (!isEpubMediaOnlyContainer(current, documentElement) && !isNarrowWrapper) {
      break;
    }

    placement = current;
    current = current.parentElement;
    depth += 1;
  }

  return placement || hiddenElement;
}

function hideOriginalEpubImageElement(element) {
  if (!element) {
    return;
  }

  element.setAttribute("data-portable-reader-original-hidden", "true");
  element.setAttribute("aria-hidden", "true");
  element.style.setProperty("display", "none", "important");
}

function isHiddenOriginalEpubImage(element) {
  return element?.getAttribute?.("data-portable-reader-original-hidden") === "true";
}

function applyGeneratedImageBlockStyle(block, image, documentElement) {
  const { minWidth, targetWidth } = getEpubImageTargetMetrics(documentElement, image);

  block.style.setProperty("box-sizing", "border-box", "important");
  block.style.setProperty("display", "block", "important");
  block.style.setProperty("width", `${Math.round(targetWidth)}px`, "important");
  block.style.setProperty("min-width", `${Math.round(minWidth)}px`, "important");
  block.style.setProperty("max-width", "none", "important");
  block.style.setProperty("position", "relative", "important");
  block.style.setProperty("left", "50%", "important");
  block.style.setProperty("transform", "translateX(-50%)", "important");
  block.style.setProperty("margin", "1.15rem 0 1.55rem", "important");
  block.style.setProperty("padding", "0", "important");
  block.style.setProperty("text-align", "center", "important");

  image.style.setProperty("box-sizing", "border-box", "important");
  image.style.setProperty("display", "block", "important");
  image.style.setProperty("width", "100%", "important");
  image.style.setProperty("min-width", "0", "important");
  image.style.setProperty("max-width", "none", "important");
  image.style.setProperty("max-height", "none", "important");
  image.style.setProperty("height", "auto", "important");
  image.style.setProperty("object-fit", "contain", "important");
  image.style.setProperty("position", "static", "important");
  image.style.setProperty("left", "auto", "important");
  image.style.setProperty("transform", "none", "important");
  image.style.setProperty("margin", "0 auto", "important");
}

function shouldGenerateLargeImage(element) {
  const naturalWidth = element.naturalWidth || parsePositiveLength(element.getAttribute?.("width"));
  const naturalHeight = element.naturalHeight || parsePositiveLength(element.getAttribute?.("height"));
  const measured = getElementMeasuredSize(element);

  if (isTinyEpubImage(naturalWidth || measured.width, naturalHeight || measured.height)) {
    return false;
  }

  return true;
}

function createGeneratedEpubImageBlock(element, source, documentElement, alt = "") {
  const displayElement = getEpubImageDisplayElement(element);

  if (!displayElement || !source || displayElement.getAttribute?.("data-portable-reader-generated-image") === "true") {
    return false;
  }

  const hostElement = getEpubImageHostElement(displayElement, documentElement);
  const placementElement = getEpubImagePlacementElement(hostElement, documentElement);
  let block = getExistingGeneratedImageBlock(placementElement);
  let image = block?.querySelector?.("img[data-portable-reader-generated-image]");

  if (!block) {
    block = documentElement.createElement("figure");
    block.setAttribute("data-portable-reader-generated-block", "true");
    image = documentElement.createElement("img");
    image.setAttribute("data-portable-reader-generated-image", "true");
    image.decoding = "async";
    image.loading = "eager";
    block.append(image);
    placementElement.after(block);
  }

  image.src = source;
  image.alt = alt || "EPUB 图片";
  image.setAttribute("data-portable-reader-image", "true");
  image.setAttribute("data-portable-reader-image-src", source);
  image.setAttribute("data-portable-reader-image-alt", image.alt);
  bindEpubImagePreview(image, source, image.alt);
  applyGeneratedImageBlockStyle(block, image, documentElement);
  block.setAttribute("data-portable-reader-image-src", source);
  block.setAttribute("data-portable-reader-image-alt", image.alt);
  bindEpubImagePreview(block, source, image.alt);

  hideOriginalEpubImageElement(displayElement);
  hideOriginalEpubImageElement(hostElement);

  return true;
}

function waitForImageReady(image) {
  if (!image || image.complete) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      image.removeEventListener("load", done);
      image.removeEventListener("error", done);
      resolve();
    };

    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
    window.setTimeout(done, 900);
  });
}

async function resizeEpubImage(image, documentElement) {
  await waitForImageReady(image);

  const naturalWidth = image.naturalWidth || parsePositiveLength(image.getAttribute("width"));
  const naturalHeight = image.naturalHeight || parsePositiveLength(image.getAttribute("height"));

  if (isTinyEpubImage(naturalWidth, naturalHeight)) {
    return false;
  }

  image.removeAttribute("width");
  image.removeAttribute("height");
  applyExpandedEpubImageStyle(image, documentElement);
  return true;
}

function resizeEpubSvgImage(image, documentElement) {
  const svg = image.ownerSVGElement;

  if (!svg) {
    return false;
  }

  const width =
    parsePositiveLength(image.getAttribute("width")) ||
    parsePositiveLength(svg.getAttribute("width")) ||
    svg.viewBox?.baseVal?.width ||
    0;
  const height =
    parsePositiveLength(image.getAttribute("height")) ||
    parsePositiveLength(svg.getAttribute("height")) ||
    svg.viewBox?.baseVal?.height ||
    0;

  if (isTinyEpubImage(width, height)) {
    return false;
  }

  if (!svg.getAttribute("viewBox") && width && height) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  svg.removeAttribute("width");
  svg.removeAttribute("height");
  applyExpandedEpubImageStyle(svg, documentElement);
  return true;
}

function markEpubImagesForExpansion(documentElement) {
  if (!documentElement) {
    return false;
  }

  ensureEpubImageStyles(documentElement);

  let changed = false;

  for (const image of documentElement.querySelectorAll("img:not([data-portable-reader-generated-image])")) {
    if (isHiddenOriginalEpubImage(image) || isHiddenOriginalEpubImage(image.closest?.("[data-portable-reader-original-hidden]"))) {
      continue;
    }

    if (image.getAttribute("data-portable-reader-image") !== "true") {
      image.setAttribute("data-portable-reader-image", "true");
      changed = true;
    }

    widenEpubImageAncestors(image, documentElement);
  }

  for (const image of documentElement.querySelectorAll("image")) {
    const svg = image.ownerSVGElement;

    if (!svg) {
      continue;
    }

    if (isHiddenOriginalEpubImage(svg) || isHiddenOriginalEpubImage(svg.closest?.("[data-portable-reader-original-hidden]"))) {
      continue;
    }

    if (svg.getAttribute("data-portable-reader-image") !== "true") {
      svg.setAttribute("data-portable-reader-image", "true");
      changed = true;
    }

    widenEpubImageAncestors(svg, documentElement);
  }

  return changed;
}

async function generateEpubLargeImageBlocks(section, documentElement) {
  if (!documentElement) {
    return false;
  }

  let changed = false;
  const images = Array.from(documentElement.querySelectorAll("img:not([data-portable-reader-generated-image])"));
  const svgImages = Array.from(documentElement.querySelectorAll("image"));

  for (const image of images) {
    if (isHiddenOriginalEpubImage(image) || isHiddenOriginalEpubImage(image.closest?.("[data-portable-reader-original-hidden]"))) {
      continue;
    }

    if (!shouldGenerateLargeImage(image)) {
      continue;
    }

    const source = await resolveEpubImageSource(getEpubImageSource(image), section);

    if (source) {
      changed = createGeneratedEpubImageBlock(image, source, documentElement, getEpubImageAlt(image)) || changed;
    }
  }

  for (const image of svgImages) {
    const svg = image.ownerSVGElement;

    if (!svg || !shouldGenerateLargeImage(svg)) {
      continue;
    }

    if (isHiddenOriginalEpubImage(svg) || isHiddenOriginalEpubImage(svg.closest?.("[data-portable-reader-original-hidden]"))) {
      continue;
    }

    const source = await resolveEpubImageSource(getEpubImageSource(image), section);

    if (source) {
      changed = createGeneratedEpubImageBlock(image, source, documentElement, getEpubImageAlt(image)) || changed;
    }
  }

  return changed;
}

function installEpubImageObserver(documentElement) {
  const body = documentElement?.body;
  const observerCtor = documentElement?.defaultView?.MutationObserver;

  if (!body || !observerCtor || body.dataset.portableReaderImageObserver === "true") {
    return;
  }

  body.dataset.portableReaderImageObserver = "true";

  const observer = new observerCtor(() => {
    markEpubImagesForExpansion(documentElement);
  });
  observer.observe(body, {
    childList: true,
    subtree: true,
  });
}

async function prepareEpubImage(image, documentElement) {
  if (
    image.getAttribute("data-portable-reader-generated-image") === "true" ||
    isHiddenOriginalEpubImage(image) ||
    isHiddenOriginalEpubImage(image.closest?.("[data-portable-reader-original-hidden]"))
  ) {
    return false;
  }

  const source = getEpubImageSource(image);
  bindEpubImagePreview(image, source, getEpubImageAlt(image));
  return resizeEpubImage(image, documentElement);
}

function prepareEpubSvgImage(image, documentElement) {
  const svg = image.ownerSVGElement;

  if (isHiddenOriginalEpubImage(svg) || isHiddenOriginalEpubImage(svg?.closest?.("[data-portable-reader-original-hidden]"))) {
    return false;
  }

  const source = getEpubImageSource(image);
  bindEpubImagePreview(image, source, getEpubImageAlt(image));
  return resizeEpubSvgImage(image, documentElement);
}

async function fixEpubImages(section, view) {
  const documentElement = view?.document || view?.iframe?.contentDocument;

  if (!documentElement) {
    return false;
  }

  const tasks = [];

  for (const image of documentElement.querySelectorAll("img")) {
    tasks.push(replaceEpubElementUrl(image, "src", section));
    tasks.push(replaceEpubElementSrcset(image, "srcset", section));
  }

  for (const source of documentElement.querySelectorAll("source")) {
    tasks.push(replaceEpubElementUrl(source, "src", section));
    tasks.push(replaceEpubElementSrcset(source, "srcset", section));
  }

  for (const image of documentElement.querySelectorAll("image")) {
    tasks.push(replaceEpubElementUrl(image, "href", section));
    tasks.push(replaceEpubElementUrl(image, "xlink:href", section));
  }

  await Promise.allSettled(tasks);
  ensureEpubImageStyles(documentElement);
  bindEpubDocumentPreviewHandler(documentElement);
  installEpubImageObserver(documentElement);
  installEpubGestureNavigation(documentElement);
  const generated = await generateEpubLargeImageBlocks(section, documentElement);
  markEpubImagesForExpansion(documentElement);

  const resized = await Promise.allSettled(
    [
      ...Array.from(documentElement.querySelectorAll("img:not([data-portable-reader-generated-image])"), (image) =>
        prepareEpubImage(image, documentElement),
      ),
      ...Array.from(documentElement.querySelectorAll("image"), (image) =>
        prepareEpubSvgImage(image, documentElement),
      ),
    ],
  );

  const changed = generated || resized.some((result) => result.status === "fulfilled" && result.value);

  if (changed) {
    view?.expand?.();
    epubRendition?.manager?.updateLayout?.();
  }

  return changed;
}

function trackEpubImageRepair(task) {
  const trackedTask = Promise.resolve(task).catch((error) => {
    console.warn(error);
  });

  epubImageRepairTasks.add(trackedTask);
  trackedTask.finally(() => {
    epubImageRepairTasks.delete(trackedTask);
  });
  return trackedTask;
}

async function waitForEpubImageRepairs(timeout = 1400) {
  const startedAt = Date.now();

  while (epubImageRepairTasks.size) {
    const remaining = timeout - (Date.now() - startedAt);

    if (remaining <= 0) {
      return;
    }

    const tasks = Array.from(epubImageRepairTasks);
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((resolve) => window.setTimeout(resolve, remaining)),
    ]);
  }
}

function isFullscreenEpubGestureEnabled() {
  return (
    appFullscreen &&
    isEpubDocument() &&
    Boolean(epubBook) &&
    Boolean(epubRendition) &&
    !epubNavigationInProgress &&
    els.lockOverlay.hidden &&
    els.libraryOverlay.hidden &&
    els.tocOverlay.hidden &&
    els.encryptionOverlay.hidden &&
    els.imageOverlay.hidden
  );
}

function isInteractiveEpubGestureTarget(target) {
  return Boolean(
    target?.closest?.(
      [
        "a",
        "button",
        "input",
        "textarea",
        "select",
        "img",
        "svg",
        "image",
        "[role='button']",
        "[contenteditable='true']",
        "[data-portable-reader-image]",
        "[data-portable-reader-generated-block]",
      ].join(","),
    ),
  );
}

function handleFullscreenEpubSwipe(start, end) {
  if (!isFullscreenEpubGestureEnabled()) {
    return false;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (
    Math.abs(dx) < FULLSCREEN_EPUB_SWIPE_DISTANCE ||
    Math.abs(dy) > FULLSCREEN_EPUB_SWIPE_MAX_DRIFT
  ) {
    return false;
  }

  navigateEpub(dx < 0 ? "next" : "prev").catch((error) => {
    console.error(error);
    showStatus("章节切换失败，请再滑一次。", true);
  });
  return true;
}

function installEpubGestureNavigation(documentElement) {
  const body = documentElement?.body;

  if (!documentElement || !body || body.dataset.portableReaderGestureNavigation === "true") {
    return;
  }

  body.dataset.portableReaderGestureNavigation = "true";
  let start = null;

  documentElement.addEventListener(
    "touchstart",
    (event) => {
      if (
        event.touches?.length !== 1 ||
        !isFullscreenEpubGestureEnabled() ||
        isInteractiveEpubGestureTarget(event.target)
      ) {
        start = null;
        return;
      }

      const touch = event.changedTouches?.[0];
      if (!touch) {
        start = null;
        return;
      }

      start = {
        x: touch.clientX,
        y: touch.clientY,
      };
    },
    { passive: true },
  );

  documentElement.addEventListener(
    "touchend",
    (event) => {
      if (!start) {
        return;
      }

      const touch = event.changedTouches?.[0];
      if (!touch) {
        start = null;
        return;
      }

      const currentStart = start;
      start = null;

      handleFullscreenEpubSwipe(currentStart, {
        x: touch.clientX,
        y: touch.clientY,
      });
    },
    { passive: true },
  );

  documentElement.addEventListener(
    "touchcancel",
    () => {
      start = null;
    },
    { passive: true },
  );
}

function installEpubContentImageHook() {
  epubRendition?.hooks?.content?.register?.((contents) => {
    const documentElement = contents?.document || contents?.content?.ownerDocument;

    if (!documentElement) {
      return;
    }

    ensureEpubImageStyles(documentElement);
    bindEpubDocumentPreviewHandler(documentElement);
    installEpubImageObserver(documentElement);
    installEpubGestureNavigation(documentElement);
    markEpubImagesForExpansion(documentElement);
  });
}

async function repairVisibleEpubImages(section = null, options = {}) {
  const attempts = options.attempts || 1;
  let changed = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const views = [];
    const sectionView = getEpubViewForSection(section);
    const primaryView = getPrimaryEpubView();

    if (sectionView) {
      views.push(sectionView);
    }

    if (primaryView && !views.includes(primaryView)) {
      views.push(primaryView);
    }

    for (const view of getEpubVisibleViews()) {
      if (view && !views.includes(view)) {
        views.push(view);
      }
    }

    for (const view of views) {
      changed = (await fixEpubImages(view.section || section, view)) || changed;
    }

    if (attempt < attempts - 1) {
      await waitForNextFrame();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
  }

  return changed;
}

function updateEpubLocation(location) {
  if (!location?.start) {
    return;
  }

  const total = getEpubChapterTotal();
  const locationIndex = location.start.index;
  const recentTargetActive =
    epubRecentTargetIndex !== null && Date.now() < epubRecentTargetUntil;

  if (
    (epubPendingTargetIndex !== null || recentTargetActive) &&
    Number.isFinite(locationIndex) &&
    locationIndex !== (epubPendingTargetIndex ?? epubRecentTargetIndex)
  ) {
    return;
  }

  if (epubRecentTargetIndex !== null && Date.now() >= epubRecentTargetUntil) {
    epubRecentTargetIndex = null;
    epubRecentTargetUntil = 0;
  }

  epubAtStart = Boolean(location.atStart);
  epubAtEnd = Boolean(location.atEnd);
  state.epubCfi = location.start.cfi || state.epubCfi;
  state.epubProgress = epubAtEnd ? 1 : estimateEpubProgress(location);
  state.page = Number.isFinite(locationIndex)
    ? clamp(locationIndex + 1, 1, total)
    : clamp(state.page || 1, 1, total);
  epubLastKnownIndex = clamp(state.page - 1, 0, total - 1);
  clearPendingEpubTarget(getEpubSectionAt(epubLastKnownIndex));
  updateControls();

  window.clearTimeout(scrollStateTimer);
  scrollStateTimer = window.setTimeout(saveReaderState, 300);
}

function createEpubRendition() {
  epubRendition = epubBook.renderTo(els.epubViewer, {
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
      "padding": "0 4%",
    },
    p: {
      "line-height": "1.72",
    },
    img: {
      "display": "block",
      "height": "auto",
      "margin": "1.15rem auto 1.55rem",
      "max-height": "none",
      "max-width": "none",
      "min-width": "min(72vw, 300px)",
      "object-fit": "contain",
      "width": "min(calc(100vw - 24px), 760px)",
    },
    svg: {
      "display": "block",
      "height": "auto",
      "margin": "1.15rem auto 1.55rem",
      "max-width": "none",
      "min-width": "min(72vw, 300px)",
      "width": "min(calc(100vw - 24px), 760px)",
    },
  });

  installEpubContentImageHook();
  epubRendition.on("relocated", updateEpubLocation);
  epubRendition.on("rendered", (section, view) => {
    trackEpubImageRepair(fixEpubImages(section, view));
  });

  return epubRendition;
}

async function recreateEpubRenditionAt(section) {
  const oldRendition = epubRendition;

  epubRendition = null;
  epubImageRepairTasks.clear();
  try {
    oldRendition?.destroy?.();
  } catch (error) {
    console.warn(error);
  }
  els.epubViewer.replaceChildren();
  createEpubRendition();

  return displayEpubSection(section);
}

function getExactArrayBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function loadEpubFromSource(source, meta = {}, openToken = beginDocumentOpen()) {
  if (!isDocumentOpenCurrent(openToken)) {
    return false;
  }

  await closeCurrentDocument();

  if (!isDocumentOpenCurrent(openToken)) {
    return false;
  }

  state.format = DOCUMENT_FORMATS.EPUB;
  epubAtEnd = false;
  epubAtStart = false;
  epubLastKnownIndex = 0;
  setReaderVisible(true);
  updateViewerMode();
  setEpubLoading(true, "正在排版 EPUB...");
  showStatus("正在打开 EPUB...", true);

  try {
    if (typeof window.ePub !== "function") {
      throw new Error("EPUB 引擎没有加载。");
    }

    const bytes = await source.readRange(0, source.length);

    if (!isDocumentOpenCurrent(openToken)) {
      return false;
    }

    const buffer = getExactArrayBuffer(bytes);
    const book = window.ePub(undefined, {
      replacements: "blobUrl",
    });
    await book.open(buffer, "binary");
    await book.ready;

    if (!isDocumentOpenCurrent(openToken)) {
      book.destroy?.();
      return false;
    }

    epubBook = book;
    createEpubRendition();

    state.documentId = meta.id || state.documentId;
    state.fileName = meta.name || state.fileName || "未命名.epub";
    state.epubProgress = clamp(state.epubProgress || 0, 0, 1);
    state.page = clamp(state.page || 1, 1, epubBook.spine?.length || Number.MAX_SAFE_INTEGER);
    epubLastKnownIndex = clamp(state.page - 1, 0, getEpubChapterTotal() - 1);

    updateControls();
    await epubRendition.display(state.epubCfi || undefined);

    if (!isDocumentOpenCurrent(openToken)) {
      return false;
    }

    await waitForNextFrame();
    await waitForNextFrame();
    await waitForEpubImageRepairs();
    await repairVisibleEpubImages(null, { attempts: 3 });
    const location = epubRendition.currentLocation?.();

    if (location) {
      updateEpubLocation(location);
    }

    saveReaderState();
    hideStatus();
    setEpubLoading(false);
    return true;
  } catch (error) {
    if (!isDocumentOpenCurrent(openToken)) {
      return false;
    }

    console.error(error);
    setEpubLoading(false);
    await closeCurrentDocument();
    state.format = DOCUMENT_FORMATS.PDF;
    setReaderVisible(false);
    updateViewerMode();
    showStatus("这个 EPUB 暂时打不开。", true);
    return false;
  }
}

async function loadEpubFromBlob(blob, meta = {}, openToken = beginDocumentOpen()) {
  return loadEpubFromSource(new BlobDocumentSource(blob), meta, openToken);
}

async function loadEpubFromRecord(record, meta = {}, openToken = beginDocumentOpen()) {
  const source = await createDocumentSourceFromRecord(record);

  if (!isDocumentOpenCurrent(openToken)) {
    return false;
  }

  return loadEpubFromSource(source, meta, openToken);
}

async function navigateEpub(direction) {
  if (!epubRendition || epubNavigationInProgress) {
    return;
  }

  setEpubLoading(true, direction === "prev" ? "正在打开上一章..." : "正在打开下一章...");
  const step = direction === "prev" ? -1 : 1;
  const targetSection = findLinearEpubSection(getEpubChapterNavigationIndex() + step, step);

  if (!targetSection) {
    showStatus(direction === "prev" ? "已经是第一章了。" : "已经是最后一章了。");
    setEpubLoading(false);
    return;
  }

  setPendingEpubTarget(targetSection);

  try {
    let displayed = await displayEpubSection(targetSection);

    if (!displayed) {
      displayed = await recreateEpubRenditionAt(targetSection);
    }

    if (!displayed) {
      throw new Error("EPUB target section did not become current.");
    }

    if (!updateEpubLocationFromRendition(targetSection, { preferFallback: true })) {
      setEpubLocationFromSection(targetSection);
    }

    rememberRecentEpubTarget(targetSection);
    epubRendition.reportLocation?.();
    saveReaderState();
  } catch (error) {
    console.error(error);
    showStatus("EPUB 跳转失败。", true);
    clearPendingEpubTarget(targetSection);
  } finally {
    window.setTimeout(() => clearPendingEpubTarget(targetSection), 700);
    setEpubLoading(false);
  }
}

async function jumpToEpubEdge(edge) {
  if (!epubRendition || epubNavigationInProgress) {
    return;
  }

  const toBottom = edge === "bottom";

  try {
    const moved = await setEpubScrollEdge(edge);

    if (moved) {
      updateEpubLocationFromRendition();
      saveReaderState();
      showStatus(toBottom ? "已滑到底部。" : "已滑到顶部。");
      return;
    }

    showStatus(toBottom ? "当前章节已经到底部。" : "当前章节已经到顶部。");
  } catch (error) {
    console.error(error);
    showStatus("EPUB 跳转失败，请再点一次。", true);
  }
}

function handleEdgeJump(edge) {
  if (isEpubDocument()) {
    if (appFullscreen) {
      navigateEpub(edge === "top" ? "prev" : "next").catch((error) => {
        console.error(error);
        showStatus("章节切换失败，请再点一次。", true);
      });
      return;
    }

    jumpToEpubEdge(edge).catch((error) => {
      console.error(error);
      showStatus("跳转失败，请再点一次。", true);
    });
    return;
  }

  handleContinuousEdgeJump(edge);
}

async function loadPdfFromSource(
  source,
  meta = {},
  requestedPage = 1,
  openToken = beginDocumentOpen(),
  options = {},
) {
  rememberOpenDiagnostic({
    documentId: meta.id || state.documentId || "",
    fileName: meta.name || state.fileName || "",
    options,
    phase: "load-pdf-from-source-start",
    requestedPage,
    source: {
      blobSize: source.blob?.size || null,
      kind: source instanceof EncryptedDocumentSource ? "encrypted" : "blob",
      length: source.length,
    },
  });
  state.format = DOCUMENT_FORMATS.PDF;
  state.epubCfi = "";
  state.epubProgress = 0;

  if (!pdfDoc && !epubBook) {
    setReaderVisible(true);
    updateViewerMode();
    updateControls();
  }

  showStatus("正在打开 PDF...", true);
  let loadingTask = null;
  let loadedDoc = null;

  try {
    loadingTask = await createPdfLoadingTaskFromSource(source, meta, meta.name || state.fileName || "");

    if (!isDocumentOpenCurrent(openToken)) {
      await destroyPdfLoadingTask(loadingTask);
      return false;
    }

    activePdfLoadingTask = loadingTask;
    loadedDoc = await waitForPdfOperation(loadingTask.promise, {
      failurePromise: loadingTask.rangeFailurePromise,
      label: "PDF open",
      timeoutMs: PDF_LOAD_TIMEOUT_MS,
    });

    if (activePdfLoadingTask === loadingTask) {
      activePdfLoadingTask = null;
    }

    if (!isDocumentOpenCurrent(openToken)) {
      await loadedDoc.destroy().catch(() => {});
      return false;
    }

    await closeCurrentDocument();

    if (!isDocumentOpenCurrent(openToken)) {
      await loadedDoc.destroy().catch(() => {});
      return false;
    }

    pdfDoc = loadedDoc;
    activePdfRangeFailurePromise = loadingTask.rangeFailurePromise || null;
    state.documentId = meta.id || state.documentId;
    state.fileName = meta.name || state.fileName || "未命名.pdf";
    state.page = clamp(requestedPage, 1, pdfDoc.numPages);
    state.scrollPage = clamp(state.scrollPage || state.page, 1, pdfDoc.numPages);
    state.zoom = clamp(state.zoom || 1, 0.6, 2.6);

    updateControls();
    setReaderVisible(true);
    updateViewerMode();
    await renderInitialPdfViewWithFallback(openToken, options);
    recordDiagnosticEvent("load-pdf-from-source-success", {
      documentId: state.documentId,
      fileName: state.fileName,
      numPages: pdfDoc.numPages,
      requestedPage,
      sourceLength: source.length,
    });
    return true;
  } catch (error) {
    if (activePdfLoadingTask === loadingTask) {
      activePdfLoadingTask = null;
    }

    if (loadedDoc && pdfDoc === loadedDoc) {
      await closeCurrentDocument();
    } else if (!loadedDoc || pdfDoc !== loadedDoc) {
      await destroyPdfLoadingTask(loadingTask);
    }

    if (!isDocumentOpenCurrent(openToken)) {
      clearDeferredPdfProgressSaveGuard(meta.id || state.documentId || "", openToken);
      return false;
    }

    console.error(error);
    rememberOpenDiagnostic({
      documentId: meta.id || state.documentId || "",
      error: summarizeError(error),
      fileName: meta.name || state.fileName || "",
      phase: "load-pdf-from-source-error",
      requestedPage,
    });
    if (!pdfDoc && !epubBook) {
      setReaderVisible(false);
      updateViewerMode();
    }
    showDiagnosticFailureStatus("这个 PDF 暂时打不开。", {
      documentId: meta.id || state.documentId || "",
      error: summarizeError(error),
      fileName: meta.name || state.fileName || "",
      phase: "load-pdf-from-source-error",
      requestedPage,
    });
    return false;
  }
}

async function loadPdfFromBlob(
  blob,
  meta = {},
  requestedPage = 1,
  openToken = beginDocumentOpen(),
  options = {},
) {
  return loadPdfFromSource(new BlobDocumentSource(blob), meta, requestedPage, openToken, options);
}

async function loadPdfFromRecord(
  record,
  meta = {},
  requestedPage = 1,
  openToken = beginDocumentOpen(),
  options = {},
) {
  const source = await createDocumentSourceFromRecord(record);

  if (!isDocumentOpenCurrent(openToken)) {
    return false;
  }

  return loadPdfFromSource(source, meta, requestedPage, openToken, options);
}

async function openDocumentRecord(record, options = {}) {
  if (!hasStoredDocumentPayload(record)) {
    showStatus("这个文件记录不可用。");
    return false;
  }

  const previousState = { ...state };
  const openToken = beginDocumentOpen();
  const openingLabel = getRecordOpeningLabel(record);
  rememberOpenDiagnostic({
    documentId: record.id || "",
    options,
    phase: "open-document-record-start",
    record: summarizeRecordForDiagnostics(record),
  });
  showStatus(`正在打开 ${openingLabel}...`, true);

  try {
    record = await ensureEncryptedRecordStoredInChunks(record, "open");
    rememberOpenDiagnostic({
      documentId: record.id || "",
      phase: "open-document-record-normalized",
      record: summarizeRecordForDiagnostics(record),
    });

    if (!isDocumentOpenCurrent(openToken)) {
      return false;
    }

    if (pdfDoc || epubBook) {
      persistReaderPositionNow();
    }

    const format = getDocumentFormat(record);
    const displayName = await getRecordDisplayName(record);

    if (!isDocumentOpenCurrent(openToken)) {
      return false;
    }

    state.documentId = record.id;
    state.format = format;
    state.fileName = displayName;
    showStatus(`正在打开 ${displayName}...`, true);

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

    const deferredScrollRestore =
      format === DOCUMENT_FORMATS.PDF && options.resetProgress !== true
        ? createDeferredPdfScrollRestoreState()
        : null;
    if (deferredScrollRestore) {
      deferredPdfProgressSaveGuard = {
        documentId: record.id,
        openToken,
      };
    }
    preparePagedPdfOpenForDeferredScrollRestore(deferredScrollRestore);

    let opened = false;

    if (format === DOCUMENT_FORMATS.EPUB) {
      opened = await loadEpubFromRecord(record, { id: record.id, name: state.fileName }, openToken) === true;
    } else {
      opened = await loadPdfFromRecord(
        record,
        { id: record.id, name: state.fileName },
        state.page,
        openToken,
        {
          commitProgress: !deferredScrollRestore,
          fallbackToFirstPageOnRenderError: options.resetProgress !== true,
        },
      ) === true;
    }

    if (!isDocumentOpenCurrent(openToken)) {
      clearDeferredPdfProgressSaveGuard(record.id, openToken);
      return false;
    }

    if (!opened) {
      rememberOpenDiagnostic({
        documentId: record.id || "",
        phase: "open-document-record-not-opened",
        record: summarizeRecordForDiagnostics(record),
      });
      Object.assign(state, previousState);
      updateViewerMode();
      updateControls();
      clearDeferredPdfProgressSaveGuard(record.id, openToken);
      return false;
    }

    await touchStoredDocument(record.id, record).catch(() => {});
    if (deferredScrollRestore) {
      scheduleDeferredPdfScrollRestore(record.id, openToken, deferredScrollRestore);
    } else {
      saveReaderState();
    }
    renderLibraryList();
    showStatus(`已打开 ${state.fileName}`);
    return true;
  } catch (error) {
    if (!isDocumentOpenCurrent(openToken)) {
      return false;
    }

    console.error(error);
    rememberOpenDiagnostic({
      documentId: record.id || previousState.documentId || "",
      error: summarizeError(error),
      phase: "open-document-record-error",
      record: summarizeRecordForDiagnostics(record),
    });

    clearDeferredPdfProgressSaveGuard(record.id || previousState.documentId || "", openToken);
    Object.assign(state, previousState);
    updateViewerMode();
    updateControls();

    showDiagnosticFailureStatus("这个文件暂时打不开。", {
      documentId: record.id || previousState.documentId || "",
      error: summarizeError(error),
      phase: "open-document-record-error",
    });
    return false;
  }
}

async function openDocumentFromLibrary(documentId) {
  const requestId = (libraryOpenRequestId += 1);
  const cachedRecord = libraryRecordCache.get(documentId);
  showStatus(`正在打开 ${getRecordOpeningLabel(cachedRecord)}...`, true);
  closeLibrary();

  try {
    const record = await getStoredDocument(documentId).catch(() => null);

    if (requestId !== libraryOpenRequestId) {
      return false;
    }

    if (!hasStoredDocumentPayload(record)) {
      showStatus("这个文件已经不在本机存储里。");
      renderLibraryList();
      return false;
    }

    return await openDocumentRecord(record);
  } catch (error) {
    if (requestId !== libraryOpenRequestId) {
      return false;
    }

    console.error(error);
    showDiagnosticFailureStatus("这个文件暂时打不开。", {
      documentId,
      error: summarizeError(error),
      phase: "open-document-from-library-error",
    });
    return false;
  }
}

async function readDocumentsNeedingEncryptionMigration() {
  const summaries = await readLibraryDocuments();
  const records = [];

  for (const summary of summaries) {
    if (!recordNeedsEncryptionMigrationSummary(summary)) {
      continue;
    }

    const record = await getStoredDocument(summary.id).catch(() => null);

    if (hasStoredDocumentPayload(record) && recordNeedsEncryptionMigration(record)) {
      records.push(record);
    }
  }

  return records;
}

async function countDocumentsNeedingEncryptionMigration() {
  const records = await readLibraryDocuments();
  return records.filter(recordNeedsEncryptionMigrationSummary).length;
}

function updateEncryptionPromptState({ busy = false, progress = 0, text = "" } = {}) {
  encryptionMigrationInProgress = busy;
  els.encryptionStartButton.disabled = busy;
  els.encryptionLaterButton.disabled = busy;
  els.encryptionPasswordInput.disabled = busy;
  els.encryptionProgress.hidden = !busy;
  els.encryptionProgressText.hidden = !busy && !text;
  els.encryptionProgress.value = clamp(progress, 0, 100);
  els.encryptionProgressText.textContent = text;
}

function showEncryptionMigrationPrompt(count) {
  closeLibrary();
  closeToc();
  els.encryptionDescription.textContent = `已开启密码锁，书架里还有 ${count} 个文件尚未完全加密。加密后忘记密码将无法恢复文件。`;
  els.encryptionPasswordInput.value = "";
  els.encryptionPasswordInput.hidden = Boolean(sessionPassword);
  els.encryptionPasswordInput.required = !sessionPassword;
  els.encryptionStartButton.textContent = "加密文件";
  updateEncryptionPromptState();
  els.encryptionOverlay.hidden = false;
  updatePanelScrollLock();

  if (!sessionPassword) {
    window.setTimeout(() => els.encryptionPasswordInput.focus(), 40);
  }
}

function hideEncryptionMigrationPrompt() {
  if (encryptionMigrationInProgress) {
    return;
  }

  els.encryptionOverlay.hidden = true;
  updatePanelScrollLock();
}

async function maybePromptLibraryEncryption() {
  if (getSelfTestMode()) {
    return;
  }

  if (!getLockConfig() || encryptionPromptDismissed || encryptionMigrationInProgress) {
    return;
  }

  if (!(await isSodiumEncryptionAvailable())) {
    showStatus("当前浏览器不支持安全随机数或 libsodium 初始化失败，暂时无法加密文件。", true);
    return;
  }

  try {
    const count = await countDocumentsNeedingEncryptionMigration();

    if (count > 0) {
      showEncryptionMigrationPrompt(count);
    }
  } catch (error) {
    console.warn(error);
  }
}

function updateDocumentEncryptionProgress(fileIndex, totalFiles, record, chunkIndex = 0, totalChunks = 1) {
  const fileProgress = totalFiles ? fileIndex / totalFiles : 0;
  const chunkProgress = totalFiles ? (chunkIndex / Math.max(1, totalChunks)) / totalFiles : 0;
  const progress = Math.round((fileProgress + chunkProgress) * 100);
  const name = getPlainRecordName(record);

  updateEncryptionPromptState({
    busy: true,
    progress,
    text: `正在加密 ${fileIndex + 1}/${totalFiles}：${name}`,
  });
}

async function encryptLibraryDocumentsNeedingMigration(password) {
  const documents = await readDocumentsNeedingEncryptionMigration();

  for (let index = 0; index < documents.length; index += 1) {
    const record = documents[index];
    updateDocumentEncryptionProgress(index, documents.length, record);
    const encryptedRecord = await encryptDocumentRecord(record, password, ({ chunkIndex, totalChunks }) => {
      updateDocumentEncryptionProgress(index, documents.length, record, chunkIndex, totalChunks);
    });
    await putStoredDocument(encryptedRecord);
  }

  return documents.length;
}

async function handleEncryptionMigrationSubmit(event) {
  event.preventDefault();

  if (encryptionMigrationInProgress) {
    return;
  }

  const password = sessionPassword || els.encryptionPasswordInput.value;

  if (password.length < 4) {
    showStatus("密码至少 4 位。");
    return;
  }

  if (!(await verifyLockPassword(password))) {
    showStatus("密码不对。");
    els.encryptionPasswordInput.select();
    return;
  }

  setSessionPassword(password);
  updateEncryptionPromptState({
    busy: true,
    progress: 0,
    text: "正在准备加密...",
  });

  try {
    const encryptedCount = await encryptLibraryDocumentsNeedingMigration(password);
    updateEncryptionPromptState({
      busy: false,
      progress: 100,
      text: "",
    });
    els.encryptionOverlay.hidden = true;
    updatePanelScrollLock();
    await renderLibraryList();
    showStatus(encryptedCount ? "书架文件已加密。" : "书架文件已经是加密状态。");
  } catch (error) {
    console.error(error);
    updateEncryptionPromptState({
      busy: false,
      progress: els.encryptionProgress.value,
      text: "加密中断，请稍后重试。",
    });
    showStatus("文件加密失败，原文件已保留。", true);
  }
}

async function handleFileSelection(file) {
  recordDiagnosticEvent("handle-file-selection-start", {
    encryptedBackup: isEncryptedBackupFile(file),
    file: summarizeFile(file),
    supportedDocument: isSupportedDocumentFile(file),
  });

  if (isEncryptedBackupFile(file)) {
    await handleEncryptedBackupSelectionV2(file);
    return;
  }

  if (!isSupportedDocumentFile(file)) {
    showStatus("请选择 PDF、EPUB 或加密备份文件。");
    return;
  }

  try {
    if (getLockConfig() && sessionPassword) {
      showStatus("正在加密并加入书架...", true);
    }

    const record = await saveDocumentFile(file);
    deleteDocumentProgress(record.id);
    await openDocumentRecord(record, { resetProgress: true });
    recordDiagnosticEvent("handle-file-selection-success", {
      file: summarizeFile(file),
      record: summarizeRecordForDiagnostics(record),
    });
    showStatus("已加入书架。");
  } catch (error) {
    console.error(error);
    recordDiagnosticEvent("handle-file-selection-error", {
      error: summarizeError(error),
      file: summarizeFile(file),
    });
    const format = getDocumentFormatFromFile(file);
    showStatus("文件已选择，但保存到书架失败。", true);

    if (format === DOCUMENT_FORMATS.EPUB) {
      await loadEpubFromBlob(file, { name: file.name || "未命名.epub" });
    } else {
      await loadPdfFromBlob(file, { name: file.name || "未命名.pdf" }, 1);
    }
  }
}

async function handleEncryptedBackupSelectionV2(file) {
  if (!sessionPassword) {
    showStatus("请先解锁当前书架，再导入加密备份。", true);
    return;
  }

  let backupRecord = null;
  rememberOpenDiagnostic({
    file: summarizeFile(file),
    phase: "encrypted-backup-import-start",
  });

  try {
    showStatus("正在读取加密备份...", true);
    backupRecord = await parseEncryptedBackupFile(file);
    rememberOpenDiagnostic({
      documentId: backupRecord.id || "",
      file: summarizeFile(file),
      phase: "encrypted-backup-parsed",
      record: summarizeRecordForDiagnostics(backupRecord),
    });
  } catch (error) {
    console.error(error);
    rememberOpenDiagnostic({
      error: summarizeError(error),
      file: summarizeFile(file),
      phase: "encrypted-backup-parse-error",
    });
    showDiagnosticFailureStatus("加密备份文件不可用。", {
      error: summarizeError(error),
      file: summarizeFile(file),
      phase: "encrypted-backup-parse-error",
    });
    return;
  }

  try {
    showStatus("正在导入加密备份...", true);
    const record = await importEncryptedBackupRecordWithCurrentPassword(backupRecord);

    if (!record) {
      return;
    }

    const opened = await openDocumentRecord(record, { resetProgress: true });
    await renderLibraryList();
    if (opened) {
      showStatus("已导入加密文件。");
    } else {
      showDiagnosticFailureStatus("已导入加密文件，但这个 PDF 暂时打不开。", {
        documentId: record.id,
        phase: "encrypted-backup-import-open-failed",
        record: summarizeRecordForDiagnostics(record),
      });
    }
  } catch (error) {
    console.warn(error);
    recordDiagnosticEvent("encrypted-backup-current-password-import-error", {
      documentId: backupRecord?.id || "",
      error: summarizeError(error),
      file: summarizeFile(file),
    });
    showBackupImportPasswordPrompt(backupRecord);
  }
}

async function handleEncryptedBackupSelection(file) {
  return handleEncryptedBackupSelectionV2(file);

  if (!sessionPassword) {
    showStatus("请先解锁同一个密码，再导入加密备份。", true);
    return;
  }

  try {
    showStatus("正在导入加密备份...", true);
    const record = await importEncryptedBackupFile(file);
    await openDocumentRecord(record, { resetProgress: true });
    await renderLibraryList();
    showStatus("已导入加密文件。");
  } catch (error) {
    console.error(error);
    showStatus("加密备份导入失败，请确认密码和文件是否匹配。", true);
  }
}

async function restoreLastDocument() {
  readSavedState();
  updateViewerMode();
  updateControls();

  try {
    let record = state.documentId ? await getStoredDocument(state.documentId) : null;

    if (!hasStoredDocumentPayload(record)) {
      const documents = await readLibraryDocuments();
      record = documents[0] || null;
    }

    if (!hasStoredDocumentPayload(record)) {
      renderLibraryList();
      return;
    }

    record = await ensureEncryptedRecordStoredInChunks(record, "restore");

    state.documentId = record.id;
    state.format = getDocumentFormat(record);
    state.fileName = await getRecordDisplayName(record);
    applyDocumentProgress(record.id, state.page || 1);
    showStatus("正在恢复上次阅读...", true);
    const openToken = beginDocumentOpen();
    let opened = true;

    if (state.format === DOCUMENT_FORMATS.EPUB) {
      opened = await loadEpubFromRecord(record, { id: record.id, name: state.fileName }, openToken) === true;
    } else {
      opened = await loadPdfFromRecord(
        record,
        { id: record.id, name: state.fileName },
        state.page,
        openToken,
        { fallbackToFirstPageOnRenderError: true },
      ) === true;
    }

    if (opened) {
      await touchStoredDocument(record.id, record).catch(() => {});
    }
    renderLibraryList();
  } catch (error) {
    console.warn(error);
    recordDiagnosticEvent("restore-last-document-error", {
      documentId: state.documentId,
      error: summarizeError(error),
    });
  }
}

async function restoreLastDocumentOnce() {
  if (restoreAttempted) {
    return;
  }

  restoreAttempted = true;
  await restoreLastDocument();
}

async function handleUnlockedSession() {
  await restoreLastDocumentOnce();
  await maybePromptLibraryEncryption();
}

function closeLibrary() {
  libraryRenderRequestId += 1;
  els.libraryOverlay.hidden = true;
  updatePanelScrollLock();
}

async function openLibrary() {
  if (!els.encryptionOverlay.hidden) {
    return;
  }

  closeToc();
  els.libraryOverlay.hidden = false;
  updatePanelScrollLock();

  if (libraryListDirty) {
    await renderLibraryList({ force: true });
  }
}

function closeToc() {
  els.tocOverlay.hidden = true;
  els.tocList.replaceChildren();
  els.tocEmptyState.hidden = true;
  tocEntries = [];
  tocActiveIndex = null;
  tocWindowStart = 0;
  tocWindowEnd = 0;
  updatePanelScrollLock();
}

function openToc() {
  if (!epubBook || !epubRendition) {
    showStatus("当前文件没有章节目录。");
    return;
  }

  closeLibrary();
  els.tocOverlay.hidden = false;
  updatePanelScrollLock();
  renderTocList();
}

function updatePanelScrollLock() {
  const panelOpen =
    !els.libraryOverlay.hidden ||
    !els.tocOverlay.hidden ||
    !els.encryptionOverlay.hidden ||
    !els.backupOverlay.hidden ||
    !els.diagnosticsOverlay.hidden;

  document.documentElement.classList.toggle("is-panel-open", panelOpen);
  document.body.classList.toggle("is-panel-open", panelOpen);
}

function getScrollablePanelList(target) {
  return target?.closest?.(
    ".library-list, .toc-list, .encryption-panel, .backup-panel, .diagnostics-panel, .diagnostics-text",
  ) || null;
}

function rememberPanelTouch(event) {
  overlayTouchY = event.touches?.[0]?.clientY || 0;
}

function preventPanelScrollLeak(event) {
  if (
    els.libraryOverlay.hidden &&
    els.tocOverlay.hidden &&
    els.encryptionOverlay.hidden &&
    els.backupOverlay.hidden &&
    els.diagnosticsOverlay.hidden
  ) {
    return;
  }

  const list = getScrollablePanelList(event.target);

  if (!list) {
    event.preventDefault();
    return;
  }

  if (list.scrollHeight <= list.clientHeight + 1) {
    event.preventDefault();
    return;
  }

  if (event.type === "wheel") {
    const atTop = list.scrollTop <= 0;
    const atBottom = Math.ceil(list.scrollTop + list.clientHeight) >= list.scrollHeight;

    if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) {
      event.preventDefault();
    }
    return;
  }

  if (event.type !== "touchmove") {
    return;
  }

  const nextY = event.touches?.[0]?.clientY || overlayTouchY;
  const deltaY = nextY - overlayTouchY;
  const atTop = list.scrollTop <= 0;
  const atBottom = Math.ceil(list.scrollTop + list.clientHeight) >= list.scrollHeight;
  overlayTouchY = nextY;

  if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
    event.preventDefault();
  }
}

function cleanTocLabel(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  const scratch = document.createElement("div");
  scratch.innerHTML = raw;
  return (scratch.textContent || scratch.innerText || raw).replace(/\s+/g, " ").trim();
}

function normalizeEpubTocHref(value) {
  if (!value) {
    return "";
  }

  let cleanValue = String(value).split("#")[0].split("?")[0].trim();

  if (!cleanValue) {
    return "";
  }

  try {
    cleanValue = window.decodeURIComponent(cleanValue);
  } catch {
    // Keep the original value if the EPUB has a malformed escape sequence.
  }

  return normalizeEpubArchivePath(cleanValue).toLowerCase();
}

function epubTocHrefsMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  return left === right || left.endsWith(right) || right.endsWith(left);
}

function getEpubSectionHrefCandidates(section) {
  return [
    section?.href,
    section?.url,
    typeof section?.canonical === "string" ? section.canonical : "",
    section?.href && epubBook?.resolve?.(section.href),
  ]
    .map(normalizeEpubTocHref)
    .filter(Boolean);
}

function resetEpubTocCache() {
  epubTocEntriesCache = null;
  epubSectionHrefIndex = null;
  tocEntries = [];
  tocActiveIndex = null;
  tocWindowStart = 0;
  tocWindowEnd = 0;
}

function getEpubSectionHrefIndex() {
  if (epubSectionHrefIndex) {
    return epubSectionHrefIndex;
  }

  epubSectionHrefIndex = new Map();

  for (let index = 0; index < getEpubChapterTotal(); index += 1) {
    const section = getEpubSectionAt(index);

    for (const candidate of getEpubSectionHrefCandidates(section)) {
      if (!epubSectionHrefIndex.has(candidate)) {
        epubSectionHrefIndex.set(candidate, section);
      }
    }
  }

  return epubSectionHrefIndex;
}

function findEpubSectionByHref(href) {
  const target = normalizeEpubTocHref(href);

  if (!target) {
    return null;
  }

  const sectionIndex = getEpubSectionHrefIndex();
  const exactSection = sectionIndex.get(target);

  if (exactSection) {
    return exactSection;
  }

  for (const [candidate, section] of sectionIndex) {
    if (epubTocHrefsMatch(candidate, target)) {
      return section;
    }
  }

  return null;
}

function flattenEpubTocItems(items, depth = 0, entries = []) {
  for (const item of items || []) {
    const label = cleanTocLabel(item?.label || item?.title || item?.text || item?.href);
    const href = item?.href || item?.url || item?.cfi || "";
    const section = findEpubSectionByHref(href);

    if (label || href) {
      entries.push({
        depth,
        href,
        label: label || `第 ${entries.length + 1} 章`,
        sectionIndex: Number.isFinite(section?.index) ? section.index : null,
      });
    }

    flattenEpubTocItems(item?.subitems || item?.children, depth + 1, entries);
  }

  return entries;
}

function getEpubTocEntries() {
  if (epubTocEntriesCache) {
    return epubTocEntriesCache;
  }

  const navigationItems = epubBook?.navigation?.toc || [];
  const entries = flattenEpubTocItems(navigationItems);

  if (entries.length) {
    epubTocEntriesCache = entries;
    return epubTocEntriesCache;
  }

  const fallbackEntries = [];

  for (let index = 0; index < getEpubChapterTotal(); index += 1) {
    const section = getEpubSectionAt(index);
    const rawLabel = section?.label || section?.idref || section?.href || `第 ${index + 1} 章`;
    fallbackEntries.push({
      depth: 0,
      href: section?.href || "",
      label: cleanTocLabel(rawLabel) || `第 ${index + 1} 章`,
      sectionIndex: index,
    });
  }

  epubTocEntriesCache = fallbackEntries;
  return epubTocEntriesCache;
}

async function jumpToEpubTocEntry(entry) {
  if (!epubRendition || epubNavigationInProgress) {
    return;
  }

  closeToc();
  setEpubLoading(true, "正在打开章节...");
  let targetSection = null;

  try {
    const section =
      Number.isFinite(entry.sectionIndex) && entry.sectionIndex >= 0
        ? getEpubSectionAt(entry.sectionIndex)
        : findEpubSectionByHref(entry.href);
    let displayed = false;
    targetSection = section;

    if (section) {
      setPendingEpubTarget(section);
      displayed = await displayEpubSection(section);

      if (!displayed) {
        displayed = await recreateEpubRenditionAt(section);
      }
    } else if (entry.href) {
      try {
        await epubRendition.display(entry.href);
        await waitForNextFrame();
        await waitForNextFrame();
        await repairVisibleEpubImages(section, { attempts: 3 });
        displayed = true;
      } catch {
        displayed = false;
      }
    }

    if (!displayed) {
      throw new Error("Cannot resolve EPUB TOC entry.");
    }

    if (!updateEpubLocationFromRendition(section, { preferFallback: Boolean(section) }) && section) {
      setEpubLocationFromSection(section);
    }

    if (section) {
      rememberRecentEpubTarget(section);
    }
    epubRendition.reportLocation?.();
    saveReaderState();
    showStatus("已打开章节。");
  } catch (error) {
    console.warn(error);
    showStatus("章节跳转失败。", true);
  } finally {
    if (targetSection) {
      window.setTimeout(() => clearPendingEpubTarget(targetSection), 700);
    }
    setEpubLoading(false);
  }
}

function createTocItem(entry, index) {
  const item = document.createElement("button");
  const title = document.createElement("span");
  const isActive = entry.sectionIndex === tocActiveIndex;

  item.className = "toc-item";
  item.type = "button";
  item.dataset.tocIndex = String(index);
  item.style.paddingLeft = `${10 + Math.min(entry.depth || 0, 4) * 14}px`;
  item.classList.toggle("active", isActive);

  title.className = "toc-name";
  title.textContent = entry.label || `第 ${index + 1} 章`;

  item.append(title);
  return item;
}

function createTocSpacer(count) {
  const spacer = document.createElement("div");
  spacer.className = "toc-spacer";
  spacer.style.height = `${Math.max(0, count) * TOC_ITEM_ESTIMATED_HEIGHT}px`;
  return spacer;
}

function getActiveTocEntryIndex(entries, activeIndex) {
  const exactIndex = entries.findIndex((entry) => entry.sectionIndex === activeIndex);

  if (exactIndex >= 0) {
    return exactIndex;
  }

  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  entries.forEach((entry, index) => {
    if (!Number.isFinite(entry.sectionIndex)) {
      return;
    }

    const distance = Math.abs(entry.sectionIndex - activeIndex);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex >= 0 ? nearestIndex : 0;
}

function scrollTocEntryIntoView(index) {
  const item = els.tocList.querySelector(`[data-toc-index="${index}"]`);

  if (!item) {
    return;
  }

  item.scrollIntoView({
    block: "center",
  });
}

function renderTocWindow(start, end, options = {}) {
  if (!tocEntries.length) {
    els.tocList.replaceChildren();
    tocWindowStart = 0;
    tocWindowEnd = 0;
    return;
  }

  const windowStart = clamp(Math.floor(start), 0, Math.max(tocEntries.length - 1, 0));
  const windowEnd = clamp(Math.ceil(end), windowStart + 1, tocEntries.length);
  const previousScrollTop = els.tocList.scrollTop;
  const fragment = document.createDocumentFragment();

  tocWindowStart = windowStart;
  tocWindowEnd = windowEnd;

  if (tocWindowStart > 0) {
    fragment.append(createTocSpacer(tocWindowStart));
  }

  for (let index = tocWindowStart; index < tocWindowEnd; index += 1) {
    fragment.append(createTocItem(tocEntries[index], index));
  }

  if (tocWindowEnd < tocEntries.length) {
    fragment.append(createTocSpacer(tocEntries.length - tocWindowEnd));
  }
  els.tocList.replaceChildren(fragment);

  if (Number.isFinite(options.scrollToIndex)) {
    window.requestAnimationFrame(() => scrollTocEntryIntoView(options.scrollToIndex));
    return;
  }

  if (options.preserveScroll) {
    window.requestAnimationFrame(() => {
      els.tocList.scrollTop = previousScrollTop;
    });
  }
}

function renderTocWindowAround(index) {
  if (!tocEntries.length) {
    renderTocWindow(0, 0);
    return;
  }

  const windowSize = Math.min(TOC_RENDER_BATCH_SIZE, tocEntries.length);
  const targetIndex = clamp(index, 0, tocEntries.length - 1);
  const start = clamp(
    targetIndex - Math.floor(windowSize / 2),
    0,
    Math.max(tocEntries.length - windowSize, 0),
  );

  renderTocWindow(start, start + windowSize, { scrollToIndex: targetIndex });
}

function fillTocViewport() {
  let guard = 0;

  while (
    tocEntries.length &&
    els.tocList.scrollHeight <= els.tocList.clientHeight + TOC_RENDER_SCROLL_THRESHOLD &&
    guard < 8 &&
    (tocWindowStart > 0 || tocWindowEnd < tocEntries.length)
  ) {
    const nextStart =
      tocWindowStart > 0
        ? Math.max(0, tocWindowStart - TOC_RENDER_BATCH_SIZE)
        : tocWindowStart;
    const nextEnd =
      tocWindowEnd < tocEntries.length
        ? Math.min(tocEntries.length, tocWindowEnd + TOC_RENDER_BATCH_SIZE)
        : tocWindowEnd;

    renderTocWindow(nextStart, nextEnd, { preserveScroll: true });
    guard += 1;
  }
}

function maybeAppendTocBatch() {
  if (els.tocOverlay.hidden || !tocEntries.length) {
    return;
  }

  const nearTop = els.tocList.scrollTop <= TOC_RENDER_SCROLL_THRESHOLD;
  const distanceToBottom =
    els.tocList.scrollHeight - els.tocList.scrollTop - els.tocList.clientHeight;
  const nearBottom = distanceToBottom <= TOC_RENDER_SCROLL_THRESHOLD;
  let nextStart = tocWindowStart;
  let nextEnd = tocWindowEnd;

  if (nearTop && tocWindowStart > 0) {
    nextStart = Math.max(0, tocWindowStart - TOC_RENDER_BATCH_SIZE);
  }

  if (nearBottom && tocWindowEnd < tocEntries.length) {
    nextEnd = Math.min(tocEntries.length, tocWindowEnd + TOC_RENDER_BATCH_SIZE);
  }

  if (nextStart !== tocWindowStart || nextEnd !== tocWindowEnd) {
    renderTocWindow(nextStart, nextEnd, { preserveScroll: true });
    fillTocViewport();
  }
}

function renderTocList() {
  tocEntries = getEpubTocEntries();
  tocActiveIndex = getEpubNavigationBaseIndex();
  const activeEntryIndex = getActiveTocEntryIndex(tocEntries, tocActiveIndex);

  els.tocList.replaceChildren();
  els.tocList.scrollTop = 0;
  els.tocEmptyState.hidden = tocEntries.length > 0;

  renderTocWindowAround(activeEntryIndex);
  window.requestAnimationFrame(fillTocViewport);
}

function handleTocListClick(event) {
  const item = event.target?.closest?.(".toc-item");

  if (!item || !els.tocList.contains(item)) {
    return;
  }

  const index = Number.parseInt(item.dataset.tocIndex || "", 10);
  const entry = tocEntries[index] || getEpubTocEntries()[index];

  if (entry) {
    jumpToEpubTocEntry(entry);
  }
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

async function renderLibraryList(options = {}) {
  if (els.libraryOverlay.hidden && options.force !== true) {
    libraryListDirty = true;
    recordDiagnosticEvent("library-render-deferred", {
      reason: "overlay-hidden",
    });
    return;
  }

  const renderId = (libraryRenderRequestId += 1);
  const startedAt = performance.now();
  libraryListDirty = false;

  try {
    els.libraryList.replaceChildren();
    els.libraryEmptyState.hidden = false;
    els.libraryEmptyState.textContent = "正在读取书架...";
    await waitForNextFrame();

    const documents = await readLibraryDocuments();

    if (renderId !== libraryRenderRequestId) {
      libraryListDirty = true;
      return;
    }

    const fragment = document.createDocumentFragment();
    const encryptedNameEntries = [];
    libraryRecordCache.clear();
    els.libraryEmptyState.hidden = documents.length > 0;
    els.libraryEmptyState.textContent = documents.length > 0 ? "" : "还没有保存过 PDF。";

    for (let index = 0; index < documents.length; index += 1) {
      const record = documents[index];
      libraryRecordCache.set(record.id, record);

      const progress = readDocumentProgress(record.id);
      const item = document.createElement("article");
      const openButton = document.createElement("button");
      const name = document.createElement("span");
      const meta = document.createElement("span");
      const actions = document.createElement("div");
      const exportButton = document.createElement("button");
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
      openButton.dataset.libraryAction = "open";
      openButton.dataset.documentId = record.id;

      name.className = "library-name";
      name.textContent = getImmediateRecordDisplayName(record);

      if (isRecordNameEncrypted(record)) {
        encryptedNameEntries.push({ element: name, record });
      }

      meta.className = "library-meta";
      meta.textContent = `${isActive ? "正在阅读 · " : ""}${format.toUpperCase()} · ${progressLabel} · ${formatFileSize(record.size || getStoredPayloadSize(record))}${isRecordEncrypted(record) ? " · 已加密" : ""}`;

      actions.className = "library-actions";

      exportButton.className = "library-export";
      exportButton.type = "button";
      exportButton.dataset.libraryAction = "export";
      exportButton.dataset.documentId = record.id;
      exportButton.textContent = "导出";

      deleteButton.className = "library-delete";
      deleteButton.type = "button";
      deleteButton.dataset.libraryAction = "delete";
      deleteButton.dataset.documentId = record.id;
      deleteButton.textContent = "删除";

      openButton.append(name, meta);

      actions.append(exportButton, deleteButton);
      item.append(openButton, actions);
      fragment.append(item);

      if ((index + 1) % 8 === 0) {
        await waitForNextFrame();
      }
    }

    if (renderId !== libraryRenderRequestId) {
      libraryListDirty = true;
      return;
    }

    els.libraryList.replaceChildren(fragment);
    recordDiagnosticEvent("library-render-success", {
      documentCount: documents.length,
      elapsedMs: Math.round(performance.now() - startedAt),
      encryptedNameCount: encryptedNameEntries.length,
    });
    resolveLibraryRecordNames(encryptedNameEntries, renderId).catch((error) => {
      console.warn(error);
      recordDiagnosticEvent("library-names-resolve-error", {
        error: summarizeError(error),
      });
    });
  } catch (error) {
    console.warn(error);
    libraryListDirty = true;
    els.libraryList.replaceChildren();
    els.libraryEmptyState.hidden = false;
    els.libraryEmptyState.textContent = "书架暂时打不开。";
    recordDiagnosticEvent("library-render-error", {
      elapsedMs: Math.round(performance.now() - startedAt),
      error: summarizeError(error),
    });
  }
}

async function handleLibraryListClick(event) {
  const button = event.target?.closest?.("button[data-library-action]");

  if (!button || !els.libraryList.contains(button)) {
    return;
  }

  const documentId = button.dataset.documentId || "";
  const action = button.dataset.libraryAction || "";

  if (!documentId) {
    return;
  }

  event.preventDefault();

  if (action === "open") {
    openDocumentFromLibrary(documentId).catch((error) => {
      console.error(error);
      showDiagnosticFailureStatus("这个文件暂时打不开。", {
        documentId,
        error: summarizeError(error),
        phase: "library-list-open-error",
      });
    });
    return;
  }

  if (action === "export") {
    const cachedRecord = libraryRecordCache.get(documentId);
    showStatus(`正在准备导出 ${getRecordOpeningLabel(cachedRecord)}...`, true);
    const record = await getStoredDocument(documentId).catch(() => null);

    if (!hasStoredDocumentPayload(record)) {
      showStatus("这个文件已经不在本机存储里。");
      renderLibraryList();
      return;
    }

    showBackupExportPrompt(record);
    return;
  }

  if (action === "delete") {
    deleteDocumentFromLibrary(documentId).catch((error) => {
      console.error(error);
      showStatus("删除失败，请再试一次。", true);
    });
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
  recordDiagnosticEvent("open-file-picker", {
    blocked:
      !els.lockOverlay.hidden ||
      !els.encryptionOverlay.hidden ||
      !els.backupOverlay.hidden ||
      !els.imageOverlay.hidden ||
      !els.diagnosticsOverlay.hidden,
  });

  if (
    !els.lockOverlay.hidden ||
    !els.encryptionOverlay.hidden ||
    !els.backupOverlay.hidden ||
    !els.imageOverlay.hidden ||
    !els.diagnosticsOverlay.hidden
  ) {
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
  els.runtimeLogButton?.addEventListener("click", copyRuntimeLogToClipboard);
  els.statusDiagnosticsButton?.addEventListener("click", copyDiagnosticsToClipboard);
  els.fullscreenButton.addEventListener("click", () => {
    toggleAppFullscreen();
  });
  els.floatingFullscreenButton.addEventListener("click", () => {
    toggleAppFullscreen();
  });
  els.floatingLockButton.addEventListener("click", lockReader);
  els.libraryButton.addEventListener("click", openLibrary);
  els.libraryCloseButton.addEventListener("click", closeLibrary);
  els.libraryList.addEventListener("click", handleLibraryListClick);
  els.tocButton.addEventListener("click", openToc);
  els.tocCloseButton.addEventListener("click", closeToc);
  els.tocList.addEventListener("click", handleTocListClick);
  els.tocList.addEventListener("scroll", maybeAppendTocBatch, { passive: true });
  els.imageCloseButton.addEventListener("click", closeImagePreview);
  els.imageOverlay.addEventListener("click", (event) => {
    if (event.target === els.imageOverlay) {
      closeImagePreview();
    }
  });
  els.imagePreview.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  els.diagnosticsCloseButton.addEventListener("click", hideDiagnosticsManualCopy);
  els.diagnosticsSelectButton.addEventListener("click", selectDiagnosticsText);
  els.diagnosticsOverlay.addEventListener("click", (event) => {
    if (event.target === els.diagnosticsOverlay) {
      hideDiagnosticsManualCopy();
    }
  });
  els.diagnosticsOverlay.addEventListener("touchstart", rememberPanelTouch, { passive: true });
  els.diagnosticsOverlay.addEventListener("touchmove", preventPanelScrollLeak, { passive: false });
  els.diagnosticsOverlay.addEventListener("wheel", preventPanelScrollLeak, { passive: false });
  els.lockCancelButton.addEventListener("click", hideLockOverlay);
  els.lockForm.addEventListener("submit", handleLockSubmit);
  els.lockOverlay.addEventListener("touchmove", preventLockScroll, { passive: false });
  els.lockOverlay.addEventListener("wheel", preventLockScroll, { passive: false });
  els.backupCurrentButton.addEventListener("click", handleBackupCurrentExport);
  els.backupCancelButton.addEventListener("click", hideBackupPrompt);
  els.backupForm.addEventListener("submit", handleBackupSubmit);
  els.backupOverlay.addEventListener("click", (event) => {
    if (event.target === els.backupOverlay) {
      hideBackupPrompt();
    }
  });
  els.backupOverlay.addEventListener("touchstart", rememberPanelTouch, { passive: true });
  els.backupOverlay.addEventListener("touchmove", preventPanelScrollLeak, { passive: false });
  els.backupOverlay.addEventListener("wheel", preventPanelScrollLeak, { passive: false });
  els.encryptionForm.addEventListener("submit", handleEncryptionMigrationSubmit);
  els.encryptionLaterButton.addEventListener("click", () => {
    encryptionPromptDismissed = true;
    hideEncryptionMigrationPrompt();
  });
  els.encryptionOverlay.addEventListener("click", (event) => {
    if (event.target === els.encryptionOverlay) {
      encryptionPromptDismissed = true;
      hideEncryptionMigrationPrompt();
    }
  });
  els.encryptionOverlay.addEventListener("touchstart", rememberPanelTouch, { passive: true });
  els.encryptionOverlay.addEventListener("touchmove", preventPanelScrollLeak, { passive: false });
  els.encryptionOverlay.addEventListener("wheel", preventPanelScrollLeak, { passive: false });
  els.libraryOverlay.addEventListener("click", (event) => {
    if (event.target === els.libraryOverlay) {
      closeLibrary();
    }
  });
  els.libraryOverlay.addEventListener("touchstart", rememberPanelTouch, { passive: true });
  els.libraryOverlay.addEventListener("touchmove", preventPanelScrollLeak, { passive: false });
  els.libraryOverlay.addEventListener("wheel", preventPanelScrollLeak, { passive: false });
  els.tocOverlay.addEventListener("click", (event) => {
    if (event.target === els.tocOverlay) {
      closeToc();
    }
  });
  els.tocOverlay.addEventListener("touchstart", rememberPanelTouch, { passive: true });
  els.tocOverlay.addEventListener("touchmove", preventPanelScrollLeak, { passive: false });
  els.tocOverlay.addEventListener("wheel", preventPanelScrollLeak, { passive: false });

  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files?.[0];
    recordDiagnosticEvent("file-input-change", {
      file: summarizeFile(file),
      hasFile: Boolean(file),
    });
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
  els.jumpTopButton.addEventListener("click", () => handleEdgeJump("top"));
  els.jumpBottomButton.addEventListener("click", () => handleEdgeJump("bottom"));
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

  els.canvasWrap.addEventListener("scroll", scheduleContinuousScrollUpdate, { passive: true });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && appFullscreen && !syncingNativeFullscreen) {
      setAppFullscreen(false);
    }
  });

  document.addEventListener("visibilitychange", () => {
    recordDiagnosticEvent("visibility-change", {
      visibilityState: document.visibilityState,
    });
    if (document.visibilityState === "hidden") {
      persistReaderPositionNow();
      flushRuntimeLogEntries();
      return;
    }

    lastViewportChangeAt = Date.now();
    restoreReaderPositionAfterResume();
    scheduleContinuousHealthCheck(300);
  });

  window.addEventListener("pagehide", () => {
    recordDiagnosticEvent("pagehide");
    persistReaderPositionNow();
    flushRuntimeLogEntries();
  });
  window.addEventListener("beforeunload", () => {
    recordDiagnosticEvent("beforeunload");
    persistReaderPositionNow();
    flushRuntimeLogEntries();
  });
  window.addEventListener("pageshow", () => {
    recordDiagnosticEvent("pageshow", {
      persisted: performance?.getEntriesByType?.("navigation")?.[0]?.type || "",
    });
    lastViewportChangeAt = Date.now();
    restoreReaderPositionAfterResume();
    scheduleContinuousHealthCheck(300);
  });
  window.addEventListener("focus", () => {
    recordDiagnosticEvent("window-focus");
    lastViewportChangeAt = Date.now();
    restoreReaderPositionAfterResume();
    scheduleContinuousHealthCheck(300);
  });

  window.addEventListener("resize", () => {
    recordDiagnosticEvent("window-resize", {
      height: window.innerHeight,
      width: window.innerWidth,
    });
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
    if (!els.imageOverlay.hidden) {
      if (event.key === "Escape") {
        closeImagePreview();
      }
      return;
    }

    if (event.key === "Escape" && !els.lockOverlay.hidden && lockMode === "setup") {
      hideLockOverlay();
      return;
    }

    if (event.key === "Escape" && !els.libraryOverlay.hidden) {
      closeLibrary();
      return;
    }

    if (event.key === "Escape" && !els.tocOverlay.hidden) {
      closeToc();
      return;
    }

    if (event.key === "Escape" && !els.backupOverlay.hidden) {
      hideBackupPrompt();
      return;
    }

    if (event.key === "Escape" && !els.diagnosticsOverlay.hidden) {
      hideDiagnosticsManualCopy();
      return;
    }

    if (event.key === "Escape" && appFullscreen) {
      toggleAppFullscreen();
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

  els.epubPane.addEventListener(
    "touchstart",
    (event) => {
      if (
        event.touches?.length !== 1 ||
        !isFullscreenEpubGestureEnabled() ||
        isInteractiveEpubGestureTarget(event.target)
      ) {
        epubPaneTouchStart = null;
        return;
      }

      const touch = event.changedTouches?.[0];
      if (!touch) {
        epubPaneTouchStart = null;
        return;
      }

      epubPaneTouchStart = {
        x: touch.clientX,
        y: touch.clientY,
      };
    },
    { passive: true },
  );

  els.epubPane.addEventListener(
    "touchend",
    (event) => {
      if (!epubPaneTouchStart) {
        return;
      }

      const touch = event.changedTouches?.[0];
      if (!touch) {
        epubPaneTouchStart = null;
        return;
      }

      const currentStart = epubPaneTouchStart;
      epubPaneTouchStart = null;

      handleFullscreenEpubSwipe(currentStart, {
        x: touch.clientX,
        y: touch.clientY,
      });
    },
    { passive: true },
  );

  els.epubPane.addEventListener(
    "touchcancel",
    () => {
      epubPaneTouchStart = null;
    },
    { passive: true },
  );
}

function noteSelfTestMetric(name) {
  if (!getSelfTestMode()) {
    return;
  }

  window.__portableReaderSelfTestMetrics ||= {};
  window.__portableReaderSelfTestMetrics[name] =
    (window.__portableReaderSelfTestMetrics[name] || 0) + 1;
}

setPdfSourceMetricHandler(noteSelfTestMetric);
setPdfSourceDiagnosticHandler((type, detail = {}) => {
  recordDiagnosticEvent(`pdf-source:${type}`, detail);
});

function createSelfTestPdfBytes(label, pageCount = 3, fillerBytes = 0) {
  const encoder = new TextEncoder();
  const safeLabel = String(label).replace(/[()\\]/g, "\\$&");
  const objects = [];
  const fontObjectId = 3;
  const pageObjectIds = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageObjectId = 4 + pageIndex * 2;
    const contentObjectId = pageObjectId + 1;
    const content = `0 0 0 rg 36 82 220 12 re f BT /F1 22 Tf 36 120 Td (${safeLabel} page ${pageIndex + 1}) Tj ET`;

    pageObjectIds.push(pageObjectId);
    objects[pageObjectId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] ` +
      `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId] = `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`;
  }

  if (fillerBytes > 0) {
    const filler = "0".repeat(Math.max(0, Math.floor(fillerBytes)));
    objects[objects.length] = `<< /Length ${filler.length} >>\nstream\n${filler}\nendstream`;
  }

  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    offsets[objectId] = encoder.encode(pdf).length;
    pdf += `${objectId} 0 obj\n${objects[objectId]}\nendobj\n`;
  }

  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    pdf += `${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
}

function createSelfTestPdfRecord(id, name, pageCount = 3, fillerBytes = 0) {
  const bytes = createSelfTestPdfBytes(name, pageCount, fillerBytes);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const now = Date.now();

  return {
    id,
    blob,
    format: DOCUMENT_FORMATS.PDF,
    lastOpenedAt: now,
    name,
    size: blob.size,
    type: "application/pdf",
    updatedAt: now,
  };
}

function getSelfTestMode() {
  try {
    return new URLSearchParams(window.location.search).get("selftest") || "";
  } catch {
    return "";
  }
}

function updateSelfTestResult(status, detail = "") {
  window.__portableReaderSelfTestResult = {
    detail,
    metrics: window.__portableReaderSelfTestMetrics || {},
    status,
    updatedAt: Date.now(),
  };
}

function getSelfTestRenderedCanvas() {
  if (isScrollMode()) {
    return (
      els.continuousPages.querySelector('.page-shell[data-rendered="true"] canvas') ||
      els.continuousPages.querySelector("canvas")
    );
  }

  return els.canvas;
}

function assertSelfTestPdfRendered(label, { requireNonBlank = false } = {}) {
  const canvas = getSelfTestRenderedCanvas();

  if (!pdfDoc || !canvas?.width || !canvas?.height) {
    throw new Error(`${label} did not render a PDF page; status=${getStatusText() || ""}`);
  }

  if (requireNonBlank && isCanvasLikelyBlank(canvas)) {
    throw new Error(`${label} rendered a blank PDF canvas; status=${getStatusText() || ""}`);
  }
}

async function waitForSelfTestPdfRendered(label, { requireNonBlank = false } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      assertSelfTestPdfRendered(label, { requireNonBlank });
      return;
    } catch (error) {
      lastError = error;
    }

    if (/失败|打不开|不可用/.test(getStatusText() || "")) {
      throw lastError;
    }

    await wait(125);
  }

  throw lastError || new Error(`${label} did not render a PDF page; status=${getStatusText() || ""}`);
}

async function openSelfTestRecord(record, options, label) {
  const timeoutMs = 20_000;
  const timeout = wait(timeoutMs).then(() => {
    throw new Error(`${label} timed out after ${timeoutMs}ms; status=${getStatusText() || ""}`);
  });

  const opened = await Promise.race([openDocumentRecord(record, options), timeout]);

  if (opened !== true) {
    throw new Error(`${label} did not open; status=${getStatusText() || ""}`);
  }

  await waitForSelfTestPdfRendered(label);

  if (/失败|打不开|不可用/.test(getStatusText() || "")) {
    throw new Error(`${label} ended with status=${getStatusText()}`);
  }
}

async function waitForSelfTestRecordVisible(record, label, { requireNonBlank = false } = {}) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(250);

    if (state.documentId === record.id && pdfDoc) {
      await waitForSelfTestPdfRendered(label, { requireNonBlank });
      return;
    }

    if (/失败|打不开|不可用/.test(getStatusText() || "")) {
      throw new Error(`${label} failed with status=${getStatusText()}`);
    }
  }

  throw new Error(`${label} did not become visible; status=${getStatusText() || ""}`);
}

async function waitForSelfTestScrollMode(label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(250);

    if (isScrollMode()) {
      await waitForNextFrame();
      assertSelfTestPdfRendered(label, { requireNonBlank: true });
      return;
    }

    if (/失败|打不开|不可用/.test(getStatusText() || "")) {
      throw new Error(`${label} failed with status=${getStatusText()}`);
    }
  }

  throw new Error(`${label} did not restore scroll mode; status=${getStatusText() || ""}`);
}

async function clickSelfTestLibraryRecord(record, label) {
  await openLibrary();
  const button = Array.from(
    els.libraryList.querySelectorAll('button[data-library-action="open"]'),
  ).find((candidate) => candidate.dataset.documentId === record.id);

  if (!button) {
    throw new Error(`${label} library button was not rendered.`);
  }

  button.click();
  await waitForSelfTestRecordVisible(record, label, { requireNonBlank: true });
}

async function runEncryptedSwitchSelfTest() {
  const password = "portable-reader-selftest";
  const encryptedId = `${DOCUMENT_ID_PREFIX}selftest-encrypted-switch`;
  const otherId = `${DOCUMENT_ID_PREFIX}selftest-other-switch`;

  updateSelfTestResult("running", "prepare");
  window.__portableReaderSelfTestMetrics = {};
  setSessionPassword(password);
  showStatus("自测：准备测试文件...", true);
  await deleteStoredDocument(encryptedId).catch(() => {});
  await deleteStoredDocument(otherId).catch(() => {});
  deleteDocumentProgress(encryptedId);
  deleteDocumentProgress(otherId);

  const targetPlainRecord = createSelfTestPdfRecord(
    encryptedId,
    "selftest encrypted",
    4,
    PDF_RANGE_CHUNK_SIZE + 180_000,
  );
  const otherRecord = createSelfTestPdfRecord(otherId, "selftest other", 2);
  const encryptedRecord = await encryptDocumentRecord(targetPlainRecord, password);
  const backupBlob = await createStoredEncryptedBackupBlob(encryptedRecord);
  const backupFile =
    typeof File === "undefined"
      ? backupBlob
      : new File([backupBlob], "selftest-target.pprenc", { type: "application/octet-stream" });

  updateSelfTestResult("running", "import encrypted backup");
  showStatus("自测：导入加密备份...", true);
  const backupRecord = await parseEncryptedBackupFile(backupFile);
  const importedRecord = await importEncryptedBackupRecordWithCurrentPassword(backupRecord);

  updateSelfTestResult("running", "open imported encrypted PDF");
  showStatus("自测：打开导入后的加密 PDF...", true);
  await openSelfTestRecord(importedRecord, { resetProgress: true }, "open imported encrypted PDF");
  state.mode = READ_MODES.SCROLL;
  state.page = 4;
  state.scrollPage = 4;
  state.scrollOffsetRatio = 0.25;
  saveReaderState();

  await putStoredDocument(otherRecord);
  updateSelfTestResult("running", "open other PDF");
  showStatus("自测：切换到另一个 PDF...", true);
  await openSelfTestRecord(otherRecord, { resetProgress: true }, "open other PDF");

  const storedEncryptedRecord = await getStoredDocument(encryptedId);
  const rawStoredEncryptedRecord = await withStore(
    "readonly",
    (store) => requestToPromise(store.get(encryptedId)),
  );

  if (!hasStoredDocumentPayload(storedEncryptedRecord)) {
    throw new Error("Stored encrypted self-test record is missing.");
  }

  if (rawStoredEncryptedRecord?.blob instanceof Blob) {
    throw new Error("Imported encrypted self-test record was stored as a live Blob.");
  }

  const storedBlobBytesLength = getStoredBlobBytesLength(rawStoredEncryptedRecord?.blobBytes);

  if (storedBlobBytesLength) {
    throw new Error("Imported encrypted self-test record still uses whole-file byte storage.");
  }

  if (
    !isEncryptedRecordStoredInChunks(storedEncryptedRecord) ||
    !isEncryptedRecordStoredInChunks(rawStoredEncryptedRecord)
  ) {
    throw new Error("Imported encrypted self-test record is missing chunked storage metadata.");
  }

  const expectedEncryptedPayloadSize = getExpectedEncryptedPayloadSize(storedEncryptedRecord);
  const storedChunkCount = await countStoredDocumentChunks(storedEncryptedRecord);

  if (storedChunkCount !== storedEncryptedRecord.encryptedChunkStorage.chunkCount) {
    throw new Error("Imported encrypted self-test chunk count does not match metadata.");
  }

  if (storedChunkCount < 2) {
    throw new Error("Imported encrypted self-test did not create multiple storage chunks.");
  }

  if (
    getEncryptedPayloadOffset(storedEncryptedRecord) !== 0 ||
    Number.isFinite(storedEncryptedRecord.encryptedPayloadSize) ||
    getEncryptedPayloadSize(storedEncryptedRecord) !== expectedEncryptedPayloadSize ||
    storedEncryptedRecord.encryptedChunkStorage.payloadSize !== expectedEncryptedPayloadSize
  ) {
    throw new Error("Imported encrypted self-test record was not saved as a payload-only library record.");
  }

  const firstStoredChunk = new Uint8Array(await readStoredDocumentChunkBytes(storedEncryptedRecord, 0));
  const storedPrefix = new TextDecoder().decode(
    firstStoredChunk.subarray(0, ENCRYPTED_BACKUP_MAGIC.length),
  );

  if (storedPrefix === ENCRYPTED_BACKUP_MAGIC) {
    throw new Error("Imported encrypted self-test record still contains backup container bytes.");
  }

  updateSelfTestResult("running", "export stored encrypted PDF");
  showStatus("自测：导出分块存储的加密 PDF...", true);
  const exportedBackupBlob = await createStoredEncryptedBackupBlob(storedEncryptedRecord);
  const exportedBackupRecord = await parseEncryptedBackupFile(exportedBackupBlob);
  await verifyEncryptedBackupRecord(exportedBackupRecord, password);

  if (getEncryptedPayloadSize(exportedBackupRecord) !== expectedEncryptedPayloadSize) {
    throw new Error("Exported encrypted self-test backup payload size does not match storage metadata.");
  }

  updateSelfTestResult("running", "reopen encrypted PDF after switching");
  showStatus("自测：从书架重新打开加密 PDF...", true);
  await openSelfTestRecord(storedEncryptedRecord, {}, "reopen encrypted PDF after switching");
  await waitForSelfTestScrollMode("reopen encrypted PDF restored continuous mode");
  const metrics = window.__portableReaderSelfTestMetrics || {};

  if ((metrics.pdfRangeRequests || 0) < 1) {
    throw new Error("Self-test did not exercise PDF range requests.");
  }

  if ((metrics.encryptedChunkReads || 0) < 2) {
    throw new Error("Self-test did not read multiple encrypted chunks.");
  }

  updateSelfTestResult("passed", "encrypted PDF reopened after switching");
  showStatus("自测通过：加密 PDF 切换后可重新打开。");
  console.info("Encrypted switch self-test passed.");
}

async function rapidOpenSelfTestRecords(records, count, delayMs) {
  const opens = [];

  for (let index = 0; index < count; index += 1) {
    const record = records[index % records.length];
    const label = `rapid open ${index + 1}`;
    const open = Promise.race([
      openDocumentRecord(record, { resetProgress: true }),
      wait(25_000).then(() => {
        throw new Error(`${label} timed out after 25000ms; status=${getStatusText() || ""}`);
      }),
    ]).catch((error) => error);

    opens.push(open);
    await wait(delayMs);
  }

  await Promise.allSettled(opens);
}

async function runRapidSwitchSelfTest() {
  const firstId = `${DOCUMENT_ID_PREFIX}selftest-rapid-a`;
  const secondId = `${DOCUMENT_ID_PREFIX}selftest-rapid-b`;

  updateSelfTestResult("running", "prepare rapid switch PDFs");
  window.__portableReaderSelfTestMetrics = {};
  showStatus("自测：准备快速切换 PDF...", true);
  await deleteStoredDocument(firstId).catch(() => {});
  await deleteStoredDocument(secondId).catch(() => {});
  deleteDocumentProgress(firstId);
  deleteDocumentProgress(secondId);

  const firstRecord = createSelfTestPdfRecord(firstId, "rapid switch a", 8, PDF_RANGE_CHUNK_SIZE * 4);
  const secondRecord = createSelfTestPdfRecord(secondId, "rapid switch b", 9, PDF_RANGE_CHUNK_SIZE * 5);

  await putStoredDocument(firstRecord);
  await putStoredDocument(secondRecord);

  updateSelfTestResult("running", "library click open");
  showStatus("自测：点击书架文件...", true);
  state.mode = READ_MODES.PAGED;
  await clickSelfTestLibraryRecord(firstRecord, "library click PDF");

  updateSelfTestResult("running", "rapid switch paged mode");
  showStatus("自测：分页模式快速切换...", true);
  state.mode = READ_MODES.PAGED;
  await rapidOpenSelfTestRecords([firstRecord, secondRecord], 8, 45);
  await openSelfTestRecord(secondRecord, { resetProgress: true }, "rapid paged final PDF");
  assertSelfTestPdfRendered("rapid paged final PDF", { requireNonBlank: true });

  updateSelfTestResult("running", "rapid switch scroll mode");
  showStatus("自测：连续模式快速切换...", true);
  state.mode = READ_MODES.SCROLL;
  await rapidOpenSelfTestRecords([secondRecord, firstRecord], 8, 45);
  await openSelfTestRecord(firstRecord, { resetProgress: true }, "rapid scroll final PDF");
  assertSelfTestPdfRendered("rapid scroll final PDF", { requireNonBlank: true });

  updateSelfTestResult("passed", "rapid PDF switching rendered visible pages");
  showStatus("自测通过：快速切换 PDF 后可正常渲染。");
  console.info("Rapid PDF switch self-test passed.");
}

async function runContinuousWindowSelfTest() {
  const documentId = `${DOCUMENT_ID_PREFIX}selftest-continuous-window`;
  const targetPage = 110;

  updateSelfTestResult("running", "prepare long PDF");
  window.__portableReaderSelfTestMetrics = {};
  showStatus("自测：准备长 PDF 窗口化渲染...", true);
  await deleteStoredDocument(documentId).catch(() => {});
  deleteDocumentProgress(documentId);

  const record = createSelfTestPdfRecord(documentId, "continuous window", 120);
  await putStoredDocument(record);
  state.mode = READ_MODES.PAGED;
  await openSelfTestRecord(record, { resetProgress: true }, "continuous window PDF");

  state.mode = READ_MODES.SCROLL;
  state.page = 1;
  state.scrollPage = 1;
  await renderContinuousDocument(1, { behavior: "auto", restoreScroll: false });

  const maxDomPages = getContinuousDomWindowPageCount();
  const initialShellCount = els.continuousPages.querySelectorAll(".page-shell").length;

  if (initialShellCount > maxDomPages || initialShellCount >= pdfDoc.numPages) {
    throw new Error(`Continuous DOM window created ${initialShellCount} shells for ${pdfDoc.numPages} pages.`);
  }

  updateSelfTestResult("running", "jump inside virtualized PDF");
  await scrollToContinuousPage(targetPage, { behavior: "auto" });
  await renderContinuousPage(targetPage, renderToken, {
    force: true,
    throwOnError: true,
  });
  let targetShell = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    targetShell = getContinuousShellByPageNumber(targetPage);

    if (targetShell?.dataset.rendered === "true") {
      break;
    }

    await wait(100);
  }

  const finalShellCount = els.continuousPages.querySelectorAll(".page-shell").length;

  if (targetShell?.dataset.rendered !== "true") {
    throw new Error(`Continuous DOM window did not render page ${targetPage}.`);
  }

  if (finalShellCount > maxDomPages || continuousDomWindowStart <= 1) {
    throw new Error(`Continuous DOM window did not move correctly; shells=${finalShellCount}.`);
  }

  updateSelfTestResult(
    "passed",
    `continuous DOM window stayed at ${finalShellCount}/${pdfDoc.numPages} pages`,
  );
  showStatus("自测通过：长 PDF 仅保留窗口内页面节点。");
}

async function runLockSecuritySelfTest() {
  const password = "portable-reader-lock-selftest";
  const originalConfig = window.localStorage.getItem(LOCK_KEY);

  try {
    updateSelfTestResult("running", "create Argon2id lock config");
    const currentConfig = await createCurrentLockConfig(password);

    if (!isCurrentLockConfig(currentConfig) || currentConfig.hash || currentConfig.salt) {
      throw new Error("Current lock configuration is not an Argon2id encoded hash.");
    }

    setLockConfig(currentConfig);

    if (!(await verifyLockPassword(password, { upgradeLegacy: false }))) {
      throw new Error("Argon2id lock configuration rejected the correct password.");
    }

    if (await verifyLockPassword(`${password}-wrong`, { upgradeLegacy: false })) {
      throw new Error("Argon2id lock configuration accepted an incorrect password.");
    }

    updateSelfTestResult("running", "migrate legacy lock config");
    const legacySalt = createSalt();
    const legacyHash = await hashPassword(password, legacySalt);
    setLockConfig({
      hash: legacyHash,
      hashAlgorithm: "SHA-256",
      salt: legacySalt,
      version: 2,
    });

    if (!(await verifyLockPassword(password))) {
      throw new Error("Legacy lock configuration rejected the correct password.");
    }

    const migratedConfig = getLockConfig();

    if (!isCurrentLockConfig(migratedConfig) || migratedConfig.hash || migratedConfig.salt) {
      throw new Error("Legacy lock configuration was not migrated to Argon2id.");
    }

    if (!(await verifyLockPassword(password, { upgradeLegacy: false }))) {
      throw new Error("Migrated Argon2id lock configuration rejected the correct password.");
    }

    updateSelfTestResult("passed", "Argon2id lock verification and legacy migration passed");
    showStatus("自测通过：密码锁已使用 Argon2id，旧配置可自动迁移。");
  } finally {
    if (originalConfig === null) {
      window.localStorage.removeItem(LOCK_KEY);
    } else {
      window.localStorage.setItem(LOCK_KEY, originalConfig);
    }
  }
}

async function runDiagnosticsSelfTest() {
  updateSelfTestResult("running", "prepare diagnostics");
  latestDiagnosticsText = "";
  diagnosticsBuildPromise = null;
  showDiagnosticFailureStatus("这个 PDF 暂时打不开。", {
    documentId: `${DOCUMENT_ID_PREFIX}selftest-diagnostics`,
    error: summarizeError(new Error("diagnostics self-test")),
    phase: "diagnostics-selftest",
  });

  const text = await diagnosticsBuildPromise;

  if (els.statusDiagnosticsButton.hidden) {
    throw new Error("Diagnostics button is hidden after failure status.");
  }

  if (!text || !text.includes("portable-pdf-reader-diagnostics")) {
    throw new Error("Diagnostics text was not prepared.");
  }

  updateSelfTestResult("passed", `diagnostics ready: ${text.length} bytes`);
}

async function runSelfTest(mode) {
  if (
    ![
      "continuous-window",
      "diagnostics",
      "encrypted-switch",
      "lock-security",
      "rapid-switch",
    ].includes(mode)
  ) {
    showStatus(`未知自测：${mode}`, true);
    return;
  }

  try {
    if (mode === "diagnostics") {
      await runDiagnosticsSelfTest();
    } else if (mode === "continuous-window") {
      await runContinuousWindowSelfTest();
    } else if (mode === "lock-security") {
      await runLockSecuritySelfTest();
    } else if (mode === "rapid-switch") {
      await runRapidSwitchSelfTest();
    } else {
      await runEncryptedSwitchSelfTest();
    }
  } catch (error) {
    console.error(error);
    updateSelfTestResult("failed", error?.message || String(error));
    showStatus(`自测失败：${error?.message || error}`, true);
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (!["http:", "https:"].includes(window.location.protocol)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./sw.js", {
      updateViaCache: "none",
    });
    registration.update?.().catch(() => {});
  } catch (error) {
    console.warn(error);
  }
}

function initializeLock() {
  if (getLockConfig()) {
    stripStoredPlainFileNames();
    showLockOverlay("unlock");
    return true;
  }

  return false;
}

function initializeVersionBadge() {
  els.appVersion.textContent = APP_VERSION;
}

initializeVersionBadge();
installRuntimeLogHooks();
wireEvents();
setReaderVisible(false);
updateViewerMode();
updateControls();
const selfTestMode = getSelfTestMode();
registerServiceWorker();
if (selfTestMode) {
  runSelfTest(selfTestMode).catch((error) => {
    console.error(error);
    showStatus(`自测失败：${error?.message || error}`, true);
  });
} else if (initializeLock()) {
  renderLibraryList();
} else {
  handleUnlockedSession().catch((error) => console.warn(error));
}
