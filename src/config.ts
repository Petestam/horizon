export interface GradientStop {
  /** Hex color string, e.g. "#dfe9ff". */
  color: string;
  /** Per-stop alpha [0,1]. */
  alpha: number;
  /** Position along the gradient [0,1]. */
  offset: number;
}

export const MAX_WAVES = 6;
export const KIOSK_COUNT = 3;

/**
 * Spread active wave indices across kiosks. Uses `waveCount` (not MAX_WAVES) so
 * when only 4 waves run, the right kiosk still gets a domain (waves 0–3).
 */
export const defaultKioskAssignments = (waveCount = MAX_WAVES): number[] => {
  const n = Math.max(1, Math.min(MAX_WAVES, Math.round(waveCount)));
  return Array.from({ length: MAX_WAVES }, (_, i) =>
    i < n ? Math.min(KIOSK_COUNT - 1, Math.floor((i * KIOSK_COUNT) / n)) : 0,
  );
};

/** Rebalance when fewer waves than kiosks left some towers with no assigned domain. */
export const ensureKioskAssignmentCoverage = (p: Params): void => {
  const n = Math.max(1, Math.min(MAX_WAVES, p.waves));
  const covered = new Set<number>();
  for (let w = 0; w < n; w++) covered.add(p.kioskAssignments[w] ?? 0);
  if (covered.size >= KIOSK_COUNT) return;
  const balanced = defaultKioskAssignments(n);
  for (let w = 0; w < MAX_WAVES; w++) p.kioskAssignments[w] = balanced[w]!;
};

export interface LightSource {
  enabled: boolean;
  /** Hex color of the light. */
  color: string;
  /** Peak alpha at the source [0,1]. */
  intensity: number;
  /** Outer reach of the light, multiples of canvas height. */
  distance: number;
  /** Horizontal vs vertical scale (1 = circular, >1 = wider, <1 = narrower). */
  spread: number;
  /** Curve shape: higher = sharper drop near the source, smoother trail. */
  falloff: number;
  /** Pushes the source center below the canvas to soften the visible arc [0,1]. */
  diffusion: number;
}

/**
 * Field topology. Each entry sets strand positions/styles a different way; the
 * existing connection/phase machinery rides whatever positions the structure
 * writes, so towers and pulses keep working across all of them.
 *
 * - `wave`      classic stack of sine-arc rows (default; sampleArc)
 * - `parallax`  two depth volumes drifting horizontally with heavy easing
 * - `expanding` lattice that breathes outward + concentric brightness rings
 * - `tensor`    lattice deformed by drifting attractor / repeller pins
 * - `grow`      branches fan from bottom seeds, tips ride growth t→1
 * - `walls`     vertical light walls, one wall "lit" at a time, rotating
 */
export type WaveStructure = "wave" | "parallax" | "expanding" | "tensor" | "grow" | "walls";

export const WAVE_STRUCTURES: readonly WaveStructure[] = [
  "wave",
  "parallax",
  "expanding",
  "tensor",
  "grow",
  "walls",
];

export interface BehaviorFlags {
  /** Per-strand spring memory: y0 lags then settles toward sampled target. */
  spring: boolean;
  /** 1-D smoothing along each row so disturbances travel between neighbors. */
  couple: boolean;
  /** Drifting attention point that gently tugs the field where it "looks". */
  intent: boolean;
  /** Tower fires + label spawns push an upward impulse into the target strand. */
  reactive: boolean;
  /** Irrational-ratio sine stack modulates freq + amplitude so motion never exactly repeats. */
  breathe: boolean;
  /** Slow FSM (calm/curious/alert) scaling phase speed + amplitude. */
  mood: boolean;
}

export interface Params {
  /** Active field structure. Connection/phase rules layer on top of all of them. */
  waveStructure: WaveStructure;
  waves: number;
  /** Per-wave amplitude multiplier; length is MAX_WAVES, indices >= waves ignored. Negatives invert the arc. */
  waveAmps: number[];
  /** Per-wave wavelength multiplier; length is MAX_WAVES. 1 = default row; higher = longer waves (lower spatial frequency). */
  waveLengths: number[];
  /** Per-wave horizontal direction; length is MAX_WAVES. -1 reverse, 0 still, 1 forward. */
  waveDirs: number[];
  /** Per-wave kiosk assignment [0..KIOSK_COUNT). Drives unify-pulse routing and alert targeting. */
  kioskAssignments: number[];
  strandsPerWave: number;
  amplitude: number;
  phaseSpeed: number;
  waveSpacing: number;
  fieldOffsetY: number;
  secondaryScale: number;
  /** Secondary strand count multiplier vs `strandsPerWave` [0, 4]. */
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
  /** Copy shown on label pills (test button + synthetic kiosk events). Realtime/socket events still send their own text. */
  labelText: string;
  /**
   * Scales kiosk/demo callouts to match [Figma callout specs](node 389:2041 CLUS26 CPA)
   * at a 1920px-wide stage reference (typography, padding, anchor, stroke).
   */
  alertScale: number;
  towersEnabled: boolean;
  /** Mean seconds between connection spawns across the 3 towers. */
  towerSpawnInterval: number;
  /** Seconds for the gradient comet to travel origin → endpoint. */
  towerPulseDur: number;
  /** Seconds for one comet lap along the path during the chase phase. */
  towerChasePeriod: number;
  /**
   * How far a tower may reach into a neighboring kiosk's domain when picking
   * a target strand. 0 = each tower is restricted to its own Voronoi cell;
   * 1 = any strand on the canvas is reachable. Interpolated linearly per side
   * so outer towers correctly extend to the canvas edge at reach = 1.
   */
  towerReach: number;
  /** Line width of the static connection L-shape. */
  towerStrokeWidth: number;
  /** Core thickness of the moving pulse snake; glow is layered around it. */
  towerPulseWidth: number;
  /** Snake length as a fraction of the connection path [0,1]. */
  towerPulseTailLen: number;
  /** Outer feathered glow intensity; 0 = bare core, 1+ = strong emit. */
  towerPulseGlow: number;
  /** Extra snake instances ahead of the primary head (1 = one follower in front). */
  towerPulseLead: number;
  /** Extra snake instances behind the primary tail. */
  towerPulseTrail: number;
  /** Distance between consecutive snake instances, as a fraction of the path. */
  towerPulseSpacing: number;
  /** Number of parallel lanes (1,3,5,7); lanes are offset perpendicular to the path. */
  towerPulseLanes: number;
  /** Pixel offset between adjacent lanes. */
  towerPulseLaneSpacing: number;
  /** Hold beat between extend wrap and the first telemetry burst — "handshake established". */
  towerBondDur: number;
  /** Inbound telemetry burst duration during investigate. Gap silence = chasePeriod - this. */
  towerBurstDur: number;
  /** Slow unify pulse duration (kiosk press → orb). */
  unifyPulseDur: number;
  /** Radius (px) of the shimmer wave radiating from a resolved connection endpoint. */
  shimmerRadius: number;
  /** Strength of the resolve-shimmer brightening across nearby strand strokes + endpoints. */
  shimmerIntensity: number;
  /** When true, render a small phase pill below each control tower (debug aid). */
  phasePillsEnabled: boolean;
  /**
   * Circular radius of the origin dot grid in units of dot diameter (default 50).
   * Grows with unify level up to this × dot ø from the orb center.
   */
  originGlowExtentDots: number;
  /** XY grid cell spacing as a multiple of dot diameter. */
  originGlowGridStep: number;
  /** Radius of each dot in the origin grid (px); kept small. */
  originGlowDotSize: number;
  /** Peak dot alpha at the inner ring (falls off to transparent at the edge). */
  originGlowStrength: number;
  /** When true, cisco-tinted agent sprites orbit inside a unified kiosk orb halo. */
  orbAgentsEnabled: boolean;
  /** Scale for agent diamond + glow footprint (1 = default). */
  orbAgentsSize: number;
  /** Multiplier for sprite opacity (1 = default). */
  orbAgentsBrightness: number;
  /** Bloom radius and halo intensity vs core (1 = default). */
  orbAgentsGlow: number;
  /**
   * When true, loop Unify → Alert → Investigate → Resolve → Automate per kiosk
   * without operator input (suppresses random kiosk-mock labels).
   */
  ambientDemo: boolean;
  /** Opt-in agentic behaviors; defaults are all off so the baseline is unchanged. */
  behaviors: BehaviorFlags;
  /** Bottom-anchored radial lights painted over the bg, in array order. */
  lightSources: LightSource[];
  /** Slow left–right drift for background lights; 0 = static, 10 = faster sweep. */
  lightDriftSpeed: number;
}

export const MIN_GRADIENT_STOPS = 4;

export const STRAND_CAP = 600;
export const HIGHLIGHT_CAP = 12;

export const defaults: Params = {
  waveStructure: "wave",
  waves: 4,
  waveAmps: new Array(MAX_WAVES).fill(1),
  waveLengths: new Array(MAX_WAVES).fill(1),
  waveDirs: new Array(MAX_WAVES).fill(1),
  kioskAssignments: defaultKioskAssignments(4),
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
  labelText: "test · operator",
  alertScale: 1,
  towersEnabled: true,
  towerSpawnInterval: 1.2,
  towerPulseDur: 2.5,
  towerChasePeriod: 4.0,
  towerReach: 1,
  towerStrokeWidth: 1,
  towerPulseWidth: 1.4,
  towerPulseTailLen: 0.14,
  towerPulseGlow: 0.7,
  towerPulseLead: 0,
  towerPulseTrail: 0,
  towerPulseSpacing: 0.2,
  towerPulseLanes: 1,
  towerPulseLaneSpacing: 6,
  towerBondDur: 0.7,
  towerBurstDur: 0.65,
  unifyPulseDur: 3.0,
  shimmerRadius: 140,
  shimmerIntensity: 0.7,
  phasePillsEnabled: true,
  originGlowExtentDots: 80,
  originGlowGridStep: 10,
  originGlowDotSize: 0.5,
  originGlowStrength: 1.5,
  orbAgentsEnabled: true,
  orbAgentsSize: 1,
  orbAgentsBrightness: 1,
  orbAgentsGlow: 1,
  ambientDemo: true,
  behaviors: {
    spring: false,
    couple: false,
    intent: false,
    reactive: false,
    breathe: false,
    mood: false,
  },
  lightSources: [
    {
      enabled: true,
      color: "#1e3a8a",
      intensity: 0.7,
      distance: 1.4,
      spread: 1.7,
      falloff: 1.6,
      diffusion: 0.3,
    },
    {
      enabled: true,
      color: "#1d4ed8",
      intensity: 0.45,
      distance: 0.95,
      spread: 1.5,
      falloff: 1.9,
      diffusion: 0.18,
    },
    {
      enabled: true,
      color: "#1ba0d7",
      intensity: 0.28,
      distance: 0.6,
      spread: 1.3,
      falloff: 2.5,
      diffusion: 0.08,
    },
    {
      enabled: true,
      color: "#6ecedb",
      intensity: 0.18,
      distance: 0.35,
      spread: 1.1,
      falloff: 3,
      diffusion: 0.02,
    },
  ],
  lightDriftSpeed: 6,
};

/**
 * Clamp JSON / partial merges into exactly `defaults.lightSources.length`
 * slots so older saved presets cannot shrink the tuner or renderer.
 */
export function normalizedLightSources(stored?: readonly unknown[] | null): LightSource[] {
  const n = (v: unknown, fb: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fb);
  return defaults.lightSources.map((def, i) => {
    const raw = stored?.[i];
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {
      enabled: typeof o.enabled === "boolean" ? o.enabled : def.enabled,
      color: typeof o.color === "string" ? o.color : def.color,
      intensity: Math.min(1, Math.max(0, n(o.intensity, def.intensity))),
      distance: Math.min(3, Math.max(0, n(o.distance, def.distance))),
      spread: Math.min(4, Math.max(0.2, n(o.spread, def.spread))),
      falloff: Math.min(8, Math.max(0.3, n(o.falloff, def.falloff))),
      diffusion: Math.min(1, Math.max(0, n(o.diffusion, def.diffusion))),
    };
  });
}
