import type { Renderer } from "./Renderer.js";
import type { Strand } from "../entities/Strand.js";
import type { Highlight } from "../entities/Highlight.js";
import type { Params } from "../config.js";
import { GradientCache } from "./gradients.js";
import { paintStatic } from "./staticLayer.js";
import { hexToRgb, parseGradient, rgbToCss, sampleGradient, type ParsedStop } from "../util/color.js";
import type { Tower } from "../towers/Tower.js";
import { Connection, walkPath } from "../towers/Connection.js";
import { TAU } from "../util/math.js";

const SHADOW_R = 8;
const ELBOW_R = 9;
const TOWER_R = 3.5;

const visibleU = (c: Connection): [number, number] => {
  if (c.phase === "extend") return [0, c.pt / c.extendDur];
  if (c.phase === "retract") return [0, 1 - c.pt / c.retractDur];
  if (c.phase === "dead") return [0, 0];
  return [0, 1];
};

/**
 * Walk the L-shape from distance d0 to d1, rounding both elbows with `arcTo`
 * when each corner is fully traversed. Partial-corner moments during extend/retract
 * fall back to a sharp lineTo for one frame.
 */
const pathThrough = (
  ctx: CanvasRenderingContext2D,
  c: Connection,
  d0: number,
  d1: number,
): void => {
  const seg1 = c.l1;
  const seg2 = c.l1 + c.l2;
  const r1 = Math.min(ELBOW_R, c.l1 * 0.5, c.l2 * 0.5);
  const r2 = Math.min(ELBOW_R, c.l2 * 0.5, c.l3 * 0.5);

  if (r1 > 0.5 && d0 <= seg1 - r1 && d1 >= seg1 + r1) {
    ctx.arcTo(c.ox, c.by, c.ex, c.by, r1);
  } else if (d0 < seg1 && seg1 < d1) {
    ctx.lineTo(c.ox, c.by);
  }

  if (r2 > 0.5 && d0 <= seg2 - r2 && d1 >= seg2 + r2) {
    ctx.arcTo(c.ex, c.by, c.ex, c.ey, r2);
  } else if (d0 < seg2 && seg2 < d1) {
    ctx.lineTo(c.ex, c.by);
  }

  const end = walkPath(c, d1 / c.total);
  ctx.lineTo(end.x, end.y);
};

/** Stroke the visible [u0,u1] slice of c. Crossings are handled separately via drop shadows. */
const strokeConn = (
  ctx: CanvasRenderingContext2D,
  c: Connection,
  u0: number,
  u1: number,
): void => {
  const d0 = u0 * c.total;
  const d1 = u1 * c.total;
  if (d1 <= d0 || c.total <= 0) return;
  const start = walkPath(c, u0);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  pathThrough(ctx, c, d0, d1);
  ctx.stroke();
};

/**
 * Paint a soft dark blob at the crossing point. Drawn between the earlier line
 * and the later one in render order: it dims the lower trace where the upper
 * trace passes over it, reading as a drop shadow / parallax depth cue without
 * a visible arc jump in the line itself.
 */
const drawDropShadow = (
  ctx: CanvasRenderingContext2D,
  c: Connection,
  d: number,
): void => {
  const p = walkPath(c, d / c.total);
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, SHADOW_R);
  g.addColorStop(0, "rgba(0,0,0,0.6)");
  g.addColorStop(0.5, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, SHADOW_R, 0, TAU);
  ctx.fill();
};

const drawChaseDot = (
  ctx: CanvasRenderingContext2D,
  c: Connection,
  u: number,
  grad: readonly ParsedStop[],
  aMul: number,
  fade: number,
): void => {
  const env = Math.sin(u * Math.PI);
  if (env <= 0.02) return;
  const p = walkPath(c, u);
  const col = sampleGradient(grad, u);
  ctx.fillStyle = rgbToCss(col.rgb, 0.7 * fade * env * col.alpha * aMul);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 1.7, 0, TAU);
  ctx.fill();
};

/**
 * 3 forward + 3 reverse glowing dots cycling along the path. The reverse set is
 * phase-shifted by a sixth of the period so the two streams interleave instead of
 * piling on top of each other at the midpoint.
 */
const drawChases = (
  ctx: CanvasRenderingContext2D,
  c: Connection,
  grad: readonly ParsedStop[],
  aMul: number,
): void => {
  const period = c.chasePeriod;
  const tNow = c.phase === "chase" ? c.pt : c.chaseDur + c.pt;
  const fade = c.phase === "pulse" ? 1 - c.pt / c.pulseDur : 1;
  const shift = period / 6;
  for (let k = 0; k < 3; k++) {
    const fwd = ((tNow + (k * period) / 3) % period) / period;
    const rev = 1 - ((tNow + (k * period) / 3 + shift) % period) / period;
    drawChaseDot(ctx, c, fwd, grad, aMul, fade);
    drawChaseDot(ctx, c, rev, grad, aMul, fade);
  }
};

const drawComet = (
  ctx: CanvasRenderingContext2D,
  c: Connection,
  grad: readonly ParsedStop[],
  aMul: number,
): void => {
  const uHead = c.pt / c.pulseDur;
  const tailLen = 0.22;
  for (let i = 0; i < 10; i++) {
    const u = uHead - (i / 10) * tailLen;
    if (u < 0) break;
    const t = 1 - i / 10;
    const p = walkPath(c, u);
    const col = sampleGradient(grad, u);
    ctx.fillStyle = rgbToCss(col.rgb, t * t * col.alpha * aMul);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.8 + t * 1.8, 0, TAU);
    ctx.fill();
  }
};

const drawRipple = (
  ctx: CanvasRenderingContext2D,
  c: Connection,
  grad: readonly ParsedStop[],
  aMul: number,
): void => {
  const t = c.pt / c.retractDur;
  if (t >= 1) return;
  const r = 14 + t * 70;
  const col = sampleGradient(grad, 0.82);
  const a = (1 - t) * 0.55 * col.alpha * aMul;
  const g = ctx.createRadialGradient(c.ex, c.ey, r * 0.5, c.ex, c.ey, r);
  g.addColorStop(0, rgbToCss(col.rgb, 0));
  g.addColorStop(0.55, rgbToCss(col.rgb, a));
  g.addColorStop(1, rgbToCss(col.rgb, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c.ex, c.ey, r, 0, TAU);
  ctx.fill();
};

/**
 * Bucket strands by stroke width so we minimize lineWidth state changes,
 * which dominate the per-frame cost on Canvas2D at high entity counts.
 */
const widthBucket = (w: number): number => Math.round(w * 4) / 4;

const clamp01 = (v: number, max = 1): number => (v < 0 ? 0 : v > max ? max : v);

export class Canvas2DRenderer implements Renderer {
  readonly name = "canvas2d";
  private ctx: CanvasRenderingContext2D;
  private staticCanvas = document.createElement("canvas");
  private gradients: GradientCache;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private params: Params | null = null;
  private gradient: readonly ParsedStop[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D context unavailable");
    this.ctx = ctx;
    this.gradients = new GradientCache(ctx);
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssW = cssWidth;
    this.cssH = cssHeight;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.gradients.clear();
    if (this.params) this.repaintStatic(this.params);
  }

  paramsChanged(params: Params, recacheStatic: boolean): void {
    this.params = params;
    this.gradient = parseGradient(params.gradient);
    if (recacheStatic) this.repaintStatic(params);
  }

  private repaintStatic(p: Params): void {
    if (this.cssW <= 0 || this.cssH <= 0) return;
    paintStatic(this.staticCanvas, this.cssW, this.cssH, this.dpr, p);
    this.gradients.clear();
  }

  beginFrame(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.staticCanvas.width > 0) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(this.staticCanvas, 0, 0);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    } else {
      this.ctx.fillStyle = "#000";
      this.ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
  }

  drawStrands(strands: readonly Strand[]): void {
    if (!this.params || strands.length === 0) return;
    const ctx = this.ctx;
    const p = this.params;
    const H = this.cssH;

    const buckets = new Map<number, Strand[]>();
    for (const s of strands) {
      const b = widthBucket(s.width);
      let arr = buckets.get(b);
      if (!arr) {
        arr = [];
        buckets.set(b, arr);
      }
      arr.push(s);
    }

    const jit = p.gradientJitter;
    const grad = this.gradient;
    ctx.lineCap = "round";
    for (const [width, list] of buckets) {
      ctx.lineWidth = width;
      for (let i = 0; i < list.length; i++) {
        const s = list[i]!;
        const len = s.length * H;
        // After the canvas flip, s.y0 anchors the strand near the bottom of
        // the field; the body extends upward toward the top of the canvas.
        const yBot = s.y0;
        const yTop = s.y0 - len;
        const cOff = s.colorJitter * jit;
        const aMul = 1 + s.alphaJitter * jit * 0.5;
        const top = sampleGradient(grad, clamp01(yTop / H + cOff, 0.4));
        const mid = sampleGradient(grad, clamp01((yTop + len * 0.35) / H + cOff));
        const bot = sampleGradient(grad, clamp01(yBot / H + cOff));
        const a = s.alpha * p.alphaMultiplier * aMul;
        const stops = this.gradients.linear(s.x, yTop, s.x, yBot, [
          { offset: 0, rgb: top.rgb, alpha: Math.min(1, a * top.alpha * 1.6) },
          { offset: 0.35, rgb: mid.rgb, alpha: a * mid.alpha },
          { offset: 1, rgb: bot.rgb, alpha: a * bot.alpha * 0.4 },
        ]);
        ctx.strokeStyle = stops;
        ctx.beginPath();
        ctx.moveTo(s.x, yTop);
        ctx.lineTo(s.x, yBot);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < strands.length; i++) {
      const s = strands[i]!;
      const scale = s.highlighted ? 1.6 : s.primary ? 1 : 0.55;
      const r = p.endpointRadius * scale;
      const aBoost = s.primary ? 2.2 : 1.4;
      const aMul = 1 + s.alphaJitter * jit * 0.5;
      const a = Math.min(1, s.alpha * p.alphaMultiplier * aBoost * aMul);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(s.x, s.y0, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawTowers(towers: readonly Tower[]): void {
    if (!this.params || towers.length === 0) return;
    const ctx = this.ctx;
    const grad = this.gradient;
    const aMul = this.params.alphaMultiplier;
    ctx.lineCap = "round";
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(220,232,255,${0.22 * aMul})`;
    for (const t of towers) {
      for (const c of t.conns) {
        const [u0, u1] = visibleU(c);
        const headD = u1 * c.total;
        for (const d of c.bridges) {
          if (d <= headD) drawDropShadow(ctx, c, d);
        }
        if (u1 > u0) strokeConn(ctx, c, u0, u1);
        if (c.phase === "chase" || c.phase === "pulse") drawChases(ctx, c, grad, aMul);
        if (c.phase === "pulse") drawComet(ctx, c, grad, aMul);
        if (c.phase === "retract") drawRipple(ctx, c, grad, aMul);
      }
    }
    for (const t of towers) {
      ctx.fillStyle = `rgba(255,255,255,${(0.55 + 0.4 * t.pulse) * aMul})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, TOWER_R, 0, TAU);
      ctx.fill();
    }
  }

  drawHighlights(highlights: readonly Highlight[]): void {
    if (highlights.length === 0) return;
    const ctx = this.ctx;
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineCap = "butt";
    // Pills sit above strand endpoints (towers are now at the bottom of the
    // canvas), so they often overlap wave bodies. An opaque pill background
    // tinted by the bg color keeps the text legible.
    const bgRgb = this.params ? hexToRgb(this.params.bgColor) : ([8, 10, 16] as const);

    for (let i = 0; i < highlights.length; i++) {
      const h = highlights[i]!;
      if (!h.strand) continue;
      const s = h.strand;
      const op = h.opacity();
      if (op <= 0) continue;

      const padX = 10;
      const padY = 5;
      const text = h.label;
      const metrics = ctx.measureText(text);
      const tw = metrics.width;
      const th = 12;
      const pillW = tw + padX * 2;
      const pillH = th + padY * 2;
      const stagger = ((i % 3) - 1) * (pillH + 8);
      const pillY = Math.max(pillH * 0.6 + 4, s.y0 - 60 + stagger);
      const pillX = Math.min(this.cssW - pillW - 8, Math.max(8, s.x - pillW / 2));
      const pillCx = pillX + pillW / 2;
      const pillBottom = pillY + pillH / 2;

      ctx.strokeStyle = `rgba(255,255,255,${0.7 * op})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pillCx, pillBottom);
      ctx.lineTo(s.x, s.y0);
      ctx.stroke();

      ctx.beginPath();
      const r = pillH / 2;
      ctx.moveTo(pillX + r, pillY - pillH / 2);
      ctx.lineTo(pillX + pillW - r, pillY - pillH / 2);
      ctx.arc(pillX + pillW - r, pillY, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(pillX + r, pillY + pillH / 2);
      ctx.arc(pillX + r, pillY, r, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = rgbToCss(bgRgb, 0.92 * op);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * op})`;
      ctx.stroke();

      ctx.fillStyle = `rgba(255,255,255,${0.95 * op})`;
      ctx.fillText(text, pillX + padX, pillY);

      ctx.fillStyle = `rgba(255,255,255,${op})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y0, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  endFrame(): void {
    /* no-op for Canvas2D */
  }
}
