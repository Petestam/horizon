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
  /** Logical wave row (0..p.waves), shared between primary + secondary layers. */
  waveRow = 0;
  age = 0;
  highlighted = false;
  /** Spring velocity in px/s; only meaningful when behaviors.spring is on. */
  vy = 0;
  /** One-shot impulse (px/s) from towers or labels; consumed each frame when behaviors.reactive is on. */
  kick = 0;
  /**
   * Wave sample Y target for this frame; written during horizontal wave motion, consumed
   * when applying vertical motion so L-connections can sync geometry in between.
   */
  waveTargetY = 0;

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
    this.waveRow = 0;
    this.age = 0;
    this.highlighted = false;
    this.vy = 0;
    this.kick = 0;
    this.waveTargetY = 0;
  }
}

export const createStrand = (): Strand => new Strand();
export const resetStrand = (s: Strand): void => s.reset();
