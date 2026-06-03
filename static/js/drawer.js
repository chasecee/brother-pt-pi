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

function setMode(container, mode, bodyClass = "") {
  container.dataset.mode = mode;
  let body = container.firstElementChild;
  if (!body || !body.classList.contains("drawer-body")) {
    body = document.createElement("div");
    container.replaceChildren(body);
  }
  body.className = bodyClass ? `drawer-body ${bodyClass}` : "drawer-body";
  body.replaceChildren();
  return body;
}

let fontPickerOpen = false;
let fontPickerSearch = "";
let fontDocClickWired = false;

function wireFontDocClick() {
  if (fontDocClickWired) return;
  fontDocClickWired = true;
  document.addEventListener("mousedown", (e) => {
    if (!fontPickerOpen) return;
    const trigger = document.querySelector(".drawer-font-current");
    const panel = document.querySelector(".drawer-font-panel");
    if (trigger?.contains(e.target) || panel?.contains(e.target)) return;
    fontPickerOpen = false;
    fontPickerSearch = "";
    const apply = () => {
      if (panel) panel.hidden = true;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    };
    if (document.startViewTransition) document.startViewTransition(apply);
    else apply();
  });
}

function buildFontPicker(segment, fonts, onTextStyleChange) {
  wireFontDocClick();
  const current = fonts.find((f) => f.name === segment.font_family) || null;

  const triggerName = el("span", { className: "drawer-font-current-name" });
  triggerName.textContent = segment.font_family;
  if (current?.previewFamily) {
    triggerName.style.fontFamily = `"${current.previewFamily}", system-ui, sans-serif`;
  }
  const trigger = el(
    "button",
    {
      type: "button",
      className: "drawer-font-current",
      "aria-expanded": String(fontPickerOpen),
      "aria-haspopup": "listbox",
    },
    [triggerName],
  );

  const panel = el("div", { className: "drawer-font-panel" });
  if (!fontPickerOpen) panel.hidden = true;

  const search = el("input", {
    type: "search",
    className: "drawer-font-search",
    placeholder: "Search fonts",
    autocomplete: "off",
    value: fontPickerSearch,
  });

  const list = el("div", { className: "drawer-font-list", role: "listbox" });

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const row = entry.target;
        const fam = row.dataset.previewFamily;
        if (fam) row.style.fontFamily = `"${fam}", system-ui, sans-serif`;
        observer.unobserve(row);
      }
    },
    { root: list, rootMargin: "120px" },
  );

  for (const fam of fonts) {
    const active = fam.name === segment.font_family;
    const row = el("button", {
      type: "button",
      className: `drawer-font-row${active ? " active" : ""}`,
      role: "option",
      "aria-selected": String(active),
      text: fam.name,
    });
    row.dataset.family = fam.name;
    if (fam.previewFamily) row.dataset.previewFamily = fam.previewFamily;
    row.addEventListener("click", () => {
      fontPickerOpen = false;
      fontPickerSearch = "";
      onTextStyleChange({ font_family: fam.name });
    });
    list.append(row);
    observer.observe(row);
  }

  function filter() {
    const q = fontPickerSearch.trim().toLowerCase();
    for (const row of list.children) {
      const hit = !q || row.dataset.family.toLowerCase().includes(q);
      row.hidden = !hit;
    }
  }
  filter();

  search.addEventListener("input", () => {
    fontPickerSearch = search.value;
    filter();
  });

  function setOpen(open) {
    fontPickerOpen = open;
    const apply = () => {
      panel.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    };
    if (document.startViewTransition) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
    if (open) {
      requestAnimationFrame(() => {
        search.focus({ preventScroll: true });
        const active = list.querySelector(".drawer-font-row.active");
        if (active) active.scrollIntoView({ block: "nearest" });
      });
    }
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });

  panel.append(search, list);
  return { trigger, panel };
}

function fontDrawer(container, ctx) {
  const { segment, fonts, onTextStyleChange } = ctx;
  const wrapper = setMode(container, "font", "drawer-font");

  const { trigger, panel } = buildFontPicker(segment, fonts, onTextStyleChange);

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
    el("div", { className: "drawer-row drawer-font-top" }, [
      trigger,
      boldWrap,
      italicWrap,
      sizeWrap,
      spacingWrap,
      valignWrap,
    ]),
    panel,
  );
}

const PICKER_ICONS = {
  text: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5 4h14v3h-2V6h-4v12h2v2H9v-2h2V6H7v1H5z"/></svg>',
  icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 2a8 8 0 110 16 8 8 0 010-16zM9 9.5a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5zm6 0a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5zm-6.4 4.9a1 1 0 011.4.1 3.5 3.5 0 005.1 0 1 1 0 111.5 1.4 5.5 5.5 0 01-8.1 0 1 1 0 01.1-1.5z"/></svg>',
  image:
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm1 2v8.6l4-4 3.5 3.5L16 12l3 3V7H5zm3.5 4a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>',
};

function pickerDrawer(container, ctx) {
  const wrap = setMode(container, "picker", "drawer-picker");
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

  const wrap = setMode(container, "icon");
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
  const {
    onUploadImage,
    onSetImageMode,
    onSetImageWidth,
    onOpenImageCrop,
    onRotateImage,
    onRemoveSegment,
    segment,
  } = ctx;
  const wrap = setMode(container, "image");

  const upload = el("input", { type: "file", accept: "image/png,image/jpeg" });
  upload.addEventListener("change", async () => {
    const file = upload.files?.[0];
    if (file) await onUploadImage(file);
    upload.value = "";
  });
  const uploadWrap = el("label", {}, [document.createTextNode("Upload"), upload]);

  const widthValue = Number(segment.width) || 1;
  const widthSlider = el("input", {
    type: "range",
    min: "0.1",
    max: "6",
    step: "0.05",
    value: widthValue.toFixed(2),
  });
  const widthReadout = el("span", {
    className: "drawer-slider-value",
    text: `${widthValue.toFixed(2)}x`,
  });
  widthSlider.addEventListener("input", () => {
    const width = parseFloat(widthSlider.value) || widthValue;
    widthReadout.textContent = `${width.toFixed(2)}x`;
    onSetImageWidth(width);
  });
  const widthWrap = el("div", { className: "drawer-row drawer-slider" }, [
    el("label", { text: "Width" }),
    widthSlider,
    widthReadout,
  ]);

  const modeWrap = el("div", { className: "drawer-row drawer-segmented" });
  for (const mode of ["contain", "cover", "crop"]) {
    const btn = el("button", {
      type: "button",
      className: `btn btn-sm${segment.fit === mode ? " active" : ""}`,
      text: mode,
      onclick: () => {
        if (mode === "crop") onOpenImageCrop();
        else onSetImageMode(mode);
      },
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
  wrap.append(
    uploadWrap,
    widthWrap,
    modeWrap,
    el("div", { className: "drawer-row" }, [rotate, remove]),
  );
}

export function renderDrawer(container, ctx) {
  if (!ctx || ctx.mode !== "font") {
    fontPickerOpen = false;
    fontPickerSearch = "";
  }
  if (!ctx || !ctx.mode || ctx.mode === "empty") {
    setMode(container, "empty");
    return;
  }
  if (ctx.mode === "font") return fontDrawer(container, ctx);
  if (ctx.mode === "picker") return pickerDrawer(container, ctx);
  if (ctx.mode === "icon") return iconDrawer(container, ctx);
  if (ctx.mode === "image") return imageDrawer(container, ctx);
  setMode(container, "empty");
}
