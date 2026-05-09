import { clamp } from "./math.js";
import type { GradientStop } from "../config.js";

export type Rgb = readonly [number, number, number];

export const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const rgbToCss = (rgb: Rgb, a = 1): string =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

export const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Pre-parsed, sorted stop list ready for fast sampling. */
export interface ParsedStop {
  offset: number;
  rgb: Rgb;
  alpha: number;
}

export const parseGradient = (stops: readonly GradientStop[]): ParsedStop[] =>
  stops
    .map((s) => ({
      offset: clamp(s.offset, 0, 1),
      rgb: hexToRgb(s.color),
      alpha: clamp(s.alpha, 0, 1),
    }))
    .sort((a, b) => a.offset - b.offset);

export const sampleGradient = (
  stops: readonly ParsedStop[],
  t: number,
): { rgb: Rgb; alpha: number } => {
  if (stops.length === 0) return { rgb: [0, 0, 0], alpha: 1 };
  const x = clamp(t, 0, 1);
  const first = stops[0]!;
  if (x <= first.offset) return { rgb: first.rgb, alpha: first.alpha };
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (x <= b.offset) {
      const span = Math.max(1e-6, b.offset - a.offset);
      const f = (x - a.offset) / span;
      return { rgb: lerpRgb(a.rgb, b.rgb, f), alpha: a.alpha + (b.alpha - a.alpha) * f };
    }
  }
  const last = stops[stops.length - 1]!;
  return { rgb: last.rgb, alpha: last.alpha };
};
