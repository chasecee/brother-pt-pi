const DEFAULT_ICON_CATEGORY = "dp-emoji";

export function iconThumbUrl(iconId) {
  if (iconId.startsWith("custom:")) return `/icons/custom/${iconId.slice(7)}`;
  const parts = iconId.split(":");
  if (parts.length === 2) return `/icons/thumbs/${parts[0]}/${parts[1]}.png`;
  return "";
}

export function isCustomIcon(iconId) {
  return iconId.startsWith("custom:");
}

export function imageAltText(iconId) {
  if (isCustomIcon(iconId)) return "Label image";
  const parts = iconId.split(":");
  if (parts.length === 2) return `Icon ${parts[1]}`;
  return "Icon";
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Icons unavailable (${res.status})`);
  return res.json();
}

export async function loadIconCategories() {
  const data = await fetchJson("/api/icons/categories");
  const categories = data.categories || [];
  const preferred = categories.find((c) => c.id === DEFAULT_ICON_CATEGORY);
  return {
    categories,
    sprite: data.sprite || null,
    defaultCategoryId: preferred ? preferred.id : categories[0]?.id || "",
  };
}

export async function loadCategoryIcons(categoryId) {
  if (!categoryId) return [];
  const data = await fetchJson(
    `/api/icons?category=${encodeURIComponent(categoryId)}`,
  );
  return data.icons || [];
}

export async function searchIcons(query) {
  const q = query.trim();
  if (!q) return [];
  const data = await fetchJson(
    `/api/icons/search?q=${encodeURIComponent(q)}`,
  );
  return data.icons || [];
}

const ICON_UPLOAD_MAX_DIM = 512;

async function prepareUploadFile(file) {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  const isPng = type === "image/png" || name.endsWith(".png");
  const isJpeg = type === "image/jpeg" || /\.jpe?g$/.test(name);
  if (!isPng && !isJpeg) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("invalid image"));
      el.src = url;
    });
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (isPng && Math.max(w, h) <= ICON_UPLOAD_MAX_DIM) return file;
    if (Math.max(w, h) > ICON_UPLOAD_MAX_DIM) {
      if (w >= h) {
        h = Math.round((h * ICON_UPLOAD_MAX_DIM) / w);
        w = ICON_UPLOAD_MAX_DIM;
      } else {
        w = Math.round((w * ICON_UPLOAD_MAX_DIM) / h);
        h = ICON_UPLOAD_MAX_DIM;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("conversion failed"))),
        "image/png",
      );
    });
    const base = file.name.replace(/\.[^.]+$/, "") || "upload";
    return new File([blob], `${base}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadCustomIcon(file) {
  const prepared = await prepareUploadFile(file);
  if (!prepared) throw new Error("PNG or JPEG only");
  const fd = new FormData();
  fd.append("file", prepared);
  const data = await (
    await fetch("/api/icons/custom", { method: "POST", body: fd })
  ).json();
  if (!data.ok) throw new Error(data.err || "upload failed");
  return data;
}
