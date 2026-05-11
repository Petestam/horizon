import { type Strand, createStrand, resetStrand } from "../entities/Strand.js";
import { ObjectPool } from "../entities/pool.js";
import { STRAND_CAP, type Params } from "../config.js";
import { mulberry32 } from "../util/math.js";
import { sampleArc } from "./curves.js";

interface WaveLayer {
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
  private width = 0;
  private height = 0;
  private phase = 0;
  private layers: WaveLayer[] = [];

  constructor() {
    this.pool = new ObjectPool<Strand>(createStrand, resetStrand, STRAND_CAP);
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
    this.phase += dt * p.phaseSpeed * p.speedMultiplier;
    const layers = this.layers;
    const strands = this.pool.getActive();
    const layerCounts: number[] = new Array(layers.length).fill(0);
    for (const s of strands) layerCounts[s.waveIndex]!++;
    const layerSeen: number[] = new Array(layers.length).fill(0);
    const span = p.waveSpacing * Math.max(0, p.waves - 1);
    for (const s of strands) {
      const layer = layers[s.waveIndex];
      if (!layer) continue;
      const n = layerCounts[s.waveIndex]!;
      const seen = layerSeen[s.waveIndex]!++;
      const t = n <= 1 ? 0.5 : seen / (n - 1);
      const ampMul = p.waveAmps[layer.waveRow] ?? 1;
      const lenMul = p.waveLengths[layer.waveRow] ?? 1;
      const sample = sampleArc({
        t,
        phase: this.phase + layer.phaseOffset,
        freq: layer.freq / Math.max(0.12, lenMul),
        amplitude: p.amplitude * layer.ampScale * ampMul,
        centerY: p.fieldOffsetY + layer.rowT * span,
        width: this.width,
        height: this.height,
      });
      s.x = sample.x;
      s.y0 = sample.y;
      s.hue = t;
      s.width = p.strokeWidth * layer.widthFactor;
      s.alpha = layer.alphaFactor;
      s.length = (p.strandLength + s.lengthJitter * p.strandLengthJitter) * layer.lengthFactor;
      s.age += dt;
    }
  }
}
