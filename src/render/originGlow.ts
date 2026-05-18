import type { Params } from "../config.js";
import { TAU } from "../util/math.js";

/**
 * Square XY dot lattice centered on the origin (ix=0, iy=0 at cx, cy), masked
 * with circular falloff. Drawn behind the core orb.
 */
export const drawOriginDotGlow = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  _coreR: number,
  level: number,
  p: Params,
  aMul: number,
): number => {
  if (level <= 0.01) return 0;
  const dotR = p.originGlowDotSize;
  const dotDia = dotR * 2;
  const peak = p.originGlowStrength * aMul;
  if (dotR <= 0 || dotDia <= 0 || peak <= 0) return 0;

  const glowR = level * Math.max(1, p.originGlowExtentDots) * dotDia;
  const step =
    p.originGlowGridStep <= 0 ? dotDia * 0.5 : dotDia * p.originGlowGridStep;
  if (glowR <= dotR) return glowR;

  const prevComp = ctx.globalCompositeOperation;
  const prevFill = ctx.fillStyle;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgb(220,232,255)";

  const glowR2 = glowR * glowR;
  const nX = Math.ceil(glowR / step);
  const nY = Math.ceil(glowR / step);

  for (let iy = -nY; iy <= nY; iy++) {
    const y = cy + iy * step;
    for (let ix = -nX; ix <= nX; ix++) {
      const x = cx + ix * step;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > glowR2) continue;
      const t = Math.sqrt(d2) / glowR;
      const fall = (1 - t) * (1 - t);
      const a = peak * fall;
      if (a < 0.008) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, TAU);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prevComp;
  ctx.fillStyle = prevFill;
  return glowR;
};
