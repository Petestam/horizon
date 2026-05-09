import type { Params } from "../config.js";
import { hexToRgb, lerpRgb, parseGradient, rgbToCss } from "../util/color.js";

/**
 * Paints the time-invariant background layers — base wash, soft vignette, and
 * a subtle pulse-wall band — to an offscreen canvas. Recomputed only on
 * resize or when color/vignette/pulse parameters change.
 */
export const paintStatic = (
  target: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  dpr: number,
  p: Params,
): void => {
  target.width = Math.max(1, Math.round(cssW * dpr));
  target.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const bg = hexToRgb(p.bgColor);
  ctx.fillStyle = rgbToCss(bg, 1);
  ctx.fillRect(0, 0, cssW, cssH);

  const stops = parseGradient(p.gradient);

  // Soft atmospheric wash that mirrors the operator's gradient stops, blended
  // toward the background and dimmed so the field strands stay the focal layer.
  const wash = ctx.createLinearGradient(0, 0, 0, cssH);
  for (const s of stops) {
    wash.addColorStop(s.offset, rgbToCss(lerpRgb(bg, s.rgb, 0.45), s.alpha * 0.32));
  }
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, cssW, cssH);

  const bandY = p.pulseBandY * cssH;
  const bandH = Math.max(2, p.pulseBandHeight * cssH);
  const bandColor = stops[0]?.rgb ?? [255, 255, 255];
  const band = ctx.createLinearGradient(0, bandY - bandH, 0, bandY + bandH);
  band.addColorStop(0, rgbToCss(bandColor, 0));
  band.addColorStop(0.5, rgbToCss(bandColor, 0.05));
  band.addColorStop(1, rgbToCss(bandColor, 0));
  ctx.fillStyle = band;
  ctx.fillRect(0, bandY - bandH, cssW, bandH * 2);

  const vCx = cssW / 2;
  const vCy = cssH * 0.55;
  const vR = Math.hypot(cssW, cssH) * 0.7;
  const vignette = ctx.createRadialGradient(vCx, vCy, vR * 0.45, vCx, vCy, vR);
  vignette.addColorStop(0, rgbToCss(bg, 0));
  vignette.addColorStop(1, rgbToCss(bg, p.vignetteIntensity));
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, cssW, cssH);
};
