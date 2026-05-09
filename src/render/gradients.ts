import type { Rgb } from "../util/color.js";
import { rgbToCss } from "../util/color.js";

type StopList = readonly { offset: number; rgb: Rgb; alpha: number }[];

const stopsHash = (stops: StopList): string =>
  stops.map((s) => `${s.offset.toFixed(3)}:${s.rgb.join(",")}:${s.alpha.toFixed(3)}`).join("|");

export class GradientCache {
  private map = new Map<string, CanvasGradient>();

  constructor(private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {}

  setContext(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void {
    this.ctx = ctx;
    this.map.clear();
  }

  clear(): void {
    this.map.clear();
  }

  linear(x0: number, y0: number, x1: number, y1: number, stops: StopList): CanvasGradient {
    const key = `L|${x0.toFixed(2)}|${y0.toFixed(2)}|${x1.toFixed(2)}|${y1.toFixed(2)}|${stopsHash(stops)}`;
    const cached = this.map.get(key);
    if (cached) return cached;
    const g = this.ctx.createLinearGradient(x0, y0, x1, y1);
    for (const s of stops) g.addColorStop(s.offset, rgbToCss(s.rgb, s.alpha));
    this.map.set(key, g);
    return g;
  }

  radial(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
    stops: StopList,
  ): CanvasGradient {
    const key = `R|${x0.toFixed(2)}|${y0.toFixed(2)}|${r0.toFixed(2)}|${x1.toFixed(2)}|${y1.toFixed(2)}|${r1.toFixed(2)}|${stopsHash(stops)}`;
    const cached = this.map.get(key);
    if (cached) return cached;
    const g = this.ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const s of stops) g.addColorStop(s.offset, rgbToCss(s.rgb, s.alpha));
    this.map.set(key, g);
    return g;
  }
}
