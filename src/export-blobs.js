// Keep small exports in browser-managed Blobs; spool large exports to OPFS.
export const MAX_MEMORY_EXPORT_BYTES = 32 * 1024 * 1024;
const exportCleanups = new Map();

function exportError(error) {
  if (!error.userMessage) {
    error.userMessage = error.name === "QuotaExceededError"
      ? "可用存储空间不足，无法准备导出文件。"
      : "当前浏览器无法准备大文件导出，请使用 HTTPS 地址或更新浏览器后重试。";
  }
  return error;
}

function createFileWriter() {
  const worker = new Worker(new URL("./export-worker.js?v=117", import.meta.url));
  let sequence = 0;
  let failure = null;
  const requests = new Map();
  const fail = (error) => {
    failure = error;
    for (const { reject, timer } of requests.values()) {
      clearTimeout(timer);
      reject(error);
    }
    requests.clear();
  };
  worker.onmessage = ({ data }) => {
    const request = requests.get(data.id);
    if (!request) return;
    requests.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) {
      const error = new Error(data.error.message);
      error.name = data.error.name;
      request.reject(error);
    } else {
      request.resolve(data.result);
    }
  };
  worker.onerror = (event) => fail(new Error(event.message || "Export worker failed."));
  worker.onmessageerror = () => fail(new Error("Export worker response could not be read."));
  return {
    request(type, data = {}, transfer = []) {
      if (failure) return Promise.reject(failure);
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail(new Error("Export storage operation timed out."));
        }, 60_000);
        requests.set(id, { resolve, reject, timer });
        try {
          worker.postMessage({ id, type, ...data }, transfer);
        } catch (error) {
          fail(error);
        }
      });
    },
    close() {
      fail(new Error("Export writer closed."));
      worker.terminate();
    },
  };
}

export async function createExportBlob(chunks, { size, type = "application/octet-stream" }) {
  let writer = null;
  let completed = false;
  const parts = [];
  let written = 0;
  try {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Invalid export size.");
    }
    if (size > MAX_MEMORY_EXPORT_BYTES) {
      // Never silently fall back to allocating a whole large file on the JS heap.
      writer = createFileWriter();
      await writer.request("open");
    }
    for await (const chunk of chunks) {
      if (!(chunk instanceof ArrayBuffer) && !ArrayBuffer.isView(chunk)) {
        throw new Error("Invalid export chunk.");
      }
      written += chunk.byteLength;
      if (written > size) throw new Error("Export exceeds its expected size.");
      if (writer) {
        const bytes = chunk instanceof ArrayBuffer
          ? new Uint8Array(chunk)
          : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        // Transfer a copy so cached source bytes remain usable after export.
        const buffer = bytes.slice().buffer;
        await writer.request("write", { buffer }, [buffer]);
      } else {
        parts.push(new Blob([chunk]));
      }
    }
    if (written !== size) throw new Error(`Export has ${written} bytes; expected ${size}.`);
    const blob = writer
      ? (await writer.request("finish", { size })).slice(0, size, type)
      : new Blob(parts, { type });
    if (writer) {
      const fileWriter = writer;
      exportCleanups.set(blob, async () => {
        try {
          await fileWriter.request("dispose");
        } finally {
          fileWriter.close();
        }
      });
    }
    completed = true;
    return blob;
  } catch (error) {
    throw size > MAX_MEMORY_EXPORT_BYTES ? exportError(error) : error;
  } finally {
    if (writer && !completed) {
      await writer.request("dispose").catch(() => {});
      writer.close();
    }
  }
}

export function transferExportBlobCleanup(source, target) {
  const cleanup = exportCleanups.get(source);
  if (cleanup && source !== target) {
    exportCleanups.delete(source);
    exportCleanups.set(target, cleanup);
  }
}

export async function releaseExportBlob(blob) {
  const cleanup = exportCleanups.get(blob);
  if (cleanup) {
    exportCleanups.delete(blob);
    await cleanup();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const blob of exportCleanups.keys()) {
      releaseExportBlob(blob).catch(() => {});
    }
  });
}
