export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

export interface ColorSpec {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

export interface SliderCtrl {
  el: HTMLElement;
  sync: (value: number) => void;
}

export const slider = ({ label, min, max, step, value, onChange }: SliderSpec): SliderCtrl => {
  const row = document.createElement("label");
  row.className = "ctl ctl-slider";
  const name = document.createElement("span");
  name.className = "ctl-name";
  name.textContent = label;
  const num = document.createElement("span");
  num.className = "ctl-val";
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const sync = (v: number) => {
    input.value = String(v);
    num.textContent = step >= 1 ? String(v) : v.toFixed(2);
  };
  input.addEventListener("input", () => {
    const v = Number(input.value);
    sync(v);
    onChange(v);
  });
  sync(value);
  row.append(name, input, num);
  return { el: row, sync };
};

export interface ColorCtrl {
  el: HTMLElement;
  sync: (value: string) => void;
}

export const color = ({ label, value, onChange }: ColorSpec): ColorCtrl => {
  const row = document.createElement("label");
  row.className = "ctl ctl-color";
  const name = document.createElement("span");
  name.className = "ctl-name";
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "color";
  const sync = (v: string) => {
    input.value = v;
  };
  input.addEventListener("input", () => onChange(input.value));
  sync(value);
  row.append(name, input);
  return { el: row, sync };
};

export const section = (title: string, ...children: HTMLElement[]): HTMLElement => {
  const sec = document.createElement("section");
  sec.className = "sec";
  const h = document.createElement("h3");
  h.textContent = title;
  sec.append(h, ...children);
  return sec;
};

export const collapsibleSection = (
  title: string,
  defaultOpen: boolean,
  ...children: HTMLElement[]
): HTMLElement => {
  const sec = document.createElement("section");
  sec.className = "sec sec-collapsible";
  const det = document.createElement("details");
  det.open = defaultOpen;
  const sum = document.createElement("summary");
  sum.textContent = title;
  const body = document.createElement("div");
  body.className = "sec-collapsible-body";
  body.append(...children);
  det.append(sum, body);
  sec.appendChild(det);
  return sec;
};

import type { GradientStop } from "../config.js";
import { MIN_GRADIENT_STOPS } from "../config.js";
import { parseGradient, rgbToCss } from "../util/color.js";
import type { State } from "../state.js";

export interface GradientEditorSpec {
  stops: GradientStop[];
  onChange: (stops: GradientStop[]) => void;
}

export interface GradientEditorCtrl {
  el: HTMLElement;
  sync: (stops: GradientStop[]) => void;
}

export const gradientEditor = ({ stops, onChange }: GradientEditorSpec): GradientEditorCtrl => {
  const wrap = document.createElement("div");
  wrap.className = "ctl-grad";

  const preview = document.createElement("div");
  preview.className = "ctl-grad-preview";

  const list = document.createElement("div");
  list.className = "ctl-grad-list";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "ctl-btn ctl-grad-add";
  addBtn.textContent = "+ add stop";

  const current: GradientStop[] = stops.map((s) => ({ ...s }));

  const commit = () => {
    onChange(current.map((s) => ({ ...s })));
  };

  const updatePreview = () => {
    const sorted = parseGradient(current);
    if (sorted.length === 0) {
      preview.style.background = "transparent";
      return;
    }
    const css = sorted
      .map((s) => `${rgbToCss(s.rgb, s.alpha)} ${(s.offset * 100).toFixed(1)}%`)
      .join(", ");
    preview.style.background = `linear-gradient(to right, ${css})`;
  };

  const renderRows = () => {
    list.replaceChildren();
    const canRemove = current.length > MIN_GRADIENT_STOPS;
    current.forEach((stop, idx) => {
      const row = document.createElement("div");
      row.className = "ctl-grad-row";

      const color = document.createElement("input");
      color.type = "color";
      color.value = stop.color;
      color.title = "color";
      color.addEventListener("input", () => {
        current[idx] = { ...current[idx]!, color: color.value };
        updatePreview();
        commit();
      });

      const alpha = document.createElement("input");
      alpha.type = "number";
      alpha.min = "0";
      alpha.max = "1";
      alpha.step = "0.01";
      alpha.value = stop.alpha.toFixed(2);
      alpha.title = "alpha 0-1";
      alpha.addEventListener("input", () => {
        const v = Math.max(0, Math.min(1, Number(alpha.value) || 0));
        current[idx] = { ...current[idx]!, alpha: v };
        updatePreview();
        commit();
      });

      const pos = document.createElement("input");
      pos.type = "number";
      pos.min = "0";
      pos.max = "1";
      pos.step = "0.01";
      pos.value = stop.offset.toFixed(2);
      pos.title = "position 0-1";
      pos.addEventListener("input", () => {
        const v = Math.max(0, Math.min(1, Number(pos.value) || 0));
        current[idx] = { ...current[idx]!, offset: v };
        updatePreview();
        commit();
      });

      const aLabel = document.createElement("span");
      aLabel.className = "ctl-grad-tag";
      aLabel.textContent = "α";
      const pLabel = document.createElement("span");
      pLabel.className = "ctl-grad-tag";
      pLabel.textContent = "@";

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "ctl-grad-rm";
      rm.textContent = "×";
      rm.title = canRemove ? "remove stop" : `min ${MIN_GRADIENT_STOPS} stops`;
      rm.disabled = !canRemove;
      rm.addEventListener("click", () => {
        if (current.length <= MIN_GRADIENT_STOPS) return;
        current.splice(idx, 1);
        renderRows();
        updatePreview();
        commit();
      });

      row.append(color, aLabel, alpha, pLabel, pos, rm);
      list.appendChild(row);
    });
  };

  addBtn.addEventListener("click", () => {
    const sorted = [...current].sort((a, b) => a.offset - b.offset);
    let inserted: GradientStop | null = null;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (b.offset - a.offset > 0.05) {
        inserted = {
          color: a.color,
          alpha: (a.alpha + b.alpha) / 2,
          offset: (a.offset + b.offset) / 2,
        };
        break;
      }
    }
    if (!inserted) {
      const last = sorted[sorted.length - 1]!;
      inserted = { color: last.color, alpha: last.alpha, offset: Math.min(1, last.offset + 0.05) };
    }
    current.push(inserted);
    renderRows();
    updatePreview();
    commit();
  });

  wrap.append(preview, list, addBtn);
  renderRows();
  updatePreview();

  const sync = (next: GradientStop[]) => {
    current.length = 0;
    current.push(...next.map((s) => ({ ...s })));
    renderRows();
    updatePreview();
  };

  return { el: wrap, sync };
};

export const perWaveEditor = (
  state: State,
): { el: HTMLElement; dispose: () => void } => {
  const wrap = document.createElement("div");
  wrap.className = "ctl-perwave";

  const renderRows = () => {
    wrap.replaceChildren();
    const n = state.params.waves;
    const amps = state.params.waveAmps;
    const lens = state.params.waveLengths;
    const dirs = state.params.waveDirs;
    for (let i = 0; i < n; i++) {
      const title = document.createElement("div");
      title.className = "ctl-perwave-title";
      title.textContent = `wave ${i + 1}`;
      wrap.appendChild(title);

      wrap.appendChild(
        slider({
          label: "amplitude",
          min: -1.5,
          max: 1.5,
          step: 0.05,
          value: amps[i] ?? 1,
          onChange: (v) => {
            const next = state.params.waveAmps.slice();
            next[i] = v;
            state.set("waveAmps", next);
          },
        }).el,
      );

      wrap.appendChild(
        slider({
          label: "wavelength",
          min: 0.12,
          max: 4,
          step: 0.05,
          value: lens[i] ?? 1,
          onChange: (v) => {
            const next = state.params.waveLengths.slice();
            next[i] = v;
            state.set("waveLengths", next);
          },
        }).el,
      );

      wrap.appendChild(
        slider({
          label: "direction",
          min: -1,
          max: 1,
          step: 1,
          value: dirs[i] ?? 1,
          onChange: (v) => {
            const next = state.params.waveDirs.slice();
            next[i] = v;
            state.set("waveDirs", next);
          },
        }).el,
      );
    }
  };

  const dispose = state.subscribe((changed) => {
    if (
      changed.has("waves") ||
      changed.has("waveAmps") ||
      changed.has("waveLengths") ||
      changed.has("waveDirs")
    ) {
      renderRows();
    }
  });
  renderRows();
  return { el: wrap, dispose };
};

export interface ToggleSpec {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export interface ToggleCtrl {
  el: HTMLElement;
  sync: (value: boolean) => void;
}

export const toggle = ({ label, value, onChange }: ToggleSpec): ToggleCtrl => {
  const row = document.createElement("label");
  row.className = "ctl ctl-toggle";
  const name = document.createElement("span");
  name.className = "ctl-name";
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  const sync = (v: boolean) => {
    input.checked = v;
  };
  input.addEventListener("change", () => onChange(input.checked));
  sync(value);
  row.append(name, input);
  return { el: row, sync };
};

export const button = (label: string, onClick: () => void): HTMLElement => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ctl-btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
};

export const buttonRow = (...buttons: HTMLElement[]): HTMLElement => {
  const row = document.createElement("div");
  row.className = "ctl ctl-btnrow";
  row.append(...buttons);
  return row;
};

export const readout = (label: string): { el: HTMLElement; set: (v: string) => void } => {
  const row = document.createElement("div");
  row.className = "ctl ctl-readout";
  const name = document.createElement("span");
  name.className = "ctl-name";
  name.textContent = label;
  const val = document.createElement("span");
  val.className = "ctl-val";
  val.textContent = "—";
  row.append(name, val);
  return { el: row, set: (v) => (val.textContent = v) };
};
