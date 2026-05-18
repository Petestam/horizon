import type { Renderer } from "./Renderer.js";
import type { Strand } from "../entities/Strand.js";
import type { Highlight } from "../entities/Highlight.js";
import type { Params } from "../config.js";
import { GradientCache } from "./gradients.js";
import { paintStatic, paintBackgroundLights } from "./staticLayer.js";
import { parseGradient, rgbToCss, sampleGradient, type ParsedStop } from "../util/color.js";
import type { Tower } from "../towers/Tower.js";
import type { Connection, PathGeom, Pt } from "../towers/Connection.js";
import type { FallPulse } from "../demo/FallPulse.js";
import { TAU } from "../util/math.js";

const ELBOW_R = 9;

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const easeInOutCubic = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Stroke an orthogonal polyline; rounds any corner where two legs meet. */
const strokeRoundedPolyline = (
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  radius: number,
): void => {
  if (points.length < 2) return;
  const cap = Math.max(0, radius);
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  if (points.length === 2) {
    ctx.lineTo(points[1]!.x, points[1]!.y);
    ctx.stroke();
    return;
  }
  for (let i = 0; i < points.length - 2; i++) {
    const prev = points[i]!;
    const cur = points[i + 1]!;
    const next = points[i + 2]!;
    const dx1 = cur.x - prev.x;
    const dy1 = cur.y - prev.y;
    const dx2 = next.x - cur.x;
    const dy2 = next.y - cur.y;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    if (len1 < 0.5 || len2 < 0.5) {
      ctx.lineTo(cur.x, cur.y);
      continue;
    }
    const r = Math.min(cap, len1 * 0.5, len2 * 0.5);
    if (r < 0.5) {
      ctx.lineTo(cur.x, cur.y);
      continue;
    }
    ctx.lineTo(cur.x - (dx1 / len1) * r, cur.y - (dy1 / len1) * r);
    ctx.arcTo(cur.x, cur.y, next.x, next.y, r);
  }
  const last = points[points.length - 1]!;
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
};

/**
 * Bundle the rounded L-path geometry for a connection. The Path2D is what we
 * actually stroke (so the snake naturally bends through the arcTo elbows), and
 * `sampleAt(arclen)` walks the *rounded* path so the head bloom + linear-gradient
 * endpoints land exactly on the stroke instead of on the sharp-L approximation.
 */
interface RoundedPath {
  path: Path2D;
  arcTotal: number;
  sampleAt: (arclen: number) => Pt;
}

const buildRoundedPath = (c: PathGeom): RoundedPath => {
  const r1 = Math.max(0, Math.min(ELBOW_R, c.l1 * 0.5, c.l2 * 0.5));
  const r2 = Math.max(0, Math.min(ELBOW_R, c.l2 * 0.5, c.l3 * 0.5));
  const dy1 = c.by >= c.oy ? 1 : -1;
  const dx2 = c.ex >= c.ox ? 1 : -1;
  const dy3 = c.ey >= c.by ? 1 : -1;

  const path = new Path2D();
  path.moveTo(c.ox, c.oy);
  if (r1 > 0.5) path.arcTo(c.ox, c.by, c.ex, c.by, r1);
  else path.lineTo(c.ox, c.by);
  if (r2 > 0.5) path.arcTo(c.ex, c.by, c.ex, c.ey, r2);
  else path.lineTo(c.ex, c.by);
  path.lineTo(c.ex, c.ey);

  const seg1 = c.l1 - r1;
  const arc1 = (Math.PI * r1) / 2;
  const seg2 = c.l2 - r1 - r2;
  const arc2 = (Math.PI * r2) / 2;
  const seg3 = c.l3 - r2;
  const arcTotal = Math.max(0, seg1) + arc1 + Math.max(0, seg2) + arc2 + Math.max(0, seg3);

  const sampleAt = (arclen: number): Pt => {
    let d = Math.max(0, Math.min(arcTotal, arclen));
    if (d <= seg1) return { x: c.ox, y: c.oy + dy1 * d };
    d -= seg1;
    if (d <= arc1 && r1 > 0) {
      const t = d / r1; // 0..π/2
      const cx = c.ox + dx2 * r1;
      const cy = c.by - dy1 * r1;
      return { x: cx - dx2 * r1 * Math.cos(t), y: cy + dy1 * r1 * Math.sin(t) };
    }
    d -= arc1;
    if (d <= seg2) return { x: c.ox + dx2 * (r1 + d), y: c.by };
    d -= seg2;
    if (d <= arc2 && r2 > 0) {
      const t = d / r2;
      const cx = c.ex - dx2 * r2;
      const cy = c.by + dy3 * r2;
      return { x: cx + dx2 * r2 * Math.sin(t), y: cy - dy3 * r2 * Math.cos(t) };
    }
    d -= arc2;
    return { x: c.ex, y: c.by + dy3 * (r2 + d) };
  };

  return { path, arcTotal, sampleAt };
};

const visibleU = (c: Connection): [number, number] => {
  if (c.phase === "extend") return [0, easeOutCubic(c.pt / c.extendDur)];
  if (c.phase === "retract") return [0, 1 - easeInOutCubic(c.pt / c.retractDur)];
  if (c.phase === "dead") return [0, 0];
  return [0, 1];
};

/** Stroke the visible [u0,u1] slice of c along its rounded path. Sharp dashes are reset by the caller. */
const strokeConn = (
  ctx: CanvasRenderingContext2D,
  rp: RoundedPath,
  u0: number,
  u1: number,
): void => {
  if (u1 <= u0 || rp.arcTotal <= 0) return;
  const a0 = u0 * rp.arcTotal;
  const a1 = u1 * rp.arcTotal;
  const visible = a1 - a0;
  if (visible < 0.25) return;
  ctx.setLineDash([visible, rp.arcTotal + visible + 10]);
  ctx.lineDashOffset = -a0;
  ctx.stroke(rp.path);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
};

/**
 * Render one luminous "snake" along the rounded L-path.
 *
 * The whole connection path is stroked exactly once per glow pass; `setLineDash`
 * reveals only the [uTail, uHead] slice, and the path's `arcTo` elbows naturally
 * bend the snake through corners. The cisco gradient is embedded in the snake
 * via a CanvasLinearGradient from tailPt → headPt with stops sampling the
 * global gradient at snake-local t (t=0 tail, t=1 head). Brightness is encoded
 * in the per-stop alpha so the head reads as the hot emit-source.
 */
const drawSnake = (
  ctx: CanvasRenderingContext2D,
  rp: RoundedPath,
  grad: readonly ParsedStop[],
  aMul: number,
  uHead: number,
  tailLen: number,
  fade: number,
  coreWidth: number,
  glow: number,
  dir: 1 | -1 = 1,
): void => {
  if (fade <= 0.02 || tailLen <= 0 || rp.arcTotal <= 0) return;
  const head = clamp01(uHead);
  const tail = clamp01(head - dir * tailLen);
  const uA = Math.min(head, tail);
  const uB = Math.max(head, tail);
  const arcA = uA * rp.arcTotal;
  const arcB = uB * rp.arcTotal;
  const visible = arcB - arcA;
  if (visible < 0.5) return;

  const headPt = rp.sampleAt(head * rp.arcTotal);
  const tailPt = rp.sampleAt(tail * rp.arcTotal);

  // Sample 6 stops along the snake for the embedded gradient. createLinearGradient
  // maps offset 0 to (tailPt) and 1 to (headPt); on a bent path the gradient
  // line is a chord through the bend, which is fine for the snake lengths we use.
  const stopCount = 6;
  const stops: Array<{ offset: number; color: string }> = [];
  for (let i = 0; i <= stopCount; i++) {
    const t = i / stopCount;
    const col = sampleGradient(grad, t);
    const bright = 0.05 + 0.95 * Math.pow(t, 1.8);
    stops.push({ offset: t, color: rgbToCss(col.rgb, bright * col.alpha * aMul * fade) });
  }

  const passes = [
    { w: 4.5 + 3 * glow, a: 0.1 * glow },
    { w: 2.2 + 1.5 * glow, a: 0.3 * glow },
    { w: 1, a: 1 },
  ];

  const prevComp = ctx.globalCompositeOperation;
  const prevCap = ctx.lineCap;
  const prevJoin = ctx.lineJoin;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([visible, rp.arcTotal + visible + 10]);
  ctx.lineDashOffset = -arcA;

  for (const pass of passes) {
    if (pass.a <= 0) continue;
    const lg = ctx.createLinearGradient(tailPt.x, tailPt.y, headPt.x, headPt.y);
    for (const s of stops) {
      // Re-scale each stop's alpha by the pass strength. We rebuild the stop list
      // per pass so the gradient object carries the right per-pass intensity.
      const t = s.offset;
      const col = sampleGradient(grad, t);
      const bright = 0.05 + 0.95 * Math.pow(t, 1.8);
      lg.addColorStop(t, rgbToCss(col.rgb, bright * col.alpha * aMul * fade * pass.a));
    }
    ctx.lineWidth = coreWidth * pass.w;
    ctx.strokeStyle = lg;
    ctx.stroke(rp.path);
  }

  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // Bright bloom at the head — emit-source point where the snake "is looking".
  const colH = sampleGradient(grad, 1);
  const haloR = coreWidth * (3 + 6 * glow);
  if (haloR > 0.5) {
    const halo = ctx.createRadialGradient(headPt.x, headPt.y, 0, headPt.x, headPt.y, haloR);
    halo.addColorStop(0, rgbToCss(colH.rgb, 0.55 * colH.alpha * aMul * fade));
    halo.addColorStop(1, rgbToCss(colH.rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(headPt.x, headPt.y, haloR, 0, TAU);
    ctx.fill();
  }

  ctx.globalCompositeOperation = prevComp;
  ctx.lineCap = prevCap;
  ctx.lineJoin = prevJoin;
};

/** Lead/trail instancing: draw `lead` snakes ahead of the head, the primary, then `trail` behind. */
const drawSnakeTrain = (
  ctx: CanvasRenderingContext2D,
  rp: RoundedPath,
  grad: readonly ParsedStop[],
  aMul: number,
  uHead: number,
  tailLen: number,
  fade: number,
  coreWidth: number,
  glow: number,
  lead: number,
  trail: number,
  spacing: number,
  dir: 1 | -1 = 1,
): void => {
  for (let i = -trail; i <= lead; i++) {
    drawSnake(ctx, rp, grad, aMul, uHead + i * spacing * dir, tailLen, fade, coreWidth, glow, dir);
  }
};

/**
 * Bucket strands by stroke width so we minimize lineWidth state changes,
 * which dominate the per-frame cost on Canvas2D at high entity counts.
 */
const widthBucket = (w: number): number => Math.round(w * 4) / 4;

import { drawOrbAgents } from "./orbAgents.js";
import { drawOriginDotGlow } from "./originGlow.js";
import {
  PHASE_PILL_FONT,
  PHASE_PILL_PAD_X,
  hitPhasePill,
  layoutPhasePills,
} from "./phasePills.js";

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
  private highlightTopMin = 0;
  private highlightSidePad = 8;
  private lastFrameTime = -1;
  private frameTime = 0;
  private frameDt = 0;

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

  setHighlightMargins(m: { topMin: number; sidePad: number }): void {
    this.highlightTopMin = m.topMin;
    this.highlightSidePad = m.sidePad;
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

  beginFrame(timeSeconds: number): void {
    this.frameDt = this.lastFrameTime < 0 ? 0 : Math.max(0, Math.min(0.1, timeSeconds - this.lastFrameTime));
    this.lastFrameTime = timeSeconds;
    this.frameTime = timeSeconds;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.staticCanvas.width > 0) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(this.staticCanvas, 0, 0);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    } else {
      this.ctx.fillStyle = "#000";
      this.ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    const p = this.params;
    if (p && this.cssW > 0 && this.cssH > 0) {
      paintBackgroundLights(this.ctx, this.cssW, this.cssH, p, timeSeconds);
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
    const p = this.params;
    const grad = this.gradient;
    const aMul = p.alphaMultiplier;
    const coreW = p.towerPulseWidth;
    const glow = p.towerPulseGlow;
    const tailLen = p.towerPulseTailLen;
    const lead = Math.round(p.towerPulseLead);
    const trail = Math.round(p.towerPulseTrail);
    const spacing = p.towerPulseSpacing;
    // Telemetry blips during investigate read as dots of light, not comets.
    const burstTailMul = 0.55;
    const connStyle = `rgba(220,232,255,${0.22 * aMul})`;

    ctx.lineCap = "round";
    for (const t of towers) {
      for (const c of t.conns) {
        const rp = buildRoundedPath(c);
        const [u0, u1] = visibleU(c);
        if (u1 > u0) {
          ctx.lineWidth = p.towerStrokeWidth;
          ctx.strokeStyle = connStyle;
          strokeConn(ctx, rp, u0, u1);
        }

        if (c.phase === "bond") {
          // Held handshake at the endpoint — soft cisco-tinted glow that breathes through the bond beat.
          const bondT = c.bondDur > 0 ? c.pt / c.bondDur : 1;
          const breathe = Math.sin(bondT * Math.PI); // 0 → 1 → 0 across the bond
          const colE = sampleGradient(grad, 0.9);
          const haloR = 14 + 10 * breathe;
          const haloA = 0.45 * breathe * colE.alpha * aMul;
          const prev = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = "lighter";
          const halo = ctx.createRadialGradient(c.ex, c.ey, 0, c.ex, c.ey, haloR);
          halo.addColorStop(0, rgbToCss(colE.rgb, haloA));
          halo.addColorStop(1, rgbToCss(colE.rgb, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(c.ex, c.ey, haloR, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = prev;
        } else if (c.phase === "chase" && c.pulseDir < 0 && !c.automated) {
          // Manual investigate: continuous particle stream — many small dots
          // with parallax speeds drift endpoint→origin, reading as a flowing
          // telemetry channel rather than a marching Morse triplet.
          const PARTICLE_COUNT = 30;
          const SIZE = 1 / 3;
          const traversal = Math.max(0.05, c.burstDur);
          const tailL = tailLen * burstTailMul * SIZE;
          const wCore = coreW * SIZE;
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            // Golden-ratio offset → even phase spread; second irrational →
            // uncorrelated speed multiplier so particles overtake each other.
            const phaseOff = (i * 0.6180339887) % 1;
            const speedMul = 0.5 + ((i * 0.7548776662) % 1);
            const u = ((c.pt * speedMul) / traversal + phaseOff) % 1;
            drawSnake(ctx, rp, grad, aMul, 1 - u, tailL, 1, wCore, glow, -1);
          }
        } else if (c.phase === "chase") {
          // Automate (and any future outbound chase): Morse-style telemetry
          // triplet, then a long silence before the next triplet. Linear
          // travel — easing reads as a thrown object; this reads as a signal.
          const period = c.chasePeriod;
          const tCycle = ((c.pt % period) + period) % period;
          const dotDur = c.burstDur;
          const dotGap = 0.2;
          const dotsPerCycle = 3;
          const slotLen = dotDur + dotGap;
          const triplet = dotsPerCycle * slotLen - dotGap;
          if (tCycle < triplet) {
            const idx = Math.floor(tCycle / slotLen);
            const tIn = tCycle - idx * slotLen;
            if (idx < dotsPerCycle && tIn < dotDur && dotDur > 0) {
              const t = tIn / dotDur;
              const uHead = c.pulseDir < 0 ? 1 - t : t;
              drawSnakeTrain(
                ctx,
                rp,
                grad,
                aMul,
                uHead,
                tailLen * burstTailMul,
                1,
                coreW,
                glow,
                lead,
                trail,
                spacing,
                c.pulseDir,
              );
              if (t < 0.22) {
                const sparkU = c.pulseDir < 0 ? 1 : 0;
                const sparkPt = rp.sampleAt(sparkU * rp.arcTotal);
                const colS = sampleGradient(grad, 0.95);
                const sparkA = (1 - t / 0.22) * 0.85 * colS.alpha * aMul;
                const sparkR = coreW * (4 + 3 * glow);
                const prev = ctx.globalCompositeOperation;
                ctx.globalCompositeOperation = "lighter";
                const sparkG = ctx.createRadialGradient(
                  sparkPt.x,
                  sparkPt.y,
                  0,
                  sparkPt.x,
                  sparkPt.y,
                  sparkR,
                );
                sparkG.addColorStop(0, rgbToCss(colS.rgb, sparkA));
                sparkG.addColorStop(1, rgbToCss(colS.rgb, 0));
                ctx.fillStyle = sparkG;
                ctx.beginPath();
                ctx.arc(sparkPt.x, sparkPt.y, sparkR, 0, TAU);
                ctx.fill();
                ctx.globalCompositeOperation = prev;
              }
            }
          }
        } else if (c.phase === "pulse") {
          // Resolve / automate: one vibrant, eased outbound pulse from origin to endpoint.
          const eased = easeInOutCubic(c.pt / c.pulseDur);
          const fade = 1 - Math.pow(c.pt / c.pulseDur, 3);
          const uHead = c.pulseDir < 0 ? 1 - eased : eased;
          drawSnakeTrain(
            ctx,
            rp,
            grad,
            aMul,
            uHead,
            tailLen,
            fade,
            coreW,
            glow,
            lead,
            trail,
            spacing,
            c.pulseDir,
          );
        }
      }
    }

    const orbRadii: number[] = [];
    for (let ti = 0; ti < towers.length; ti++) {
      const t = towers[ti]!;
      const expand = Math.max(0, Math.min(1, t.originGrid));
      const r = 3.5 + 6 * expand;
      orbRadii[ti] = r;
      const haloR =
        expand > 0.01 ? drawOriginDotGlow(ctx, t.x, t.y, r, expand, p, aMul) : 0;
      if (p.orbAgentsEnabled && expand > 0.02 && haloR > 0) {
        drawOrbAgents(ctx, t.x, t.y, r, haloR, expand, aMul, ti, this.frameTime, p);
      }
    }

    const prevAlpha = ctx.globalAlpha;
    const prevComp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    for (let ti = 0; ti < towers.length; ti++) {
      const t = towers[ti]!;
      const r = orbRadii[ti]!;
      const pulseR = r + t.pulse * 0.8;
      ctx.beginPath();
      ctx.arc(t.x, t.y, pulseR, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevComp;
  }

  /**
   * Brighten strand strokes + endpoint orbs along a ring expanding from each
   * resolved connection endpoint. Called between drawStrands and drawTowers so
   * the overlay reads as an emit-from-the-strand glow, not an under-layer.
   * Skips labels per design — only strand strokes and endpoints participate.
   */
  drawShimmers(strands: readonly Strand[], towers: readonly Tower[]): void {
    if (!this.params || towers.length === 0 || strands.length === 0) return;
    const p = this.params;
    if (p.shimmerIntensity <= 0 || p.shimmerRadius <= 0) return;
    const ctx = this.ctx;
    const grad = this.gradient;
    const aMul = p.alphaMultiplier;
    const H = this.cssH;
    // Sample the hot end of the cisco gradient as the shimmer's tint.
    const tint = sampleGradient(grad, 0.92);

    const prevComp = ctx.globalCompositeOperation;
    const prevCap = ctx.lineCap;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (const t of towers) {
      for (const c of t.conns) {
        if (c.phase !== "pulse" && c.phase !== "retract") continue;
        if (c.shimmerT <= 0) continue;
        const total = Math.max(0.05, c.retractDur);
        const progress = Math.max(0, Math.min(1, c.shimmerT / total));
        if (progress >= 1) continue;
        const mul = c.shimmerMul;
        const ringR = p.shimmerRadius * mul * easeOutCubic(progress);
        const band = Math.max(18, p.shimmerRadius * 0.35);
        const intensity = p.shimmerIntensity * mul * (1 - progress);
        if (intensity < 0.01) continue;
        const cx = c.ex;
        const cy = c.ey;
        const lo = Math.max(0, ringR - band);
        const hi = ringR + band;
        const lo2 = lo * lo;
        const hi2 = hi * hi;
        const sigma = band * 0.45;
        const sigma2 = 2 * sigma * sigma;

        for (const s of strands) {
          const dx = s.x - cx;
          const dy = s.y0 - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < lo2 || d2 > hi2) continue;
          const d = Math.sqrt(d2);
          const fall = Math.exp(-((d - ringR) * (d - ringR)) / sigma2);
          const a = intensity * fall * aMul;
          if (a < 5e-3) continue;
          const len = s.length * H;
          ctx.strokeStyle = rgbToCss(tint.rgb, a * tint.alpha);
          ctx.lineWidth = s.width * 1.4;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y0 - len);
          ctx.lineTo(s.x, s.y0);
          ctx.stroke();
          ctx.fillStyle = rgbToCss(tint.rgb, Math.min(1, a * 2.2 * tint.alpha));
          ctx.beginPath();
          ctx.arc(s.x, s.y0, p.endpointRadius * 1.5, 0, TAU);
          ctx.fill();
        }
      }
    }

    ctx.globalCompositeOperation = prevComp;
    ctx.lineCap = prevCap;
  }

  /**
   * Small monochrome pill below each tower listing its current phase. Debug aid;
   * surfaces what the demo / auto-spawn is actually doing while you tune.
   */
  drawPhasePills(towers: readonly Tower[]): void {
    if (!this.params?.phasePillsEnabled || towers.length === 0) return;
    const ctx = this.ctx;
    const edgePad = 8;
    const sidePad = Math.max(edgePad, this.highlightSidePad);
    const prevAlpha = ctx.globalAlpha;
    const prevComp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.font = PHASE_PILL_FONT;
    ctx.textBaseline = "middle";
    const pills = layoutPhasePills(towers, this.cssW, this.cssH, sidePad, (label) =>
      ctx.measureText(label).width,
    );
    for (const p of pills) {
      ctx.fillStyle = "#0a0c12";
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.fillStyle = "#e8eeff";
      ctx.fillText(p.label, p.x + PHASE_PILL_PAD_X, p.y + p.h / 2);
    }
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevComp;
  }

  /** Stage-space hit test for debug phase pills; returns kiosk index or null. */
  hitPhasePill(cssX: number, cssY: number, towers: readonly Tower[]): number | null {
    const edgePad = 8;
    const sidePad = Math.max(edgePad, this.highlightSidePad);
    this.ctx.font = PHASE_PILL_FONT;
    const pills = layoutPhasePills(towers, this.cssW, this.cssH, sidePad, (label) =>
      this.ctx.measureText(label).width,
    );
    return hitPhasePill(pills, cssX, cssY);
  }

  drawFallPulses(pulses: readonly FallPulse[]): void {
    if (!this.params || pulses.length === 0) return;
    const ctx = this.ctx;
    const grad = this.gradient;
    const params = this.params;
    const aMul = params.alphaMultiplier;
    for (const p of pulses) {
      const u = easeInOutCubic(Math.max(0, Math.min(1, p.t / p.duration)));
      // Fade in over the first 6%, fade out only in the last 4% so the orb
      // catches the pulse without it dimming visibly on approach.
      const raw = Math.max(0, Math.min(1, p.t / p.duration));
      const fade = raw < 0.06 ? raw / 0.06 : raw > 0.96 ? (1 - raw) / 0.04 : 1;
      const rp = buildRoundedPath(p);
      drawSnake(
        ctx,
        rp,
        grad,
        aMul,
        u,
        params.towerPulseTailLen,
        fade,
        params.towerPulseWidth,
        params.towerPulseGlow,
        1,
      );
    }
  }

  drawHighlights(highlights: readonly Highlight[]): void {
    if (highlights.length === 0 || !this.params) return;
    const ctx = this.ctx;
    const p = this.params;
    /** Matches Figma CLUS26 callout (node 389:2041) at 1920 CSS px stage width, scaled by `alertScale`. */
    const s = Math.max(0.08, (p.alertScale * this.cssW) / 1920);
    const fontPx = Math.max(9, 32 * s);
    const padX = 40 * s;
    const padY = 12 * s;
    const borderW = Math.max(0.75, 1 * s);
    const cornerCap = 114 * s;
    const anchorGap = 10 * s;
    const gutter = Math.max(8, 14 * s);
    const sidePad = this.highlightSidePad;
    const topMin = this.highlightTopMin;
    const bottomMin = this.cssH - sidePad;
    const anchorOuterR = 29 * s;
    const anchorInnerR = Math.max(2.25, 5 * s);

    ctx.textBaseline = "middle";
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.font = `${fontPx}px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

    interface Slot {
      h: Highlight;
      ax: number;
      ay: number;
      lines: string[];
      lineH: number;
      op: number;
      tx: number;
      ty: number;
      tw: number;
      th: number;
    }
    const slots: Slot[] = [];

    // Layout: anchor-centered above target, clamped to stage, slid past prior pills until clear.
    for (const h of highlights) {
      const op = h.opacity();
      if (op <= 0) continue;
      const ax = h.conn ? h.conn.ex : h.strand?.x;
      const ay = h.conn ? h.conn.ey : h.strand?.y0;
      if (ax === undefined || ay === undefined) continue;

      const lines: string[] = h.subtext ? [h.label, h.subtext] : [h.label];
      const lineH = fontPx * 1.31;
      const widths = lines.map((l) => ctx.measureText(l).width);
      const tw = Math.max(...widths) + padX * 2;
      const th = lines.length * lineH + padY * 2;

      const minY = topMin + th / 2;
      const maxY = Math.max(minY, bottomMin - th / 2);
      const tx = Math.min(this.cssW - sidePad - tw, Math.max(sidePad, ax - tw / 2));
      // Sit just above the anchor ring with a short visible leader stem.
      let ty = ay - anchorOuterR - anchorGap - th / 2;
      ty = Math.max(minY, Math.min(maxY, ty));

      for (let pass = 0; pass < 8; pass++) {
        let bumped = false;
        for (const o of slots) {
          const horiz = tx < o.tx + o.tw + gutter && tx + tw > o.tx - gutter;
          const vert = ty - th / 2 < o.ty + o.th / 2 + gutter && ty + th / 2 > o.ty - o.th / 2 - gutter;
          if (!horiz || !vert) continue;
          const below = o.ty + o.th / 2 + gutter + th / 2;
          ty = below <= maxY ? below : Math.max(minY, o.ty - o.th / 2 - gutter - th / 2);
          bumped = true;
        }
        if (!bumped) break;
      }
      slots.push({ h, ax, ay, lines, lineH, op, tx, ty, tw, th });
    }

    // Smoothing: exponential damping toward target; snap on first appearance so pills don't slide from origin.
    const lerp = 1 - Math.exp(-this.frameDt * 14);
    for (const slot of slots) {
      const h = slot.h;
      if (!h.displayed) {
        h.dispX = slot.tx;
        h.dispY = slot.ty;
        h.dispW = slot.tw;
        h.dispH = slot.th;
        h.displayed = true;
      } else {
        h.dispX += (slot.tx - h.dispX) * lerp;
        h.dispY += (slot.ty - h.dispY) * lerp;
        h.dispW += (slot.tw - h.dispW) * lerp;
        h.dispH += (slot.th - h.dispH) * lerp;
      }
    }

    // Draw using smoothed dims.
    for (const slot of slots) {
      const { h, ax, ay, lines, lineH, op } = slot;
      const pillW = h.dispW;
      const pillH = h.dispH;
      const pillX = h.dispX;
      const pillY = h.dispY;
      const pillCx = pillX + pillW / 2;
      const pillTop = pillY - pillH / 2;
      const pillBottom = pillY + pillH / 2;

      const elbowR = Math.max(6 * s, 8);
      ctx.strokeStyle = `rgba(255,255,255,${op})`;
      ctx.lineWidth = borderW;
      // Vertical-first orthogonal routing with rounded elbows at every turn.
      if (ay >= pillBottom) {
        const anchorTop = ay - anchorOuterR;
        strokeRoundedPolyline(
          ctx,
          [
            { x: pillCx, y: pillBottom },
            { x: pillCx, y: anchorTop },
            { x: ax, y: anchorTop },
          ],
          elbowR,
        );
      } else if (ay <= pillTop) {
        const anchorBottom = ay + anchorOuterR;
        strokeRoundedPolyline(
          ctx,
          [
            { x: pillCx, y: pillTop },
            { x: pillCx, y: anchorBottom },
            { x: ax, y: anchorBottom },
          ],
          elbowR,
        );
      } else {
        const exitY = pillBottom + anchorGap;
        const anchorEdge = exitY >= ay ? ay + anchorOuterR : ay - anchorOuterR;
        strokeRoundedPolyline(
          ctx,
          [
            { x: pillCx, y: pillBottom },
            { x: pillCx, y: exitY },
            { x: ax, y: exitY },
            { x: ax, y: anchorEdge },
          ],
          elbowR,
        );
      }

      ctx.beginPath();
      ctx.arc(ax, ay, anchorOuterR, 0, TAU);
      ctx.strokeStyle = `rgba(255,255,255,${op})`;
      ctx.lineWidth = borderW;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ax, ay, anchorInnerR, 0, TAU);
      ctx.fillStyle = `rgba(255,255,255,${op})`;
      ctx.fill();

      const r = Math.min(pillH / 2, cornerCap);
      const pillPath = (): void => {
        ctx.beginPath();
        ctx.moveTo(pillX + r, pillTop);
        ctx.lineTo(pillX + pillW - r, pillTop);
        ctx.arcTo(pillX + pillW, pillTop, pillX + pillW, pillTop + r, r);
        ctx.lineTo(pillX + pillW, pillBottom - r);
        ctx.arcTo(pillX + pillW, pillBottom, pillX + pillW - r, pillBottom, r);
        ctx.lineTo(pillX + r, pillBottom);
        ctx.arcTo(pillX, pillBottom, pillX, pillBottom - r, r);
        ctx.lineTo(pillX, pillTop + r);
        ctx.arcTo(pillX, pillTop, pillX + r, pillTop, r);
        ctx.closePath();
      };

      pillPath();
      ctx.fillStyle = `rgba(0,0,0,${op})`;
      ctx.fill();

      pillPath();
      ctx.strokeStyle = `rgba(217,217,217,${0.10 * op})`;
      ctx.lineWidth = borderW;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pillX + r, pillBottom);
      ctx.lineTo(pillX + pillW - r, pillBottom);
      ctx.strokeStyle = `rgba(217,217,217,${0.12 * op})`;
      ctx.lineWidth = Math.max(borderW * 2, 2 * s);
      ctx.stroke();

      ctx.fillStyle = `rgba(255,255,255,${op})`;
      ctx.textAlign = "center";
      for (let k = 0; k < lines.length; k++) {
        ctx.fillText(lines[k]!, pillCx, pillTop + padY + lineH * (k + 0.5));
      }
      ctx.textAlign = "left";
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  endFrame(): void {
    /* no-op for Canvas2D */
  }
}
