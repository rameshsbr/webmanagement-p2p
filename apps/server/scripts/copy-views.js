// ESM-friendly copy of all .ejs files from src/views -> dist/views
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC = path.join(__dirname, "..", "src", "views");
const DEST = path.join(__dirname, "..", "dist", "views");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyDir(src, dest) {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else if (entry.isFile()) {
      // copy all view files (ejs + any partial assets you keep alongside)
      await ensureDir(path.dirname(to));
      await fs.copyFile(from, to);
    }
  }
}

async function main() {
  try {
    await copyDir(SRC, DEST);
    console.log(`[copy-views] Copied views -> ${DEST}`);
  } catch (e) {
    console.error("[copy-views] Failed:", e?.message || e);
    process.exit(1);
  }
}

main();
