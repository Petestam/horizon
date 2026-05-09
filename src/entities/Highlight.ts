import type { Strand } from "./Strand.js";

export class Highlight {
  strand: Strand | null = null;
  label = "";
  age = 0;
  fadeIn = 0.8;
  hold = 4;
  fadeOut = 1.2;
  dead = false;

  reset(): void {
    if (this.strand) this.strand.highlighted = false;
    this.strand = null;
    this.label = "";
    this.age = 0;
    this.fadeIn = 0.8;
    this.hold = 4;
    this.fadeOut = 1.2;
    this.dead = false;
  }

  init(strand: Strand, label: string, ttlMs: number): void {
    this.strand = strand;
    this.label = label;
    this.age = 0;
    this.fadeIn = 0.8;
    this.hold = Math.max(0.5, ttlMs / 1000);
    this.fadeOut = 1.2;
    this.dead = false;
    strand.highlighted = true;
  }

  step(dt: number): void {
    this.age += dt;
    if (this.age >= this.fadeIn + this.hold + this.fadeOut) this.dead = true;
  }

  opacity(): number {
    const { age, fadeIn, hold, fadeOut } = this;
    if (age < fadeIn) return age / fadeIn;
    if (age < fadeIn + hold) return 1;
    const t = (age - fadeIn - hold) / fadeOut;
    return Math.max(0, 1 - t);
  }
}

export const createHighlight = (): Highlight => new Highlight();
export const resetHighlight = (h: Highlight): void => h.reset();
