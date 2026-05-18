import type { Params, WaveStructure } from "../config.js";
import type { Strand } from "../entities/Strand.js";
import type { WaveLayer } from "./WaveField.js";
import { TAU } from "../util/math.js";
import { sampleArc } from "./curves.js";

/**
 * Per-frame context handed to every {@link WaveStructure} sampler. Each sampler
 * writes `strand.x`, `strand.waveTargetY`, `strand.width`, `strand.alpha`,
 * `strand.length`, and `strand.hue`. Connection / phase / pulse machinery rides
 * whatever positions a structure produces — the only contract a structure must
 * honour is leaving each strand at a sensible canvas-space point that towers
 * can latch onto.
 */
export interface StructureCtx {
  strands: readonly Strand[];
  layers: readonly WaveLayer[];
  /** Active strand count per layer (cached so structures don't re-scan). */
  layerCounts: readonly number[];
  p: Params;
  /** Accumulated phase in radians (already advanced by phaseSpeed/mood). */
  phase: number;
  width: number;
  height: number;
  intentX: number;
  intentY: number;
  intentOn: boolean;
  breatheF: number;
  breatheA: number;
  moodAmp: number;
}

const easeIO01 = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Stable [0,1) hash from an integer index — golden-ratio low-discrepancy sequence. */
const phi = (i: number): number => (i * 0.6180339887498949) % 1;

/** Apply the shared per-strand style (width / alpha / length) baseline. */
const styleBaseline = (s: Strand, p: Params, layer: WaveLayer): void => {
  s.width = p.strokeWidth * layer.widthFactor;
  s.alpha = layer.alphaFactor;
  s.length = (p.strandLength + s.lengthJitter * p.strandLengthJitter) * layer.lengthFactor;
};

/**
 * Walk active strands; resolve `(s, layer, t, seen, idx)` per call. `t` is the
 * normalized seen-index within the strand's wave layer; `idx` is the global
 * iteration index across all strands.
 */
const eachStrand = (
  ctx: StructureCtx,
  fn: (s: Strand, layer: WaveLayer, info: { t: number; seen: number; idx: number; n: number }) => void,
): void => {
  const { strands, layers, layerCounts } = ctx;
  const seen = new Array(layers.length).fill(0);
  let idx = 0;
  for (const s of strands) {
    const layer = layers[s.waveIndex];
    if (!layer) continue;
    const n = layerCounts[s.waveIndex]!;
    const i = seen[s.waveIndex]++;
    const t = n <= 1 ? 0.5 : i / (n - 1);
    fn(s, layer, { t, seen: i, idx, n });
    idx++;
  }
};

/** Center Y around the configured field offset / wave-stack midpoint. */
const fieldCenterY = (p: Params, height: number): number =>
  (1 - p.fieldOffsetY - p.waveSpacing * Math.max(0, p.waves - 1) * 0.5) * height;

const wave = (ctx: StructureCtx): void => {
  const { p, phase, width, height, intentX, intentOn, breatheF, breatheA, moodAmp } = ctx;
  const span = p.waveSpacing * Math.max(0, p.waves - 1);
  const wRecip = width > 0 ? 1 / width : 0;
  eachStrand(ctx, (s, layer, { t }) => {
    const ampMul = p.waveAmps[layer.waveRow] ?? 1;
    const lenMul = p.waveLengths[layer.waveRow] ?? 1;
    const dirMul = p.waveDirs[layer.waveRow] ?? 1;
    const sample = sampleArc({
      t,
      phase: phase * dirMul + layer.phaseOffset,
      freq: (layer.freq * breatheF) / Math.max(0.12, lenMul),
      amplitude: p.amplitude * layer.ampScale * ampMul * breatheA * moodAmp,
      centerY: p.fieldOffsetY + layer.rowT * span,
      width,
      height,
    });
    let y = sample.y;
    if (intentOn) {
      const dx = sample.x * wRecip - intentX;
      y -= Math.exp(-(dx * dx) / 0.03) * 20;
    }
    s.x = sample.x;
    s.waveTargetY = y;
    s.hue = t;
    styleBaseline(s, p, layer);
  });
};

/**
 * Two-volume parallax: primary strands are the "near" plane, secondary the
 * "far". Both volumes wrap horizontally; near drifts faster and lives in a
 * brighter band. Phase is fed through a slow sine envelope to add "major
 * easing" — the field never travels at a constant rate.
 */
const parallax = (ctx: StructureCtx): void => {
  const { p, phase, width, height, moodAmp } = ctx;
  const eased = phase + 1.4 * Math.sin(phase * 0.32);
  const ampF = p.amplitude * height * ctx.breatheA * moodAmp;
  eachStrand(ctx, (s, layer, { t, seen }) => {
    const near = layer.primary;
    const speed = near ? 0.22 : 0.07;
    const xT = (t + eased * speed) % 1;
    const yT = phi(seen + layer.waveRow * 137);
    const band = near ? { c: 0.42, h: 0.5 } : { c: 0.55, h: 0.34 };
    const wobble = Math.sin(t * TAU * 1.4 + phase * (near ? 0.55 : 0.21)) * (near ? 0.22 : 0.1);
    s.x = ((xT + 1) % 1) * width;
    s.waveTargetY = (band.c + (yT - 0.5) * band.h) * height + wobble * ampF;
    s.hue = t;
    styleBaseline(s, p, layer);
    s.alpha = layer.alphaFactor * (near ? 1 : 0.5);
    s.length *= near ? 1 : 0.65;
    s.width *= near ? 1 : 0.8;
  });
};

/** Square-ish (cols × rows) lattice sized to fit the active strand count. */
const lattice = (total: number, width: number, height: number): { cols: number; rows: number } => {
  if (total <= 0) return { cols: 1, rows: 1 };
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const cols = Math.max(2, Math.round(Math.sqrt(total * aspect)));
  const rows = Math.max(2, Math.ceil(total / cols));
  return { cols, rows };
};

/**
 * Lattice that breathes outward + inward; concentric rings of brightness
 * radiate from the center each cycle so the grid reads as a pulsing field.
 */
const expanding = (ctx: StructureCtx): void => {
  const { strands, p, phase, width, height, moodAmp } = ctx;
  const { cols, rows } = lattice(strands.length, width, height);
  const breathe = 0.7 + 0.3 * easeIO01((Math.sin(phase * 0.55) + 1) * 0.5);
  const dx = ((width * 0.92) / (cols - 1)) * breathe;
  const dy = ((height * 0.6) / (rows - 1)) * breathe;
  const cx = width * 0.5;
  const cy = fieldCenterY(p, height);
  eachStrand(ctx, (s, layer, { idx }) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const rDist = Math.hypot(col - (cols - 1) / 2, row - (rows - 1) / 2);
    const ring = 0.5 + 0.5 * Math.sin(phase * 1.4 - rDist * 0.55);
    s.x = cx + (col - (cols - 1) / 2) * dx;
    s.waveTargetY = cy + (row - (rows - 1) / 2) * dy;
    s.hue = row / Math.max(1, rows - 1);
    styleBaseline(s, p, layer);
    s.alpha = layer.alphaFactor * (0.22 + 0.78 * ring) * moodAmp;
    s.length *= 0.55 + 0.45 * ring;
  });
};

/**
 * Tensile lattice: three slow-drifting anchors pull (or push) nearby grid
 * nodes via Gaussian falloff, so the surface stretches like a tensor field
 * sampled at the strand positions.
 */
const tensor = (ctx: StructureCtx): void => {
  const { strands, p, phase, width, height, moodAmp } = ctx;
  const { cols, rows } = lattice(strands.length, width, height);
  const dx = (width * 0.92) / (cols - 1);
  const dy = (height * 0.7) / (rows - 1);
  const cx = width * 0.5;
  const cy = fieldCenterY(p, height);
  const sigma2 = (width * 0.24) ** 2;
  const anchors = [
    { x: cx + Math.cos(phase * 0.31) * width * 0.32, y: cy + Math.sin(phase * 0.27) * height * 0.2, s: 1 },
    { x: cx + Math.cos(phase * 0.21 + 2.1) * width * 0.28, y: cy + Math.sin(phase * 0.39 + 1.2) * height * 0.22, s: -1 },
    { x: cx + Math.cos(phase * 0.43 + 4.3) * width * 0.22, y: cy + Math.sin(phase * 0.19 + 3.6) * height * 0.16, s: 1 },
  ];
  eachStrand(ctx, (s, layer, { idx }) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    let bx = cx + (col - (cols - 1) / 2) * dx;
    let by = cy + (row - (rows - 1) / 2) * dy;
    let pull = 0;
    for (const a of anchors) {
      const ddx = a.x - bx;
      const ddy = a.y - by;
      const w = Math.exp(-(ddx * ddx + ddy * ddy) / sigma2) * a.s * 0.55;
      bx += ddx * w;
      by += ddy * w;
      pull += w;
    }
    s.x = bx;
    s.waveTargetY = by;
    s.hue = row / Math.max(1, rows - 1);
    styleBaseline(s, p, layer);
    s.alpha = layer.alphaFactor * (0.4 + 0.6 * Math.min(1, Math.abs(pull) * 2)) * moodAmp;
  });
};

/**
 * Branches fan up from `p.waves` seeds along the bottom. Each strand owns a
 * stable (seed, branch, depth) slot; phase scrolls depth so the branches
 * appear to grow, with tip-end strands brighter than the trunk.
 */
const grow = (ctx: StructureCtx): void => {
  const { strands, p, phase, width, height, moodAmp } = ctx;
  const seeds = Math.max(1, p.waves);
  const branchesPerSeed = 5;
  const branchLen = height * 0.7;
  const spread = 1.3;
  const slotSize = seeds * branchesPerSeed;
  const perBranch = Math.max(1, Math.ceil(strands.length / slotSize));
  const seedY = height * (1 - p.fieldOffsetY * 0.4);
  eachStrand(ctx, (s, layer, { idx }) => {
    const seedIdx = idx % seeds;
    const branchIdx = Math.floor(idx / seeds) % branchesPerSeed;
    const branchSeen = Math.floor(idx / slotSize);
    const tBase = perBranch <= 1 ? 0.5 : branchSeen / (perBranch - 1);
    const tAnim = ((tBase + phase * 0.05 + seedIdx * 0.13 + branchIdx * 0.07) % 1 + 1) % 1;
    const angle = -Math.PI / 2 + (branchIdx / Math.max(1, branchesPerSeed - 1) - 0.5) * spread;
    const curl = Math.sin(tAnim * Math.PI * 1.4 + phase * 0.4 + seedIdx) * 0.18;
    const dirX = Math.sin(angle + curl);
    const dirY = -Math.cos(angle + curl);
    const dist = tAnim * branchLen;
    s.x = ((seedIdx + 0.5) / seeds) * width + dirX * dist;
    s.waveTargetY = seedY + dirY * dist;
    s.hue = tAnim;
    styleBaseline(s, p, layer);
    const tip = easeIO01(tAnim);
    s.alpha = layer.alphaFactor * (0.2 + 0.8 * tip) * moodAmp;
    s.length *= 0.45 + 0.55 * tip;
    s.width *= 0.75 + 0.4 * tip;
  });
};

/**
 * `p.waves` vertical light walls; strands cluster around each wall's x. A
 * single wall is "lit" at any moment and the lit slot rotates through the
 * stack, giving a slow lighthouse sweep.
 */
const walls = (ctx: StructureCtx): void => {
  const { strands, p, phase, width, height, moodAmp } = ctx;
  const n = Math.max(2, p.waves);
  const spacing = width / (n + 1);
  const wallW = spacing * 0.18;
  const bandY = (1 - p.fieldOffsetY - p.waveSpacing * Math.max(0, p.waves - 1) * 0.3) * height;
  const bandH = height * 0.62;
  const perWall = Math.max(1, Math.ceil(strands.length / n));
  const lit = ((phase * 0.45) % n + n) % n;
  eachStrand(ctx, (s, layer, { idx, seen }) => {
    const wall = idx % n;
    const inWall = Math.floor(idx / n);
    const yT = perWall <= 1 ? 0.5 : inWall / (perWall - 1);
    const jit = phi(seen + wall * 71) - 0.5;
    const dist = Math.min(Math.abs(wall - lit), n - Math.abs(wall - lit));
    const glow = Math.exp(-(dist * dist) / 0.6);
    s.x = spacing * (wall + 1) + jit * wallW;
    s.waveTargetY = bandY + (yT - 0.5) * bandH + Math.sin(phase * 0.6 + wall) * height * 0.02;
    s.hue = yT;
    styleBaseline(s, p, layer);
    s.alpha = layer.alphaFactor * (0.12 + 0.88 * glow) * moodAmp;
    s.length *= 0.85 + 0.15 * glow;
    s.width *= 0.9 + 0.4 * glow;
  });
};

export const STRUCTURES: Record<WaveStructure, (ctx: StructureCtx) => void> = {
  wave,
  parallax,
  expanding,
  tensor,
  grow,
  walls,
};
