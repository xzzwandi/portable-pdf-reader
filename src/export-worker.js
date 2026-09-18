// Dedicated worker: SyncAccessHandle also supports Safari versions without createWritable.
let directory = null;
let fileName = "";
let fileHandle = null;
let access = null;
let offset = 0;

async function dispose() {
  try {
    access?.close();
  } finally {
    access = null;
    if (directory && fileName) {
      await directory.removeEntry(fileName).catch((error) => {
        if (error.name !== "NotFoundError") throw error;
      });
      fileName = "";
    }
  }
}

async function perform(type, data) {
  if (type === "open") {
    const root = await navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle("portable-reader-exports", { create: true });
    // Remove leftovers from interrupted sessions, never another tab's fresh export.
    const expiredBefore = Date.now() - 24 * 60 * 60 * 1000;
    for await (const [name] of directory.entries()) {
      const match = /^export-(\d+)-[a-f0-9-]+$/.exec(name);
      if (match && Number(match[1]) < expiredBefore) {
        await directory.removeEntry(name).catch(() => {});
      }
    }
    fileName = `export-${Date.now()}-${crypto.randomUUID()}`;
    fileHandle = await directory.getFileHandle(fileName, { create: true });
    access = await fileHandle.createSyncAccessHandle();
    offset = 0;
    return;
  }
  if (type === "write") {
    if (!access) throw new Error("Export file is not open.");
    const bytes = new Uint8Array(data.buffer);
    let consumed = 0;
    while (consumed < bytes.length) {
      const written = access.write(bytes.subarray(consumed), { at: offset });
      if (written <= 0) throw new Error("Export file write made no progress.");
      consumed += written;
      offset += written;
    }
    return;
  }
  if (type === "finish") {
    if (!access || offset !== data.size) throw new Error("Export file is incomplete.");
    access.flush();
    access.close();
    access = null;
    return fileHandle.getFile();
  }
  if (type === "dispose") {
    await dispose();
    return;
  }
  throw new Error("Unknown export operation.");
}

// Serial processing also makes cleanup safe if it arrives while opening the file.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const result = await perform(data.type, data);
      self.postMessage({ id: data.id, result });
    } catch (error) {
      await dispose().catch(() => {});
      self.postMessage({ id: data.id, error: { name: error.name, message: error.message } });
    }
  });
};
