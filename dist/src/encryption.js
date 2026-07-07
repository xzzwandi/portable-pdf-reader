import sodium from "../vendor/libsodium/libsodium-wrappers.mjs";
import {
  AES_GCM_ALGORITHM,
  AES_GCM_ENCRYPTION_VERSION,
  AES_GCM_IV_BYTES,
  AES_GCM_NONCE_PREFIX_BYTES,
  AES_GCM_TAG_BYTES,
  ARGON2ID13_KEY_ALGORITHM,
  DOCUMENT_FORMATS,
  ENCRYPTED_BACKUP_MAGIC,
  ENCRYPTED_BACKUP_MAX_HEADER_BYTES,
  ENCRYPTED_BACKUP_VERSION,
  ENCRYPTED_NAME_VERSION,
  ENCRYPTION_CHUNK_SIZE,
  ENCRYPTION_KDF_ITERATIONS,
  ENCRYPTION_VERSION,
  PBKDF2_KEY_ALGORITHM,
  XCHACHA20_POLY1305_ALGORITHM,
  XCHACHA_NONCE_BYTES,
  XCHACHA_NONCE_PREFIX_BYTES,
  XCHACHA_TAG_BYTES,
} from "./constants.js?v=98";
import { readUint32Bytes } from "./utils.js?v=98";

export async function ensureSodiumReady() {
  await sodium.ready;
  return sodium;
}

export async function isSodiumEncryptionAvailable() {
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

export function isWebCryptoEncryptionAvailable() {
  return Boolean(window.crypto?.subtle && window.crypto?.getRandomValues);
}

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex = "") {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string.");
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

export function getDocumentFormat(record = {}) {
  if (record.format === DOCUMENT_FORMATS.EPUB) {
    return DOCUMENT_FORMATS.EPUB;
  }

  if (record.format === DOCUMENT_FORMATS.PDF) {
    return DOCUMENT_FORMATS.PDF;
  }

  if (record.type === "application/epub+zip" || record.name?.toLowerCase().endsWith(".epub")) {
    return DOCUMENT_FORMATS.EPUB;
  }

  return DOCUMENT_FORMATS.PDF;
}

export function getEncryptionOriginalSize(record = {}) {
  return Number.isFinite(record.encryption?.originalSize)
    ? record.encryption.originalSize
    : record.size || record.blob?.size || 0;
}

export function isAesGcmRecordEncryption(encryption = {}) {
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

export function isXChaChaRecordEncryption(encryption = {}) {
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

export function isRecordEncrypted(record = {}) {
  return (
    record.encrypted === true &&
    (isXChaChaRecordEncryption(record.encryption) || isAesGcmRecordEncryption(record.encryption))
  );
}

export function isCurrentRecordEncryption(record = {}) {
  return (
    record.encrypted === true &&
    isXChaChaRecordEncryption(record.encryption)
  );
}

export function isRecordNameEncrypted(record = {}) {
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

export function getFallbackDocumentName(format = DOCUMENT_FORMATS.PDF) {
  return format === DOCUMENT_FORMATS.EPUB ? "未命名.epub" : "未命名.pdf";
}

export function getPlainRecordName(record = {}) {
  return record.name || getFallbackDocumentName(getDocumentFormat(record));
}

export function recordNeedsEncryptionMigration(record = {}) {
  if (!isRecordEncrypted(record)) {
    return true;
  }

  if (!isCurrentRecordEncryption(record)) {
    return false;
  }

  return !isRecordNameEncrypted(record) || Boolean(record.name);
}

export function createChunkIv(encryption, chunkIndex) {
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

export function createChunkNonce(encryption, chunkIndex) {
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

export function getEncryptionTagBytes(encryption = {}) {
  if (Number.isFinite(encryption.tagLength) && encryption.tagLength > 0) {
    return Math.ceil(encryption.tagLength / 8);
  }

  return encryption.algorithm === AES_GCM_ALGORITHM ? AES_GCM_TAG_BYTES : XCHACHA_TAG_BYTES;
}

export function getEncryptedPayloadOffset(record = {}) {
  return Number.isFinite(record.encryptedPayloadOffset)
    ? Math.max(0, Math.floor(record.encryptedPayloadOffset))
    : 0;
}

export function getEncryptedPayloadSize(record = {}) {
  const offset = getEncryptedPayloadOffset(record);

  if (Number.isFinite(record.encryptedPayloadSize)) {
    return Math.max(0, Math.floor(record.encryptedPayloadSize));
  }

  if (Number.isFinite(record.encryptedChunkStorage?.payloadSize)) {
    return Math.max(0, Math.floor(record.encryptedChunkStorage.payloadSize));
  }

  return Math.max(0, (record.blob?.size || 0) - offset);
}

export function getExpectedEncryptedPayloadSize(record = {}) {
  if (!isRecordEncrypted(record)) {
    return 0;
  }

  const originalSize = getEncryptionOriginalSize(record);
  const chunkSize = Math.max(1, Math.floor(record.encryption?.chunkSize || ENCRYPTION_CHUNK_SIZE));
  const tagBytes = getEncryptionTagBytes(record.encryption);
  const totalChunks = Math.max(1, Math.ceil(originalSize / chunkSize));
  return originalSize + totalChunks * tagBytes;
}

export function getEncryptedPayloadBlob(record = {}) {
  const offset = getEncryptedPayloadOffset(record);
  const size = getEncryptedPayloadSize(record);
  return record.blob?.slice(offset, offset + size, "application/octet-stream");
}

export function withoutEncryptedPayloadLocation(record) {
  const next = { ...record };
  delete next.encryptedPayloadOffset;
  delete next.encryptedPayloadSize;
  return next;
}

export function withPayloadOnlyEncryptedBlob(record = {}) {
  if (!isRecordEncrypted(record) || !record.blob) {
    return record;
  }

  const offset = getEncryptedPayloadOffset(record);
  const size = getEncryptedPayloadSize(record);
  const blobSize = record.blob.size || 0;
  const expectedPayloadSize = getExpectedEncryptedPayloadSize(record);

  if (offset === 0 && (!Number.isFinite(record.encryptedPayloadSize) || size === blobSize)) {
    return withoutEncryptedPayloadLocation(record);
  }

  if (size <= 0 || offset + size > blobSize) {
    throw new Error("Encrypted document payload location is invalid.");
  }

  if (expectedPayloadSize > 0 && size !== expectedPayloadSize) {
    throw new Error("Encrypted document payload size is invalid.");
  }

  return withoutEncryptedPayloadLocation({
    ...record,
    blob: record.blob.slice(offset, offset + size, "application/octet-stream"),
  });
}

export function withStableEncryptedBackupBlob(record = {}) {
  if (
    !isRecordEncrypted(record) ||
    getEncryptedPayloadOffset(record) <= 0 ||
    typeof File === "undefined" ||
    !(record.blob instanceof File)
  ) {
    return record;
  }

  return {
    ...record,
    blob: record.blob.slice(0, record.blob.size, "application/octet-stream"),
  };
}

function createEmbeddedEncryptedBackupRecord(header, blob, payloadLocation, fallbackRecord = {}) {
  const payload = header?.record || {};
  const format = payload.format === DOCUMENT_FORMATS.EPUB ? DOCUMENT_FORMATS.EPUB : DOCUMENT_FORMATS.PDF;
  const type = format === DOCUMENT_FORMATS.EPUB ? "application/epub+zip" : "application/pdf";

  return withoutPlainRecordName({
    ...fallbackRecord,
    blob,
    encrypted: true,
    encryptedName: payload.encryptedName,
    encryptedPayloadOffset: payloadLocation.encryptedPayloadOffset,
    encryptedPayloadSize: payloadLocation.encryptedPayloadSize,
    encryption: payload.encryption,
    format,
    id: typeof payload.id === "string" && payload.id ? payload.id : fallbackRecord.id,
    size: Number.isFinite(payload.size)
      ? payload.size
      : payload.encryption?.originalSize || fallbackRecord.size || blob.size,
    type: payload.type || fallbackRecord.type || type,
    updatedAt: Number.isFinite(payload.updatedAt) ? payload.updatedAt : fallbackRecord.updatedAt,
  });
}

async function readEmbeddedEncryptedBackupRecord(record = {}) {
  const blob = record.blob;

  if (!blob?.size) {
    return null;
  }

  const magicBytes = new TextEncoder().encode(ENCRYPTED_BACKUP_MAGIC);
  const prefixLength = magicBytes.length + 4;

  if (blob.size <= prefixLength) {
    return null;
  }

  const prefix = new Uint8Array(await blob.slice(0, prefixLength).arrayBuffer());

  for (let index = 0; index < magicBytes.length; index += 1) {
    if (prefix[index] !== magicBytes[index]) {
      return null;
    }
  }

  const headerLength = readUint32Bytes(prefix, magicBytes.length);
  const dataOffset = prefixLength + headerLength;

  if (
    headerLength <= 0 ||
    headerLength > ENCRYPTED_BACKUP_MAX_HEADER_BYTES ||
    dataOffset >= blob.size
  ) {
    throw new Error("Embedded encrypted backup header is invalid.");
  }

  try {
    const headerBytes = await blob.slice(prefixLength, dataOffset).arrayBuffer();
    const header = JSON.parse(new TextDecoder().decode(headerBytes));
    const encryptedPayloadSize = blob.size - dataOffset;
    const embeddedRecord = createEmbeddedEncryptedBackupRecord(
      header,
      blob,
      {
        encryptedPayloadOffset: dataOffset,
        encryptedPayloadSize,
      },
      record,
    );
    const expectedPayloadSize = getExpectedEncryptedPayloadSize(embeddedRecord);

    if (
      header?.app !== "portable-pdf-reader" ||
      header?.kind !== "encrypted-document" ||
      header?.version !== ENCRYPTED_BACKUP_VERSION ||
      !embeddedRecord.id ||
      !isRecordEncrypted(embeddedRecord) ||
      !isRecordNameEncrypted(embeddedRecord) ||
      (Number.isFinite(header?.blob?.size) && header.blob.size !== encryptedPayloadSize) ||
      (expectedPayloadSize > 0 && expectedPayloadSize !== encryptedPayloadSize)
    ) {
      throw new Error("Embedded encrypted backup payload is invalid or incomplete.");
    }

    return embeddedRecord;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Embedded encrypted backup header is invalid.", { cause: error });
    }

    throw error;
  }
}

export async function detectEmbeddedEncryptedBackupPayload(record = {}) {
  const embeddedRecord = await readEmbeddedEncryptedBackupRecord(record);

  if (!embeddedRecord) {
    return null;
  }

  return {
    encryptedPayloadOffset: getEncryptedPayloadOffset(embeddedRecord),
    encryptedPayloadSize: getEncryptedPayloadSize(embeddedRecord),
  };
}

export async function withDetectedEncryptedPayloadLocation(record = {}) {
  if (!isRecordEncrypted(record)) {
    return record;
  }

  const stableRecord = withStableEncryptedBackupBlob(record);
  const embeddedRecord = await readEmbeddedEncryptedBackupRecord(stableRecord);

  if (embeddedRecord) {
    return embeddedRecord;
  }

  const blobSize = stableRecord.blob?.size || 0;
  const expectedPayloadSize = getExpectedEncryptedPayloadSize(stableRecord);
  const offset = getEncryptedPayloadOffset(stableRecord);
  const size = getEncryptedPayloadSize(stableRecord);

  if (expectedPayloadSize > 0 && blobSize === expectedPayloadSize) {
    return withoutEncryptedPayloadLocation(stableRecord);
  }

  if (offset > 0 || Number.isFinite(stableRecord.encryptedPayloadSize)) {
    if (offset + size <= blobSize) {
      if (offset === 0 && size === blobSize) {
        return withoutEncryptedPayloadLocation(stableRecord);
      }

      return stableRecord;
    }

    throw new Error("Encrypted document payload location is invalid.");
  }

  return stableRecord;
}

export async function normalizeEncryptedRecordPayload(record = {}) {
  if (!isRecordEncrypted(record)) {
    return record;
  }

  let normalizedRecord = record;

  for (let unwrapCount = 0; unwrapCount < 4; unwrapCount += 1) {
    normalizedRecord = await withPayloadOnlyEncryptedBlob(
      await withDetectedEncryptedPayloadLocation(normalizedRecord),
    );

    const nestedRecord = await readEmbeddedEncryptedBackupRecord(normalizedRecord);

    if (!nestedRecord) {
      return normalizedRecord;
    }
  }

  throw new Error("Encrypted backup nesting is too deep.");
}

export function createChunkAad(record, encryption, chunkIndex) {
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

export function createNameAad(record, encryption) {
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

export async function deriveAesGcmKey(password, encryption) {
  if (!isWebCryptoEncryptionAvailable()) {
    throw new Error("Web Crypto is unavailable in this browser.");
  }

  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    PBKDF2_KEY_ALGORITHM.replace("-SHA256", ""),
    false,
    ["deriveKey"],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: PBKDF2_KEY_ALGORITHM.replace("-SHA256", ""),
      hash: "SHA-256",
      salt: hexToBytes(encryption.salt),
      iterations: encryption.iterations || ENCRYPTION_KDF_ITERATIONS,
    },
    baseKey,
    {
      name: AES_GCM_ALGORITHM,
      length: encryption.keyLength || 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function deriveXChaChaKey(password, encryption) {
  const sodiumApi = await ensureSodiumReady();
  const key = sodiumApi.crypto_pwhash(
    sodiumApi.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    password,
    hexToBytes(encryption.salt),
    encryption.opsLimit || sodiumApi.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    encryption.memLimit || sodiumApi.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodiumApi.crypto_pwhash_ALG_ARGON2ID13,
  );
  return key;
}

export async function deriveEncryptionKey(password, encryption) {
  if (!password || !encryption?.salt) {
    throw new Error("Missing encryption password.");
  }

  if (encryption.algorithm === AES_GCM_ALGORITHM) {
    return deriveAesGcmKey(password, encryption);
  }

  return deriveXChaChaKey(password, encryption);
}

export async function deriveRecordEncryptionKey(record, password) {
  if (!isRecordEncrypted(record)) {
    throw new Error("Document is not encrypted.");
  }

  return deriveEncryptionKey(password, record.encryption);
}

export async function encryptRecordName(record, key, encryption) {
  const plainName = getPlainRecordName(record);
  const encodedName = new TextEncoder().encode(plainName);

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
      encodedName,
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
    encodedName,
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

export async function decryptRecordName(record, key) {
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

export function withoutPlainRecordName(record) {
  const next = { ...record };
  delete next.name;
  return next;
}
