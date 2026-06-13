import { renderDrawer } from "./drawer";
import { buildNumberStepper } from "./stepper";
import { COPY, ELLIPSIS, SEG_ADD, X } from "./lucide-icons";
import {
  iconThumbUrl,
  imageAltText,
  isCustomIcon,
  loadIconCategories,
  loadCategoryIcons,
  searchIcons,
  uploadCustomIcon,
} from "./icons";

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function isCaretAtStart(el) {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || range.startOffset !== 0) return false;
  const node = range.startContainer;
  return node === el || node === el.firstChild;
}

function focusCaretAtEnd(el) {
  el.focus();
  const sel = document.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function textBlockDefaults(row) {
  return {
    type: "text",
    value: "",
    font_family: row.font_family,
    bold: row.bold,
    italic: row.italic,
    font_size: row.font_size,
    letter_spacing: row.letter_spacing,
    v_align: row.v_align,
  };
}

function normalizeTextBlock(block, row) {
  return {
    type: "text",
    value: String(block.value || ""),
    font_family: block.font_family || row.font_family,
    bold: typeof block.bold === "boolean" ? block.bold : !!row.bold,
    italic: typeof block.italic === "boolean" ? block.italic : !!row.italic,
    font_size: parseInt(block.font_size ?? row.font_size, 10) || row.font_size,
    letter_spacing:
      parseFloat(block.letter_spacing ?? row.letter_spacing) || row.letter_spacing,
    v_align: parseInt(block.v_align ?? row.v_align, 10) || row.v_align,
  };
}

function normalizeIconBlock(block) {
  const out = { type: "icon", id: block.id };
  if (isCustomIcon(block.id)) {
    const width = Number(block.width);
    if (Number.isFinite(width) && width > 0) out.width = Math.max(0.1, width);
    const fit = block.fit === "fit" ? "contain" : block.fit;
    if (fit === "contain" || fit === "cover" || fit === "crop") out.fit = fit;
    if (block.crop) {
      const { x, y, w, h } = block.crop;
      if (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Number.isFinite(w) &&
        Number.isFinite(h) &&
        w > 0 &&
        h > 0
      ) {
        out.crop = { x, y, w, h };
      }
    }
    const coverY = Number(block.cover_y);
    if (Number.isFinite(coverY)) out.cover_y = Math.max(0, Math.min(1, coverY));
  } else if (block.height != null) {
    out.height = block.height;
  }
  if (block.rotate) out.rotate = block.rotate;
  return out;
}

const DEFAULT_IMAGE_WIDTH = 3;

function clampImageWidth(width, fallback = DEFAULT_IMAGE_WIDTH) {
  const value = Number(width);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(0.1, value);
}

function imageFitMode(fit) {
  if (fit === "fit") return "cover";
  if (fit === "contain" || fit === "cover" || fit === "crop") return fit;
  return "cover";
}

function drawerImageFit(fit) {
  const mode = imageFitMode(fit);
  return mode === "crop" ? "cover" : mode;
}

function clampCoverY(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function coverImageDraw(boundsW, boundsH, imgW, imgH, coverY) {
  const drawW = boundsW;
  const drawH = (imgH * boundsW) / imgW;
  const drawX = 0;
  const minDy = boundsH - drawH;
  const drawY = minDy < 0 ? minDy * (1 - coverY) : (boundsH - drawH) / 2;
  return { drawW, drawH, drawX, drawY, minDy };
}

function coverYFromDrawY(boundsH, drawH, drawY) {
  const minDy = boundsH - drawH;
  if (minDy >= 0) return 0.5;
  return clampCoverY(1 - drawY / minDy);
}

function layoutImageEdit(stage, source, block, lineH) {
  const fit = drawerImageFit(block.fit);
  const boundsW = lineH * clampImageWidth(block.width);
  const boundsH = lineH;
  const imgW = source.naturalWidth || 1;
  const imgH = source.naturalHeight || 1;
  let drawW;
  let drawH;
  let drawX;
  let drawY;
  if (fit === "cover") {
    const laid = coverImageDraw(
      boundsW,
      boundsH,
      imgW,
      imgH,
      clampCoverY(block.cover_y),
    );
    ({ drawW, drawH, drawX, drawY } = laid);
  } else {
    const scale = Math.min(boundsW / imgW, boundsH / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
    drawX = (boundsW - drawW) / 2;
    drawY = (boundsH - drawH) / 2;
  }
  const stageLeft = Math.min(0, drawX);
  const stageTop = Math.min(0, drawY);
  const stageRight = Math.max(boundsW, drawX + drawW);
  const stageBottom = Math.max(boundsH, drawY + drawH);
  const stageW = stageRight - stageLeft;
  const stageH = stageBottom - stageTop;

  stage.style.left = `${stageLeft}px`;
  stage.style.top = `${stageTop}px`;
  stage.style.width = `${stageW}px`;
  stage.style.height = `${stageH}px`;
  source.style.width = `${drawW}px`;
  source.style.height = `${drawH}px`;
  source.style.left = `${drawX - stageLeft}px`;
  source.style.top = `${drawY - stageTop}px`;
}

function unmountImageEdits() {
  for (const seg of document.querySelectorAll(".seg-image.is-editing")) {
    seg.classList.remove("is-editing");
    seg.querySelector(".seg-image-edit")?.remove();
    seg.querySelector(".seg-image-chrome")?.remove();
  }
  for (const row of document.querySelectorAll(".stage-row.is-image-editing")) {
    row.classList.remove("is-image-editing");
  }
}

function clampFontSize(n) {
  return Math.min(128, Math.max(10, Math.round(n)));
}

function unmountTextResizes(keepSeg = null) {
  for (const wrap of document.querySelectorAll(".seg-text-wrap")) {
    const seg = wrap.querySelector(".seg-text");
    if (seg === keepSeg) continue;
    const parent = wrap.parentNode;
    if (seg && parent) {
      parent.insertBefore(seg, wrap);
      wrap.remove();
    }
  }
  for (const seg of document.querySelectorAll(".seg-text")) {
    if (seg === keepSeg) continue;
    seg.querySelector(".seg-text-handle")?.remove();
  }
}

function mountTextResize(seg, getSize, onSizeChange) {
  if (seg.closest(".seg-text-wrap")?.querySelector(".seg-text-handle")) return;

  let wrap = seg.closest(".seg-text-wrap");
  if (!wrap) {
    wrap = document.createElement("span");
    wrap.className = "seg-text-wrap";
    const parent = seg.parentNode;
    if (!parent) return;
    parent.insertBefore(wrap, seg);
    wrap.appendChild(seg);
  }

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "seg-text-handle";
  handle.setAttribute("aria-label", "Resize font size");
  handle.tabIndex = -1;
  handle.innerHTML = '<span class="seg-text-handle-grip" aria-hidden="true"></span>';
  wrap.appendChild(handle);

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startSize = getSize();
    const onMove = (ev) => {
      onSizeChange(clampFontSize(startSize + Math.round((ev.clientX - startX) / 2)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function syncImageEditLayout(seg, block, lineH) {
  const edit = seg.querySelector(".seg-image-edit");
  if (!edit) return;
  const stage = edit.querySelector(".seg-image-edit-stage");
  const source = edit.querySelector(".seg-image-source");
  if (!stage || !source || !source.complete) return;
  layoutImageEdit(stage, source, block, lineH);
}

function mountImageEdit(
  seg,
  rowIndex,
  segIndex,
  block,
  lineH,
  getBlock,
  onWidthChange,
  onCoverYChange,
) {
  const existing = seg.querySelector(".seg-image-edit");
  if (existing) {
    syncImageEditLayout(seg, getBlock() || block, lineH);
    seg.classList.toggle("cover-fit", drawerImageFit((getBlock() || block).fit) === "cover");
    return;
  }

  seg.classList.add("is-editing");
  seg.classList.toggle("cover-fit", drawerImageFit(block.fit) === "cover");
  const rowNode = seg.closest(".stage-row");
  if (rowNode) rowNode.classList.add("is-image-editing");

  const edit = document.createElement("div");
  edit.className = "seg-image-edit";
  edit.innerHTML = `
    <div class="seg-image-edit-stage">
      <img class="seg-image-source" alt="" draggable="false" />
    </div>
  `;
  seg.prepend(edit);

  const chrome = document.createElement("div");
  chrome.className = "seg-image-chrome";
  chrome.innerHTML = `
    <div class="seg-image-bounds">
      <button type="button" class="seg-image-handle" aria-label="Resize width">
        <span class="seg-image-handle-grip" aria-hidden="true"></span>
      </button>
    </div>
  `;
  seg.append(chrome);

  const stage = edit.querySelector(".seg-image-edit-stage");
  const source = edit.querySelector(".seg-image-source");
  const handle = chrome.querySelector(".seg-image-handle");
  source.alt = imageAltText(block.id);
  source.src = iconThumbUrl(block.id);

  const relayout = () => {
    const current = getBlock();
    if (!current) return;
    seg.classList.toggle("cover-fit", drawerImageFit(current.fit) === "cover");
    layoutImageEdit(stage, source, current, lineH);
  };
  source.addEventListener("load", relayout);
  if (source.complete) relayout();

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const current = getBlock();
    if (!current) return;
    const startWidth = clampImageWidth(current.width);
    const onMove = (ev) => {
      const next = clampImageWidth(startWidth + (ev.clientX - startX) / lineH);
      onWidthChange(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  stage.addEventListener("pointerdown", (e) => {
    const current = getBlock();
    if (!current || drawerImageFit(current.fit) !== "cover") return;
    if (!source.complete || source.naturalWidth < 1) return;
    e.preventDefault();
    e.stopPropagation();
    const boundsH = lineH;
    const boundsW = lineH * clampImageWidth(current.width);
    const { drawH, minDy } = coverImageDraw(
      boundsW,
      boundsH,
      source.naturalWidth,
      source.naturalHeight,
      clampCoverY(current.cover_y),
    );
    if (minDy >= 0) return;
    const startY = e.clientY;
    const startDrawY = minDy * (1 - clampCoverY(current.cover_y));
    const onMove = (ev) => {
      const drawY = Math.max(minDy, Math.min(0, startDrawY + ev.clientY - startY));
      onCoverYChange(coverYFromDrawY(boundsH, drawH, drawY));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  edit.addEventListener("pointerdown", (e) => e.stopPropagation());
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => {
    const target = e.target as Node;
    for (const tail of document.querySelectorAll(".row-tail.open")) {
      if (!tail.contains(target)) {
        tail.classList.remove("open");
        const t = tail.querySelector(".row-menu-toggle");
        if (t) t.setAttribute("aria-expanded", "false");
      }
    }
  });
}

export function createStageController({
  rowsEl,
  drawerEl,
  fonts,
  resolveStageFamily,
  fontMetrics,
  fontMetricsSync,
  limits,
  defaultPrefs,
  getDisplayScale = () => 1,
  showToast,
  onChange,
  onPrint,
}) {
  const state = {
    rows: [],
    tape: { bg: "#f5f5f5", ink: "#1a1a1a", border: "transparent" },
    active: { mode: "empty", rowIndex: -1, segIndex: -1, insertIndex: -1 },
    iconState: {
      loaded: false,
      categories: [],
      categoryId: "",
      icons: [],
      searchQuery: "",
      sprite: null,
    },
  };

  let pendingFocus = null;
  const drawerHome = drawerEl.parentElement;

  function signalChange() {
    onChange(clone(state.rows));
  }

  function setActive(next, { rebuild = false } = {}) {
    const prevMode = state.active.mode;
    const nextMode = next.mode ?? prevMode;
    const animate =
      (rebuild || nextMode !== prevMode) && document.startViewTransition;
    const apply = () => {
      state.active = { ...state.active, ...next };
      if (rebuild) rebuildRows();
      applyActiveState();
    };
    if (animate) document.startViewTransition(apply);
    else apply();
  }

  function applyTextStyleToInput(input, seg) {
    const k = getDisplayScale();
    input.style.fontFamily = resolveStageFamily(seg.font_family);
    input.style.fontWeight = seg.bold ? "700" : "400";
    input.style.fontStyle = seg.italic ? "italic" : "normal";
    input.style.fontSize = `${(seg.font_size * k).toFixed(2)}px`;
    input.style.letterSpacing = `${(seg.letter_spacing * k).toFixed(2)}px`;
    input.style.setProperty("--seg-valign", `${(seg.v_align * k).toFixed(2)}px`);
  }

  function ensureNonEmpty() {
    if (state.rows.length) return;
    state.rows.push(makeRow());
  }

  function makeRow() {
    return {
      blocks: [textBlockDefaults(defaultPrefs)],
      qty: 1,
      font_size: defaultPrefs.font_size,
      font_family: defaultPrefs.font_family,
      bold: defaultPrefs.bold,
      italic: defaultPrefs.italic,
      v_align: defaultPrefs.v_align,
      letter_spacing: defaultPrefs.letter_spacing,
      margin_h: defaultPrefs.margin_h,
      icon_gap: defaultPrefs.icon_gap,
      icon_size: defaultPrefs.icon_size,
    };
  }

  function addRow(atIndex) {
    const idx = Math.max(0, Math.min(state.rows.length, atIndex));
    state.rows.splice(idx, 0, makeRow());
    pendingFocus = { rowIndex: idx, segIndex: 0, caret: "end" };
    signalChange();
    setActive(
      { mode: "font", rowIndex: idx, segIndex: 0, insertIndex: -1 },
      { rebuild: true },
    );
  }

  let lastSyncedIconSeg = null;
  let pendingIconScroll = false;
  let iconStatePromise = null;
  function ensureIconStateLoaded() {
    if (state.iconState.loaded) return Promise.resolve();
    if (iconStatePromise) return iconStatePromise;
    iconStatePromise = loadIconCategories()
      .then(async ({ categories, defaultCategoryId, sprite }) => {
        state.iconState.categories = categories;
        state.iconState.categoryId = defaultCategoryId;
        state.iconState.sprite = sprite;
        state.iconState.icons = await loadCategoryIcons(defaultCategoryId);
        state.iconState.loaded = true;
      })
      .catch(async () => {
        await new Promise((r) => setTimeout(r, 500));
        const { categories, defaultCategoryId, sprite } =
          await loadIconCategories();
        state.iconState.categories = categories;
        state.iconState.categoryId = defaultCategoryId;
        state.iconState.sprite = sprite;
        state.iconState.icons = await loadCategoryIcons(defaultCategoryId);
        state.iconState.loaded = true;
      })
      .catch((e) => {
        showToast(e.message || "Icons failed to load");
      })
      .finally(() => {
        iconStatePromise = null;
        applyActiveState();
      });
    return iconStatePromise;
  }

  async function setIconCategory(categoryId) {
    await ensureIconStateLoaded();
    state.iconState.categoryId = categoryId;
    state.iconState.searchQuery = "";
    state.iconState.icons = await loadCategoryIcons(categoryId);
    applyActiveState();
  }

  async function setIconSearch(query) {
    await ensureIconStateLoaded();
    state.iconState.searchQuery = query;
    if (!query.trim()) {
      state.iconState.icons = await loadCategoryIcons(state.iconState.categoryId);
    } else {
      state.iconState.icons = await searchIcons(query);
    }
    applyActiveState();
  }

  function insertBlock(rowIndex, insertIndex, block) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const idx = Math.max(0, Math.min(row.blocks.length, insertIndex));
    row.blocks.splice(idx, 0, block);
    signalChange();
    if (block.type === "text") {
      pendingFocus = { rowIndex, segIndex: idx, caret: "end" };
      setActive(
        { mode: "font", rowIndex, segIndex: idx, insertIndex: -1 },
        { rebuild: true },
      );
    } else if (isCustomIcon(block.id)) {
      setActive(
        { mode: "image", rowIndex, segIndex: idx, insertIndex: -1 },
        { rebuild: true },
      );
    } else {
      setActive(
        { mode: "icon", rowIndex, segIndex: idx, insertIndex: -1 },
        { rebuild: true },
      );
    }
  }

  function removeSegment(rowIndex, segIndex) {
    const row = state.rows[rowIndex];
    if (!row) return;
    row.blocks.splice(segIndex, 1);
    if (!row.blocks.length) {
      state.rows.splice(rowIndex, 1);
      ensureNonEmpty();
    }
    signalChange();
    setActive(
      { mode: "empty", rowIndex: -1, segIndex: -1, insertIndex: -1 },
      { rebuild: true },
    );
  }

  function updateSegmentTextStyle(rowIndex, segIndex, patch) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "text") return;
    Object.assign(block, patch);
    signalChange();
    const input = querySegEl(rowIndex, segIndex);
    if (input) applyTextStyleToInput(input, normalizeTextBlock(block, row));
    applyRowMetricsForIndex(rowIndex);
    applyActiveState();
  }

  function setFontSize(rowIndex, segIndex, fontSize) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "text") return;
    const next = clampFontSize(fontSize);
    if (block.font_size === next) return;
    block.font_size = next;
    signalChange();
    const input = querySegEl(rowIndex, segIndex);
    if (input) applyTextStyleToInput(input, normalizeTextBlock(block, row));
    applyRowMetricsForIndex(rowIndex);
    openDrawerForCurrent();
    requestAnimationFrame(updateDrawerPointer);
  }

  function updateImageMode(rowIndex, segIndex, fit) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "icon" || !isCustomIcon(block.id)) return;
    block.fit = imageFitMode(fit);
    signalChange();
    setActive({ mode: "image", rowIndex, segIndex }, { rebuild: true });
  }

  function rotateImage(rowIndex, segIndex) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "icon" || !isCustomIcon(block.id)) return;
    const cur = parseInt(block.rotate || 0, 10) || 0;
    block.rotate = (cur + 90) % 360;
    signalChange();
    setActive({ mode: "image", rowIndex, segIndex }, { rebuild: true });
  }

  function rowLineH(rowIndex) {
    const rowNode = rowsEl.querySelector(`.stage-row[data-row="${rowIndex}"]`);
    if (rowNode) {
      const inlineH = parseFloat(rowNode.style.getPropertyValue("--row-line-h"));
      if (Number.isFinite(inlineH) && inlineH > 0) return inlineH;
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const printablePx = parseFloat(rootStyle.getPropertyValue("--tape-printable-px"));
    if (Number.isFinite(printablePx) && printablePx > 0) return printablePx;
    const tapeMm = parseFloat(rootStyle.getPropertyValue("--tape-display-mm"));
    const topMm = parseFloat(rootStyle.getPropertyValue("--tape-dead-top"));
    const bottomMm = parseFloat(rootStyle.getPropertyValue("--tape-dead-bottom"));
    if (Number.isFinite(tapeMm) && tapeMm > 0) {
      const printableMm =
        tapeMm -
        (Number.isFinite(topMm) ? topMm : 0) -
        (Number.isFinite(bottomMm) ? bottomMm : 0);
      if (printableMm > 0) return (printableMm * 96) / 25.4;
    }
    return 28;
  }

  function setImageWidth(rowIndex, segIndex, width) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "icon" || !isCustomIcon(block.id)) return;
    block.width = clampImageWidth(width, clampImageWidth(block.width));
    signalChange();
    const seg = querySegEl(rowIndex, segIndex);
    if (seg) {
      seg.style.setProperty("--seg-width", String(block.width));
      const lineH = rowLineH(rowIndex);
      paintCustomPreview(rowIndex, segIndex, lineH);
      syncImageEditLayout(seg, block, lineH);
    }
    requestAnimationFrame(updateDrawerPointer);
  }

  function setCoverY(rowIndex, segIndex, coverY) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "icon" || !isCustomIcon(block.id)) return;
    if (drawerImageFit(block.fit) !== "cover") return;
    block.cover_y = clampCoverY(coverY, clampCoverY(block.cover_y));
    signalChange();
    const seg = querySegEl(rowIndex, segIndex);
    if (seg) {
      const lineH = rowLineH(rowIndex);
      syncImageEditLayout(seg, block, lineH);
      paintCustomPreview(rowIndex, segIndex, lineH);
    }
  }

  async function uploadImageAt(rowIndex, segIndex) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.click();
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const out = await uploadCustomIcon(file);
        const row = state.rows[rowIndex];
        if (!row) return;
        if (segIndex >= 0 && segIndex < row.blocks.length) {
          row.blocks[segIndex] = {
            type: "icon",
            id: out.id,
            fit: "cover",
            width: DEFAULT_IMAGE_WIDTH,
          };
          signalChange();
          setActive(
            { mode: "image", rowIndex, segIndex },
            { rebuild: true },
          );
        }
      } catch (e) {
        showToast(e.message || "Upload failed");
      }
    };
  }

  async function pickIcon(icon) {
    const { rowIndex, segIndex, insertIndex } = state.active;
    if (rowIndex < 0) return;
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = { type: "icon", id: icon.id };
    if (segIndex >= 0 && state.active.mode !== "picker") {
      row.blocks[segIndex] = block;
      signalChange();
      setActive(
        {
          mode: isCustomIcon(icon.id) ? "image" : "icon",
          rowIndex,
          segIndex,
        },
        { rebuild: true },
      );
    } else {
      insertBlock(rowIndex, insertIndex, block);
    }
  }

  async function drawerInsertType(type) {
    const { rowIndex, insertIndex } = state.active;
    if (rowIndex < 0) return;
    if (type === "text") {
      insertBlock(rowIndex, insertIndex, textBlockDefaults(state.rows[rowIndex]));
      return;
    }
    if (type === "icon") {
      setActive({ mode: "icon" });
      return;
    }
    if (type === "image") {
      const targetRow = rowIndex;
      const targetIndex = insertIndex;
      const fakeInput = document.createElement("input");
      fakeInput.type = "file";
      fakeInput.accept = "image/png,image/jpeg";
      fakeInput.click();
      fakeInput.onchange = async () => {
        const file = fakeInput.files?.[0];
        if (!file) return;
        try {
          const out = await uploadCustomIcon(file);
          insertBlock(targetRow, targetIndex, {
            type: "icon",
            id: out.id,
            fit: "cover",
            width: DEFAULT_IMAGE_WIDTH,
          });
        } catch (e) {
          showToast(e.message || "Upload failed");
        }
      };
    }
  }

  function segmentToDrawerShape(row, block) {
    if (!block || block.type !== "text") return null;
    return normalizeTextBlock(block, row);
  }

  function openDrawerForCurrent() {
    const { mode, rowIndex, segIndex } = state.active;
    if (mode === "empty" || rowIndex < 0) {
      renderDrawer(drawerEl, { mode: "empty" });
      return;
    }
    const row = state.rows[rowIndex];
    if (!row) {
      renderDrawer(drawerEl, { mode: "empty" });
      return;
    }
    const block = row.blocks[segIndex];
    const selectedIconId =
      block && block.type === "icon" && !isCustomIcon(block.id) ? block.id : "";
    if (mode !== "icon") lastSyncedIconSeg = null;
    if (mode === "icon") {
      if (!state.iconState.loaded) ensureIconStateLoaded();
      else {
        const segKey = `${rowIndex}:${segIndex}`;
        if (lastSyncedIconSeg !== segKey) {
          lastSyncedIconSeg = segKey;
          if (selectedIconId) {
            pendingIconScroll = true;
            const targetCat = selectedIconId.split(":")[0];
            if (targetCat && targetCat !== state.iconState.categoryId) {
              void setIconCategory(targetCat);
              return;
            }
          }
        }
      }
    }
    const scrollToSelected = pendingIconScroll;
    pendingIconScroll = false;
    renderDrawer(drawerEl, {
      mode,
      scrollToSelected,
      segment:
        mode === "font"
          ? segmentToDrawerShape(row, block)
          : mode === "image" && block
            ? { fit: drawerImageFit(block.fit) }
            : null,
      fonts,
      iconState: state.iconState,
      selectedIconId,
      onTextStyleChange: (patch) => updateSegmentTextStyle(rowIndex, segIndex, patch),
      onInsertType: drawerInsertType,
      onSearchIcons: setIconSearch,
      onChooseCategory: setIconCategory,
      onPickIcon: pickIcon,
      onUploadImage: async (file) => {
        try {
          const out = await uploadCustomIcon(file);
          const r = state.rows[rowIndex];
          if (!r) return;
          r.blocks[segIndex] = {
            type: "icon",
            id: out.id,
            fit: "cover",
            width: DEFAULT_IMAGE_WIDTH,
          };
          signalChange();
          setActive(
            { mode: "image", rowIndex, segIndex },
            { rebuild: true },
          );
        } catch (e) {
          showToast(e.message || "Upload failed");
        }
      },
      onSetImageMode: (fit) => updateImageMode(rowIndex, segIndex, fit),
      onRotateImage: () => rotateImage(rowIndex, segIndex),
      onRemoveSegment: () => removeSegment(rowIndex, segIndex),
    });
  }

  function querySegEl(rowIndex, segIndex) {
    return rowsEl.querySelector(
      `.stage-row[data-row="${rowIndex}"] [data-seg="${segIndex}"]`,
    );
  }

  async function paintCustomPreview(rowIndex, segIndex, heightPx) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "icon" || !isCustomIcon(block.id)) return;
    const seg = querySegEl(rowIndex, segIndex);
    if (!seg) return;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    seg.dataset.previewToken = token;
    try {
      const canvas = await globalThis.PtRender.iconCanvas(block.id, heightPx, block);
      if (!seg.isConnected || seg.dataset.previewToken !== token) return;
      const widthScale = clampImageWidth(block.width);
      seg.style.setProperty("--seg-width", String(widthScale));
      const img = seg.querySelector(".seg-image-preview");
      if (img) {
        img.src = canvas.toDataURL("image/png");
        seg.classList.remove("is-loading");
      }
    } catch {
      // ignore
    }
  }

  function makeSegAdd(rowIndex, insertIndex, position) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `seg-add seg-add-${position}`;
    btn.innerHTML = SEG_ADD;
    btn.dataset.insert = String(insertIndex);
    btn.setAttribute("aria-label", "Add content");
    btn.setAttribute("aria-expanded", "false");
    btn.onclick = (e) => {
      e.stopPropagation();
      ensureIconStateLoaded();
      setActive({ mode: "picker", rowIndex, segIndex: -1, insertIndex });
    };
    return btn;
  }

  function applyTapeStyle(track) {
    track.classList.toggle("tape-unknown", !!state.tape.unknown);
    if (state.tape.unknown) {
      track.style.removeProperty("--tape-bg");
      track.style.removeProperty("--tape-ink");
      track.style.removeProperty("--tape-border");
      return;
    }
    track.style.setProperty("--tape-bg", state.tape.bg);
    track.style.setProperty("--tape-ink", state.tape.ink);
    track.style.setProperty("--tape-border", state.tape.border);
  }

  function rowTrack(row, rowIndex) {
    const track = document.createElement("div");
    track.className = "row-track";
    applyTapeStyle(track);
    track.append(makeSegAdd(rowIndex, 0, "start"));
    for (let i = 0; i < row.blocks.length; i++) {
      const block = row.blocks[i];
      if (block.type === "text") {
        const seg = normalizeTextBlock(block, row);
        const span = document.createElement("span");
        span.className = "seg-text";
        span.dataset.seg = String(i);
        span.contentEditable = "plaintext-only";
        span.spellcheck = false;
        span.setAttribute("role", "textbox");
        span.dataset.placeholder = "Text";
        if (seg.value) span.textContent = seg.value;
        applyTextStyleToInput(span, seg);
        span.addEventListener("focus", () => {
          if (
            state.active.mode === "font" &&
            state.active.rowIndex === rowIndex &&
            state.active.segIndex === i
          ) {
            return;
          }
          setActive({ mode: "font", rowIndex, segIndex: i, insertIndex: -1 });
        });
        span.addEventListener("input", () => {
          row.blocks[i].value = span.textContent || "";
          signalChange();
        });
        span.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addRow(rowIndex + 1);
          } else if (
            e.key === "Backspace" &&
            !span.textContent &&
            isCaretAtStart(span)
          ) {
            e.preventDefault();
            removeSegment(rowIndex, i);
          }
        });
        track.append(span);
      } else if (block.type === "icon") {
        const seg = document.createElement("button");
        seg.type = "button";
        const custom = isCustomIcon(block.id);
        seg.className = custom ? "seg-icon seg-image" : "seg-icon";
        seg.dataset.seg = String(i);
        if (custom) {
          seg.style.setProperty("--seg-width", String(clampImageWidth(block.width)));
        }
        const img = document.createElement("img");
        img.alt = imageAltText(block.id);
        if (custom) img.className = "seg-image-preview";
        if (!custom) {
          img.width = 48;
          img.height = 48;
          img.src = iconThumbUrl(block.id);
        }
        seg.classList.add("is-loading");
        const clearLoading = () => seg.classList.remove("is-loading");
        img.addEventListener("load", clearLoading);
        img.addEventListener("error", clearLoading, { once: true });
        if (!custom && img.complete && img.naturalWidth > 0) clearLoading();
        seg.append(img);
        seg.onclick = (e) => {
          e.stopPropagation();
          setActive({
            mode: isCustomIcon(block.id) ? "image" : "icon",
            rowIndex,
            segIndex: i,
            insertIndex: -1,
          });
        };
        track.append(seg);
      }
    }
    track.append(makeSegAdd(rowIndex, row.blocks.length, "end"));
    return track;
  }

  function applyRowMetricsForIndex(rowIndex) {
    const rowNode = rowsEl.querySelector(
      `.stage-row[data-row="${rowIndex}"]`,
    );
    if (!rowNode) return;
    const row = state.rows[rowIndex];
    if (!row) return;
    const iconScale = parseFloat(row.icon_size) || 1;
    rowNode.style.setProperty("--icon-scale", String(iconScale));
    const lineH = rowLineH(rowIndex);
    rowNode.style.setProperty("--row-line-h", `${lineH}px`);
    const paintCustoms = (lineH) => {
      for (const icon of rowNode.querySelectorAll(".seg-icon")) {
        const segIndex = parseInt(icon.dataset.seg || "-1", 10);
        const block = row.blocks[segIndex];
        if (block && block.type === "icon" && isCustomIcon(block.id)) {
          paintCustomPreview(rowIndex, segIndex, lineH);
        }
      }
    };
    paintCustoms(lineH);
  }

  function rebuildRows() {
    if (drawerEl.parentElement === rowsEl) {
      drawerHome.appendChild(drawerEl);
    }
    rowsEl.innerHTML = "";
    state.rows.forEach((row, rowIndex) => {
      const li = document.createElement("div");
      li.className = "stage-row";
      li.setAttribute("role", "listitem");
      li.dataset.row = String(rowIndex);

      const duplicate = document.createElement("button");
      duplicate.type = "button";
      duplicate.className = "row-btn row-duplicate";
      duplicate.setAttribute("aria-label", "Duplicate label line");
      duplicate.title = "Duplicate label line";
      duplicate.innerHTML = `${COPY}<span>Duplicate</span>`;
      duplicate.onclick = () => {
        const copy = clone(row);
        const idx = rowIndex + 1;
        state.rows.splice(idx, 0, copy);
        signalChange();
        setActive(
          { mode: "empty", rowIndex: -1, segIndex: -1, insertIndex: -1 },
          { rebuild: true },
        );
      };

      const qty = buildNumberStepper({
        label: "Qty",
        value: row.qty || 1,
        min: limits.qty[0],
        max: limits.qty[1],
        step: 1,
        scrub: true,
        className: "row-qty-stepper",
        onChange: (next) => {
          row.qty = next;
          signalChange();
        },
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "row-btn row-remove";
      remove.setAttribute("aria-label", "Remove label line");
      remove.title = "Remove label line";
      remove.innerHTML = `${X}<span>Delete</span>`;
      remove.onclick = () => {
        state.rows.splice(rowIndex, 1);
        ensureNonEmpty();
        signalChange();
        setActive(
          { mode: "empty", rowIndex: -1, segIndex: -1, insertIndex: -1 },
          { rebuild: true },
        );
      };

      const items = document.createElement("div");
      items.className = "row-menu-items";
      items.append(duplicate, qty, remove);

      const itemsWrap = document.createElement("div");
      itemsWrap.className = "row-menu-items-wrap";
      itemsWrap.append(items);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "row-btn row-menu-toggle";
      toggle.setAttribute("aria-label", "Row actions");
      toggle.title = "Row actions";
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML = ELLIPSIS;

      const tail = document.createElement("div");
      tail.className = "row-tail";
      tail.append(itemsWrap, toggle);

      toggle.onclick = (e) => {
        e.stopPropagation();
        const opening = !tail.classList.contains("open");
        if (opening) {
          tail.style.setProperty("--menu-w", `${items.scrollWidth}px`);
        }
        tail.classList.toggle("open", opening);
        toggle.setAttribute("aria-expanded", opening ? "true" : "false");
      };

      li.append(rowTrack(row, rowIndex), tail);
      rowsEl.append(li);
      applyRowMetricsForIndex(rowIndex);
    });

    if (pendingFocus) {
      const { rowIndex, segIndex, caret } = pendingFocus;
      pendingFocus = null;
      requestAnimationFrame(() => {
        const el = querySegEl(rowIndex, segIndex);
        if (el && el.classList.contains("seg-text")) {
          if (caret === "end") focusCaretAtEnd(el);
          else el.focus();
        }
      });
    }
  }

  function rowNodeAt(rowIndex) {
    return rowsEl.querySelector(`.stage-row[data-row="${rowIndex}"]`);
  }

  function repositionDrawer() {
    if (state.active.mode === "empty" || state.active.rowIndex < 0) {
      if (drawerEl.parentElement !== drawerHome) {
        drawerHome.appendChild(drawerEl);
      }
      return;
    }
    const rowNode = rowNodeAt(state.active.rowIndex);
    if (!rowNode) return;
    if (drawerEl.previousElementSibling !== rowNode) {
      rowNode.insertAdjacentElement("afterend", drawerEl);
    }
  }

  function applyActiveState() {
    unmountImageEdits();
    let keepTextSeg = null;
    if (state.active.mode === "font" && state.active.segIndex >= 0) {
      const rowNode = rowNodeAt(state.active.rowIndex);
      keepTextSeg =
        rowNode?.querySelector(`[data-seg="${state.active.segIndex}"].seg-text`) ?? null;
    }
    unmountTextResizes(keepTextSeg);
    for (const seg of rowsEl.querySelectorAll(".seg-text, .seg-icon")) {
      seg.classList.remove("seg-active");
    }
    for (const add of rowsEl.querySelectorAll(".seg-add")) {
      add.setAttribute("aria-expanded", "false");
    }
    if (state.active.mode !== "empty") {
      const rowNode = rowNodeAt(state.active.rowIndex);
      if (rowNode) {
        if (state.active.segIndex >= 0 && state.active.mode !== "picker") {
          const seg = rowNode.querySelector(`[data-seg="${state.active.segIndex}"]`);
          if (seg) seg.classList.add("seg-active");
        }
        if (state.active.mode === "picker") {
          const selector =
            state.active.insertIndex === 0
              ? ".seg-add-start"
              : ".seg-add-end";
          const add = rowNode.querySelector(selector);
          if (add) add.setAttribute("aria-expanded", "true");
        }
        if (state.active.mode === "image" && state.active.segIndex >= 0) {
          const seg = rowNode.querySelector(
            `[data-seg="${state.active.segIndex}"].seg-image`,
          );
          const block = state.rows[state.active.rowIndex]?.blocks[state.active.segIndex];
          if (seg && block) {
            mountImageEdit(
              seg,
              state.active.rowIndex,
              state.active.segIndex,
              block,
              rowLineH(state.active.rowIndex),
              () => state.rows[state.active.rowIndex]?.blocks[state.active.segIndex],
              (width) => setImageWidth(state.active.rowIndex, state.active.segIndex, width),
              (coverY) => setCoverY(state.active.rowIndex, state.active.segIndex, coverY),
            );
          }
        }
        if (state.active.mode === "font" && state.active.segIndex >= 0) {
          const seg = rowNode.querySelector(
            `[data-seg="${state.active.segIndex}"].seg-text`,
          );
          const block = state.rows[state.active.rowIndex]?.blocks[state.active.segIndex];
          if (seg && block?.type === "text") {
            mountTextResize(
              seg,
              () => state.rows[state.active.rowIndex]?.blocks[state.active.segIndex]?.font_size,
              (next) => setFontSize(state.active.rowIndex, state.active.segIndex, next),
            );
          }
        }
      }
    }
    repositionDrawer();
    openDrawerForCurrent();
    requestAnimationFrame(updateDrawerPointer);
  }

  function activeAnchorEl() {
    const { mode, rowIndex, segIndex, insertIndex } = state.active;
    if (mode === "empty" || rowIndex < 0) return null;
    const rowNode = rowNodeAt(rowIndex);
    if (!rowNode) return null;
    const track = rowNode.querySelector(".row-track");
    if (!track) return null;
    if (mode === "picker") {
      return insertIndex === 0
        ? track.querySelector(".seg-add-start")
        : track.querySelector(".seg-add-end");
    }
    if (segIndex >= 0) {
      const seg = track.querySelector(`[data-seg="${segIndex}"]`);
      if (seg) return seg;
    }
    if (insertIndex === 0) return track.querySelector(".seg-add-start");
    return track.querySelector(".seg-add-end");
  }

  function updateDrawerPointer() {
    const anchor = activeAnchorEl();
    if (!anchor) {
      drawerEl.style.removeProperty("--pointer-x");
      return;
    }
    const ar = anchor.getBoundingClientRect();
    const dr = drawerEl.getBoundingClientRect();
    const x = ar.left + ar.width / 2 - dr.left;
    drawerEl.style.setProperty("--pointer-x", `${Math.round(x)}px`);
  }

  return {
    setRows(nextRows) {
      state.rows = nextRows.map((row) => ({
        ...row,
        blocks: (row.blocks || []).map((b) =>
          b.type === "text" ? normalizeTextBlock(b, row) : normalizeIconBlock(b),
        ),
      }));
      ensureNonEmpty();
      rebuildRows();
      applyActiveState();
    },
    setTape(preview) {
      const next = preview || {};
      state.tape = {
        bg: next.bg || "#f5f5f5",
        ink: next.ink || "#1a1a1a",
        border: next.border || "transparent",
        unknown: !!next.unknown,
      };
      for (const track of rowsEl.querySelectorAll(".row-track")) {
        applyTapeStyle(track);
      }
    },
    setNewRowDefaults(preset) {
      if (!preset) return;
      if (preset.font_size != null) defaultPrefs.font_size = preset.font_size;
      if (preset.margin_h != null) defaultPrefs.margin_h = preset.margin_h;
      if (preset.v_align != null) defaultPrefs.v_align = preset.v_align;
      if (preset.letter_spacing != null) {
        defaultPrefs.letter_spacing = preset.letter_spacing;
      }
    },
    getRows() {
      return clone(state.rows);
    },
    closeDrawer() {
      setActive({ mode: "empty", rowIndex: -1, segIndex: -1, insertIndex: -1 });
    },
    addRowEnd() {
      addRow(state.rows.length);
    },
    appendRow(row) {
      const blocks = (row.blocks || []).map((b) =>
        b.type === "text" ? normalizeTextBlock(b, row) : normalizeIconBlock(b),
      );
      state.rows.push({ ...row, blocks });
      ensureNonEmpty();
      const idx = state.rows.length - 1;
      rebuildRows();
      signalChange();
      setActive(
        { mode: "font", rowIndex: idx, segIndex: 0, insertIndex: -1 },
        { rebuild: false },
      );
    },
    async printAll() {
      await onPrint(clone(state.rows));
    },
    refreshPointer() {
      updateDrawerPointer();
    },
    setGlobalDefault(key, value) {
      defaultPrefs[key] = value;
      for (const row of state.rows) {
        row[key] = value;
        if (key === "v_align") {
          for (const block of row.blocks) {
            if (block.type === "text") block.v_align = value;
          }
        }
      }
      signalChange();
      for (let r = 0; r < state.rows.length; r++) {
        const row = state.rows[r];
        row.blocks.forEach((block, segIndex) => {
          if (block.type !== "text") return;
          const input = querySegEl(r, segIndex);
          if (input) applyTextStyleToInput(input, normalizeTextBlock(block, row));
        });
        applyRowMetricsForIndex(r);
      }
      requestAnimationFrame(updateDrawerPointer);
    },
    rerenderStyles() {
      state.rows.forEach((row, rowIndex) => {
        row.blocks.forEach((block, segIndex) => {
          if (block.type !== "text") return;
          const input = querySegEl(rowIndex, segIndex);
          if (input) applyTextStyleToInput(input, normalizeTextBlock(block, row));
        });
        applyRowMetricsForIndex(rowIndex);
      });
      requestAnimationFrame(updateDrawerPointer);
    },
  };
}
