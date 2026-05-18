import type { Params } from "../config.js";
import { hexToRgb, rgbToCss } from "../util/color.js";
import { TAU } from "../util/math.js";

/** Stable per-light phase so drift patterns don't reset when params reload. */
const lightPhase = (i: number): number => i * 2.397 + 0.61;

/** Bottom anchor spread across the stage (wider bases read as ambient wash). */
const lightAnchorX = (cssW: number, i: number, count: number): number => {
  if (count <= 1) return cssW * 0.5;
  const t = i / (count - 1);
  return cssW * (0.2 + t * 0.6);
};

/**
 * Bottom radial lights with slow horizontal drift (`lightDriftSpeed`).
 * Each source has its own anchor, period, and direction so glows gently sweep
 * left–right instead of sliding in lockstep. Painted every frame above static bg.
 */
export const paintBackgroundLights = (
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  p: Params,
  timeSeconds: number,
): void => {
  const s = Math.min(Math.max(p.lightDriftSpeed, 0), 10);
  const drift = s / 10;
  const lights = p.lightSources;
  const n = lights.length;

  for (let i = 0; i < n; i++) {
    const ls = lights[i]!;
    if (!ls.enabled || ls.intensity <= 0 || ls.distance <= 0) continue;

    const phase = lightPhase(i);
    const period = 480 + (i % 3) * 90 + (i % 2) * 55;
    const omega = (TAU / period) * s;
    const amp = cssW * (0.045 + 0.04 * drift) * (0.82 + (i % 3) * 0.12);
    const dx = (i % 2 === 0 ? 1 : -1) * amp * Math.sin(timeSeconds * omega + phase);
    const cx = lightAnchorX(cssW, i, n) + dx;

    const breathe =
      drift > 0 ? 1 + 0.07 * drift * Math.sin(timeSeconds * omega * 1.25 + phase + 0.9) : 1;
    const spreadPulse =
      drift > 0 ? 1 + 0.05 * drift * Math.sin(timeSeconds * omega * 0.85 + phase + 1.4) : 1;

    const cy = cssH * (1 + ls.diffusion);
    const radius = cssH * ls.distance;
    const sx = Math.max(0.05, ls.spread * spreadPulse);
    const peak = ls.intensity * breathe;
    const lc = hexToRgb(ls.color);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, 1);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    const N = 12;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      grad.addColorStop(t, rgbToCss(lc, Math.pow(1 - t, ls.falloff) * peak));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(-cx / sx, -cy, cssW / sx, cssH);
    ctx.restore();
  }
};

/**
 * Paints the time-invariant background layers — flat background, neutral
 * pulse-wall band, and a soft vignette. Bottom lights are animated separately.
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
  // Sit slightly above center to mirror the canvas flip (towers anchor the bottom).
  const vCy = cssH * 0.45;
  const vR = Math.hypot(cssW, cssH) * 0.7;
  const vignette = ctx.createRadialGradient(vCx, vCy, vR * 0.45, vCx, vCy, vR);
  vignette.addColorStop(0, rgbToCss(bg, 0));
  vignette.addColorStop(1, rgbToCss(bg, p.vignetteIntensity));
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, cssW, cssH);
};
