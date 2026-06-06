#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip, createBrotliCompress, constants as zc } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "static");
const DIST = path.join(ROOT, ".cache", "static-dist");

const COMPRESSIBLE = new Set([".html", ".css", ".js", ".mjs", ".svg", ".json", ".map"]);

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
  const ext = path.extname(file);
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

async function build() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  const files = await walk(SRC);
  for (const src of files) {
    const rel = path.relative(SRC, src);
    const dst = path.join(DIST, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const ext = path.extname(src);
    const base = path.basename(src);
    if (ext === ".js" && !base.endsWith(".min.js")) {
      const code = await fs.readFile(src, "utf8");
      const result = await esbuild.transform(code, {
        minify: true,
        target: ["es2020"],
        loader: "js",
        legalComments: "none",
      });
      await fs.writeFile(dst, result.code);
    } else if (ext === ".css") {
      const code = await fs.readFile(src, "utf8");
      const result = await esbuild.transform(code, {
        minify: true,
        loader: "css",
      });
      await fs.writeFile(dst, result.code);
    } else {
      await fs.copyFile(src, dst);
    }
  }

  for (const file of await walk(DIST)) await precompress(file);

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
    `built ${DIST} | raw ${(total / 1024).toFixed(0)}KB | brotli ${(totalBr / 1024).toFixed(0)}KB`,
  );
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
