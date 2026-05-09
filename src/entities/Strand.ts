export class Strand {
  x = 0;
  y0 = 0;
  length = 0;
  /** Stable [-1,1] jitter, applied against current p.strandLengthJitter at draw time. */
  lengthJitter = 0;
  /** Stable [-1,1] color-stop offset jitter, scaled by p.gradientJitter at draw time. */
  colorJitter = 0;
  /** Stable [-1,1] alpha jitter, scaled by p.gradientJitter * 0.5 at draw time. */
  alphaJitter = 0;
  width = 1;
  alpha = 1;
  hue = 0;
  primary = true;
  waveIndex = 0;
  age = 0;
  highlighted = false;

  reset(): void {
    this.x = 0;
    this.y0 = 0;
    this.length = 0;
    this.lengthJitter = 0;
    this.colorJitter = 0;
    this.alphaJitter = 0;
    this.width = 1;
    this.alpha = 1;
    this.hue = 0;
    this.primary = true;
    this.waveIndex = 0;
    this.age = 0;
    this.highlighted = false;
  }
}

export const createStrand = (): Strand => new Strand();
export const resetStrand = (s: Strand): void => s.reset();
