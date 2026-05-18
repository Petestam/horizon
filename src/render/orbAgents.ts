import { hexToRgb, rgbToCss, type Rgb } from "../util/color.js";
import type { Params } from "../config.js";
import { TAU } from "../util/math.js";

/** Cisco portfolio accents — single halo ring; motion is shared structured orbit. */
const ORB_AGENT_COLORS: readonly Rgb[] = [
  hexToRgb("#C935C7"),
  hexToRgb("#65A30D"),
  hexToRgb("#7B5CF0"),
  hexToRgb("#F26522"),
  hexToRgb("#1FA774"),
  hexToRgb("#E20074"),
  hexToRgb("#00BCE4"),
];

/** One tilted plane for all agents (atomic shell, not independent fireflies). */
const ORBIT_TILT = 1.02;
const CT = Math.cos(ORBIT_TILT);
const ST = Math.sin(ORBIT_TILT);

/** Inner / outer ring radius as fraction of orbit shell. */
const RING_INNER = 0.86;
const RING_OUTER = 0.98;
const INNER_COUNT = 4;

const drawSprite = (
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  rgb: Rgb,
  alphaBase: number,
  spriteR: number,
  glowR: number,
  brightness: number,
  glow: number,
): void => {
  const aCore = alphaBase * brightness;
  const aHalo = aCore * glow;
  if (glow > 0.001) {
    const halo = ctx.createRadialGradient(ax, ay, 0, ax, ay, glowR);
    halo.addColorStop(0, rgbToCss(rgb, aHalo));
    halo.addColorStop(0.55, rgbToCss(rgb, aHalo * 0.12));
    halo.addColorStop(1, rgbToCss(rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(ax, ay, glowR, 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = rgbToCss(rgb, Math.min(1, aCore * 1.1));
  ctx.beginPath();
  ctx.moveTo(ax, ay - spriteR);
  ctx.lineTo(ax + spriteR * 0.72, ay);
  ctx.lineTo(ax, ay + spriteR);
  ctx.lineTo(ax - spriteR * 0.72, ay);
  ctx.closePath();
  ctx.fill();
};

/** Structured sprites on two coplanar rings: even spacing, one angular rate. */
export const drawOrbAgents = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  coreR: number,
  haloR: number,
  level: number,
  aMul: number,
  towerIndex: number,
  timeSeconds: number,
  tuning: Pick<Params, "orbAgentsSize" | "orbAgentsBrightness" | "orbAgentsGlow">,
): void => {
  const sizeMul = tuning.orbAgentsSize;
  const brightness = tuning.orbAgentsBrightness;
  const glow = tuning.orbAgentsGlow;
  const orbitBase = coreR + (haloR - coreR) * (0.34 + 0.24 * level);
  const baseSpriteR = (1.15 + level * 0.85) * sizeMul;
  const fade = Math.min(1, level / 0.12);
  const t0 = timeSeconds + towerIndex * 0.35;
  const omega = 0.48;

  interface Particle {
    z: number;
    ax: number;
    ay: number;
    rgb: Rgb;
    alpha: number;
    spriteR: number;
    glowR: number;
  }
  const particles: Particle[] = [];
  const n = ORB_AGENT_COLORS.length;

  for (let i = 0; i < n; i++) {
    const rgb = ORB_AGENT_COLORS[i]!;
    const outer = i >= INNER_COUNT;
    const r = orbitBase * (outer ? RING_OUTER : RING_INNER);
    const count = outer ? n - INNER_COUNT : INNER_COUNT;
    const idx = outer ? i - INNER_COUNT : i;
    const phase = outer ? TAU / (2 * INNER_COUNT) : 0;
    const ang = t0 * omega + idx * (TAU / count) + phase;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);

    const x = ca * r;
    const y = sa * ST * r;
    const z = sa * CT * r;

    const depth = 0.5 + 0.5 * (z / Math.max(r, 1));
    const scale = 0.68 + 0.32 * depth;
    const persp = 0.9 + 0.1 * depth;
    const ax = cx + x * persp;
    const ay = cy + y * persp - z * 0.12;
    const alpha = fade * (0.14 + 0.38 * depth) * aMul;
    const spriteR = baseSpriteR * scale;

    particles.push({
      z,
      ax,
      ay,
      rgb,
      alpha,
      spriteR,
      glowR: spriteR * 2.15 * Math.max(0.06, glow),
    });
  }

  particles.sort((a, b) => a.z - b.z);

  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "source-over";
  for (const pt of particles)
    drawSprite(ctx, pt.ax, pt.ay, pt.rgb, pt.alpha, pt.spriteR, pt.glowR, brightness, glow);
  ctx.globalCompositeOperation = prev;
};
