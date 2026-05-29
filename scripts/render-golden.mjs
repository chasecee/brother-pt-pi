#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "canvas";
import opentype from "opentype.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/render-fixtures.json"), "utf8"));
const OUT = path.join(ROOT, "tests/golden/js");

const fontCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, "fonts/catalog.json"), "utf8"));
const iconCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, "icons/catalog.json"), "utf8"));

class MockImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
  }
  set src(url) {
    const filePath = url.startsWith("/icons/custom/")
      ? path.join(ROOT, "data/icons/custom", path.basename(url))
      : null;
    if (!filePath || !fs.existsSync(filePath)) {
      this.onerror?.();
      return;
    }
    loadImage(filePath).then((img) => {
      this.width = img.width;
      this.height = img.height;
      this._img = img;
      this.onload?.();
    }).catch(() => this.onerror?.());
  }
}

const sandbox = {
  opentype,
  document: {
    createElement() {
      return createCanvas(1, 1);
    },
  },
  Image: MockImage,
  fetch: async (url) => {
    if (url === "/icons/catalog.json") {
      return { json: async () => iconCatalog };
    }
    throw new Error(`fetch not mocked: ${url}`);
  },
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "static/js/render.js"), "utf8"), context);

const PtRender = context.PtRender;
const families = Object.entries(fontCatalog).map(([name, variants]) => ({
  name,
  variants: Object.fromEntries(
    Object.entries(variants).map(([k, f]) => [k, path.join(ROOT, "fonts", f)])
  ),
}));
PtRender.setFontFamilies(families);
await PtRender.setIconCatalog(iconCatalog);

fs.mkdirSync(OUT, { recursive: true });
for (const c of FIXTURES) {
  const dataUrl = await PtRender.renderLabel(c.blocks, c.opts, c.tape_h ?? 112, {
    forPrint: !c.for_preview,
  });
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(path.join(OUT, `${c.id}.png`), Buffer.from(b64, "base64"));
  console.log(`js ${c.id}`);
}
