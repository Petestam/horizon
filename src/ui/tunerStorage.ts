import {
  defaults,
  MAX_WAVES,
  MIN_GRADIENT_STOPS,
  type GradientStop,
  type Params,
} from "../config.js";

const LAST_PARAMS_KEY = "horizon.operator.lastParams";
const NAMED_CONFIGS_KEY = "horizon.operator.namedConfigs";

type NamedConfigsMap = Record<string, Params>;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const isGradientStop = (x: unknown): x is GradientStop => {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.color === "string" && typeof o.alpha === "number" && typeof o.offset === "number";
};

/** Merge stored JSON into a full Params object with safe defaults. */
export function coerceParams(raw: unknown): Params | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const base = {
    ...defaults,
    waveAmps: [...defaults.waveAmps],
    waveLengths: [...defaults.waveLengths],
    gradient: defaults.gradient.map((s) => ({ ...s })),
  };

  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  base.waves = Math.round(clamp(num(o.waves, base.waves), 1, MAX_WAVES));
  base.strandsPerWave = Math.round(clamp(num(o.strandsPerWave, base.strandsPerWave), 20, 140));
  base.amplitude = clamp(num(o.amplitude, base.amplitude), 0.05, 0.4);
  base.phaseSpeed = clamp(num(o.phaseSpeed, base.phaseSpeed), 0, 0.4);
  base.waveSpacing = clamp(num(o.waveSpacing, base.waveSpacing), 0.02, 0.18);
  base.fieldOffsetY = clamp(num(o.fieldOffsetY, base.fieldOffsetY), 0, 0.7);
  base.secondaryScale = clamp(num(o.secondaryScale, base.secondaryScale), 0, 1);
  base.secondaryDensity = clamp(num(o.secondaryDensity, base.secondaryDensity), 0, 1);
  base.endpointRadius = clamp(num(o.endpointRadius, base.endpointRadius), 0.5, 4);
  base.strokeWidth = clamp(num(o.strokeWidth, base.strokeWidth), 0.5, 3);
  base.strandLength = clamp(num(o.strandLength, base.strandLength), 0.3, 1);
  base.strandLengthJitter = clamp(num(o.strandLengthJitter, base.strandLengthJitter), 0, 0.2);
  base.gradientJitter = clamp(num(o.gradientJitter, base.gradientJitter), 0, 0.25);
  base.speedMultiplier = clamp(num(o.speedMultiplier, base.speedMultiplier), 0, 3);
  base.alphaMultiplier = clamp(num(o.alphaMultiplier, base.alphaMultiplier), 0.1, 1);
  base.vignetteIntensity = clamp(num(o.vignetteIntensity, base.vignetteIntensity), 0, 1);
  base.pulseBandY = clamp(num(o.pulseBandY, base.pulseBandY), 0.2, 0.8);
  base.pulseBandHeight = clamp(num(o.pulseBandHeight, base.pulseBandHeight), 0.005, 0.12);
  base.bgColor = typeof o.bgColor === "string" ? o.bgColor : base.bgColor;
  base.labelsEnabled = typeof o.labelsEnabled === "boolean" ? o.labelsEnabled : base.labelsEnabled;

  if (Array.isArray(o.waveAmps)) {
    for (let i = 0; i < MAX_WAVES; i++) {
      const v = o.waveAmps[i];
      base.waveAmps[i] = typeof v === "number" && Number.isFinite(v) ? clamp(v, -1.5, 1.5) : base.waveAmps[i]!;
    }
  }

  if (Array.isArray(o.waveLengths)) {
    for (let i = 0; i < MAX_WAVES; i++) {
      const v = o.waveLengths[i];
      base.waveLengths[i] = typeof v === "number" && Number.isFinite(v) ? clamp(v, 0.12, 4) : base.waveLengths[i]!;
    }
  }

  if (Array.isArray(o.gradient)) {
    const stops = o.gradient.filter(isGradientStop).map((s) => ({
      color: s.color,
      alpha: clamp(s.alpha, 0, 1),
      offset: clamp(s.offset, 0, 1),
    }));
    if (stops.length >= MIN_GRADIENT_STOPS) base.gradient = stops;
  }

  return base;
}

export function loadLastParams(): Params | null {
  try {
    const raw = localStorage.getItem(LAST_PARAMS_KEY);
    if (!raw) return null;
    return coerceParams(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveLastParams(p: Params): void {
  try {
    localStorage.setItem(LAST_PARAMS_KEY, JSON.stringify(p));
  } catch {
    /* quota / private mode */
  }
}

function readNamedMap(): NamedConfigsMap {
  try {
    const raw = localStorage.getItem(NAMED_CONFIGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: NamedConfigsMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const coerced = coerceParams(v);
      if (coerced) out[k] = coerced;
    }
    return out;
  } catch {
    return {};
  }
}

function writeNamedMap(map: NamedConfigsMap): void {
  try {
    localStorage.setItem(NAMED_CONFIGS_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function listNamedConfigs(): string[] {
  return Object.keys(readNamedMap()).sort((a, b) => a.localeCompare(b));
}

export function getNamedConfig(name: string): Params | null {
  const coerced = coerceParams(readNamedMap()[name]);
  return coerced;
}

export function putNamedConfig(name: string, p: Params): void {
  const map = readNamedMap();
  map[name] = {
    ...p,
    waveAmps: [...p.waveAmps],
    waveLengths: [...p.waveLengths],
    gradient: p.gradient.map((s) => ({ ...s })),
  };
  writeNamedMap(map);
}

export function deleteNamedConfig(name: string): void {
  const map = readNamedMap();
  delete map[name];
  writeNamedMap(map);
}
