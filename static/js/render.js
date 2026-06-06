/* global opentype */
const PtRender = (() => {
  let fontFamilies = {};
  let iconCatalog = null;
  const fontCache = new Map();

  function setFontFamilies(families) {
    fontFamilies = {};
    for (const fam of families || []) {
      fontFamilies[fam.name] = fam.variants || {};
    }
  }

  let iconCatalogPromise = null;

  async function setIconCatalog(catalog) {
    iconCatalog = catalog;
  }

  function loadIconCatalog() {
    if (iconCatalog) return Promise.resolve(iconCatalog);
    if (iconCatalogPromise) return iconCatalogPromise;
    iconCatalogPromise = fetch("/icons/catalog.json")
      .then((r) => r.json())
      .then((data) => {
        iconCatalog = data;
        return data;
      })
      .finally(() => {
        iconCatalogPromise = null;
      });
    return iconCatalogPromise;
  }

  function resolveFontUrl(family, bold, italic) {
    const variants = fontFamilies[family] || fontFamilies.Helsinki || {};
    const keys = bold && italic
      ? ["boldItalic", "bold", "italic", "regular"]
      : bold
        ? ["bold", "boldItalic", "regular"]
        : italic
          ? ["italic", "boldItalic", "regular"]
          : ["regular", "bold", "italic", "boldItalic"];
    for (const key of keys) {
      if (variants[key]) return variants[key];
    }
    return null;
  }

  async function loadFont(url) {
    if (!url) throw new Error("no font url");
    if (fontCache.has(url)) return fontCache.get(url);
    const p = fetch(url).then((r) => r.arrayBuffer()).then((buf) => opentype.parse(buf));
    fontCache.set(url, p);
    return p;
  }

  function lineWidth(font, text, fontSize, spacing) {
    if (!text) return 0;
    let w = 0;
    for (const ch of text) {
      w += font.getAdvanceWidth(ch, fontSize);
    }
    if (text.length > 1) w += spacing * (text.length - 1);
    return w;
  }

  function drawLine(ctx, font, x, y, text, fontSize, spacing) {
    ctx.imageSmoothingEnabled = false;
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (spacing === 0) {
      font.draw(ctx, text, ix, iy, fontSize);
      return;
    }
    let cx = ix;
    for (const ch of text) {
      font.draw(ctx, ch, cx, iy, fontSize);
      cx += Math.round(font.getAdvanceWidth(ch, fontSize) + spacing);
    }
  }

  function contentBBox(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = data[i];
        if (v < 255) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < 0) return null;
    return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
  }

  function scaleCanvasToHeight(src, targetH) {
    const h = src.height;
    if (h === 0) {
      const c = document.createElement("canvas");
      c.width = 1;
      c.height = targetH;
      return c;
    }
    const scale = targetH / h;
    const nw = Math.max(1, Math.round(src.width * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const out = document.createElement("canvas");
    out.width = nw;
    out.height = nh;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, nw, nh);
    ctx.drawImage(src, 0, 0, nw, nh);
    return out;
  }

  function imageTo1BitCanvas(img) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i];
      const g = data.data[i + 1];
      const b = data.data[i + 2];
      const a = data.data[i + 3];
      const gray = a < 128 ? 255 : Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      const bit = gray < 128 ? 0 : 255;
      data.data[i] = bit;
      data.data[i + 1] = bit;
      data.data[i + 2] = bit;
      data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    return c;
  }

  async function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`image load failed: ${url}`));
      img.src = url;
    });
  }

  function applyRotate(canvas, degrees) {
    if (degrees % 360 === 0) return canvas;
    const rad = (-degrees * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const w = canvas.width;
    const h = canvas.height;
    const nw = Math.max(1, Math.round(w * cos + h * sin));
    const nh = Math.max(1, Math.round(w * sin + h * cos));
    const out = document.createElement("canvas");
    out.width = nw;
    out.height = nh;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, nw, nh);
    ctx.translate(nw / 2, nh / 2);
    ctx.rotate(rad);
    ctx.drawImage(canvas, -w / 2, -h / 2);
    return out;
  }

  function applyCropRect(src, crop) {
    if (!crop) return src;
    const x = Number(crop.x);
    const y = Number(crop.y);
    const w = Number(crop.w);
    const h = Number(crop.h);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(w) ||
      !Number.isFinite(h) ||
      w <= 0 ||
      h <= 0
    ) {
      return src;
    }
    const sx = Math.max(0, Math.round(x * src.width));
    const sy = Math.max(0, Math.round(y * src.height));
    const ex = Math.min(src.width, Math.round((x + w) * src.width));
    const ey = Math.min(src.height, Math.round((y + h) * src.height));
    const cw = Math.max(1, ex - sx);
    const ch = Math.max(1, ey - sy);
    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    out.getContext("2d").drawImage(src, sx, sy, cw, ch, 0, 0, cw, ch);
    return out;
  }

  function drawIntoBox(src, boxW, boxH, mode) {
    const out = document.createElement("canvas");
    out.width = boxW;
    out.height = boxH;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, boxW, boxH);
    const w = src.width;
    const h = src.height;
    if (w < 1 || h < 1) return out;
    if (mode === "crop") {
      ctx.drawImage(src, 0, 0, w, h, 0, 0, boxW, boxH);
      return out;
    }
    const scale =
      mode === "cover" ? Math.max(boxW / w, boxH / h) : Math.min(boxW / w, boxH / h);
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    const dx = Math.floor((boxW - dw) / 2);
    const dy = Math.floor((boxH - dh) / 2);
    ctx.drawImage(src, dx, dy, dw, dh);
    return out;
  }

  function normalizedCustomFit(fit) {
    if (fit === "fit") return "contain";
    if (fit === "contain" || fit === "cover" || fit === "crop") return fit;
    return "crop";
  }

  function customWidthScale(block, src) {
    const width = Number(block.width);
    if (Number.isFinite(width) && width > 0) {
      return Math.max(0.1, Math.min(6, width));
    }
    if (src.height > 0) return src.width / src.height;
    return 1;
  }

  function processCustomImageCanvas(src, targetH, fit, rotate, crop, widthScale) {
    let c = applyRotate(src, rotate);
    if (fit === "crop" && crop) c = applyCropRect(c, crop);
    const boxH = Math.max(1, targetH);
    const boxW = Math.max(1, Math.round(boxH * widthScale));
    return drawIntoBox(c, boxW, boxH, fit);
  }

  async function rasterizeBrotherGlyph(family, codepoint, targetH) {
    const url = resolveFontUrl(family, false, false);
    const font = await loadFont(url);
    const pad = targetH;
    const c = document.createElement("canvas");
    c.width = pad * 2;
    c.height = pad * 2;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#000";
    const ch = String.fromCodePoint(codepoint);
    const scale = targetH / font.unitsPerEm;
    const path = font.getPath(ch, pad, pad, targetH);
    path.fill = "#000";
    path.draw(ctx);
    const bbox = contentBBox(c);
    if (!bbox) {
      const out = document.createElement("canvas");
      out.width = 1;
      out.height = targetH;
      return out;
    }
    const tmp = document.createElement("canvas");
    tmp.width = bbox.maxX - bbox.minX;
    tmp.height = bbox.maxY - bbox.minY;
    tmp.getContext("2d").drawImage(
      c,
      bbox.minX, bbox.minY, tmp.width, tmp.height,
      0, 0, tmp.width, tmp.height
    );
    return scaleCanvasToHeight(tmp, targetH);
  }

  async function iconCanvas(iconId, targetH, block) {
    if (iconId.startsWith("custom:")) {
      const uuid = iconId.slice(7);
      const fit = normalizedCustomFit(block.fit);
      const rotate = [0, 90, 180, 270].includes(block.rotate) ? block.rotate : 0;
      const img = await loadImage(`/icons/custom/${uuid}`);
      const src = imageTo1BitCanvas(img);
      return processCustomImageCanvas(
        src,
        targetH,
        fit,
        rotate,
        block.crop || null,
        customWidthScale(block, src),
      );
    }
    await loadIconCatalog();
    const meta = iconCatalog?.icons?.[iconId];
    if (!meta) throw new Error(`unknown icon: ${iconId}`);
    return rasterizeBrotherGlyph(meta.family, parseInt(meta.codepoint, 10), targetH);
  }

  function iconScale(block, opts) {
    if (block.height != null && block.height !== 1.0) {
      return Math.max(0.25, Math.min(2.0, Number(block.height)));
    }
    return Math.max(0.25, Math.min(2.0, Number(opts.icon_size || 1.0)));
  }

  function gapBefore(prevKind, kind, gap) {
    return prevKind === "icon" && kind === "icon" ? Math.max(0, gap) : 0;
  }

  function canvasToDataUrl(canvas, forPrint) {
    const out = forPrint ? imageTo1BitCanvas(canvas) : canvas;
    return out.toDataURL("image/png");
  }

  function textStyleForBlock(block, opts) {
    return {
      value: String(block.value || ""),
      font_family: block.font_family || opts.font_family,
      bold: typeof block.bold === "boolean" ? block.bold : !!opts.bold,
      italic: typeof block.italic === "boolean" ? block.italic : !!opts.italic,
      font_size: Math.max(1, parseInt(block.font_size ?? opts.font_size, 10) || opts.font_size),
      letter_spacing: Number(
        block.letter_spacing ?? opts.letter_spacing ?? 0,
      ),
      v_align: parseInt(block.v_align ?? opts.v_align ?? 0, 10) || 0,
    };
  }

  async function renderBlocks(blocks, opts, tapeH, forPrint = false) {
    const margin = Math.max(0, opts.margin_h || 0);
    const iconGap = Math.max(0, parseInt(opts.icon_gap, 10) || 0);
    const prepared = [];
    let maxAscent = 0;
    let maxDescent = 0;
    for (const block of blocks) {
      if (block.type === "text") {
        const style = textStyleForBlock(block, opts);
        const fontUrl = resolveFontUrl(
          style.font_family,
          style.bold,
          style.italic,
        );
        const font = await loadFont(fontUrl);
        const ascent = font.ascender * (style.font_size / font.unitsPerEm);
        const descent = Math.abs(
          font.descender * (style.font_size / font.unitsPerEm),
        );
        if (ascent > maxAscent) maxAscent = ascent;
        if (descent > maxDescent) maxDescent = descent;
        prepared.push({
          kind: "text",
          ...style,
          font,
          ascent,
          descent,
        });
      } else if (block.type === "icon" && block.id) {
        prepared.push({ kind: "icon", block });
      }
    }
    if (maxAscent <= 0 || maxDescent <= 0) {
      const fallbackUrl = resolveFontUrl(opts.font_family, opts.bold, opts.italic);
      const fallbackFont = await loadFont(fallbackUrl);
      const fallbackSize = Math.max(1, parseInt(opts.font_size, 10) || 1);
      maxAscent = fallbackFont.ascender * (fallbackSize / fallbackFont.unitsPerEm);
      maxDescent = Math.abs(
        fallbackFont.descender * (fallbackSize / fallbackFont.unitsPerEm),
      );
    }
    const lineH = maxAscent + maxDescent;
    const iconCap = Math.max(8, tapeH - 4);
    const segments = [];
    for (const seg of prepared) {
      if (seg.kind === "icon") {
        const scale = iconScale(seg.block, opts);
        const ih = Math.max(8, Math.min(iconCap, Math.round(lineH * scale)));
        segments.push({
          kind: "icon",
          canvas: await iconCanvas(seg.block.id, ih, seg.block),
        });
      } else {
        segments.push(seg);
      }
    }

    let segGaps = 0;
    for (let i = 1; i < segments.length; i++) {
      segGaps += gapBefore(segments[i - 1].kind, segments[i].kind, iconGap);
    }

    const segWidths = segments.map((seg) => {
      if (seg.kind === "text") {
        return Math.round(
          lineWidth(seg.font, seg.value, seg.font_size, seg.letter_spacing),
        );
      }
      if (seg.block && seg.block.id && seg.block.id.startsWith("custom:")) {
        return Math.max(
          1,
          Math.round(seg.canvas.height * customWidthScale(seg.block, seg.canvas)),
        );
      }
      return seg.canvas.width;
    });
    const contentW = segWidths.reduce((a, b) => a + b, 0) + segGaps;
    const imgW = contentW + margin * 2;
    const imgH = tapeH;

    const canvas = document.createElement("canvas");
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, imgW, imgH);
    ctx.fillStyle = "#000";

    const blockTop = Math.floor((imgH - lineH) / 2);
    const baseline = blockTop + maxAscent;
    let x = margin + Math.floor((contentW - segWidths.reduce((a, b) => a + b, 0) - segGaps) / 2);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (i > 0) x += gapBefore(segments[i - 1].kind, seg.kind, iconGap);
      if (seg.kind === "text") {
        drawLine(
          ctx,
          seg.font,
          x,
          baseline + seg.v_align,
          seg.value,
          seg.font_size,
          seg.letter_spacing,
        );
        x += segWidths[i];
      } else {
        const iy = blockTop + Math.floor((lineH - seg.canvas.height) / 2);
        ctx.drawImage(seg.canvas, x, Math.max(0, iy));
        x += segWidths[i];
      }
    }

    return canvasToDataUrl(canvas, forPrint);
  }

  async function renderLabel(blocks, opts, tapeH, { forPrint = false } = {}) {
    if (!blocks || !blocks.length) throw new Error("empty blocks");
    return renderBlocks(blocks, opts, tapeH, forPrint);
  }

  return {
    setFontFamilies,
    setIconCatalog,
    loadIconCatalog,
    renderLabel,
    iconCanvas,
    resolveFontUrl,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.PtRender = PtRender;
}
