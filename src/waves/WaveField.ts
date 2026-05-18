import { type Strand, createStrand, resetStrand } from "../entities/Strand.js";
import { ObjectPool } from "../entities/pool.js";
import { STRAND_CAP, type Params } from "../config.js";
import { mulberry32 } from "../util/math.js";
import { STRUCTURES } from "./structures.js";

const MOODS = [
  { speed: 0.7, amp: 0.9 },
  { speed: 1.0, amp: 1.0 },
  { speed: 1.6, amp: 1.15 },
];
const SPRING_K = 24;
const SPRING_D = 2 * Math.sqrt(SPRING_K);

export interface WaveLayer {
  index: number;
  primary: boolean;
  count: number;
  /** Index of the parent wave row [0, p.waves); shared between primary and its secondary. */
  waveRow: number;
  /** Position [0,1] within the wave stack; resolved against fieldOffsetY + waveSpacing each frame. */
  rowT: number;
  freq: number;
  phaseOffset: number;
  lengthFactor: number;
  widthFactor: number;
  alphaFactor: number;
  ampScale: number;
}

export class WaveField {
  readonly pool: ObjectPool<Strand>;
  /**
   * Invoked after strand horizontal positions update and before vertical wave motion.
   * Used to snap connection L-shapes to new `strand.x` first, reducing perpendicular
   * crossings with the vertical wave motion that follows.
   */
  afterHorizontal: (() => void) | null = null;
  private width = 0;
  private height = 0;
  private phase = 0;
  private layers: WaveLayer[] = [];
  private rng = mulberry32(0xfaded);
  private intentX = 0.5;
  private intentY = 0.5;
  private intentTX = 0.5;
  private intentTY = 0.5;
  private intentTimer = 0;
  private mood = 1;
  private moodTimer = 0;

  constructor() {
    this.pool = new ObjectPool<Strand>(createStrand, resetStrand, STRAND_CAP);
  }

  /** Apply a one-shot vertical impulse to a strand; consumed next frame when reactive is on. */
  kick(s: Strand, amount: number): void {
    s.kick += amount;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  rebuild(p: Params): void {
    this.layers = [];
    let layerIdx = 0;
    for (let i = 0; i < p.waves; i++) {
      const t = p.waves <= 1 ? 0.5 : i / (p.waves - 1);
      this.layers.push({
        index: layerIdx++,
        primary: true,
        count: p.strandsPerWave,
        waveRow: i,
        rowT: t,
        freq: 0.6 + t * 0.4,
        phaseOffset: i * 0.7,
        lengthFactor: 1 - t * 0.06,
        widthFactor: 1,
        alphaFactor: 1,
        ampScale: 1 - t * 0.18,
      });
      if (p.secondaryScale > 0.01 && p.secondaryDensity > 0.01) {
        this.layers.push({
          index: layerIdx++,
          primary: false,
          count: Math.max(1, Math.round(p.strandsPerWave * p.secondaryDensity)),
          waveRow: i,
          rowT: t + 0.04,
          freq: 1.4 + t * 0.6,
          phaseOffset: i * 0.7 + 0.4,
          lengthFactor: 0.7 - t * 0.05,
          widthFactor: 0.65,
          alphaFactor: 0.55,
          ampScale: (1 - t * 0.18) * p.secondaryScale,
        });
      }
    }
    this.allocateStrands();
  }

  private allocateStrands(): void {
    this.pool.releaseAll();
    let used = 0;
    const total = this.layers.reduce((s, l) => s + l.count, 0);
    if (total === 0) return;
    const cap = Math.min(STRAND_CAP, total);
    const seed = mulberry32(0xa11ce);
    for (const layer of this.layers) {
      const share = Math.round((layer.count / total) * cap);
      const n = Math.min(share, cap - used);
      for (let i = 0; i < n; i++) {
        const s = this.pool.acquire();
        if (!s) return;
        s.waveIndex = layer.index;
        s.waveRow = layer.waveRow;
        s.primary = layer.primary;
        s.alpha = layer.alphaFactor;
        s.width = layer.widthFactor;
        s.lengthJitter = (seed() - 0.5) * 2;
        s.colorJitter = (seed() - 0.5) * 2;
        s.alphaJitter = (seed() - 0.5) * 2;
        s.hue = i / Math.max(1, n - 1);
        s.x = i / Math.max(1, n - 1);
      }
      used += n;
    }
  }

  step(dt: number, p: Params): void {
    const b = p.behaviors;

    if (b.mood) {
      this.moodTimer -= dt;
      if (this.moodTimer <= 0) {
        this.mood = Math.floor(this.rng() * MOODS.length);
        this.moodTimer = 30 + this.rng() * 60;
      }
    }
    const moodSpeed = b.mood ? MOODS[this.mood]!.speed : 1;
    const moodAmp = b.mood ? MOODS[this.mood]!.amp : 1;

    this.phase += dt * p.phaseSpeed * p.speedMultiplier * moodSpeed;

    if (b.intent) {
      this.intentTimer -= dt;
      if (this.intentTimer <= 0) {
        this.intentTX = this.rng();
        this.intentTY = 0.3 + this.rng() * 0.5;
        this.intentTimer = 6 + this.rng() * 8;
      }
      this.intentX += (this.intentTX - this.intentX) * dt * 0.4;
      this.intentY += (this.intentTY - this.intentY) * dt * 0.4;
    }

    const breatheF = b.breathe
      ? 1 + 0.18 * (0.6 * Math.sin(this.phase * 0.31) + 0.4 * Math.sin(this.phase * 0.502))
      : 1;
    const breatheA = b.breathe ? 1 + 0.12 * Math.sin(this.phase * 0.21) : 1;

    const layers = this.layers;
    const strands = this.pool.getActive();
    const layerCounts: number[] = new Array(layers.length).fill(0);
    for (const s of strands) layerCounts[s.waveIndex]!++;

    const sampler = STRUCTURES[p.waveStructure] ?? STRUCTURES.wave;
    sampler({
      strands,
      layers,
      layerCounts,
      p,
      phase: this.phase,
      width: this.width,
      height: this.height,
      intentX: this.intentX,
      intentY: this.intentY,
      intentOn: b.intent,
      breatheF,
      breatheA,
      moodAmp,
    });

    for (const s of strands) {
      if (b.reactive) s.vy += s.kick;
      s.kick = 0;
      s.age += dt;
    }

    this.afterHorizontal?.();

    for (const s of strands) {
      const layer = layers[s.waveIndex];
      if (!layer) continue;
      const targetY = s.waveTargetY;
      if (b.spring) {
        s.vy += (SPRING_K * (targetY - s.y0) - SPRING_D * s.vy) * dt;
        s.y0 += s.vy * dt;
      } else {
        s.y0 = targetY;
        s.vy = 0;
      }
    }

    if (b.couple) {
      const byLayer = new Map<number, Strand[]>();
      for (const s of strands) {
        const arr = byLayer.get(s.waveIndex);
        if (arr) arr.push(s);
        else byLayer.set(s.waveIndex, [s]);
      }
      for (const row of byLayer.values()) {
        if (row.length < 3) continue;
        row.sort((a, b) => a.x - b.x);
        for (let i = 1; i < row.length - 1; i++) {
          row[i]!.y0 = row[i]!.y0 * 0.7 + (row[i - 1]!.y0 + row[i + 1]!.y0) * 0.15;
        }
      }
    }
  }
}
