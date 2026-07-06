import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import {
  AES_GCM_ALGORITHM,
  ENCRYPTED_CHUNK_CACHE_LIMIT,
  ENCRYPTION_CHUNK_SIZE,
  PDF_RANGE_CHUNK_SIZE,
  PDF_SOURCE_READ_RETRY_DELAY_MS,
  PDF_SOURCE_READ_RETRY_LIMIT,
} from "./constants.js?v=73";
import {
  createChunkAad,
  createChunkIv,
  createChunkNonce,
  ensureSodiumReady,
  getEncryptedPayloadOffset,
  getEncryptedPayloadSize,
  getEncryptionOriginalSize,
  getEncryptionTagBytes,
} from "./encryption.js?v=73";
import { clamp, wait } from "./utils.js?v=73";

const PDFJS_ROOT = new URL("../vendor/pdfjs/", import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_ROOT}pdf.worker.min.mjs`;

let metricHandler = () => {};

export function setPdfSourceMetricHandler(handler) {
  metricHandler = typeof handler === "function" ? handler : () => {};
}

function noteMetric(name) {
  metricHandler(name);
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

    noteMetric("encryptedChunkReads");
    const plainStart = chunkIndex * this.chunkSize;
    const plainLength = Math.min(this.chunkSize, Math.max(0, this.length - plainStart));
    const tagBytes = getEncryptionTagBytes(this.encryption);
    const encryptedOffset = chunkIndex * (this.chunkSize + tagBytes);
    const encryptedPayloadOffset = getEncryptedPayloadOffset(this.record);
    const encryptedStart = encryptedPayloadOffset + encryptedOffset;
    const encryptedEnd = encryptedStart + plainLength + tagBytes;
    const encryptedPayloadEnd = encryptedPayloadOffset + getEncryptedPayloadSize(this.record);

    if (encryptedEnd > encryptedPayloadEnd) {
      throw new Error("Encrypted document payload is incomplete.");
    }

    const encryptedBytes = new Uint8Array(await this.blob.slice(encryptedStart, encryptedEnd).arrayBuffer());
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
    this.source = source;
    this.aborted = false;
    this.failed = false;
    this.loadingTask = null;
    this.failurePromise = new Promise((_, reject) => {
      this.rejectFailure = reject;
    });
    this.failurePromise.catch(() => {});
  }

  attachLoadingTask(loadingTask) {
    this.loadingTask = loadingTask;
  }

  fail(error) {
    if (this.aborted || this.failed) {
      return;
    }

    this.failed = true;
    this.aborted = true;
    this.rejectFailure?.(error);
    this.loadingTask?.destroy?.().catch(() => {});
  }

  async requestDataRange(begin, end) {
    if (this.aborted) {
      return;
    }

    noteMetric("pdfRangeRequests");
    const safeBegin = clamp(Math.floor(begin), 0, this.length);
    const safeEnd = clamp(Math.ceil(end), safeBegin, this.length);

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
        this.fail(rangeError);
      }
    }
  }

  abort() {
    this.aborted = true;
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
