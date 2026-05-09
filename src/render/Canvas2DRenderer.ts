import type { Renderer } from "./Renderer.js";
import type { Strand } from "../entities/Strand.js";
import type { Highlight } from "../entities/Highlight.js";
import type { Params } from "../config.js";
import { GradientCache } from "./gradients.js";
import { paintStatic } from "./staticLayer.js";
import { parseGradient, sampleGradient, type ParsedStop } from "../util/color.js";

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
        const y1 = s.y0 + len;
        const cOff = s.colorJitter * jit;
        const aMul = 1 + s.alphaJitter * jit * 0.5;
        const top = sampleGradient(grad, clamp01(s.y0 / H + cOff, 0.4));
        const mid = sampleGradient(grad, clamp01((s.y0 + len * 0.35) / H + cOff));
        const bot = sampleGradient(grad, clamp01(y1 / H + cOff));
        const a = s.alpha * p.alphaMultiplier * aMul;
        const stops = this.gradients.linear(s.x, s.y0, s.x, y1, [
          { offset: 0, rgb: top.rgb, alpha: Math.min(1, a * top.alpha * 1.6) },
          { offset: 0.35, rgb: mid.rgb, alpha: a * mid.alpha },
          { offset: 1, rgb: bot.rgb, alpha: a * bot.alpha * 0.4 },
        ]);
        ctx.strokeStyle = stops;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y0);
        ctx.lineTo(s.x, y1);
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

  drawHighlights(highlights: readonly Highlight[]): void {
    if (highlights.length === 0) return;
    const ctx = this.ctx;
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineCap = "butt";

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
      ctx.stroke();

      ctx.fillStyle = `rgba(255,255,255,${0.85 * op})`;
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
