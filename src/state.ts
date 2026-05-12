import { defaults, type Params } from "./config.js";

export type ParamKey = keyof Params;
type Listener = (changed: ReadonlySet<ParamKey>) => void;

const COLOR_KEYS: ReadonlySet<ParamKey> = new Set([
  "gradient",
  "bgColor",
  "vignetteIntensity",
  "pulseBandY",
  "pulseBandHeight",
]);

const COUNT_KEYS: ReadonlySet<ParamKey> = new Set([
  "waves",
  "strandsPerWave",
  "secondaryDensity",
  "secondaryScale",
]);

export class State {
  params: Params = {
    ...defaults,
    waveAmps: [...defaults.waveAmps],
    waveLengths: [...defaults.waveLengths],
    waveDirs: [...defaults.waveDirs],
    gradient: defaults.gradient.map((s) => ({ ...s })),
    behaviors: { ...defaults.behaviors },
  };
  private listeners = new Set<Listener>();

  set<K extends ParamKey>(key: K, value: Params[K]): void {
    if (this.params[key] === value) return;
    this.params[key] = value;
    this.emit(new Set([key]));
  }

  patch(patch: Partial<Params>): void {
    const changed = new Set<ParamKey>();
    for (const k of Object.keys(patch) as ParamKey[]) {
      const v = patch[k];
      if (v !== undefined && this.params[k] !== v) {
        (this.params as Record<ParamKey, unknown>)[k] = v;
        changed.add(k);
      }
    }
    if (changed.size > 0) this.emit(changed);
  }

  /** Replace all tunables at once (e.g. loading a saved preset). */
  replace(next: Params): void {
    this.params = {
      ...next,
      waveAmps: [...next.waveAmps],
      waveLengths: [...next.waveLengths],
      waveDirs: [...(next.waveDirs ?? defaults.waveDirs)],
      gradient: next.gradient.map((s) => ({ ...s })),
      behaviors: { ...defaults.behaviors, ...(next.behaviors ?? {}) },
    };
    this.emit(new Set(Object.keys(this.params) as ParamKey[]));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changed: Set<ParamKey>): void {
    for (const fn of this.listeners) fn(changed);
  }
}

export const isColorChange = (changed: ReadonlySet<ParamKey>): boolean => {
  for (const k of changed) if (COLOR_KEYS.has(k)) return true;
  return false;
};

export const isCountChange = (changed: ReadonlySet<ParamKey>): boolean => {
  for (const k of changed) if (COUNT_KEYS.has(k)) return true;
  return false;
};
