import {
  APP_VERSION,
  DOCUMENT_FORMATS,
  DOCUMENT_ID_PREFIX,
  ENCRYPTED_BACKUP_MAGIC,
  ENCRYPTED_BACKUP_MAX_HEADER_BYTES,
  ENCRYPTED_BACKUP_VERSION,
} from "./constants.js?v=111";
import {
  getDocumentFormat,
  getEncryptedPayloadBlob,
  getEncryptedPayloadOffset,
  getEncryptedPayloadSize,
  getEncryptionOriginalSize,
  getExpectedEncryptedPayloadSize,
  isRecordEncrypted,
  isRecordNameEncrypted,
  withDetectedEncryptedPayloadLocation,
  withoutEncryptedPayloadLocation,
  withoutPlainRecordName,
} from "./encryption.js?v=111";
import { createUint32Bytes, readUint32Bytes } from "./utils.js?v=111";

function isLibraryDocument(record) {
  return Boolean(record?.blob && typeof record.id === "string" && record.id.startsWith(DOCUMENT_ID_PREFIX));
}

function createEncryptedBackupHeader(record) {
  const format = getDocumentFormat(record);
  const type = format === DOCUMENT_FORMATS.EPUB ? "application/epub+zip" : "application/pdf";
  const payloadSize = getEncryptedPayloadSize(record);

  return {
    app: "portable-pdf-reader",
    appVersion: APP_VERSION,
    kind: "encrypted-document",
    version: ENCRYPTED_BACKUP_VERSION,
    exportedAt: Date.now(),
    record: {
      encrypted: true,
      encryptedName: record.encryptedName,
      encryption: record.encryption,
      format,
      id: record.id,
      size: getEncryptionOriginalSize(record),
      type: record.type || type,
      updatedAt: record.updatedAt || Date.now(),
    },
    blob: {
      size: payloadSize,
      type: "application/octet-stream",
    },
  };
}

export async function createEncryptedBackupBlob(record, options = {}) {
  const suppliedPayloadBlob = options.payloadBlob instanceof Blob ? options.payloadBlob : null;
  const payloadRecord = suppliedPayloadBlob
    ? withoutEncryptedPayloadLocation({
        ...record,
        blob: suppliedPayloadBlob,
      })
    : await withDetectedEncryptedPayloadLocation(record);
  const payloadBlob = suppliedPayloadBlob || getEncryptedPayloadBlob(payloadRecord);
  const payloadSize = getEncryptedPayloadSize(payloadRecord);
  const expectedPayloadSize = getExpectedEncryptedPayloadSize(payloadRecord);

  if (
    !isLibraryDocument(payloadRecord) ||
    !isRecordEncrypted(payloadRecord) ||
    !isRecordNameEncrypted(payloadRecord)
  ) {
    throw new Error("Encrypted backup record is invalid.");
  }

  if (
    !(payloadBlob instanceof Blob) ||
    payloadBlob.size !== payloadSize ||
    (expectedPayloadSize > 0 && payloadSize !== expectedPayloadSize)
  ) {
    throw new Error(
      `Encrypted backup payload is missing or incomplete: blob=${payloadBlob?.size || 0}, recordBlob=${payloadRecord.blob?.size || 0}, offset=${getEncryptedPayloadOffset(payloadRecord)}, payload=${payloadSize}, expected=${expectedPayloadSize}.`,
    );
  }

  const headerBytes = new TextEncoder().encode(JSON.stringify(createEncryptedBackupHeader(payloadRecord)));

  if (headerBytes.length > ENCRYPTED_BACKUP_MAX_HEADER_BYTES) {
    throw new Error("Encrypted backup metadata is too large.");
  }

  return new Blob(
    [
      new TextEncoder().encode(ENCRYPTED_BACKUP_MAGIC),
      createUint32Bytes(headerBytes.length),
      headerBytes,
      payloadBlob,
    ],
    { type: "application/octet-stream" },
  );
}

async function readEncryptedBackupFile(file) {
  const magicBytes = new TextEncoder().encode(ENCRYPTED_BACKUP_MAGIC);
  const prefixLength = magicBytes.length + 4;
  const prefix = new Uint8Array(await file.slice(0, prefixLength).arrayBuffer());

  if (prefix.length !== prefixLength) {
    throw new Error("Invalid encrypted backup.");
  }

  for (let index = 0; index < magicBytes.length; index += 1) {
    if (prefix[index] !== magicBytes[index]) {
      throw new Error("Invalid encrypted backup.");
    }
  }

  const headerLength = readUint32Bytes(prefix, magicBytes.length);
  const dataOffset = prefixLength + headerLength;

  if (
    headerLength <= 0 ||
    headerLength > ENCRYPTED_BACKUP_MAX_HEADER_BYTES ||
    dataOffset >= file.size
  ) {
    throw new Error("Invalid encrypted backup.");
  }

  const headerBytes = await file.slice(prefixLength, dataOffset).arrayBuffer();
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  const encryptedPayloadSize = file.size - dataOffset;
  const containerBlob = file.slice(0, file.size, "application/octet-stream");

  return {
    blob: containerBlob,
    encryptedPayloadOffset: dataOffset,
    encryptedPayloadSize,
    header,
  };
}

function createRecordFromEncryptedBackup(header, blob, payloadLocation = {}) {
  const payload = header?.record || {};
  const format = payload.format === DOCUMENT_FORMATS.EPUB ? DOCUMENT_FORMATS.EPUB : DOCUMENT_FORMATS.PDF;
  const type = format === DOCUMENT_FORMATS.EPUB ? "application/epub+zip" : "application/pdf";
  const now = Date.now();
  const expectedBlobSize = header?.blob?.size;
  const encryptedPayloadOffset = Number.isFinite(payloadLocation.encryptedPayloadOffset)
    ? payloadLocation.encryptedPayloadOffset
    : 0;
  const encryptedPayloadSize = Number.isFinite(payloadLocation.encryptedPayloadSize)
    ? payloadLocation.encryptedPayloadSize
    : Math.max(0, blob?.size || 0);
  const record = withoutPlainRecordName({
    blob,
    encrypted: true,
    encryptedName: payload.encryptedName,
    encryptedPayloadOffset,
    encryptedPayloadSize,
    encryption: payload.encryption,
    format,
    id: payload.id,
    lastOpenedAt: now,
    size: Number.isFinite(payload.size) ? payload.size : payload.encryption?.originalSize || blob.size,
    type: payload.type || type,
    updatedAt: Number.isFinite(payload.updatedAt) ? payload.updatedAt : now,
  });
  const expectedPayloadSize = getExpectedEncryptedPayloadSize(record);

  if (
    header?.app !== "portable-pdf-reader" ||
    header?.kind !== "encrypted-document" ||
    header?.version !== ENCRYPTED_BACKUP_VERSION ||
    (Number.isFinite(expectedBlobSize) && expectedBlobSize !== encryptedPayloadSize) ||
    (expectedPayloadSize > 0 && expectedPayloadSize !== encryptedPayloadSize) ||
    !isLibraryDocument(record) ||
    !isRecordEncrypted(record) ||
    !isRecordNameEncrypted(record)
  ) {
    throw new Error("Invalid encrypted backup.");
  }

  return record;
}

export async function parseEncryptedBackupFile(file) {
  const { header, blob, encryptedPayloadOffset, encryptedPayloadSize } = await readEncryptedBackupFile(file);
  return createRecordFromEncryptedBackup(header, blob, {
    encryptedPayloadOffset,
    encryptedPayloadSize,
  });
}
