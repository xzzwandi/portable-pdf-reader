import sodium from "./vendor/libsodium/libsodium-wrappers.mjs";
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
const APP_VERSION = "v58";
const DOCUMENT_FORMATS = {
  PDF: "pdf",
  EPUB: "epub",
};
const READ_MODES = {
  PAGED: "paged",
  SCROLL: "scroll",
};
const CONTINUOUS_KEEP_VIEWPORTS = 2.25;
const CONTINUOUS_RENDER_VIEWPORTS = 1.35;
const CONTINUOUS_MAX_RENDERED_PAGES = 6;
const CONTINUOUS_OBSERVER_MARGIN = "700px 0px";
const CONTINUOUS_RENDER_TIMEOUT_MS = 60_000;
const CONTINUOUS_HEALTH_CHECK_DELAY_MS = 700;
const CONTINUOUS_HEALTH_CHECK_INTERVAL_MS = 1_500;
const CONTINUOUS_BLANK_RETRY_LIMIT = 3;
const CONTINUOUS_CLEANUP_IDLE_MS = 3_500;
const PDF_RANGE_CHUNK_SIZE = 1_048_576;
const MAX_PAGED_CANVAS_PIXELS = 18_000_000;
const MAX_CONTINUOUS_CANVAS_PIXELS = 6_500_000;
const MAX_CANVAS_DIMENSION = 8192;
const FULLSCREEN_EPUB_SWIPE_DISTANCE = 72;
const FULLSCREEN_EPUB_SWIPE_MAX_DRIFT = 52;
const TOC_RENDER_BATCH_SIZE = 72;
const TOC_RENDER_SCROLL_THRESHOLD = 320;
const TOC_ITEM_ESTIMATED_HEIGHT = 58;
const ENCRYPTION_VERSION = 2;
const AES_GCM_ENCRYPTION_VERSION = 1;
const AES_GCM_ALGORITHM = "AES-GCM";
const XCHACHA20_POLY1305_ALGORITHM = "XCHACHA20-POLY1305";
const PBKDF2_KEY_ALGORITHM = "PBKDF2-SHA256";
const ARGON2ID13_KEY_ALGORITHM = "ARGON2ID13";
const ENCRYPTION_ALGORITHM = XCHACHA20_POLY1305_ALGORITHM;
const ENCRYPTION_KEY_ALGORITHM = ARGON2ID13_KEY_ALGORITHM;
const ENCRYPTION_KDF_ITERATIONS = 300_000;
const ENCRYPTION_CHUNK_SIZE = 1_048_576;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_NONCE_PREFIX_BYTES = 4;
const AES_GCM_TAG_BYTES = 16;
const XCHACHA_NONCE_BYTES = 24;
const XCHACHA_NONCE_PREFIX_BYTES = 16;
const XCHACHA_TAG_BYTES = 16;
const ENCRYPTED_CHUNK_CACHE_LIMIT = 8;
const ENCRYPTED_NAME_VERSION = 1;

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
  lockButton: document.querySelector("#lockButton"),
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
  scrollModeButton: document.querySelector("#scrollModeButton"),
  status: document.querySelector("#status"),
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
let restoreAttempted = false;
let scrollTrackingSuppressionDepth = 0;
let statusTimer = null;
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
const continuousRenderRuns = new Map();
const continuousBlankRetries = new Map();
let continuousQueueRunning = false;
let continuousRenderRunId = 0;
let continuousHealthTimer = null;
let continuousCleanupTimer = null;

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

async function getPasswordHashCandidates(password, salt) {
  const hashes = [await hashPassword(password, salt), hashLegacyLocalPassword(password, salt)];
  return [...new Set(hashes)];
}

function setSessionPassword(password) {
  sessionPassword = password || "";
}

function clearSessionPassword() {
  sessionPassword = "";
  encryptionKeyCache.clear();
}

async function ensureSodiumReady() {
  await sodium.ready;
  return sodium;
}

async function isSodiumEncryptionAvailable() {
  if (!window.crypto?.getRandomValues) {
    return false;
  }

  try {
    const sodiumApi = await ensureSodiumReady();
    return Boolean(
      sodiumApi.crypto_aead_xchacha20poly1305_ietf_encrypt &&
        sodiumApi.crypto_aead_xchacha20poly1305_ietf_decrypt &&
        sodiumApi.crypto_pwhash,
    );
  } catch (error) {
    console.warn(error);
    return false;
  }
}

function isWebCryptoEncryptionAvailable() {
  return Boolean(window.crypto?.subtle && window.crypto?.getRandomValues);
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex = "") {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string.");
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function getEncryptionOriginalSize(record = {}) {
  return Number.isFinite(record.encryption?.originalSize)
    ? record.encryption.originalSize
    : record.size || record.blob?.size || 0;
}

function isAesGcmRecordEncryption(encryption = {}) {
  return (
    encryption?.version === AES_GCM_ENCRYPTION_VERSION &&
    encryption?.algorithm === AES_GCM_ALGORITHM &&
    encryption?.keyAlgorithm === PBKDF2_KEY_ALGORITHM &&
    typeof encryption?.salt === "string" &&
    typeof encryption?.noncePrefix === "string" &&
    Number.isFinite(encryption?.chunkSize) &&
    Number.isFinite(encryption?.originalSize)
  );
}

function isXChaChaRecordEncryption(encryption = {}) {
  return (
    encryption?.version === ENCRYPTION_VERSION &&
    encryption?.algorithm === XCHACHA20_POLY1305_ALGORITHM &&
    encryption?.keyAlgorithm === ARGON2ID13_KEY_ALGORITHM &&
    typeof encryption?.salt === "string" &&
    typeof encryption?.noncePrefix === "string" &&
    Number.isFinite(encryption?.chunkSize) &&
    Number.isFinite(encryption?.originalSize)
  );
}

function isRecordEncrypted(record = {}) {
  return (
    record.encrypted === true &&
    (isXChaChaRecordEncryption(record.encryption) || isAesGcmRecordEncryption(record.encryption))
  );
}

function isCurrentRecordEncryption(record = {}) {
  return (
    record.encrypted === true &&
    isXChaChaRecordEncryption(record.encryption)
  );
}

function isRecordNameEncrypted(record = {}) {
  if (!isRecordEncrypted(record) || record.encryptedName?.version !== ENCRYPTED_NAME_VERSION) {
    return false;
  }

  if (isXChaChaRecordEncryption(record.encryption)) {
    return (
      record.encryptedName?.algorithm === XCHACHA20_POLY1305_ALGORITHM &&
      typeof record.encryptedName?.nonce === "string" &&
      typeof record.encryptedName?.data === "string"
    );
  }

  return (
    record.encryptedName?.algorithm === AES_GCM_ALGORITHM &&
    typeof record.encryptedName?.iv === "string" &&
    typeof record.encryptedName?.data === "string"
  );
}

function getFallbackDocumentName(format = DOCUMENT_FORMATS.PDF) {
  return format === DOCUMENT_FORMATS.EPUB ? "未命名.epub" : "未命名.pdf";
}

function getPlainRecordName(record = {}) {
  return record.name || getFallbackDocumentName(getDocumentFormat(record));
}

function recordNeedsEncryptionMigration(record = {}) {
  if (!isRecordEncrypted(record)) {
    return true;
  }

  if (!isCurrentRecordEncryption(record)) {
    return false;
  }

  return !isRecordNameEncrypted(record) || Boolean(record.name);
}

function createChunkIv(encryption, chunkIndex) {
  const prefix = hexToBytes(encryption.noncePrefix || "");

  if (prefix.length !== AES_GCM_NONCE_PREFIX_BYTES) {
    throw new Error("Invalid AES-GCM nonce prefix.");
  }

  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  iv.set(prefix, 0);

  let value = Math.max(0, Math.floor(chunkIndex));
  for (let index = AES_GCM_IV_BYTES - 1; index >= AES_GCM_NONCE_PREFIX_BYTES; index -= 1) {
    iv[index] = value & 0xff;
    value = Math.floor(value / 256);
  }

  return iv;
}

function createChunkNonce(encryption, chunkIndex) {
  const prefix = hexToBytes(encryption.noncePrefix || "");

  if (prefix.length !== XCHACHA_NONCE_PREFIX_BYTES) {
    throw new Error("Invalid XChaCha20-Poly1305 nonce prefix.");
  }

  const nonce = new Uint8Array(XCHACHA_NONCE_BYTES);
  nonce.set(prefix, 0);

  let value = Math.max(0, Math.floor(chunkIndex));
  for (let index = XCHACHA_NONCE_BYTES - 1; index >= XCHACHA_NONCE_PREFIX_BYTES; index -= 1) {
    nonce[index] = value & 0xff;
    value = Math.floor(value / 256);
  }

  return nonce;
}

function getEncryptionTagBytes(encryption = {}) {
  if (Number.isFinite(encryption.tagLength) && encryption.tagLength > 0) {
    return Math.ceil(encryption.tagLength / 8);
  }

  return encryption.algorithm === AES_GCM_ALGORITHM ? AES_GCM_TAG_BYTES : XCHACHA_TAG_BYTES;
}

function createChunkAad(record, encryption, chunkIndex) {
  const format = getDocumentFormat(record);
  return new TextEncoder().encode(
    [
      "portable-pdf-reader",
      `encryption-v${encryption.version}`,
      encryption.algorithm,
      record.id || "",
      format,
      String(encryption.originalSize),
      String(encryption.chunkSize),
      String(chunkIndex),
    ].join("|"),
  );
}

function createNameAad(record, encryption) {
  const format = getDocumentFormat(record);
  return new TextEncoder().encode(
    [
      "portable-pdf-reader",
      "encrypted-name",
      `encryption-v${encryption.version}`,
      encryption.algorithm,
      record.id || "",
      format,
      String(encryption.originalSize),
      String(encryption.chunkSize),
    ].join("|"),
  );
}

async function verifyLockPassword(password) {
  const config = getLockConfig();

  if (!config) {
    return true;
  }

  return (await getPasswordHashCandidates(password, config.salt)).includes(config.hash);
}

async function deriveAesGcmKey(password, encryption) {
  if (!isWebCryptoEncryptionAvailable()) {
    throw new Error("AES-GCM records require Web Crypto. Open this record over HTTPS or localhost.");
  }

  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: hexToBytes(encryption.salt),
      iterations: encryption.iterations || ENCRYPTION_KDF_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: AES_GCM_ALGORITHM,
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveXChaChaKey(password, encryption) {
  const sodiumApi = await ensureSodiumReady();
  const salt = hexToBytes(encryption.salt);

  if (salt.length !== sodiumApi.crypto_pwhash_SALTBYTES) {
    throw new Error("Invalid Argon2id salt.");
  }

  return sodiumApi.crypto_pwhash(
    sodiumApi.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    password,
    salt,
    encryption.opsLimit || sodiumApi.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    encryption.memLimit || sodiumApi.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodiumApi.crypto_pwhash_ALG_ARGON2ID13,
  );
}

async function deriveEncryptionKey(password, encryption) {
  if (encryption?.algorithm === AES_GCM_ALGORITHM) {
    return deriveAesGcmKey(password, encryption);
  }

  if (encryption?.algorithm === XCHACHA20_POLY1305_ALGORITHM) {
    return deriveXChaChaKey(password, encryption);
  }

  throw new Error("Unsupported document encryption.");
}

function getEncryptionKeyCacheId(record = {}) {
  return [
    record.id || "",
    record.encryption?.version || "",
    record.encryption?.algorithm || "",
    record.encryption?.salt || "",
  ].join(":");
}

async function getEncryptionKeyForRecord(record, password = sessionPassword) {
  if (!isRecordEncrypted(record)) {
    return null;
  }

  if (!password) {
    throw new Error("Encrypted document is locked.");
  }

  const cacheId = getEncryptionKeyCacheId(record);

  if (encryptionKeyCache.has(cacheId)) {
    return encryptionKeyCache.get(cacheId);
  }

  const key = await deriveEncryptionKey(password, record.encryption);
  encryptionKeyCache.set(cacheId, key);
  return key;
}

async function encryptRecordName(record, key, encryption) {
  const plainName = getPlainRecordName(record);
  const plainBytes = new TextEncoder().encode(plainName);

  if (encryption.algorithm === AES_GCM_ALGORITHM) {
    const iv = randomBytes(AES_GCM_IV_BYTES);
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: AES_GCM_ALGORITHM,
        iv,
        additionalData: createNameAad(record, encryption),
        tagLength: AES_GCM_TAG_BYTES * 8,
      },
      key,
      plainBytes,
    );

    return {
      algorithm: AES_GCM_ALGORITHM,
      data: bytesToHex(new Uint8Array(encrypted)),
      encoding: "utf-8",
      iv: bytesToHex(iv),
      tagLength: AES_GCM_TAG_BYTES * 8,
      version: ENCRYPTED_NAME_VERSION,
    };
  }

  const sodiumApi = await ensureSodiumReady();
  const nonce = randomBytes(sodiumApi.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const encrypted = sodiumApi.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plainBytes,
    createNameAad(record, encryption),
    null,
    nonce,
    key,
  );

  return {
    algorithm: XCHACHA20_POLY1305_ALGORITHM,
    data: bytesToHex(encrypted),
    encoding: "utf-8",
    nonce: bytesToHex(nonce),
    tagLength: sodiumApi.crypto_aead_xchacha20poly1305_ietf_ABYTES * 8,
    version: ENCRYPTED_NAME_VERSION,
  };
}

async function decryptRecordName(record, key) {
  if (!isRecordNameEncrypted(record)) {
    return getPlainRecordName(record);
  }

  if (record.encryption.algorithm === AES_GCM_ALGORITHM) {
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: AES_GCM_ALGORITHM,
        iv: hexToBytes(record.encryptedName.iv),
        additionalData: createNameAad(record, record.encryption),
        tagLength: record.encryptedName.tagLength || AES_GCM_TAG_BYTES * 8,
      },
      key,
      hexToBytes(record.encryptedName.data),
    );

    return new TextDecoder().decode(decrypted) || getFallbackDocumentName(getDocumentFormat(record));
  }

  const sodiumApi = await ensureSodiumReady();
  const decrypted = sodiumApi.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    hexToBytes(record.encryptedName.data),
    createNameAad(record, record.encryption),
    hexToBytes(record.encryptedName.nonce),
    key,
  );

  return new TextDecoder().decode(decrypted) || getFallbackDocumentName(getDocumentFormat(record));
}

function withoutPlainRecordName(record) {
  const next = { ...record };
  delete next.name;
  return next;
}

async function getRecordDisplayName(record = {}) {
  if (isRecordNameEncrypted(record)) {
    if (!sessionPassword) {
      return getFallbackDocumentName(getDocumentFormat(record));
    }

    try {
      const key = await getEncryptionKeyForRecord(record);
      return await decryptRecordName(record, key);
    } catch (error) {
      console.warn(error);
      return getFallbackDocumentName(getDocumentFormat(record));
    }
  }

  return getPlainRecordName(record);
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

      const salt = createSalt();
      const hash = await hashPassword(password, salt);
      setLockConfig({
        hash,
        hashAlgorithm: "SHA-256",
        salt,
        version: 2,
      });
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

  const config = getLockConfig();

  if (!config) {
    setLockBusy(false);
    hideLockOverlay();
    return;
  }

  try {
    const hashes = await getPasswordHashCandidates(password, config.salt);

    if (!hashes.includes(config.hash)) {
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

async function cancelCurrentRender() {
  clearContinuousHealthTimer();
  clearContinuousCleanupTimer();

  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }

  for (const task of pageRenderTasks.values()) {
    task.cancel();
  }
  pageRenderTasks.clear();
  continuousRenderPromises.clear();
  continuousRenderRuns.clear();
}

function clearContinuousPages() {
  clearContinuousHealthTimer();
  clearContinuousCleanupTimer();

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
  continuousRenderRuns.clear();
  continuousBlankRetries.clear();
  els.continuousPages.replaceChildren();
}

async function closeCurrentDocument() {
  renderToken += 1;
  setEpubLoading(false);
  closeImagePreview();
  closeToc();
  setAppFullscreen(false, { syncLayout: false });
  await cancelCurrentRender();
  clearContinuousPages();

  els.canvas.removeAttribute("width");
  els.canvas.removeAttribute("height");
  els.canvas.removeAttribute("style");
  els.epubViewer.replaceChildren();
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

class BlobDocumentSource {
  constructor(blob) {
    this.blob = blob;
    this.length = blob.size;
  }

  async readRange(begin, end) {
    const safeBegin = clamp(Math.floor(begin), 0, this.length);
    const safeEnd = clamp(Math.ceil(end), safeBegin, this.length);
    return new Uint8Array(await this.blob.slice(safeBegin, safeEnd).arrayBuffer());
  }
}

class EncryptedDocumentSource {
  constructor(record, key) {
    this.record = record;
    this.blob = record.blob;
    this.encryption = record.encryption;
    this.key = key;
    this.length = getEncryptionOriginalSize(record);
    this.chunkCache = new Map();
  }

  get chunkSize() {
    return this.encryption.chunkSize || ENCRYPTION_CHUNK_SIZE;
  }

  async readEncryptedChunk(chunkIndex) {
    if (this.chunkCache.has(chunkIndex)) {
      return this.chunkCache.get(chunkIndex);
    }

    const plainStart = chunkIndex * this.chunkSize;
    const plainLength = Math.min(this.chunkSize, Math.max(0, this.length - plainStart));
    const tagBytes = getEncryptionTagBytes(this.encryption);
    const encryptedOffset = chunkIndex * (this.chunkSize + tagBytes);
    const encryptedEnd = encryptedOffset + plainLength + tagBytes;
    const encryptedBytes = new Uint8Array(await this.blob.slice(encryptedOffset, encryptedEnd).arrayBuffer());
    let bytes;

    if (this.encryption.algorithm === AES_GCM_ALGORITHM) {
      const decrypted = await window.crypto.subtle.decrypt(
        {
          name: AES_GCM_ALGORITHM,
          iv: createChunkIv(this.encryption, chunkIndex),
          additionalData: createChunkAad(this.record, this.encryption, chunkIndex),
          tagLength: this.encryption.tagLength || AES_GCM_TAG_BYTES * 8,
        },
        this.key,
        encryptedBytes,
      );
      bytes = new Uint8Array(decrypted);
    } else {
      const sodiumApi = await ensureSodiumReady();
      bytes = sodiumApi.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        encryptedBytes,
        createChunkAad(this.record, this.encryption, chunkIndex),
        createChunkNonce(this.encryption, chunkIndex),
        this.key,
      );
    }

    this.chunkCache.set(chunkIndex, bytes);

    if (this.chunkCache.size > ENCRYPTED_CHUNK_CACHE_LIMIT) {
      const oldestKey = this.chunkCache.keys().next().value;
      this.chunkCache.delete(oldestKey);
    }

    return bytes;
  }

  async readRange(begin, end) {
    const safeBegin = clamp(Math.floor(begin), 0, this.length);
    const safeEnd = clamp(Math.ceil(end), safeBegin, this.length);
    const output = new Uint8Array(safeEnd - safeBegin);

    if (!output.length) {
      return output;
    }

    const firstChunk = Math.floor(safeBegin / this.chunkSize);
    const lastChunk = Math.floor((safeEnd - 1) / this.chunkSize);
    let outputOffset = 0;

    for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
      const chunk = await this.readEncryptedChunk(chunkIndex);
      const chunkPlainStart = chunkIndex * this.chunkSize;
      const sliceStart = Math.max(0, safeBegin - chunkPlainStart);
      const sliceEnd = Math.min(chunk.length, safeEnd - chunkPlainStart);
      output.set(chunk.subarray(sliceStart, sliceEnd), outputOffset);
      outputOffset += sliceEnd - sliceStart;
    }

    return output;
  }
}

class PdfDataRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  constructor(source, initialData, fileName = "") {
    super(source.length, initialData, true, fileName);
    this.source = source;
    this.aborted = false;
  }

  async requestDataRange(begin, end) {
    if (this.aborted) {
      return;
    }

    const safeBegin = clamp(Math.floor(begin), 0, this.length);
    const safeEnd = clamp(Math.ceil(end), safeBegin, this.length);

    try {
      const chunk = await this.source.readRange(safeBegin, safeEnd);

      if (this.aborted) {
        return;
      }

      this.onDataRange(safeBegin, chunk);
      this.onDataProgress(safeEnd, this.length);
    } catch (error) {
      if (!this.aborted) {
        console.error(error);
      }
    }
  }

  abort() {
    this.aborted = true;
  }
}

async function createDocumentSourceFromRecord(record) {
  if (!isRecordEncrypted(record)) {
    return new BlobDocumentSource(record.blob);
  }

  if (!sessionPassword) {
    throw new Error("Encrypted document is locked.");
  }

  const key = await getEncryptionKeyForRecord(record);
  return new EncryptedDocumentSource(record, key);
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

  const originalSize = record.size || record.blob.size || 0;
  const sodiumApi = await ensureSodiumReady();
  const encryption = {
    algorithm: ENCRYPTION_ALGORITHM,
    chunkSize: ENCRYPTION_CHUNK_SIZE,
    encryptedAt: Date.now(),
    keyAlgorithm: ENCRYPTION_KEY_ALGORITHM,
    memLimit: sodiumApi.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    noncePrefix: bytesToHex(randomBytes(XCHACHA_NONCE_PREFIX_BYTES)),
    opsLimit: sodiumApi.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    originalSize,
    salt: bytesToHex(randomBytes(sodiumApi.crypto_pwhash_SALTBYTES)),
    tagLength: sodiumApi.crypto_aead_xchacha20poly1305_ietf_ABYTES * 8,
    version: ENCRYPTION_VERSION,
  };
  const key = await deriveEncryptionKey(password, encryption);
  const encryptedName = await encryptRecordName(record, key, encryption);
  const totalChunks = Math.max(1, Math.ceil(originalSize / encryption.chunkSize));
  const encryptedParts = [];

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const begin = chunkIndex * encryption.chunkSize;
    const end = Math.min(begin + encryption.chunkSize, originalSize);
    const plainBytes = new Uint8Array(await record.blob.slice(begin, end).arrayBuffer());
    const encryptedBytes = sodiumApi.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plainBytes,
      createChunkAad(record, encryption, chunkIndex),
      null,
      createChunkNonce(encryption, chunkIndex),
      key,
    );

    encryptedParts.push(encryptedBytes);
    onProgress({
      chunkIndex: chunkIndex + 1,
      totalChunks,
    });
  }

  return {
    ...withoutPlainRecordName(record),
    blob: new Blob(encryptedParts, { type: "application/octet-stream" }),
    encrypted: true,
    encryptedName,
    encryption,
    size: originalSize,
  };
}

async function createPdfLoadingTaskFromSource(source, meta = {}) {
  const initialEnd = Math.min(PDF_RANGE_CHUNK_SIZE, source.length);
  const initialData = initialEnd > 0 ? await source.readRange(0, initialEnd) : undefined;
  const range = new PdfDataRangeTransport(source, initialData, meta.name || state.fileName || "");

  return pdfjsLib.getDocument({
    range,
    length: source.length,
    rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
    disableStream: true,
    disableAutoFetch: true,
    cMapPacked: true,
    cMapUrl: `${PDFJS_ROOT}cmaps/`,
    standardFontDataUrl: `${PDFJS_ROOT}standard_fonts/`,
    wasmUrl: `${PDFJS_ROOT}image_decoders/`,
  });
}

async function createPdfLoadingTaskFromBlob(blob, meta = {}) {
  return createPdfLoadingTaskFromSource(new BlobDocumentSource(blob), meta);
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
  let page = null;
  showStatus("正在渲染...", true);

  try {
    await cancelCurrentRender();
    clearContinuousPages();

    page = await pdfDoc.getPage(targetPage);

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
    page = await pdfDoc.getPage(clamp(state.page, 1, pdfDoc.numPages));
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

function buildContinuousPlaceholders(estimatedSize) {
  const fragment = document.createDocumentFragment();

  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
    const shell = document.createElement("article");
    shell.className = "page-shell";
    shell.dataset.page = String(pageNumber);
    setContinuousShellSize(shell, estimatedSize.width, estimatedSize.height);

    const placeholder = createContinuousPlaceholder(estimatedSize.width, estimatedSize.height);

    const label = document.createElement("div");
    label.className = "page-label";
    label.textContent = String(pageNumber);

    shell.append(placeholder, label);
    fragment.append(shell);
  }

  els.continuousPages.append(fragment);
}

function setContinuousShellSize(shell, width, height) {
  const safeWidth = Math.max(240, Math.floor(width));
  const safeHeight = Math.max(320, Math.floor(height));
  shell.dataset.pageWidth = String(safeWidth);
  shell.dataset.pageHeight = String(safeHeight);
  shell.style.minHeight = `${safeHeight + 28}px`;
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

function getContinuousViewportWindow(extraViewports = CONTINUOUS_KEEP_VIEWPORTS) {
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
  return pageNumber === state.page || pageNumber === state.scrollPage;
}

function isContinuousShellNearViewport(shell, extraViewports = CONTINUOUS_KEEP_VIEWPORTS) {
  const windowBounds = getContinuousViewportWindow(extraViewports);
  const top = shell.offsetTop - els.continuousPages.offsetTop;
  const bottom = top + Math.max(shell.offsetHeight, 1);
  return bottom >= windowBounds.top && top <= windowBounds.bottom;
}

function getContinuousShellDistance(shell) {
  const { center } = getContinuousViewportWindow(0);
  const top = shell.offsetTop - els.continuousPages.offsetTop;
  const shellCenter = top + Math.max(shell.offsetHeight, 1) / 2;
  return Math.abs(shellCenter - center);
}

function getVisibleContinuousShells(extraViewports = 0.35) {
  if (!els.continuousPages.childElementCount) {
    return [];
  }

  return Array.from(els.continuousPages.querySelectorAll(".page-shell"))
    .filter((shell) => isContinuousShellNearViewport(shell, extraViewports))
    .sort((a, b) => getContinuousShellDistance(a) - getContinuousShellDistance(b));
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

  for (const shell of getVisibleContinuousShells().slice(0, CONTINUOUS_MAX_RENDERED_PAGES)) {
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

      if (retryCount < CONTINUOUS_BLANK_RETRY_LIMIT) {
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
    const shell = els.continuousPages.querySelector(`[data-page="${pageNumber}"]`);

    if (!shell || !isContinuousShellNearViewport(shell, CONTINUOUS_RENDER_VIEWPORTS)) {
      task.cancel();
      pageRenderTasks.delete(pageNumber);
    }
  }

  const renderedShells = Array.from(
    els.continuousPages.querySelectorAll('.page-shell[data-rendered="true"]'),
  );
  const keptShells = [];

  for (const shell of renderedShells) {
    if (isContinuousShellNearViewport(shell)) {
      keptShells.push(shell);
    } else {
      releaseContinuousCanvas(shell);
    }
  }

  if (keptShells.length > CONTINUOUS_MAX_RENDERED_PAGES) {
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
      .slice(CONTINUOUS_MAX_RENDERED_PAGES)
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
    const shell = els.continuousPages.querySelector(`[data-page="${pageNumber}"]`);

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

    if (!isContinuousShellNearViewport(shell, CONTINUOUS_RENDER_VIEWPORTS)) {
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

  const shell = els.continuousPages.querySelector(`[data-page="${pageNumber}"]`);

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

  const shell = els.continuousPages.querySelector(`[data-page="${targetPage}"]`);

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

  const shells = Array.from(els.continuousPages.querySelectorAll(".page-shell"))
    .filter((shell) => isContinuousShellNearViewport(shell, CONTINUOUS_RENDER_VIEWPORTS))
    .sort((a, b) => getContinuousShellDistance(a) - getContinuousShellDistance(b));

  for (const shell of shells.slice(0, CONTINUOUS_MAX_RENDERED_PAGES)) {
    scheduleContinuousPageRender(getContinuousShellPageNumber(shell), token);
  }

  scheduleContinuousHealthCheck();
}

async function renderContinuousPage(pageNumber, token = renderToken, options = {}) {
  if (!pdfDoc || token !== renderToken) {
    return;
  }

  const targetPage = clamp(Math.round(pageNumber), 1, pdfDoc.numPages);
  const shell = els.continuousPages.querySelector(`[data-page="${targetPage}"]`);

  if (!shell || (!options.force && shell.dataset.rendered === "true")) {
    return;
  }

  const existingRender = continuousRenderPromises.get(targetPage);

  if (existingRender) {
    await existingRender.catch((error) => {
      if (error?.name !== "RenderingCancelledException") {
        console.error(error);
      }
    });
    return;
  }

  const runId = (continuousRenderRunId += 1);
  continuousRenderRuns.set(targetPage, runId);
  shell.dataset.renderRunId = String(runId);

  const renderPromise = renderContinuousPageInternal(targetPage, shell, token, runId, options);
  continuousRenderPromises.set(targetPage, renderPromise);

  try {
    await renderPromise;
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

async function renderContinuousPageInternal(targetPage, shell, token, runId, options = {}) {
  if (!options.force && !isContinuousShellNearViewport(shell, CONTINUOUS_RENDER_VIEWPORTS)) {
    return;
  }

  shell.dataset.rendering = "true";
  shell.dataset.renderStartedAt = String(Date.now());
  let page = null;
  let task = null;

  try {
    page = await pdfDoc.getPage(targetPage);

    if (!isContinuousRenderCurrent(targetPage, shell, token, runId)) {
      return;
    }

    if (!options.force && !isContinuousShellNearViewport(shell, CONTINUOUS_RENDER_VIEWPORTS)) {
      releaseContinuousCanvas(shell);
      return;
    }

    const viewport = getScaledViewport(page);
    const canvas = ensureContinuousCanvas(shell, viewport);
    const context = prepareCanvas(canvas, viewport);

    task = page.render({
      canvasContext: context,
      viewport,
    });

    pageRenderTasks.set(targetPage, task);
    await task.promise;

    if (!isContinuousRenderCurrent(targetPage, shell, token, runId)) {
      // A stale render can finish after a retry has reused the shell; leave the newer canvas alone.
      return;
    }

    shell.dataset.rendered = "true";
    shell.dataset.renderedAt = String(Date.now());
    scheduleContinuousHealthCheck(260);
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
    }

    if (isContinuousRenderCurrent(targetPage, shell, token, runId)) {
      releaseContinuousCanvas(shell);
    }
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
    scheduleContinuousPageRender(state.page + 1, token);
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
      rootMargin: CONTINUOUS_OBSERVER_MARGIN,
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

function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
  const shell = els.continuousPages.querySelector(`[data-page="${targetPage}"]`);

  if (!shell) {
    return;
  }

  if (options.renderFirst !== false) {
    scheduleContinuousPageRender(targetPage, renderToken);
  }

  els.canvasWrap.scrollTo({
    top: getContinuousPageTop(shell),
    behavior: options.behavior || "smooth",
  });

  window.requestAnimationFrame(() => {
    queueVisibleContinuousPages(renderToken);
    pruneContinuousPages();
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

    releaseScrollTracking();
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

    scheduleContinuousPageRender(targetPage - 1, token);
    scheduleContinuousPageRender(targetPage + 1, token);
    queueVisibleContinuousPages(token);
    pruneContinuousPages();
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

async function loadEpubFromSource(source, meta = {}) {
  await closeCurrentDocument();
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
    const buffer = getExactArrayBuffer(bytes);
    const book = window.ePub(undefined, {
      replacements: "blobUrl",
    });
    await book.open(buffer, "binary");
    await book.ready;

    epubBook = book;
    createEpubRendition();

    state.documentId = meta.id || state.documentId;
    state.fileName = meta.name || state.fileName || "未命名.epub";
    state.epubProgress = clamp(state.epubProgress || 0, 0, 1);
    state.page = clamp(state.page || 1, 1, epubBook.spine?.length || Number.MAX_SAFE_INTEGER);
    epubLastKnownIndex = clamp(state.page - 1, 0, getEpubChapterTotal() - 1);

    updateControls();
    await epubRendition.display(state.epubCfi || undefined);
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
  } catch (error) {
    console.error(error);
    setEpubLoading(false);
    await closeCurrentDocument();
    state.format = DOCUMENT_FORMATS.PDF;
    setReaderVisible(false);
    updateViewerMode();
    showStatus("这个 EPUB 暂时打不开。", true);
  }
}

async function loadEpubFromBlob(blob, meta = {}) {
  return loadEpubFromSource(new BlobDocumentSource(blob), meta);
}

async function loadEpubFromRecord(record, meta = {}) {
  const source = await createDocumentSourceFromRecord(record);
  return loadEpubFromSource(source, meta);
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

async function loadPdfFromSource(source, meta = {}, requestedPage = 1) {
  await closeCurrentDocument();
  state.format = DOCUMENT_FORMATS.PDF;
  state.epubCfi = "";
  state.epubProgress = 0;
  setReaderVisible(true);
  updateViewerMode();
  showStatus("正在打开 PDF...", true);

  try {
    const loadingTask = await createPdfLoadingTaskFromSource(source, meta);
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

async function loadPdfFromBlob(blob, meta = {}, requestedPage = 1) {
  return loadPdfFromSource(new BlobDocumentSource(blob), meta, requestedPage);
}

async function loadPdfFromRecord(record, meta = {}, requestedPage = 1) {
  const source = await createDocumentSourceFromRecord(record);
  return loadPdfFromSource(source, meta, requestedPage);
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
  state.fileName = await getRecordDisplayName(record);

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
    await loadEpubFromRecord(record, { id: record.id, name: state.fileName });
  } else {
    await loadPdfFromRecord(record, { id: record.id, name: state.fileName }, state.page);
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

async function readDocumentsNeedingEncryptionMigration() {
  const records = await readLibraryDocuments();
  return records.filter((record) => record?.blob && recordNeedsEncryptionMigration(record));
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
  if (!getLockConfig() || encryptionPromptDismissed || encryptionMigrationInProgress) {
    return;
  }

  if (!(await isSodiumEncryptionAvailable())) {
    showStatus("当前浏览器不支持安全随机数或 libsodium 初始化失败，暂时无法加密文件。", true);
    return;
  }

  try {
    const documents = await readDocumentsNeedingEncryptionMigration();

    if (documents.length > 0) {
      showEncryptionMigrationPrompt(documents.length);
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
  if (!isSupportedDocumentFile(file)) {
    showStatus("请选择 PDF 或 EPUB 文件。");
    return;
  }

  try {
    if (getLockConfig() && sessionPassword) {
      showStatus("正在加密并加入书架...", true);
    }

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
    state.fileName = await getRecordDisplayName(record);
    applyDocumentProgress(record.id, state.page || 1);
    showStatus("正在恢复上次阅读...", true);
    if (state.format === DOCUMENT_FORMATS.EPUB) {
      await loadEpubFromRecord(record, { id: record.id, name: state.fileName });
    } else {
      await loadPdfFromRecord(record, { id: record.id, name: state.fileName }, state.page);
    }
    renderLibraryList();
  } catch (error) {
    console.warn(error);
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
  els.libraryOverlay.hidden = true;
  updatePanelScrollLock();
}

async function openLibrary() {
  if (!els.encryptionOverlay.hidden) {
    return;
  }

  closeToc();
  await renderLibraryList();
  els.libraryOverlay.hidden = false;
  updatePanelScrollLock();
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
    !els.libraryOverlay.hidden || !els.tocOverlay.hidden || !els.encryptionOverlay.hidden;

  document.documentElement.classList.toggle("is-panel-open", panelOpen);
  document.body.classList.toggle("is-panel-open", panelOpen);
}

function getScrollablePanelList(target) {
  return target?.closest?.(".library-list, .toc-list, .encryption-panel") || null;
}

function rememberPanelTouch(event) {
  overlayTouchY = event.touches?.[0]?.clientY || 0;
}

function preventPanelScrollLeak(event) {
  if (els.libraryOverlay.hidden && els.tocOverlay.hidden && els.encryptionOverlay.hidden) {
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
      name.textContent = await getRecordDisplayName(record);

      meta.className = "library-meta";
      meta.textContent = `${isActive ? "正在阅读 · " : ""}${format.toUpperCase()} · ${progressLabel} · ${formatFileSize(record.size || record.blob?.size || 0)}${isRecordEncrypted(record) ? " · 已加密" : ""}`;

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
  if (!els.lockOverlay.hidden || !els.encryptionOverlay.hidden || !els.imageOverlay.hidden) {
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
  els.fullscreenButton.addEventListener("click", () => {
    toggleAppFullscreen();
  });
  els.floatingFullscreenButton.addEventListener("click", () => {
    toggleAppFullscreen();
  });
  els.floatingLockButton.addEventListener("click", lockReader);
  els.libraryButton.addEventListener("click", openLibrary);
  els.libraryCloseButton.addEventListener("click", closeLibrary);
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
  els.lockButton.addEventListener("click", lockReader);
  els.lockCancelButton.addEventListener("click", hideLockOverlay);
  els.lockForm.addEventListener("submit", handleLockSubmit);
  els.lockOverlay.addEventListener("touchmove", preventLockScroll, { passive: false });
  els.lockOverlay.addEventListener("wheel", preventLockScroll, { passive: false });
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

  els.canvasWrap.addEventListener("scroll", updateCurrentPageFromScroll, { passive: true });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && appFullscreen && !syncingNativeFullscreen) {
      setAppFullscreen(false);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistReaderPositionNow();
      return;
    }

    lastViewportChangeAt = Date.now();
    restoreReaderPositionAfterResume();
    scheduleContinuousHealthCheck(300);
  });

  window.addEventListener("pagehide", persistReaderPositionNow);
  window.addEventListener("beforeunload", persistReaderPositionNow);
  window.addEventListener("pageshow", () => {
    lastViewportChangeAt = Date.now();
    restoreReaderPositionAfterResume();
    scheduleContinuousHealthCheck(300);
  });
  window.addEventListener("focus", () => {
    lastViewportChangeAt = Date.now();
    restoreReaderPositionAfterResume();
    scheduleContinuousHealthCheck(300);
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
wireEvents();
setReaderVisible(false);
updateViewerMode();
updateControls();
const startedLocked = initializeLock();
registerServiceWorker();
if (startedLocked) {
  renderLibraryList();
} else {
  handleUnlockedSession().catch((error) => console.warn(error));
}
