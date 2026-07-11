import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import {
  APP_VERSION,
  AES_GCM_ALGORITHM,
  ENCRYPTED_CHUNK_CACHE_LIMIT,
  ENCRYPTION_CHUNK_SIZE,
  PDF_RANGE_CHUNK_SIZE,
  PDF_SOURCE_READ_RETRY_DELAY_MS,
  PDF_SOURCE_READ_RETRY_LIMIT,
} from "./constants.js?v=112";
import {
  createChunkAad,
  createChunkIv,
  createChunkNonce,
  ensureSodiumReady,
  getEncryptedPayloadOffset,
  getEncryptedPayloadSize,
  getEncryptionOriginalSize,
  getEncryptionTagBytes,
} from "./encryption.js?v=112";
import { clamp, wait } from "./utils.js?v=112";

const PDFJS_ROOT = new URL("../vendor/pdfjs/", import.meta.url).href;
const PDFJS_WORKER_VERSION = APP_VERSION.replace(/^v/, "");
pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_ROOT}pdf.worker.mjs?v=${PDFJS_WORKER_VERSION}`;

let metricHandler = () => {};
let diagnosticHandler = () => {};
let rangeTransportSequence = 0;

export function setPdfSourceMetricHandler(handler) {
  metricHandler = typeof handler === "function" ? handler : () => {};
}

export function setPdfSourceDiagnosticHandler(handler) {
  diagnosticHandler = typeof handler === "function" ? handler : () => {};
}

function noteMetric(name) {
  metricHandler(name);
}

function summarizeSourceError(error) {
  if (!error) {
    return null;
  }

  const summary = {
    message: typeof error.message === "string" ? error.message : String(error),
    name: typeof error.name === "string" ? error.name : error.constructor?.name || "Error",
  };

  if (error.cause) {
    summary.cause = summarizeSourceError(error.cause);
  }

  return summary;
}

function noteDiagnostic(type, detail = {}) {
  try {
    diagnosticHandler(type, detail);
  } catch {
    // Diagnostics are best-effort and should not affect PDF reads.
  }
}

function summarizeSource(source) {
  const summary = {
    blobSize: source.blob?.size || null,
    kind: source instanceof EncryptedDocumentSource ? "encrypted" : "blob",
    length: source.length,
  };

  if (source instanceof EncryptedDocumentSource) {
    summary.encryptedPayloadOffset = getEncryptedPayloadOffset(source.record);
    summary.encryptedPayloadSize = getEncryptedPayloadSize(source.record);
    summary.originalSize = getEncryptionOriginalSize(source.record);
  }

  return summary;
}

export class BlobDocumentSource {
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

export class EncryptedDocumentSource {
  constructor(record, key, options = {}) {
    this.record = record;
    this.blob = record.blob;
    this.encryption = record.encryption;
    this.key = key;
    this.length = getEncryptionOriginalSize(record);
    this.chunkCache = new Map();
    this.readEncryptedBytes = typeof options.readEncryptedBytes === "function"
      ? options.readEncryptedBytes
      : null;
  }

  get chunkSize() {
    return this.encryption.chunkSize || ENCRYPTION_CHUNK_SIZE;
  }

  async readEncryptedChunk(chunkIndex) {
    if (this.chunkCache.has(chunkIndex)) {
      return this.chunkCache.get(chunkIndex);
    }

    noteMetric("encryptedChunkReads");
    const plainStart = chunkIndex * this.chunkSize;
    const plainLength = Math.min(this.chunkSize, Math.max(0, this.length - plainStart));
    const tagBytes = getEncryptionTagBytes(this.encryption);
    const encryptedOffset = chunkIndex * (this.chunkSize + tagBytes);
    const encryptedPayloadOffset = getEncryptedPayloadOffset(this.record);
    const encryptedStart = encryptedPayloadOffset + encryptedOffset;
    const encryptedEnd = encryptedStart + plainLength + tagBytes;
    const encryptedPayloadEnd = encryptedPayloadOffset + getEncryptedPayloadSize(this.record);
    noteDiagnostic("encrypted-chunk-read", {
      chunkIndex,
      encryptedEnd,
      encryptedPayloadEnd,
      encryptedPayloadOffset,
      encryptedStart,
      plainLength,
      plainStart,
      tagBytes,
    });

    if (encryptedEnd > encryptedPayloadEnd) {
      noteDiagnostic("encrypted-chunk-incomplete", {
        chunkIndex,
        encryptedEnd,
        encryptedPayloadEnd,
        encryptedPayloadOffset,
        encryptedStart,
        plainLength,
        plainStart,
        tagBytes,
      });
      throw new Error("Encrypted document payload is incomplete.");
    }

    const encryptedBytes = this.readEncryptedBytes
      ? new Uint8Array(await this.readEncryptedBytes({
          chunkIndex,
          encryptedEnd,
          encryptedPayloadOffset,
          encryptedStart,
          expectedLength: encryptedEnd - encryptedStart,
        }))
      : new Uint8Array(await this.blob.slice(encryptedStart, encryptedEnd).arrayBuffer());
    let bytes;

    if (this.encryption.algorithm === AES_GCM_ALGORITHM) {
      const decrypted = await window.crypto.subtle.decrypt(
        {
          name: AES_GCM_ALGORITHM,
          iv: createChunkIv(this.encryption, chunkIndex),
          additionalData: createChunkAad(this.record, this.encryption, chunkIndex),
          tagLength: this.encryption.tagLength || getEncryptionTagBytes(this.encryption) * 8,
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
    this.transportId = ++rangeTransportSequence;
    this.source = source;
    this.aborted = false;
    this.failed = false;
    this.loadingTask = null;
    this.rangeReadQueue = Promise.resolve();
    this.failurePromise = new Promise((_, reject) => {
      this.rejectFailure = reject;
    });
    this.failurePromise.catch(() => {});
    noteDiagnostic("transport-created", {
      fileName,
      initialDataBytes: initialData?.byteLength || 0,
      source: summarizeSource(source),
      transportId: this.transportId,
    });
  }

  attachLoadingTask(loadingTask) {
    this.loadingTask = loadingTask;
    noteDiagnostic("transport-attached", {
      transportId: this.transportId,
    });
  }

  fail(error) {
    if (this.aborted || this.failed) {
      return;
    }

    this.failed = true;
    this.aborted = true;
    noteDiagnostic("transport-failed", {
      error: summarizeSourceError(error),
      source: summarizeSource(this.source),
      transportId: this.transportId,
    });
    this.rejectFailure?.(error);
    this.loadingTask?.destroy?.().catch(() => {});
  }

  requestDataRange(begin, end) {
    if (this.aborted) {
      return;
    }

    const readRange = () => this.readRequestedDataRange(begin, end);
    this.rangeReadQueue = this.rangeReadQueue.then(readRange, readRange);
    this.rangeReadQueue.catch(() => {});
  }

  async readRequestedDataRange(begin, end) {
    if (this.aborted) {
      return;
    }

    noteMetric("pdfRangeRequests");
    const safeBegin = clamp(Math.floor(begin), 0, this.length);
    const safeEnd = clamp(Math.ceil(end), safeBegin, this.length);
    noteDiagnostic("range-request", {
      begin,
      end,
      safeBegin,
      safeEnd,
      source: summarizeSource(this.source),
      transportId: this.transportId,
    });

    try {
      const chunk = await readPdfSourceRange(this.source, safeBegin, safeEnd);

      if (this.aborted) {
        return;
      }

      if (chunk.byteLength !== safeEnd - safeBegin) {
        throw new Error(
          `PDF range read returned ${chunk.byteLength} bytes for ${safeEnd - safeBegin} requested bytes.`,
        );
      }

      noteDiagnostic("range-response", {
        bytes: chunk.byteLength,
        safeBegin,
        safeEnd,
        transportId: this.transportId,
      });
      this.onDataRange(safeBegin, chunk);
      this.onDataProgress(safeEnd, this.length);
    } catch (error) {
      if (!this.aborted) {
        const rangeError = new Error(`PDF range read failed for bytes ${safeBegin}-${safeEnd}.`, {
          cause: error,
        });
        console.error(rangeError.message, {
          begin: safeBegin,
          end: safeEnd,
          length: this.length,
          error,
        });
        noteDiagnostic("range-error", {
          error: summarizeSourceError(rangeError),
          safeBegin,
          safeEnd,
          source: summarizeSource(this.source),
          transportId: this.transportId,
        });
        this.fail(rangeError);
      }
    }
  }

  abort() {
    this.aborted = true;
    noteDiagnostic("transport-aborted", {
      transportId: this.transportId,
    });
  }
}

export async function readPdfSourceRange(source, begin, end) {
  let lastError = null;

  for (let attempt = 1; attempt <= PDF_SOURCE_READ_RETRY_LIMIT; attempt += 1) {
    try {
      return await source.readRange(begin, end);
    } catch (error) {
      lastError = error;

      if (attempt < PDF_SOURCE_READ_RETRY_LIMIT) {
        await wait(PDF_SOURCE_READ_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

export async function createPdfLoadingTaskFromSource(source, meta = {}, fallbackFileName = "") {
  const commonOptions = {
    cMapPacked: true,
    cMapUrl: `${PDFJS_ROOT}cmaps/`,
    standardFontDataUrl: `${PDFJS_ROOT}standard_fonts/`,
    wasmUrl: `${PDFJS_ROOT}image_decoders/`,
  };

  const initialEnd = Math.min(PDF_RANGE_CHUNK_SIZE, source.length);
  const initialData = initialEnd > 0 ? await readPdfSourceRange(source, 0, initialEnd) : undefined;
  const range = new PdfDataRangeTransport(source, initialData, meta.name || fallbackFileName || "");
  const loadingTask = pdfjsLib.getDocument({
    range,
    length: source.length,
    rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
    disableStream: true,
    disableAutoFetch: true,
    ...commonOptions,
  });

  range.attachLoadingTask(loadingTask);
  loadingTask.rangeFailurePromise = range.failurePromise;

  return loadingTask;
}

export async function createPdfLoadingTaskFromBlob(blob, meta = {}, fallbackFileName = "") {
  return createPdfLoadingTaskFromSource(new BlobDocumentSource(blob), meta, fallbackFileName);
}
