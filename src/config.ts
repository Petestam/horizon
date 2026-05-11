export interface GradientStop {
  /** Hex color string, e.g. "#dfe9ff". */
  color: string;
  /** Per-stop alpha [0,1]. */
  alpha: number;
  /** Position along the gradient [0,1]. */
  offset: number;
}

export const MAX_WAVES = 6;

export interface Params {
  waves: number;
  /** Per-wave amplitude multiplier; length is MAX_WAVES, indices >= waves ignored. Negatives invert the arc. */
  waveAmps: number[];
  /** Per-wave wavelength multiplier; length is MAX_WAVES. 1 = default row; higher = longer waves (lower spatial frequency). */
  waveLengths: number[];
  strandsPerWave: number;
  amplitude: number;
  phaseSpeed: number;
  waveSpacing: number;
  fieldOffsetY: number;
  secondaryScale: number;
  secondaryDensity: number;
  endpointRadius: number;
  strokeWidth: number;
  strandLength: number;
  strandLengthJitter: number;
  gradientJitter: number;
  speedMultiplier: number;
  alphaMultiplier: number;
  vignetteIntensity: number;
  pulseBandY: number;
  pulseBandHeight: number;
  gradient: GradientStop[];
  bgColor: string;
  labelsEnabled: boolean;
}

export const MIN_GRADIENT_STOPS = 4;

export const STRAND_CAP = 600;
export const HIGHLIGHT_CAP = 6;

export const defaults: Params = {
  waves: 4,
  waveAmps: new Array(MAX_WAVES).fill(1),
  waveLengths: new Array(MAX_WAVES).fill(1),
  strandsPerWave: 90,
  amplitude: 0.18,
  phaseSpeed: 0.05,
  waveSpacing: 0.07,
  fieldOffsetY: 0.18,
  secondaryScale: 0.55,
  secondaryDensity: 0.7,
  endpointRadius: 1.5,
  strokeWidth: 1,
  strandLength: 0.78,
  strandLengthJitter: 0.06,
  gradientJitter: 0.08,
  speedMultiplier: 1,
  alphaMultiplier: 0.45,
  vignetteIntensity: 0.65,
  pulseBandY: 0.46,
  pulseBandHeight: 0.04,
  gradient: [
    { color: "#dfe9ff", alpha: 0.95, offset: 0 },
    { color: "#7e6ed8", alpha: 0.85, offset: 0.35 },
    { color: "#5a4cc2", alpha: 0.85, offset: 0.7 },
    { color: "#ff7a3a", alpha: 1, offset: 1 },
  ],
  bgColor: "#000000",
  labelsEnabled: true,
};
