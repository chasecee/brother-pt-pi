#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip, createBrotliCompress, constants as zc } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "static");

const COMPRESSIBLE = new Set([
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".svg",
  ".json",
  ".map",
  ".txt",
  ".xml",
]);

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function precompress(file) {
  const ext = path.extname(file).toLowerCase();
  if (!COMPRESSIBLE.has(ext)) return;
  const stat = await fs.stat(file);
  if (stat.size < 1024) return;
  await pipeline(
    createReadStream(file),
    createBrotliCompress({
      params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: stat.size },
    }),
    createWriteStream(file + ".br"),
  );
  await pipeline(
    createReadStream(file),
    createGzip({ level: 9 }),
    createWriteStream(file + ".gz"),
  );
}

async function main() {
  const distStat = await fs.stat(DIST).catch(() => null);
  if (!distStat?.isDirectory()) {
    throw new Error(`missing static build output at ${DIST}`);
  }

  for (const file of await walk(DIST)) {
    await precompress(file);
  }

  for (const extra of [
    path.join(ROOT, "icons", "catalog.json"),
    path.join(ROOT, "fonts", "catalog.json"),
  ]) {
    await precompress(extra);
  }

  let total = 0;
  let totalBr = 0;
  for (const f of await walk(DIST)) {
    const s = await fs.stat(f);
    if (f.endsWith(".br")) totalBr += s.size;
    else if (!f.endsWith(".gz")) total += s.size;
  }
  console.log(
    `compressed ${DIST} | raw ${(total / 1024).toFixed(0)}KB | brotli ${(totalBr / 1024).toFixed(0)}KB`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
