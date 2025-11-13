import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src/public");
const distDir = path.resolve(__dirname, "../dist/public");

if (!existsSync(srcDir)) {
  console.warn(`[copy-public] Source directory missing: ${srcDir}`);
  process.exit(0);
}

try {
  rmSync(distDir, { recursive: true, force: true });
} catch (err) {
  console.warn("[copy-public] Unable to clean destination", err);
}

mkdirSync(path.dirname(distDir), { recursive: true });
cpSync(srcDir, distDir, { recursive: true });
console.log(`[copy-public] Copied public assets -> ${distDir}`);
