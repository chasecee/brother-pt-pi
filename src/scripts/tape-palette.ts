export type TapePreview = {
  bg: string;
  ink: string;
  border?: string;
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

function isIncompatibleTape(tape_color: string): boolean {
  return normalized(tape_color) === "incompatible";
}

export function resolveTapeColorKey(tape_color: string): string {
  const key = normalized(tape_color);
  if (key === "incompatible") return "white";
  return key || "none";
}

export function formatTapeColor(value: string): string {
  const key = normalized(value);
  if (key === "incompatible") return "White";
  if (!key || key === "none") return "Unknown";
  return titleCase(key);
}

export function formatTextColor(value: string, tape_color?: string): string {
  if (isIncompatibleTape(tape_color || "")) return "Black";
  const key = normalized(value);
  if (!key || key === "other") return "Unknown";
  if (key === "incompatible") return "Incompatible";
  return titleCase(key);
}

export function formatMediaKind(value: string): string {
  const labels: Record<string, string> = {
    none: "None",
    laminated_tape: "Laminated",
    non_laminated_tape: "Non-laminated",
    heat_shrink_tube: "Heat-shrink",
    flexible_tape: "Flexible",
    incompatible_tape: "Incompatible",
  };
  return labels[normalized(value)] || titleCase(value) || "Unknown";
}

export function formatMediaLabel(media: {
  width_mm?: number;
  tape_color?: string;
  text_color?: string;
  kind?: string;
  errors?: string[];
} | null | undefined): string {
  if (!media || !media.width_mm) return "—";
  if (media.errors?.includes("no_media")) {
    return `${media.width_mm}mm · No cartridge`;
  }
  const tape = formatTapeColor(resolveTapeColorKey(media.tape_color || ""));
  const ink = formatTextColor(media.text_color || "", media.tape_color || "");
  const kind = formatMediaKind(media.kind || "");
  return `${media.width_mm}mm · ${ink} on ${tape} · ${kind}`;
}

export function tapePreview(tape_color: string, text_color: string): TapePreview {
  if (isIncompatibleTape(tape_color)) {
    const white = TAPE_STYLE.white;
    return {
      bg: white.bg,
      ink: "#1a1a1a",
      border: white.border || "transparent",
    };
  }
  const key = resolveTapeColorKey(tape_color);
  const tape = TAPE_STYLE[key] || TAPE_STYLE.none;
  const ink = tape.ink || TEXT_INK[normalized(text_color)] || "#1a1a1a";
  return {
    bg: tape.bg,
    ink,
    border: tape.border || "transparent",
  };
}
