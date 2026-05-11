import type { Params } from "../config.js";
import { hexToRgb, rgbToCss } from "../util/color.js";

/**
 * Paints the time-invariant background layers — flat background, neutral
 * pulse-wall band, and a soft vignette. The strand gradient is intentionally
 * scoped to the strands themselves and never bled into the background.
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

  const bandY = p.pulseBandY * cssH;
  const bandH = Math.max(2, p.pulseBandHeight * cssH);
  const band = ctx.createLinearGradient(0, bandY - bandH, 0, bandY + bandH);
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(0.5, "rgba(255,255,255,0.04)");
  band.addColorStop(1, "rgba(255,255,255,0)");
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
