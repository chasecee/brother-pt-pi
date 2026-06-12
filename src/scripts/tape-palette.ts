export type TapePreview = {
  bg: string;
  ink: string;
  border?: string;
  unknown?: boolean;
};

type TapeStyle = {
  bg: string;
  border?: string;
  ink?: string;
};

const TEXT_INK: Record<string, string> = {
  black: "#1a1a1a",
  white: "#ffffff",
  red: "#c62828",
  blue: "#1565c0",
  gold: "#c9a227",
  blue_f: "#1976d2",
};

const TAPE_STYLE: Record<string, TapeStyle> = {
  white: { bg: "#f5f5f5", border: "rgba(0, 0, 0, 0.18)" },
  black: { bg: "#171717", ink: "#ffffff" },
  red: { bg: "#c62828" },
  blue: { bg: "#1565c0" },
  yellow: { bg: "#f7d000", border: "rgba(0, 0, 0, 0.2)" },
  green: { bg: "#2e7d32" },
  other: { bg: "#d4d4d4", border: "rgba(0, 0, 0, 0.2)" },
  clear_black: {
    bg: "conic-gradient(from 45deg, rgba(0,0,0,0.13) 0deg 90deg, rgba(255,255,255,0.18) 90deg 180deg, rgba(0,0,0,0.13) 180deg 270deg, rgba(255,255,255,0.18) 270deg 360deg) 0 0 / 8px 8px",
    border: "rgba(0, 0, 0, 0.26)",
    ink: "#1a1a1a",
  },
  clear_white: {
    bg: "conic-gradient(from 45deg, rgba(0,0,0,0.2) 0deg 90deg, rgba(255,255,255,0.2) 90deg 180deg, rgba(0,0,0,0.2) 180deg 270deg, rgba(255,255,255,0.2) 270deg 360deg) 0 0 / 8px 8px",
    border: "rgba(0, 0, 0, 0.35)",
    ink: "#ffffff",
  },
  matte_white: { bg: "#eceae6", border: "rgba(0, 0, 0, 0.2)" },
  matte_clear: {
    bg: "conic-gradient(from 45deg, rgba(0,0,0,0.08) 0deg 90deg, rgba(255,255,255,0.14) 90deg 180deg, rgba(0,0,0,0.08) 180deg 270deg, rgba(255,255,255,0.14) 270deg 360deg) 0 0 / 8px 8px",
    border: "rgba(0, 0, 0, 0.22)",
  },
  matte_silver: {
    bg: "linear-gradient(135deg, #d9d9da 0%, #b9b9bc 50%, #d4d4d6 100%)",
    border: "rgba(0, 0, 0, 0.18)",
  },
  satin_gold: {
    bg: "linear-gradient(135deg, #d9bf6c 0%, #b89334 48%, #e1cb86 100%)",
    border: "rgba(85, 56, 0, 0.25)",
  },
  satin_silver: {
    bg: "linear-gradient(135deg, #e5e5e6 0%, #c1c1c4 50%, #ececed 100%)",
    border: "rgba(0, 0, 0, 0.18)",
  },
  blue_d: { bg: "#2f6fb8" },
  red_d: { bg: "#b23a3a" },
  fluro_orange: {
    bg: "linear-gradient(180deg, #ff9f2f 0%, #ff8a00 100%)",
    border: "rgba(0, 0, 0, 0.2)",
  },
  fluro_yellow: {
    bg: "linear-gradient(180deg, #ffe845 0%, #f7db00 100%)",
    border: "rgba(0, 0, 0, 0.22)",
  },
  berry_pink_s: { bg: "#c94f8d" },
  light_gray_s: { bg: "#d0d0d0", border: "rgba(0, 0, 0, 0.2)" },
  lime_green_s: { bg: "#7eb938" },
  yellow_f: {
    bg: "repeating-linear-gradient(45deg, #f2d43b 0px, #f2d43b 3px, #f7e36b 3px, #f7e36b 6px)",
    border: "rgba(0, 0, 0, 0.22)",
  },
  pink_f: {
    bg: "repeating-linear-gradient(45deg, #d97eb0 0px, #d97eb0 3px, #e8a7cb 3px, #e8a7cb 6px)",
  },
  blue_f: {
    bg: "repeating-linear-gradient(45deg, #3d6db5 0px, #3d6db5 3px, #648bcc 3px, #648bcc 6px)",
  },
  white_hst: {
    bg: "linear-gradient(180deg, #fafafa 0%, #ececec 100%)",
    border: "rgba(0, 0, 0, 0.2)",
  },
  white_flex_id: {
    bg: "repeating-linear-gradient(45deg, #f5f5f5 0px, #f5f5f5 3px, #e7e7e7 3px, #e7e7e7 6px)",
    border: "rgba(0, 0, 0, 0.18)",
  },
  yellow_flex_id: {
    bg: "repeating-linear-gradient(45deg, #f0d547 0px, #f0d547 3px, #f8e56f 3px, #f8e56f 6px)",
    border: "rgba(0, 0, 0, 0.22)",
  },
  cleaning: { bg: "#d9d9d9", border: "rgba(0, 0, 0, 0.2)" },
  stencil: { bg: "#c9c9c9", border: "rgba(0, 0, 0, 0.2)" },
  none: { bg: "#f5f5f5", border: "rgba(0, 0, 0, 0.18)" },
};

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function titleCase(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const TAPE_ID_TO_KEY: Record<number, string> = {
  0x01: "white",
  0x02: "other",
  0x03: "clear_black",
  0x04: "red",
  0x05: "blue",
  0x06: "yellow",
  0x07: "green",
  0x08: "black",
  0x09: "clear_white",
  0x20: "matte_white",
  0x21: "matte_clear",
  0x22: "matte_silver",
  0x23: "satin_gold",
  0x24: "satin_silver",
  0x30: "blue_d",
  0x31: "red_d",
  0x40: "fluro_orange",
  0x41: "fluro_yellow",
  0x50: "berry_pink_s",
  0x51: "light_gray_s",
  0x52: "lime_green_s",
  0x60: "yellow_f",
  0x61: "pink_f",
  0x62: "blue_f",
  0x70: "white_hst",
  0x90: "white_flex_id",
  0x91: "yellow_flex_id",
  0xf0: "cleaning",
  0xf1: "stencil",
};

const TEXT_ID_TO_KEY: Record<number, string> = {
  0x01: "white",
  0x02: "other",
  0x04: "red",
  0x05: "blue",
  0x08: "black",
  0x0a: "gold",
  0x62: "blue_f",
  0xf0: "cleaning",
  0xf1: "stencil",
};

export function resolveTapeColorKey(
  tape_color: string,
  tape_color_id?: number,
): string {
  const id = Number(tape_color_id) || 0;
  if (id && TAPE_ID_TO_KEY[id]) return TAPE_ID_TO_KEY[id];
  const key = normalized(tape_color);
  if (key === "incompatible") return id && id !== 0xff ? "other" : "none";
  if (!key && id && id !== 0xff) return "other";
  return key || "none";
}

function resolveTextColorKey(
  text_color: string,
  text_color_id?: number,
): string {
  const id = Number(text_color_id) || 0;
  if (id && TEXT_ID_TO_KEY[id]) return TEXT_ID_TO_KEY[id];
  const key = normalized(text_color);
  if (key === "incompatible") return id && id !== 0xff ? "other" : "none";
  if (!key && id && id !== 0xff) return "other";
  return key || "none";
}

export function formatTapeColor(value: string): string {
  const key = normalized(value);
  if (!key || key === "none") return "Unknown";
  return titleCase(key);
}

export function formatTextColor(value: string): string {
  const key = normalized(value);
  if (!key || key === "none" || key === "other") return "Unknown";
  return titleCase(key);
}

export function formatMediaLabel(media: {
  width_mm?: number;
  tape_color?: string;
  text_color?: string;
  tape_color_id?: number;
  text_color_id?: number;
  errors?: string[];
} | null | undefined): string {
  if (!media || !media.width_mm) return "—";
  if (media.errors?.includes("no_media")) {
    return `${media.width_mm}mm · No cartridge`;
  }
  const tapeKey = resolveTapeColorKey(
    media.tape_color || "",
    media.tape_color_id,
  );
  const inkKey = resolveTextColorKey(
    media.text_color || "",
    media.text_color_id,
  );
  const tape = formatTapeColor(tapeKey);
  const ink = formatTextColor(inkKey);
  return `${media.width_mm}mm · ${ink} on ${tape}`;
}

function isUnknownTapeColor(tapeKey: string, inkKey: string): boolean {
  return tapeKey === "none" || inkKey === "none" || inkKey === "other";
}

export function tapePreview(
  tape_color: string,
  text_color: string,
  tape_color_id?: number,
  text_color_id?: number,
): TapePreview {
  const tapeKey = resolveTapeColorKey(tape_color, tape_color_id);
  const inkKey = resolveTextColorKey(text_color, text_color_id);
  if (isUnknownTapeColor(tapeKey, inkKey)) {
    return { bg: "", ink: "", border: "", unknown: true };
  }
  const tape = TAPE_STYLE[tapeKey] || TAPE_STYLE.white;
  const ink = tape.ink || TEXT_INK[inkKey] || "#1a1a1a";
  return {
    bg: tape.bg,
    ink,
    border: tape.border || "transparent",
  };
}
