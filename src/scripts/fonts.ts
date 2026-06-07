const fontCatalog = new Map();
const fontFaceCache = new Set();
const fontParseCache = new Map();
const fontUnitsCache = new Map();

function unitsKey(name, bold, italic) {
  return `${name}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
}

function cssFamilyName(name) {
  return `ptp-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function styleKey(bold, italic) {
  if (bold && italic) return "boldItalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "regular";
}

function resolveVariant(variants, bold, italic) {
  const key = styleKey(bold, italic);
  const order =
    key === "boldItalic"
      ? ["boldItalic", "bold", "italic", "regular"]
      : key === "bold"
        ? ["bold", "boldItalic", "regular", "italic"]
        : key === "italic"
          ? ["italic", "boldItalic", "regular", "bold"]
          : ["regular", "bold", "italic", "boldItalic"];
  for (const k of order) {
    if (variants[k]) return variants[k];
  }
  return null;
}

function ensureFontFaceSheet() {
  let el = document.getElementById("fontFaces");
  if (!el) {
    el = document.createElement("style");
    el.id = "fontFaces";
    document.head.append(el);
  }
  return el;
}

export async function loadFonts() {
  const resp = await fetch("/api/fonts");
  const data = await resp.json();
  const families = data.families || [];
  fontCatalog.clear();
  for (const fam of families) {
    fontCatalog.set(fam.name, {
      name: fam.name,
      variants: fam.variants || {},
      slug: fam.slug || null,
      cssFamily: cssFamilyName(fam.name),
    });
    const metrics = fam.metrics || {};
    for (const [variant, m] of Object.entries(metrics)) {
      if (!m || typeof m !== "object") continue;
      const bold = variant === "bold" || variant === "boldItalic";
      const italic = variant === "italic" || variant === "boldItalic";
      fontUnitsCache.set(unitsKey(fam.name, bold, italic), {
        ascender: m.ascender,
        descender: m.descender,
        unitsPerEm: m.unitsPerEm,
      });
    }
  }
  const css = [];
  for (const fam of fontCatalog.values()) {
    const rules = [
      ["regular", 400, "normal"],
      ["bold", 700, "normal"],
      ["italic", 400, "italic"],
      ["boldItalic", 700, "italic"],
    ];
    for (const [key, weight, style] of rules) {
      const url = fam.variants[key];
      if (!url) continue;
      const cacheKey = `${fam.name}:${key}:${url}`;
      if (fontFaceCache.has(cacheKey)) continue;
      fontFaceCache.add(cacheKey);
      const fmt = url.toLowerCase().endsWith(".otf")
        ? 'format("opentype")'
        : 'format("truetype")';
      css.push(
        `@font-face{font-family:"${fam.cssFamily}";src:url("${url}") ${fmt};font-weight:${weight};font-style:${style};font-display:swap}`,
      );
    }
    if (fam.slug) {
      css.push(
        `@font-face{font-family:"${fam.cssFamily}-preview";src:url("/font-previews/${fam.slug}.woff2") format("woff2");font-display:swap}`,
      );
    }
  }
  ensureFontFaceSheet().textContent = css.join("\n");
  return families;
}

function getFamilyMeta(name) {
  return fontCatalog.get(name) || null;
}

export function listFonts() {
  return [...fontCatalog.values()]
    .map((fam) => ({
      name: fam.name,
      previewFamily: fam.slug ? `${fam.cssFamily}-preview` : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveStageFamily(name) {
  const fam = getFamilyMeta(name);
  if (!fam) return "system-ui, sans-serif";
  return `"${fam.cssFamily}", system-ui, sans-serif`;
}

async function loadVariantFont(name, bold, italic) {
  const fam = getFamilyMeta(name);
  if (!fam) throw new Error("missing font family");
  const url = resolveVariant(fam.variants, bold, italic);
  if (!url) throw new Error("missing font variant");
  if (fontParseCache.has(url)) return fontParseCache.get(url);
  const p = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((buf) => opentype.parse(buf));
  fontParseCache.set(url, p);
  return p;
}

export async function fontMetrics(name, bold, italic, fontSize) {
  const font = await loadVariantFont(name, bold, italic);
  fontUnitsCache.set(unitsKey(name, bold, italic), {
    ascender: font.ascender,
    descender: font.descender,
    unitsPerEm: font.unitsPerEm,
  });
  return fontMetricsFromUnits(font, fontSize);
}

function fontMetricsFromUnits(units, fontSize) {
  const size = Math.max(1, Number(fontSize) || 1);
  const ascent = units.ascender * (size / units.unitsPerEm);
  const descent = Math.abs(units.descender * (size / units.unitsPerEm));
  return { ascent, descent };
}

export function fontMetricsSync(name, bold, italic, fontSize) {
  const units = fontUnitsCache.get(unitsKey(name, bold, italic));
  if (!units) return null;
  return fontMetricsFromUnits(units, fontSize);
}
