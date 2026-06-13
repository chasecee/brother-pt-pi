import { PICKER_ICONS, ROTATE_CW, UPLOAD, X } from "./lucide-icons";
import { buildNumberStepper, syncNumberStepper } from "./stepper";

function trackImageLoad(host, img) {
  if (img.complete && img.naturalWidth > 0) return;
  host.classList.add("is-loading");
  const done = () => host.classList.remove("is-loading");
  img.addEventListener("load", done, { once: true });
  img.addEventListener("error", done, { once: true });
}

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
  let body = container.querySelector(":scope > .drawer-body");
  if (!body) {
    body = document.createElement("div");
    container.appendChild(body);
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
        centerActive();
      });
    }
  }

  function centerActive() {
    const active = list.querySelector(".drawer-font-row.active");
    if (!active) return;
    const top = active.offsetTop - (list.clientHeight - active.offsetHeight) / 2;
    list.scrollTop = Math.max(0, top);
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });

  panel.append(search, list);
  if (fontPickerOpen) requestAnimationFrame(centerActive);
  return { trigger, panel };
}

function syncFontPicker(body, segment, fonts) {
  const current = fonts.find((f) => f.name === segment.font_family) || null;
  const triggerName = body.querySelector(".drawer-font-current-name");
  if (triggerName) {
    triggerName.textContent = segment.font_family;
    triggerName.style.fontFamily = current?.previewFamily
      ? `"${current.previewFamily}", system-ui, sans-serif`
      : "";
  }
  const list = body.querySelector(".drawer-font-list");
  if (list) {
    for (const row of list.children) {
      const active = row.dataset.family === segment.font_family;
      row.classList.toggle("active", active);
      row.setAttribute("aria-selected", String(active));
    }
  }
}

function syncFontDrawer(body, ctx) {
  const { segment, fonts } = ctx;
  const row = body.querySelector(".drawer-row");
  if (!row) return;

  syncFontPicker(body, segment, fonts);

  const bold = row.querySelector(".drawer-font-bold input");
  if (bold) bold.checked = !!segment.bold;

  const italic = row.querySelector(".drawer-font-italic input");
  if (italic) italic.checked = !!segment.italic;

  const sizeStepper = row.querySelector('.drawer-stepper[data-key="font_size"]');
  if (sizeStepper) {
    syncNumberStepper(sizeStepper, {
      value: segment.font_size,
      min: 10,
      max: 128,
    });
  }

  const spacingStepper = row.querySelector('.drawer-stepper[data-key="letter_spacing"]');
  if (spacingStepper) {
    syncNumberStepper(spacingStepper, {
      value: segment.letter_spacing,
      min: -5,
      max: 20,
      step: 0.5,
    });
  }

  const valignStepper = row.querySelector('.drawer-stepper[data-key="v_align"]');
  if (valignStepper) {
    syncNumberStepper(valignStepper, {
      value: segment.v_align,
      min: -32,
      max: 32,
    });
  }
}

function fontDrawer(container, ctx) {
  const { segment, fonts, onTextStyleChange } = ctx;

  const existing =
    container.dataset.mode === "font"
      ? container.querySelector(".drawer-body.drawer-font")
      : null;

  if (existing) {
    syncFontDrawer(existing, ctx);
    return;
  }

  const wrapper = setMode(container, "font", "drawer-font");

  const { trigger, panel } = buildFontPicker(segment, fonts, onTextStyleChange);

  const bold = el("input", { type: "checkbox" });
  bold.checked = !!segment.bold;
  bold.addEventListener("change", () => onTextStyleChange({ bold: bold.checked }));
  const boldWrap = el("label", { className: "drawer-font-bold" }, [
    bold,
    document.createTextNode("Bold"),
  ]);

  const italic = el("input", { type: "checkbox" });
  italic.checked = !!segment.italic;
  italic.addEventListener("change", () =>
    onTextStyleChange({ italic: italic.checked }),
  );
  const italicWrap = el("label", { className: "drawer-font-italic" }, [
    italic,
    document.createTextNode("Italic"),
  ]);

  const sizeStepper = buildNumberStepper({
    label: "Size",
    fieldLabel: "Size",
    value: segment.font_size,
    min: 10,
    max: 128,
    step: 1,
    scrub: true,
    onChange: (next) => onTextStyleChange({ font_size: next }),
  });
  sizeStepper.dataset.key = "font_size";

  const spacingStepper = buildNumberStepper({
    label: "Spacing",
    fieldLabel: "Space",
    value: segment.letter_spacing,
    min: -5,
    max: 20,
    step: 0.5,
    scrub: true,
    onChange: (next) => onTextStyleChange({ letter_spacing: next }),
  });
  spacingStepper.dataset.key = "letter_spacing";

  const valignStepper = buildNumberStepper({
    label: "V align",
    fieldLabel: "Valign",
    value: segment.v_align,
    min: -32,
    max: 32,
    step: 1,
    scrub: true,
    onChange: (next) => onTextStyleChange({ v_align: next }),
  });
  valignStepper.dataset.key = "v_align";

  wrapper.append(
    el("div", { className: "drawer-row" }, [
      trigger,
      boldWrap,
      italicWrap,
      sizeStepper,
      spacingStepper,
      valignStepper,
    ]),
    panel,
  );
}

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

function buildCatButton(cat, active, onChooseCategory) {
  const preview = el("span", { className: "drawer-icon-cat-preview" });
  if (Number.isInteger(cat.sprite_index)) {
    preview.style.setProperty("--sprite-row", String(cat.sprite_index));
  } else {
    preview.textContent = cat.title?.slice(0, 2) || "?";
    preview.classList.add("drawer-icon-cat-fallback");
  }
  const btn = el(
    "button",
    {
      type: "button",
      className: `drawer-icon-cat${active ? " active" : ""}`,
      title: cat.title,
      onclick: () => onChooseCategory(cat.id),
    },
    [preview],
  );
  btn.dataset.catId = cat.id;
  return btn;
}

let lastPaintedCategoryId = null;

function buildIconCats(
  categories,
  activeId,
  sprite,
  onChooseCategory,
  scrollCategory,
) {
  const cats = el("div", { className: "drawer-icon-cats" });
  cats.dataset.catIds = categories.map((c) => c.id).join("|");
  if (sprite?.url) {
    cats.style.setProperty("--sprite-url", `url("${sprite.url}")`);
    cats.style.setProperty("--sprite-cell", `${sprite.cell}px`);
  }
  for (const cat of categories) {
    cats.append(buildCatButton(cat, cat.id === activeId, onChooseCategory));
  }
  if (scrollCategory) revealActiveCat(cats);
  lastPaintedCategoryId = activeId;
  return cats;
}

function revealActiveCat(cats) {
  const active = cats.querySelector(".drawer-icon-cat.active");
  if (!active) return;
  requestAnimationFrame(() => {
    active.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function syncSelectedIcon(grid, selectedIconId) {
  for (const btn of grid.children) {
    const isActive = !!selectedIconId && btn.dataset.iconId === selectedIconId;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  }
}

function centerSelectedInGrid(grid) {
  const active = grid.querySelector(".drawer-icon-pick.active");
  if (!active) return;
  requestAnimationFrame(() => {
    const top = active.offsetTop - (grid.clientHeight - active.offsetHeight) / 2;
    grid.scrollTop = Math.max(0, top);
  });
}

function buildIconGrid(icons, onPick, selectedIconId, scrollToSelected) {
  const grid = el("div", { className: "drawer-icon-grid" });
  grid.dataset.iconIds = icons.map((i) => i.id).join("|");
  for (const icon of icons) {
    const img = el("img", {
      src: icon.thumb_url,
      alt: "",
      loading: "eager",
      decoding: "async",
    });
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
    btn.dataset.iconId = icon.id;
    trackImageLoad(btn, img);
    grid.append(btn);
  }
  syncSelectedIcon(grid, selectedIconId);
  if (scrollToSelected && selectedIconId) centerSelectedInGrid(grid);
  return grid;
}

function buildIconBody(icons, loaded, onPickIcon, selectedIconId, scrollToSelected) {
  if (icons.length) return buildIconGrid(icons, onPickIcon, selectedIconId, scrollToSelected);
  return el("div", {
    className: "drawer-empty",
    text: loaded ? "No icons" : "Loading icons…",
  });
}

function iconDrawer(container, ctx) {
  const {
    iconState,
    onSearchIcons,
    onChooseCategory,
    onPickIcon,
    selectedIconId,
    scrollToSelected,
  } = ctx;
  const categories = iconState.categories || [];
  const icons = iconState.icons || [];
  const catSig = categories.map((c) => c.id).join("|");
  const iconSig = icons.map((i) => i.id).join("|");
  const categoryChanged = iconState.categoryId !== lastPaintedCategoryId;

  const existingPanel =
    container.dataset.mode === "icon"
      ? container.querySelector(".drawer-icon-panel")
      : null;

  if (existingPanel) {
    const search = existingPanel.querySelector('input[type="search"]');
    if (search && document.activeElement !== search) {
      const next = iconState.searchQuery || "";
      if (search.value !== next) search.value = next;
    }

    const oldCats = existingPanel.querySelector(".drawer-icon-cats");
    const oldBody = existingPanel.querySelector(
      ".drawer-icon-grid, .drawer-empty",
    );
    if (oldCats && oldBody) {
      if (oldCats.dataset.catIds === catSig) {
        for (const btn of oldCats.children) {
          btn.classList.toggle(
            "active",
            btn.dataset.catId === iconState.categoryId,
          );
        }
        if (categoryChanged || scrollToSelected) {
          revealActiveCat(oldCats);
          lastPaintedCategoryId = iconState.categoryId;
        }
      } else {
        oldCats.replaceWith(
          buildIconCats(
            categories,
            iconState.categoryId,
            iconState.sprite,
            onChooseCategory,
            categoryChanged || scrollToSelected,
          ),
        );
      }

      const isGrid = oldBody.classList.contains("drawer-icon-grid");
      if (isGrid) {
        syncSelectedIcon(oldBody, selectedIconId);
        if (scrollToSelected && selectedIconId) centerSelectedInGrid(oldBody);
      }
      if (icons.length && isGrid && oldBody.dataset.iconIds === iconSig) return;
      if (!icons.length && !isGrid) {
        oldBody.textContent = iconState.loaded ? "No icons" : "Loading icons…";
        return;
      }
      oldBody.replaceWith(
        buildIconBody(
          icons,
          iconState.loaded,
          onPickIcon,
          selectedIconId,
          scrollToSelected,
        ),
      );
      return;
    }

    existingPanel.remove();
  }

  const wrap = setMode(container, "icon");
  const panel = el("div", { className: "drawer-icon-panel" });

  const search = el("input", {
    type: "search",
    placeholder: "Search icons",
    value: iconState.searchQuery || "",
  });
  search.addEventListener("input", () => onSearchIcons(search.value));

  panel.append(
    search,
    buildIconCats(
      categories,
      iconState.categoryId,
      iconState.sprite,
      onChooseCategory,
      true,
    ),
    buildIconBody(
      icons,
      iconState.loaded,
      onPickIcon,
      selectedIconId,
      scrollToSelected,
    ),
  );
  wrap.append(panel);
}

function imageDrawer(container, ctx) {
  const {
    onUploadImage,
    onSetImageMode,
    onRotateImage,
    onRemoveSegment,
    segment,
  } = ctx;
  const wrap = setMode(container, "image", "drawer-image");

  const uploadInput = el("input", {
    type: "file",
    accept: "image/png,image/jpeg",
  });
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files?.[0];
    if (file) await onUploadImage(file);
    uploadInput.value = "";
  });
  const uploadGlyph = el("span", { className: "drawer-image-glyph" });
  uploadGlyph.innerHTML = UPLOAD;
  const uploadBtn = el("label", { className: "drawer-image-upload" }, [
    uploadInput,
    uploadGlyph,
    el("span", { text: "Replace" }),
  ]);

  const modeWrap = el("div", { className: "drawer-image-fit" });
  for (const mode of ["contain", "cover"]) {
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
    className: "btn btn-sm drawer-image-icon-btn",
    "aria-label": "Rotate",
    title: "Rotate",
    onclick: onRotateImage,
  });
  rotate.innerHTML = ROTATE_CW;

  const remove = el("button", {
    type: "button",
    className: "btn btn-sm btn-danger drawer-image-icon-btn",
    "aria-label": "Remove",
    title: "Remove",
    onclick: onRemoveSegment,
  });
  remove.innerHTML = X;

  wrap.append(
    el("div", { className: "drawer-image-row" }, [
      uploadBtn,
      modeWrap,
      el("div", { className: "drawer-image-actions" }, [rotate, remove]),
    ]),
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
