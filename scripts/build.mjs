import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

const entries = [
  "index.html",
  "styles.css",
  "app.js",
  "src",
  "manifest.webmanifest",
  "sw.js",
  "icons",
  "vendor",
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of entries) {
  await cp(join(root, entry), join(dist, entry), { recursive: true });
}

await writeFile(join(dist, ".nojekyll"), "");

console.log(`Static site built at ${dist}`);
