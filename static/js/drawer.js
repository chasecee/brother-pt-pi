function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v);
    } else if (v != null) {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children) node.append(child);
  return node;
}

function clearDrawer(container, mode = "empty") {
  container.dataset.mode = mode;
  container.innerHTML = "";
}

function fontDrawer(container, ctx) {
  const { segment, fontNames, onTextStyleChange } = ctx;
  const wrapper = el("div", { className: "drawer-body" });

  const fontSelect = el("select", { className: "drawer-font-family" });
  for (const name of fontNames) {
    const option = el("option", { value: name, text: name });
    if (name === segment.font_family) option.selected = true;
    fontSelect.append(option);
  }
  fontSelect.addEventListener("change", () =>
    onTextStyleChange({ font_family: fontSelect.value }),
  );

  const bold = el("input", { type: "checkbox" });
  bold.checked = !!segment.bold;
  bold.addEventListener("change", () => onTextStyleChange({ bold: bold.checked }));
  const boldWrap = el("label", {}, [bold, document.createTextNode("Bold")]);

  const italic = el("input", { type: "checkbox" });
  italic.checked = !!segment.italic;
  italic.addEventListener("change", () =>
    onTextStyleChange({ italic: italic.checked }),
  );
  const italicWrap = el("label", {}, [italic, document.createTextNode("Italic")]);

  const size = el("input", {
    type: "number",
    min: "10",
    max: "128",
    value: String(segment.font_size),
  });
  size.addEventListener("input", () =>
    onTextStyleChange({ font_size: parseInt(size.value, 10) || segment.font_size }),
  );
  const sizeWrap = el("label", {}, [document.createTextNode("Size"), size]);

  const spacing = el("input", {
    type: "number",
    min: "-5",
    max: "20",
    step: "0.5",
    value: String(segment.letter_spacing),
  });
  spacing.addEventListener("input", () =>
    onTextStyleChange({
      letter_spacing: parseFloat(spacing.value) || 0,
    }),
  );
  const spacingWrap = el("label", {}, [document.createTextNode("Spacing"), spacing]);

  const valign = el("input", {
    type: "number",
    min: "-32",
    max: "32",
    value: String(segment.v_align),
  });
  valign.addEventListener("input", () =>
    onTextStyleChange({ v_align: parseInt(valign.value, 10) || 0 }),
  );
  const valignWrap = el("label", {}, [document.createTextNode("V align"), valign]);

  wrapper.append(
    el("div", { className: "drawer-row" }, [fontSelect]),
    el("div", { className: "drawer-row" }, [boldWrap, italicWrap]),
    el("div", { className: "drawer-row" }, [sizeWrap, spacingWrap, valignWrap]),
  );
  clearDrawer(container, "font");
  container.append(wrapper);
}

const PICKER_ICONS = {
  text: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5 4h14v3h-2V6h-4v12h2v2H9v-2h2V6H7v1H5z"/></svg>',
  icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 2a8 8 0 110 16 8 8 0 010-16zM9 9.5a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5zm6 0a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5zm-6.4 4.9a1 1 0 011.4.1 3.5 3.5 0 005.1 0 1 1 0 111.5 1.4 5.5 5.5 0 01-8.1 0 1 1 0 01.1-1.5z"/></svg>',
  image:
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm1 2v8.6l4-4 3.5 3.5L16 12l3 3V7H5zm3.5 4a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>',
};

function pickerDrawer(container, ctx) {
  const wrap = el("div", { className: "drawer-body drawer-picker" });
  const mk = (type, label) => {
    const glyph = el("span", { className: "drawer-picker-glyph" });
    glyph.innerHTML = PICKER_ICONS[type] || "";
    return el(
      "button",
      {
        type: "button",
        className: "btn btn-sm drawer-picker-btn",
        onclick: () => ctx.onInsertType(type),
      },
      [glyph, el("span", { text: label })],
    );
  };
  wrap.append(mk("text", "Text"), mk("icon", "Icon"), mk("image", "Image"));
  clearDrawer(container, "picker");
  container.append(wrap);
}

function iconGrid(icons, onPick) {
  const grid = el("div", { className: "drawer-icon-grid" });
  for (const icon of icons) {
    const img = el("img", { src: icon.thumb_url, alt: "" });
    const btn = el(
      "button",
      {
        type: "button",
        className: "drawer-icon-pick",
        title: icon.id,
        onclick: () => onPick(icon),
      },
      [img],
    );
    grid.append(btn);
  }
  return grid;
}

function iconDrawer(container, ctx) {
  const { iconState, onSearchIcons, onChooseCategory, onPickIcon } = ctx;
  const prevCatsEl = container.querySelector(".drawer-icon-cats");
  const prevGridEl = container.querySelector(".drawer-icon-grid");
  const prevSearchEl = container.querySelector('input[type="search"]');
  const prevCatsScroll = prevCatsEl ? prevCatsEl.scrollLeft : 0;
  const prevGridScroll = prevGridEl ? prevGridEl.scrollTop : 0;
  const searchHadFocus =
    prevSearchEl && document.activeElement === prevSearchEl;
  const searchSelStart = searchHadFocus ? prevSearchEl.selectionStart : null;
  const searchSelEnd = searchHadFocus ? prevSearchEl.selectionEnd : null;

  const wrap = el("div", { className: "drawer-body" });
  const panel = el("div", { className: "drawer-icon-panel" });

  const search = el("input", {
    type: "search",
    placeholder: "Search icons",
    value: iconState.searchQuery || "",
  });
  search.addEventListener("input", () => onSearchIcons(search.value));

  const cats = el("div", { className: "drawer-icon-cats" });
  for (const cat of iconState.categories || []) {
    const active = cat.id === iconState.categoryId;
    const urls =
      (cat.preview_thumb_urls && cat.preview_thumb_urls.length
        ? cat.preview_thumb_urls
        : cat.preview_thumb_url
          ? [cat.preview_thumb_url]
          : []
      ).slice(0, 4);
    const grid = el("span", { className: "drawer-icon-cat-grid" });
    if (urls.length) {
      for (const url of urls) {
        grid.append(
          el("span", { className: "drawer-icon-cat-cell" }, [
            el("img", { src: url, alt: "" }),
          ]),
        );
      }
    } else {
      grid.append(
        el("span", {
          className: "drawer-icon-cat-fallback",
          text: cat.title?.slice(0, 2) || "?",
        }),
      );
    }
    const btn = el(
      "button",
      {
        type: "button",
        className: `drawer-icon-cat${active ? " active" : ""}`,
        title: cat.title,
        onclick: () => onChooseCategory(cat.id),
      },
      [grid],
    );
    cats.append(btn);
  }

  const icons = iconState.icons || [];
  const body = icons.length
    ? iconGrid(icons, onPickIcon)
    : el("div", {
        className: "drawer-empty",
        text: iconState.loaded ? "No icons" : "Loading icons…",
      });

  panel.append(search, cats, body);
  wrap.append(panel);
  clearDrawer(container, "icon");
  container.append(wrap);

  cats.scrollLeft = prevCatsScroll;
  if (body.classList.contains("drawer-icon-grid")) {
    body.scrollTop = prevGridScroll;
  }

  if (searchHadFocus) {
    search.focus({ preventScroll: true });
    try {
      search.setSelectionRange(
        searchSelStart ?? search.value.length,
        searchSelEnd ?? search.value.length,
      );
    } catch {
      // some inputs disallow setSelectionRange
    }
  }
}

function imageDrawer(container, ctx) {
  const { onUploadImage, onSetImageMode, onRotateImage, onRemoveSegment, segment } =
    ctx;
  const wrap = el("div", { className: "drawer-body" });

  const upload = el("input", { type: "file", accept: "image/png,image/jpeg" });
  upload.addEventListener("change", async () => {
    const file = upload.files?.[0];
    if (file) await onUploadImage(file);
    upload.value = "";
  });
  const uploadWrap = el("label", {}, [document.createTextNode("Upload"), upload]);

  const modeWrap = el("div", { className: "drawer-row" });
  for (const mode of ["fit", "cover", "crop"]) {
    const btn = el("button", {
      type: "button",
      className: `btn btn-sm${segment.fit === mode ? " active" : ""}`,
      text: mode,
      onclick: () => onSetImageMode(mode),
    });
    modeWrap.append(btn);
  }
  const rotate = el("button", {
    type: "button",
    className: "btn btn-sm",
    text: "Rotate",
    onclick: onRotateImage,
  });
  const remove = el("button", {
    type: "button",
    className: "btn btn-sm btn-danger",
    text: "Remove",
    onclick: onRemoveSegment,
  });
  wrap.append(uploadWrap, modeWrap, el("div", { className: "drawer-row" }, [rotate, remove]));
  clearDrawer(container, "image");
  container.append(wrap);
}

export function renderDrawer(container, ctx) {
  if (!ctx || !ctx.mode || ctx.mode === "empty") {
    clearDrawer(container, "empty");
    return;
  }
  if (ctx.mode === "font") return fontDrawer(container, ctx);
  if (ctx.mode === "picker") return pickerDrawer(container, ctx);
  if (ctx.mode === "icon") return iconDrawer(container, ctx);
  if (ctx.mode === "image") return imageDrawer(container, ctx);
  clearDrawer(container, "empty");
}
