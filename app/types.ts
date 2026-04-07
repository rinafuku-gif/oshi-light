export type Mode = "static" | "scroll" | "pov" | "blink";

export interface AppState {
  mode: Mode;
  text: string;
  textColor: string;
  bgColor: string;
  scrollSpeed: number; // px/sec
  blinkSpeed: number;  // ms per half-cycle
  imageUrl: string | null;
  overlayText: boolean;
  panelOpen: boolean;
}

export const COLOR_PRESETS = [
  { label: "ピンク", value: "#FF69B4" },
  { label: "レッド", value: "#FF0000" },
  { label: "ブルー", value: "#00BFFF" },
  { label: "グリーン", value: "#00FF7F" },
  { label: "パープル", value: "#9370DB" },
  { label: "オレンジ", value: "#FF8C00" },
  { label: "イエロー", value: "#FFD700" },
  { label: "ホワイト", value: "#FFFFFF" },
] as const;

export const BG_PRESETS = [
  { label: "黒", value: "#000000" },
  { label: "濃紺", value: "#0a0a2a" },
  { label: "赤", value: "#8B0000" },
  { label: "緑", value: "#003300" },
  { label: "白", value: "#FFFFFF" },
] as const;
