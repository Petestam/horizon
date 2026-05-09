import { TAU } from "../util/math.js";

export interface ArcSample {
  x: number;
  y: number;
}

export interface ArcParams {
  /** Normalized x position [0,1] across the field. */
  t: number;
  /** Phase in radians, advanced by time. */
  phase: number;
  /** Spatial frequency multiplier. */
  freq: number;
  /** Vertical amplitude as fraction of canvas height. */
  amplitude: number;
  /** Vertical center as fraction of canvas height. */
  centerY: number;
  /** Canvas dimensions in CSS pixels. */
  width: number;
  height: number;
}

/**
 * Sample an arc that opens downward — a low-frequency cosine envelope shaped
 * by a wider Gaussian-like falloff at the edges to evoke the bell-curve seen
 * in the reference image.
 */
export const sampleArc = (p: ArcParams): ArcSample => {
  const x = p.t * p.width;
  const env = Math.cos((p.t - 0.5) * Math.PI); // 1 at center, 0 at edges
  const wobble = Math.sin(p.t * TAU * p.freq + p.phase);
  const y = p.centerY * p.height - env * p.amplitude * p.height + wobble * p.amplitude * p.height * 0.18;
  return { x, y };
};
