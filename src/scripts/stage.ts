import { renderDrawer } from "./drawer";
import { openCropDialog } from "./crop-dialog";
import {
  iconThumbUrl,
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
    if (Number.isFinite(width) && width > 0) out.width = Math.max(0.1, Math.min(6, width));
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
  } else if (block.height != null) {
    out.height = block.height;
  }
  if (block.rotate) out.rotate = block.rotate;
  return out;
}

function clampImageWidth(width, fallback = 1) {
  const value = Number(width);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(0.1, Math.min(6, value));
}

function imageFitMode(fit) {
  if (fit === "fit") return "contain";
  if (fit === "contain" || fit === "cover" || fit === "crop") return fit;
  return "contain";
}

async function imageAspectFromFile(file) {
  return new Promise((resolve) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve(img.naturalWidth / img.naturalHeight);
        return;
      }
      resolve(1);
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      resolve(1);
    };
    img.src = src;
  });
}

export function createStageController({
  rowsEl,
  drawerEl,
  fonts,
  resolveStageFamily,
  fontMetrics,
  limits,
  defaultPrefs,
  getDisplayScale = () => 1,
  showToast,
  onChange,
  onPrint,
}) {
  const state = {
    rows: [],
    tapeColor: "#f5f5f5",
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
        applyActiveState();
      })
      .finally(() => {
        iconStatePromise = null;
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

  function setImageWidth(rowIndex, segIndex, width) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "icon" || !isCustomIcon(block.id)) return;
    block.width = clampImageWidth(width, clampImageWidth(block.width, 1));
    signalChange();
    setActive({ mode: "image", rowIndex, segIndex }, { rebuild: true });
  }

  async function openImageCrop(rowIndex, segIndex) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "icon" || !isCustomIcon(block.id)) return;
    const imageUrl = iconThumbUrl(block.id);
    const aspect = clampImageWidth(block.width, 1);
    const crop = await openCropDialog({
      imageUrl,
      aspect,
      initial: block.crop || null,
    });
    if (!crop) return;
    block.crop = crop;
    block.fit = "crop";
    signalChange();
    setActive({ mode: "image", rowIndex, segIndex }, { rebuild: true });
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
        const width = await imageAspectFromFile(file);
        const out = await uploadCustomIcon(file);
        const row = state.rows[rowIndex];
        if (!row) return;
        if (segIndex >= 0 && segIndex < row.blocks.length) {
          row.blocks[segIndex] = {
            type: "icon",
            id: out.id,
            fit: "contain",
            width: clampImageWidth(width),
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
          const width = await imageAspectFromFile(file);
          const out = await uploadCustomIcon(file);
          insertBlock(targetRow, targetIndex, {
            type: "icon",
            id: out.id,
            fit: "contain",
            width: clampImageWidth(width),
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
            const targetCat = selectedIconId.split(":")[0];
            if (targetCat && targetCat !== state.iconState.categoryId) {
              setIconCategory(targetCat);
            }
          }
        }
      }
    }
    renderDrawer(drawerEl, {
      mode,
      segment:
        mode === "font"
          ? segmentToDrawerShape(row, block)
          : mode === "image" && block
            ? {
                fit: imageFitMode(block.fit),
                width: clampImageWidth(block.width, 1),
              }
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
          const width = await imageAspectFromFile(file);
          const out = await uploadCustomIcon(file);
          const r = state.rows[rowIndex];
          if (!r) return;
          r.blocks[segIndex] = {
            type: "icon",
            id: out.id,
            fit: "contain",
            width: clampImageWidth(width),
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
      onSetImageWidth: (width) => setImageWidth(rowIndex, segIndex, width),
      onOpenImageCrop: () => openImageCrop(rowIndex, segIndex),
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
      const widthScale = clampImageWidth(
        block.width,
        canvas.height > 0 ? canvas.width / canvas.height : 1,
      );
      seg.style.setProperty("--seg-width", String(widthScale));
      const img = seg.querySelector("img");
      if (img) img.src = canvas.toDataURL("image/png");
    } catch {
      // ignore
    }
  }

  function makeSegAdd(rowIndex, insertIndex, position) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `seg-add seg-add-${position}`;
    btn.textContent = "+";
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

  function rowTrack(row, rowIndex) {
    const track = document.createElement("div");
    track.className = "row-track";
    track.style.setProperty("--tape-bg", state.tapeColor);
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
          seg.style.setProperty("--seg-width", String(clampImageWidth(block.width, 1)));
        }
        const img = document.createElement("img");
        img.alt = "";
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

  async function applyRowMetricsForIndex(rowIndex) {
    const rowNode = rowsEl.querySelector(
      `.stage-row[data-row="${rowIndex}"]`,
    );
    if (!rowNode) return;
    const row = state.rows[rowIndex];
    if (!row) return;
    let maxAscent = 0;
    let maxDescent = 0;
    for (const block of row.blocks) {
      if (block.type !== "text") continue;
      const seg = normalizeTextBlock(block, row);
      try {
        const m = await fontMetrics(
          seg.font_family,
          seg.bold,
          seg.italic,
          seg.font_size,
        );
        if (m.ascent > maxAscent) maxAscent = m.ascent;
        if (m.descent > maxDescent) maxDescent = m.descent;
      } catch {
        // ignore
      }
    }
    if (maxAscent <= 0 || maxDescent <= 0) {
      maxAscent = row.font_size * 0.8;
      maxDescent = row.font_size * 0.2;
    }
    const k = getDisplayScale();
    const lineH = Math.max(8, Math.round((maxAscent + maxDescent) * k));
    rowNode.style.setProperty("--row-line-h", `${lineH}px`);
    for (const icon of rowNode.querySelectorAll(".seg-icon")) {
      const segIndex = parseInt(icon.dataset.seg || "-1", 10);
      const block = row.blocks[segIndex];
      if (block && block.type === "icon" && isCustomIcon(block.id)) {
        icon.style.height = `${lineH}px`;
        paintCustomPreview(rowIndex, segIndex, lineH);
      } else {
        const scale = parseFloat(row.icon_size) || 1;
        icon.style.height = `${Math.max(8, Math.round(lineH * scale))}px`;
      }
    }
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
      duplicate.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H9zm0 2h10v12h-2V8a2 2 0 0 0-2-2H9V5zM5 8h10v11H5V8z"/></svg>';
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

      const qty = document.createElement("input");
      qty.type = "number";
      qty.className = "row-qty";
      qty.min = String(limits.qty[0]);
      qty.max = String(limits.qty[1]);
      qty.value = String(row.qty || 1);
      qty.oninput = () => {
        row.qty = Math.max(
          limits.qty[0],
          Math.min(limits.qty[1], parseInt(qty.value, 10) || 1),
        );
        qty.value = String(row.qty);
        signalChange();
      };

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "row-btn row-remove";
      remove.setAttribute("aria-label", "Remove label line");
      remove.title = "Remove label line";
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/></svg>';
      remove.onclick = () => {
        state.rows.splice(rowIndex, 1);
        ensureNonEmpty();
        signalChange();
        setActive(
          { mode: "empty", rowIndex: -1, segIndex: -1, insertIndex: -1 },
          { rebuild: true },
        );
      };

      const tail = document.createElement("div");
      tail.className = "row-tail";
      tail.append(duplicate, qty, remove);
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
    for (const rowNode of rowsEl.querySelectorAll(".stage-row")) {
      rowNode.classList.remove("active");
    }
    for (const seg of rowsEl.querySelectorAll(".seg-text, .seg-icon")) {
      seg.classList.remove("seg-active");
    }
    for (const add of rowsEl.querySelectorAll(".seg-add")) {
      add.setAttribute("aria-expanded", "false");
    }
    if (state.active.mode !== "empty") {
      const rowNode = rowNodeAt(state.active.rowIndex);
      if (rowNode) {
        rowNode.classList.add("active");
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
    setTapeColor(color) {
      state.tapeColor = color || "#f5f5f5";
      for (const track of rowsEl.querySelectorAll(".row-track")) {
        track.style.setProperty("--tape-bg", state.tapeColor);
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
