import {
  loadFonts,
  listFonts,
  resolveStageFamily,
  fontMetrics,
  fontMetricsSync,
} from "./fonts";
import { createStageController } from "./stage";
import { formatMediaLabel, tapePreview } from "./tape-palette";
import {
  loadServerState,
  pushServerState,
  scheduleStateSave,
  flushStateSave,
} from "./state";

const $ = (id) => document.getElementById(id);
let DEFAULT_PREFS = {};
let LIMITS = {};
let tapeMm = 18;
let baselineTapeHeightPx = 112;
let detectedMedia = null;
let lastTapeWidthMm = null;
let usbOk = false;
let printInFlight = 0;
let toastTimer = null;
let stage = null;
let recent = [];

function showToast(text, kind = "error") {
  const el = $("toast");
  if (!el) return;
  el.textContent = text;
  el.className = `toast ${kind}`;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function defaultRowFromBlocks(blocks, prefs) {
  return {
    blocks: blocks.length ? blocks : [{ type: "text", value: "" }],
    qty: 1,
    font_size: prefs.fontSize,
    font_family: prefs.fontFamily,
    bold: prefs.bold,
    italic: prefs.italic,
    v_align: prefs.vAlign,
    letter_spacing: prefs.letterSpacing,
    margin_h: prefs.marginH,
    icon_gap: prefs.iconGap,
    icon_size: prefs.iconSize,
  };
}

function rowToPayload(row) {
  return {
    blocks: row.blocks,
    qty: row.qty || 1,
    font_size: row.font_size,
    font_family: row.font_family,
    bold: row.bold,
    italic: row.italic,
    v_align: row.v_align,
    letter_spacing: row.letter_spacing,
    margin_h: row.margin_h,
    icon_gap: row.icon_gap,
    icon_size: row.icon_size,
  };
}

function currentPrefsForSave() {
  return {
    fontFamily: DEFAULT_PREFS.fontFamily,
    bold: DEFAULT_PREFS.bold,
    italic: DEFAULT_PREFS.italic,
    fontSize: DEFAULT_PREFS.fontSize,
    vAlign: DEFAULT_PREFS.vAlign,
    letterSpacing: DEFAULT_PREFS.letterSpacing,
    marginH: DEFAULT_PREFS.marginH,
    iconGap: DEFAULT_PREFS.iconGap,
    iconSize: DEFAULT_PREFS.iconSize,
  };
}

function buildStatePayload() {
  const rows = stage.getRows();
  return {
    draft: { lines: rows.map((r) => r.blocks).filter((blocks) => blocks.length) },
    queue: rows.map(rowToPayload),
    prefs: currentPrefsForSave(),
  };
}

function applyConfigLimits() {
  if (!LIMITS.qty) return;
}

async function loadConfig() {
  const cfg = await (await fetch("/api/config")).json();
  DEFAULT_PREFS = cfg.prefs || {};
  LIMITS = cfg.limits || {};
  tapeMm = cfg.tapeHeightMm || 18;
  baselineTapeHeightPx = 112;
  applyConfigLimits();
  updateTapeScale();
}

function updateTapeScale() {
  const dprScale = window.devicePixelRatio > 1 ? 72 / 96 : 1;
  const displayMm = tapeMm * dprScale;
  document.documentElement.style.setProperty("--tape-display-mm", String(displayMm));
  const displayPx = (displayMm * 96) / 25.4;
  const canvasPx = effectiveTapeHeightPx();
  const scale = canvasPx > 0 ? displayPx / canvasPx : 1;
  document.documentElement.style.setProperty(
    "--display-scale",
    scale.toFixed(4),
  );
  stage?.rerenderStyles?.();
}

function effectiveTapeHeightPx() {
  if (detectedMedia && detectedMedia.height_px) return detectedMedia.height_px;
  return baselineTapeHeightPx;
}

function currentDisplayScale() {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--display-scale"),
  );
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function setStatus(text, cls) {
  const el = $("status");
  if (!el) return;
  el.textContent = text;
  el.className = cls;
  el.style.removeProperty("--ink");
}

function setStatusMedia(media) {
  const el = $("status");
  if (!el) return;
  const preview = tapePreview(media.tape_color, media.text_color);
  el.className = "ok";
  el.style.setProperty("--ink", preview.ink);
  el.innerHTML =
    '<span class="tape-swatch" style="background:' +
    preview.bg +
    '"></span>' +
    media.width_mm +
    "mm";
}

function formatRelative(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds - h * 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.round((seconds - d * 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

function updateMediaPanel() {
  const el = $("statTape");
  if (!el) return;
  if (!usbOk) {
    el.textContent = "Not connected";
    el.title = "";
    return;
  }
  if (!detectedMedia || !detectedMedia.width_mm) {
    el.textContent = "—";
    el.title = "";
    return;
  }
  const preview = tapePreview(
    detectedMedia.tape_color,
    detectedMedia.text_color,
  );
  const label = formatMediaLabel(detectedMedia);
  el.style.setProperty("--ink", preview.ink);
  el.innerHTML =
    '<span class="tape-swatch" style="background:' +
    preview.bg +
    '"></span>' +
    label;
  el.title = label;
}

function updateSystemPanel(r) {
  const memFill = $("statMemFill");
  const memText = $("statMemText");
  const mem = r && r.mem;
  if (mem && mem.avail_mb != null && mem.total_mb != null) {
    const total = Number(mem.total_mb) || 0;
    const avail = Number(mem.avail_mb) || 0;
    const used = Math.max(0, total - avail);
    const usedRatio = total > 0 ? used / total : 0;
    const usedPct = Math.max(0, Math.min(100, Math.round(usedRatio * 100)));
    memFill.style.width = `${usedPct}%`;
    memFill.classList.toggle("medium", usedRatio >= 0.6 && usedRatio < 0.85);
    memFill.classList.toggle("high", usedRatio >= 0.85);
    memText.textContent = `${usedPct}%`;
  } else {
    memFill.style.width = "0%";
    memFill.classList.remove("medium", "high");
    memText.textContent = "—";
  }
  const bridge = r && r.bridge;
  if (bridge) {
    if (bridge.connected) {
      $("statBridge").innerHTML =
        '<span class="bridge-pill ok"><span class="bridge-dot"></span>Connected</span>';
    } else {
      $("statBridge").innerHTML =
        '<span class="bridge-pill bad"><span class="bridge-dot"></span>Disconnected</span>';
    }
  } else {
    $("statBridge").textContent = "—";
  }
  $("statTemp").textContent =
    r && r.temp_c != null ? `${r.temp_c.toFixed(1)} °C` : "—";
  $("statUptime").textContent =
    r && r.uptime_s != null ? formatRelative(r.uptime_s) : "—";
  if (r && r.deployed_at) {
    const ts = Number(r.deployed_at);
    if (Number.isFinite(ts)) {
      const ageS = Date.now() / 1000 - ts;
      $("statDeployed").textContent = `${formatRelative(ageS)} ago`;
      $("statDeployed").title = new Date(ts * 1000).toLocaleString();
    }
  } else {
    $("statDeployed").textContent = "—";
  }
}

function updateStatusDisplay() {
  if (printInFlight > 0) {
    setStatus("printing", "printing");
    return;
  }
  if (!usbOk) {
    setStatus("not found", "bad");
    return;
  }
  if (detectedMedia && detectedMedia.width_mm) {
    if (
      detectedMedia.errors &&
      detectedMedia.errors.includes("no_media")
    ) {
      setStatus(detectedMedia.width_mm + "mm · no media", "bad");
      return;
    }
    setStatusMedia(detectedMedia);
    return;
  }
  setStatus("ready", "ok");
}

function applyMedia(data) {
  if (!data || !data.ok) return;
  const widthMm = data.width_mm || 0;
  const widthChanged = widthMm > 0 && widthMm !== lastTapeWidthMm;
  detectedMedia = data;
  if (data.width_mm) tapeMm = data.width_mm;
  updateTapeScale();
  if (stage) stage.setTape(tapePreview(data.tape_color, data.text_color));
  if (stage && data.preset && widthChanged) {
    stage.setNewRowDefaults(data.preset);
  }
  if (widthMm > 0) lastTapeWidthMm = widthMm;
  updateMediaPanel();
}

function applySnapshot(r) {
  usbOk = !!r.ok;
  updateSystemPanel(r);
  if (r.media) applyMedia(r.media);
  else updateMediaPanel();
  updateStatusDisplay();
}

function startEvents() {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    applySnapshot(JSON.parse(e.data));
  };
  es.onerror = () => {
    usbOk = false;
    detectedMedia = null;
    lastTapeWidthMm = null;
    setStatus("error", "bad");
    updateSystemPanel(null);
    updateMediaPanel();
  };
}

async function rowPreviewPng(row, forPrint = false) {
  return globalThis.PtRender.renderLabel(
    row.blocks,
    rowToPayload(row),
    effectiveTapeHeightPx(),
    { forPrint },
  );
}

function renderRecent() {
  const section = $("recentSection");
  const container = $("recent");
  if (!section || !container) return;
  container.innerHTML = "";
  section.hidden = recent.length === 0;
  $("recentHint").textContent = recent.length
    ? `${recent.length} label${recent.length === 1 ? "" : "s"}`
    : "";
  recent.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "recent-row";
    row.title = "Add to queue";
    const img = document.createElement("img");
    img.src = item.png || "";
    img.alt = "";
    const qty = document.createElement("span");
    qty.className = "recent-qty";
    qty.textContent = item.qty || 1;
    row.append(img, qty);
    row.addEventListener("click", () => {
      const { png, printed_at, ...rowData } = item;
      stage.appendRow(rowData);
    });
    container.append(row);
  });
}

async function applyRecent(items) {
  recent = (items || []).map((item) => ({ ...item, png: null }));
  await Promise.all(
    recent.map(async (item) => {
      item.png = await rowPreviewPng(item);
    }),
  );
  renderRecent();
}

async function printRows(rows) {
  if (!rows.length) return;
  printInFlight++;
  updateStatusDisplay();
  $("printBtn").disabled = true;
  try {
    const labels = await Promise.all(
      rows.map(async (row) => ({
        png: await rowPreviewPng(row, true),
        qty: row.qty || 1,
        meta: rowToPayload(row),
      })),
    );
    const out = await (
      await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels }),
      })
    ).json();
    if (!out.ok) {
      showToast("Print failed: " + out.err);
      return;
    }
    await applyRecent(out.recent);
  } catch (e) {
    showToast("Print failed: " + (e.message || "error"));
  } finally {
    printInFlight--;
    $("printBtn").disabled = false;
    updateStatusDisplay();
  }
}

function wireSystemPanel() {
  $("settingsBtn").addEventListener("click", () => {
    const btn = $("settingsBtn");
    const panel = $("systemPanel");
    const open = !panel.classList.contains("open");
    panel.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function wireGlobalPrefs() {
  const margin = $("prefMargin");
  const valign = $("prefVAlign");
  margin.value = String(DEFAULT_PREFS.marginH ?? 24);
  valign.value = String(DEFAULT_PREFS.vAlign ?? 0);
  margin.addEventListener("input", () => {
    const v = parseInt(margin.value, 10);
    if (!Number.isFinite(v)) return;
    DEFAULT_PREFS.marginH = v;
    stage?.setGlobalDefault("margin_h", v);
  });
  valign.addEventListener("input", () => {
    const v = parseInt(valign.value, 10);
    if (!Number.isFinite(v)) return;
    DEFAULT_PREFS.vAlign = v;
    stage?.setGlobalDefault("v_align", v);
  });
}

async function init() {
  wireSystemPanel();
  await loadConfig();
  const families = await loadFonts();
  globalThis.PtRender.setFontFamilies(families);
  const raw = await loadServerState();
  const prefs = { ...DEFAULT_PREFS, ...(raw.prefs || {}) };
  DEFAULT_PREFS = prefs;

  const rowsFromQueue = (raw.queue || []).map((item) => ({ ...item }));
  const rowsFromDraft = (raw.draft?.lines || []).map((blocks) =>
    defaultRowFromBlocks(blocks, prefs),
  );
  const initialRows = rowsFromQueue.length ? rowsFromQueue : rowsFromDraft;
  const defaultsForNewRows = {
    font_size: prefs.fontSize,
    font_family: prefs.fontFamily,
    bold: prefs.bold,
    italic: prefs.italic,
    v_align: prefs.vAlign,
    letter_spacing: prefs.letterSpacing,
    margin_h: prefs.marginH,
    icon_gap: prefs.iconGap,
    icon_size: prefs.iconSize,
  };

  stage = createStageController({
    rowsEl: $("rows"),
    drawerEl: $("drawer"),
    fonts: listFonts(),
    resolveStageFamily,
    fontMetrics,
    fontMetricsSync,
    limits: LIMITS,
    defaultPrefs: defaultsForNewRows,
    getDisplayScale: currentDisplayScale,
    showToast,
    onChange: () => {
      scheduleStateSave(buildStatePayload, 500);
    },
    onPrint: printRows,
  });
  stage.setRows(
    initialRows.length
      ? initialRows
      : [defaultRowFromBlocks([{ type: "text", value: "" }], prefs)],
  );

  wireGlobalPrefs();
  $("rowAdd").onclick = () => stage.addRowEnd();
  $("printBtn").onclick = () => stage.printAll();
  let clickStartedInsideEditor = false;
  document.addEventListener("mousedown", (e) => {
    clickStartedInsideEditor = !!(
      e.target.closest(".editor") ||
      e.target.closest("#systemPanel") ||
      e.target.closest("#settingsBtn")
    );
  });
  document.addEventListener("click", () => {
    if (clickStartedInsideEditor) return;
    stage.closeDrawer();
  });

  window.addEventListener("beforeunload", () => flushStateSave(buildStatePayload));
  window.addEventListener("resize", () => {
    updateTapeScale();
    stage?.refreshPointer();
  });

  await applyRecent(raw.recent || []);
  startEvents();
}

init().catch((e) => showToast(e.message || "Init failed"));
