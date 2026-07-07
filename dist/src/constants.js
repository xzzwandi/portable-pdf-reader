export const DB_NAME = "portable-pdf-reader";
export const DB_VERSION = 1;
export const STORE_NAME = "documents";
export const DOCUMENT_ID_PREFIX = "doc:";
export const LAST_DOCUMENT_ID = "last-document";
export const LOCK_KEY = "portable-pdf-reader-lock";
export const PROGRESS_KEY = "portable-pdf-reader-document-progress";
export const STATE_KEY = "portable-pdf-reader-state";
export const APP_VERSION = "v91";

export const ENCRYPTED_BACKUP_EXTENSION = ".pprenc";
export const ENCRYPTED_BACKUP_MAGIC = "PPRENC1\n";
export const ENCRYPTED_BACKUP_VERSION = 1;
export const ENCRYPTED_BACKUP_MAX_HEADER_BYTES = 262_144;

export const DOCUMENT_FORMATS = {
  PDF: "pdf",
  EPUB: "epub",
};

export const READ_MODES = {
  PAGED: "paged",
  SCROLL: "scroll",
};

export const CONTINUOUS_KEEP_VIEWPORTS = 2.25;
export const CONTINUOUS_RENDER_VIEWPORTS = 1.35;
export const CONTINUOUS_MAX_RENDERED_PAGES = 6;
export const CONTINUOUS_OBSERVER_MARGIN = "700px 0px";
export const CONTINUOUS_RENDER_TIMEOUT_MS = 60_000;
export const CONTINUOUS_HEALTH_CHECK_DELAY_MS = 700;
export const CONTINUOUS_HEALTH_CHECK_INTERVAL_MS = 1_500;
export const CONTINUOUS_BLANK_RETRY_LIMIT = 3;
export const CONTINUOUS_CLEANUP_IDLE_MS = 3_500;

export const PAGED_BLANK_RETRY_LIMIT = 2;
export const PAGED_BLANK_RETRY_DELAY_MS = 120;

export const PDF_RANGE_CHUNK_SIZE = 1_048_576;
export const PDF_LOAD_TIMEOUT_MS = 60_000;
export const PDF_RENDER_TIMEOUT_MS = 60_000;
export const PDF_SOURCE_READ_RETRY_LIMIT = 2;
export const PDF_SOURCE_READ_RETRY_DELAY_MS = 90;

export const MAX_PAGED_CANVAS_PIXELS = 18_000_000;
export const MAX_CONTINUOUS_CANVAS_PIXELS = 6_500_000;
export const MAX_CANVAS_DIMENSION = 8192;

export const FULLSCREEN_EPUB_SWIPE_DISTANCE = 72;
export const FULLSCREEN_EPUB_SWIPE_MAX_DRIFT = 52;

export const TOC_RENDER_BATCH_SIZE = 72;
export const TOC_RENDER_SCROLL_THRESHOLD = 320;
export const TOC_ITEM_ESTIMATED_HEIGHT = 58;

export const ENCRYPTION_VERSION = 2;
export const AES_GCM_ENCRYPTION_VERSION = 1;
export const AES_GCM_ALGORITHM = "AES-GCM";
export const XCHACHA20_POLY1305_ALGORITHM = "XCHACHA20-POLY1305";
export const PBKDF2_KEY_ALGORITHM = "PBKDF2-SHA256";
export const ARGON2ID13_KEY_ALGORITHM = "ARGON2ID13";
export const ENCRYPTION_ALGORITHM = XCHACHA20_POLY1305_ALGORITHM;
export const ENCRYPTION_KEY_ALGORITHM = ARGON2ID13_KEY_ALGORITHM;
export const ENCRYPTION_KDF_ITERATIONS = 300_000;
export const ENCRYPTION_CHUNK_SIZE = 1_048_576;
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_NONCE_PREFIX_BYTES = 4;
export const AES_GCM_TAG_BYTES = 16;
export const XCHACHA_NONCE_BYTES = 24;
export const XCHACHA_NONCE_PREFIX_BYTES = 16;
export const XCHACHA_TAG_BYTES = 16;
export const ENCRYPTED_CHUNK_CACHE_LIMIT = 8;
export const ENCRYPTED_NAME_VERSION = 1;
