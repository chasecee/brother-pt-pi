import { renderDrawer } from "./drawer.js";
import {
  iconThumbUrl,
  isCustomIcon,
  loadIconCategories,
  loadCategoryIcons,
  searchIcons,
  uploadCustomIcon,
} from "./icons.js";

function clone(v) {
  return JSON.parse(JSON.stringify(v));
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
  if (block.height != null) out.height = block.height;
  if (block.fit) out.fit = block.fit;
  if (block.rotate) out.rotate = block.rotate;
  return out;
}

export function createStageController({
  rowsEl,
  drawerEl,
  fontNames,
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
    },
  };

  let pendingFocus = null;
  const drawerHome = drawerEl.parentElement;

  function signalChange() {
    onChange(clone(state.rows));
  }

  function setActive(next, { rebuild = false } = {}) {
    state.active = { ...state.active, ...next };
    if (rebuild) rebuildRows();
    applyActiveState();
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

  function ensureIconStateLoaded() {
    if (state.iconState.loaded) return Promise.resolve();
    return loadIconCategories().then(async ({ categories, defaultCategoryId }) => {
      state.iconState.loaded = true;
      state.iconState.categories = categories;
      state.iconState.categoryId = defaultCategoryId;
      state.iconState.icons = await loadCategoryIcons(defaultCategoryId);
    });
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
    if (!block || block.type !== "icon") return;
    block.fit = fit;
    signalChange();
    const el = querySegEl(rowIndex, segIndex);
    if (el) el.dataset.fit = fit;
    applyActiveState();
  }

  function rotateImage(rowIndex, segIndex) {
    const row = state.rows[rowIndex];
    if (!row) return;
    const block = row.blocks[segIndex];
    if (!block || block.type !== "icon") return;
    const cur = parseInt(block.rotate || 0, 10) || 0;
    block.rotate = (cur + 90) % 360;
    signalChange();
    const el = querySegEl(rowIndex, segIndex);
    if (el) el.dataset.rotate = String(block.rotate);
    applyActiveState();
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
            fit: "crop",
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
      await ensureIconStateLoaded();
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
            fit: "crop",
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
    renderDrawer(drawerEl, {
      mode,
      segment:
        mode === "font"
          ? segmentToDrawerShape(row, block)
          : mode === "image" && block
            ? { fit: block.fit || "crop" }
            : null,
      fontNames,
      iconState: state.iconState,
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
          r.blocks[segIndex] = { type: "icon", id: out.id, fit: "crop" };
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

  function makeSegAdd(rowIndex, insertIndex, position) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `seg-add seg-add-${position}`;
    btn.textContent = "+";
    btn.dataset.insert = String(insertIndex);
    btn.setAttribute("aria-label", "Add content");
    btn.setAttribute("aria-expanded", "false");
    btn.onclick = async (e) => {
      e.stopPropagation();
      await ensureIconStateLoaded();
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
        const input = document.createElement("input");
        input.type = "text";
        input.className = "seg-text";
        input.dataset.seg = String(i);
        input.value = seg.value;
        input.placeholder = "Text";
        input.autocomplete = "off";
        input.spellcheck = false;
        applyTextStyleToInput(input, seg);
        input.addEventListener("focus", () => {
          if (
            state.active.mode === "font" &&
            state.active.rowIndex === rowIndex &&
            state.active.segIndex === i
          ) {
            return;
          }
          setActive({ mode: "font", rowIndex, segIndex: i, insertIndex: -1 });
        });
        input.addEventListener("input", () => {
          row.blocks[i].value = input.value;
          signalChange();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addRow(rowIndex + 1);
          } else if (
            e.key === "Backspace" &&
            input.selectionStart === 0 &&
            input.selectionEnd === 0 &&
            !input.value
          ) {
            e.preventDefault();
            removeSegment(rowIndex, i);
          }
        });
        track.append(input);
      } else if (block.type === "icon") {
        const seg = document.createElement("button");
        seg.type = "button";
        seg.className = isCustomIcon(block.id) ? "seg-icon seg-image" : "seg-icon";
        seg.dataset.seg = String(i);
        seg.dataset.fit = block.fit || "";
        seg.dataset.rotate = String(block.rotate || 0);
        const img = document.createElement("img");
        img.src = iconThumbUrl(block.id);
        img.alt = "";
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
      const scale = parseFloat(row.icon_size) || 1;
      icon.style.height = `${Math.max(8, Math.round(lineH * scale))}px`;
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
      remove.className = "row-remove";
      remove.textContent = "x";
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
      tail.append(qty, remove);
      li.append(rowTrack(row, rowIndex), tail);
      rowsEl.append(li);
      applyRowMetricsForIndex(rowIndex);
    });

    if (pendingFocus) {
      const { rowIndex, segIndex, caret } = pendingFocus;
      pendingFocus = null;
      requestAnimationFrame(() => {
        const el = querySegEl(rowIndex, segIndex);
        if (el && el.tagName === "INPUT") {
          el.focus();
          if (caret === "end") {
            const len = el.value.length;
            try {
              el.setSelectionRange(len, len);
            } catch {
              // ignore for non-text inputs
            }
          }
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
    for (const add of rowsEl.querySelectorAll(".seg-add")) {
      add.setAttribute("aria-expanded", "false");
    }
    if (state.active.mode !== "empty") {
      const rowNode = rowNodeAt(state.active.rowIndex);
      if (rowNode) {
        rowNode.classList.add("active");
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
