import type { State } from "../state.js";
import {
  MAX_WAVES,
  WAVE_STRUCTURES,
  type BehaviorFlags,
  type LightSource,
  type WaveStructure,
} from "../config.js";
import {
  slider,
  color,
  collapsibleSection,
  readout,
  select,
  textInput,
  toggle,
  button,
  buttonRow,
  gradientEditor,
  perWaveEditor,
} from "./controls.js";
import {
  deleteNamedConfig,
  getNamedConfig,
  listNamedConfigs,
  putNamedConfig,
  saveLastParams,
} from "./tunerStorage.js";

const CSS = `
.overlay-panel {
  position: fixed; top: 0; right: 0; height: 100%;
  width: 320px; max-width: 90vw;
  background: rgba(8,8,12,0.92);
  backdrop-filter: blur(12px);
  border-left: 1px solid rgba(255,255,255,0.08);
  color: #e8e8e8;
  font-size: 12px; line-height: 1.4;
  padding: 16px 14px 24px; box-sizing: border-box;
  overflow-y: auto;
  transform: translateX(100%);
  transition: transform 240ms ease;
  pointer-events: auto;
  z-index: 10;
}
.overlay-panel.open { transform: translateX(0); }
.overlay-hint {
  position: fixed; bottom: 12px; left: 12px;
  font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(255,255,255,0.35);
  pointer-events: none;
  z-index: 5;
}
.overlay-panel h2 { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin: 0 0 14px; color: rgba(255,255,255,0.55); font-weight: 500; }
.overlay-panel .sec { margin-bottom: 18px; }
.overlay-panel .sec h3 { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.45); margin: 0 0 8px; font-weight: 500; }
.overlay-panel .ctl-config-title {
  font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); margin: 0 0 8px; font-weight: 500;
}
.overlay-panel .ctl-config-row { display: flex; gap: 6px; margin-top: 8px; }
.overlay-panel select.ctl-select {
  width: 100%;
  box-sizing: border-box;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  color: #e8e8e8;
  border-radius: 4px;
  padding: 6px 8px;
  font: inherit;
}
.overlay-panel .sec-collapsible details > summary {
  font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); margin: 0 0 8px; font-weight: 500;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.overlay-panel .sec-collapsible details > summary::-webkit-details-marker { display: none; }
.overlay-panel .sec-collapsible details > summary::before {
  content: "▸"; display: inline-block; margin-right: 6px; transition: transform 0.15s ease;
  color: rgba(255,255,255,0.35);
}
.overlay-panel .sec-collapsible details[open] > summary::before { transform: rotate(90deg); }
.overlay-panel .sec-collapsible-body { padding-bottom: 2px; }
.overlay-panel .ctl { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: center; padding: 4px 0; }
.overlay-panel .ctl-slider { grid-template-columns: 90px 1fr 40px; }
.overlay-panel .ctl-text { grid-template-columns: 1fr; gap: 4px; align-items: stretch; }
.overlay-panel .ctl-text input[type=text] {
  width: 100%; box-sizing: border-box;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  color: #e8e8e8; border-radius: 4px; padding: 6px 8px; font: inherit;
}
.overlay-panel .ctl-name { color: rgba(255,255,255,0.7); }
.overlay-panel .ctl-val { color: rgba(255,255,255,0.55); font-variant-numeric: tabular-nums; text-align: right; }
.overlay-panel input[type=range] { width: 100%; accent-color: #c0b8ff; }
.overlay-panel input[type=color] { width: 28px; height: 20px; padding: 0; border: 1px solid rgba(255,255,255,0.15); background: transparent; border-radius: 3px; }
.overlay-panel input[type=checkbox] { accent-color: #c0b8ff; width: 14px; height: 14px; }
.overlay-panel .ctl-btnrow { display: flex; gap: 6px; padding: 6px 0; grid-template-columns: none; }
.overlay-panel .ctl-btn {
  flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.85); border-radius: 4px; padding: 6px 8px; cursor: pointer;
  font: inherit; letter-spacing: 0.04em;
}
.overlay-panel .ctl-btn:hover { background: rgba(255,255,255,0.12); }
.overlay-panel .ctl-btn:active { background: rgba(255,255,255,0.18); }
.overlay-panel .ctl-grad { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 6px; }
.overlay-panel .ctl-grad-preview {
  height: 16px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.12);
  background-image:
    linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255,255,255,0.06) 25%, transparent 25%);
  background-size: 8px 8px;
}
.overlay-panel .ctl-grad-list { display: flex; flex-direction: column; gap: 4px; }
.overlay-panel .ctl-grad-row {
  display: grid;
  grid-template-columns: 28px 12px 56px 12px 56px 22px;
  align-items: center; gap: 4px;
}
.overlay-panel .ctl-grad-tag { color: rgba(255,255,255,0.4); text-align: center; font-size: 10px; }
.overlay-panel .ctl-grad input[type=color] { width: 28px; height: 22px; }
.overlay-panel .ctl-grad input[type=number] {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: #e8e8e8; padding: 3px 4px; border-radius: 3px; font: inherit; width: 100%;
  font-variant-numeric: tabular-nums;
}
.overlay-panel .ctl-grad-rm {
  background: transparent; border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.55); border-radius: 3px; cursor: pointer;
  width: 22px; height: 22px; padding: 0; line-height: 1;
}
.overlay-panel .ctl-grad-rm:hover:not(:disabled) { background: rgba(255,80,80,0.18); color: #fff; border-color: rgba(255,80,80,0.4); }
.overlay-panel .ctl-grad-rm:disabled { opacity: 0.3; cursor: not-allowed; }
.overlay-panel .ctl-grad-add { align-self: flex-start; flex: 0 0 auto; padding: 4px 10px; }
.overlay-panel .ctl-perwave-title {
  font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
  color: rgba(255,255,255,0.5); margin: 12px 0 6px; font-weight: 500;
}
.overlay-panel .ctl-perwave .ctl-perwave-title:first-child { margin-top: 0; }
`;

export interface OverlayHandles {
  setFps: (fps: number) => void;
  setStrandCount: (n: number) => void;
  setRendererInfo: (name: string, w: number, h: number, dpr: number) => void;
  destroy: () => void;
}

export interface OverlayActions {
  fireTestLabel: () => void;
  clearLabels: () => void;
  fireTower: () => void;
  clearTowers: () => void;
  unify: () => void;
  investigate: () => void;
  resolve: () => void;
  automate: () => void;
  resetDemo: () => void;
}

export const mountOverlay = (
  root: HTMLElement,
  state: State,
  actions: OverlayActions,
): OverlayHandles => {
  const styleEl = document.createElement("style");
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  const panel = document.createElement("div");
  panel.className = "overlay-panel";
  panel.innerHTML = "<h2>Operator Tuners</h2>";

  const p = state.params;
  const set = state.set.bind(state);
  const disposers: Array<() => void> = [];

  const waveRowEditor = perWaveEditor(state);
  disposers.push(waveRowEditor.dispose);

  const syncFromState: Array<() => void> = [];

  const fillConfigSelect = (sel: HTMLSelectElement) => {
    sel.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Load preset…";
    sel.appendChild(placeholder);
    for (const name of listNamedConfigs()) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
  };

  const cfgWrap = document.createElement("div");
  cfgWrap.className = "sec ctl-config";
  const cfgTitle = document.createElement("div");
  cfgTitle.className = "ctl-config-title";
  cfgTitle.textContent = "Presets";
  const cfgSelect = document.createElement("select");
  cfgSelect.className = "ctl-select";
  fillConfigSelect(cfgSelect);
  const cfgRow = document.createElement("div");
  cfgRow.className = "ctl-config-row";
  cfgRow.append(
    button("Save as…", () => {
      const name = window.prompt("Preset name");
      if (!name?.trim()) return;
      const key = name.trim();
      putNamedConfig(key, state.params);
      fillConfigSelect(cfgSelect);
      cfgSelect.value = key;
      saveLastParams(state.params);
    }),
    button("Delete", () => {
      const key = cfgSelect.value;
      if (!key) return;
      deleteNamedConfig(key);
      fillConfigSelect(cfgSelect);
    }),
  );
  cfgSelect.addEventListener("change", () => {
    const key = cfgSelect.value;
    if (!key) return;
    const cfg = getNamedConfig(key);
    if (!cfg) return;
    state.replace(cfg);
    for (const fn of syncFromState) fn();
  });
  cfgWrap.append(cfgTitle, cfgSelect, cfgRow);
  panel.appendChild(cfgWrap);

  const STRUCTURE_LABELS: Record<WaveStructure, string> = {
    wave: "sine wave",
    parallax: "interstellar parallax",
    expanding: "expanding grid",
    tensor: "tensile grid",
    grow: "growing branches",
    walls: "light walls",
  };
  const wStruct = select<WaveStructure>({
    label: "structure",
    value: p.waveStructure,
    options: WAVE_STRUCTURES.map((v) => ({ value: v, label: STRUCTURE_LABELS[v] })),
    onChange: (v) => set("waveStructure", v),
  });
  syncFromState.push(() => wStruct.sync(state.params.waveStructure));

  const wCount = slider({
    label: "count",
    min: 1,
    max: MAX_WAVES,
    step: 1,
    value: p.waves,
    onChange: (v) => set("waves", v),
  });
  syncFromState.push(() => wCount.sync(state.params.waves));

  const wFieldY = slider({
    label: "field y",
    min: 0,
    max: 0.7,
    step: 0.01,
    value: p.fieldOffsetY,
    onChange: (v) => set("fieldOffsetY", v),
  });
  syncFromState.push(() => wFieldY.sync(state.params.fieldOffsetY));

  const wAmp = slider({
    label: "amplitude",
    min: 0.05,
    max: 0.4,
    step: 0.01,
    value: p.amplitude,
    onChange: (v) => set("amplitude", v),
  });
  syncFromState.push(() => wAmp.sync(state.params.amplitude));

  const wSpace = slider({
    label: "spacing",
    min: 0.02,
    max: 0.18,
    step: 0.005,
    value: p.waveSpacing,
    onChange: (v) => set("waveSpacing", v),
  });
  syncFromState.push(() => wSpace.sync(state.params.waveSpacing));

  const wPhase = slider({
    label: "phase speed",
    min: 0,
    max: 0.4,
    step: 0.005,
    value: p.phaseSpeed,
    onChange: (v) => set("phaseSpeed", v),
  });
  syncFromState.push(() => wPhase.sync(state.params.phaseSpeed));

  const wSecS = slider({
    label: "secondary scale",
    min: 0,
    max: 1,
    step: 0.02,
    value: p.secondaryScale,
    onChange: (v) => set("secondaryScale", v),
  });
  syncFromState.push(() => wSecS.sync(state.params.secondaryScale));

  const wSecD = slider({
    label: "secondary density",
    min: 0,
    max: 4,
    step: 0.02,
    value: p.secondaryDensity,
    onChange: (v) => set("secondaryDensity", v),
  });
  syncFromState.push(() => wSecD.sync(state.params.secondaryDensity));

  panel.appendChild(
    collapsibleSection(
      "Waves",
      true,
      wStruct.el,
      wCount.el,
      wFieldY.el,
      wAmp.el,
      wSpace.el,
      wPhase.el,
      wSecS.el,
      wSecD.el,
    ),
  );

  panel.appendChild(collapsibleSection("Per wave (amplitude & wavelength)", true, waveRowEditor.el));

  const sPer = slider({
    label: "per wave",
    min: 20,
    max: 140,
    step: 2,
    value: p.strandsPerWave,
    onChange: (v) => set("strandsPerWave", v),
  });
  syncFromState.push(() => sPer.sync(state.params.strandsPerWave));

  const sStroke = slider({
    label: "stroke width",
    min: 0.5,
    max: 3,
    step: 0.1,
    value: p.strokeWidth,
    onChange: (v) => set("strokeWidth", v),
  });
  syncFromState.push(() => sStroke.sync(state.params.strokeWidth));

  const sEnd = slider({
    label: "endpoint radius",
    min: 0.5,
    max: 4,
    step: 0.1,
    value: p.endpointRadius,
    onChange: (v) => set("endpointRadius", v),
  });
  syncFromState.push(() => sEnd.sync(state.params.endpointRadius));

  const sLen = slider({
    label: "strand length",
    min: 0.3,
    max: 1,
    step: 0.01,
    value: p.strandLength,
    onChange: (v) => set("strandLength", v),
  });
  syncFromState.push(() => sLen.sync(state.params.strandLength));

  const sJit = slider({
    label: "length jitter",
    min: 0,
    max: 0.2,
    step: 0.005,
    value: p.strandLengthJitter,
    onChange: (v) => set("strandLengthJitter", v),
  });
  syncFromState.push(() => sJit.sync(state.params.strandLengthJitter));

  const sGJit = slider({
    label: "gradient jitter",
    min: 0,
    max: 0.25,
    step: 0.005,
    value: p.gradientJitter,
    onChange: (v) => set("gradientJitter", v),
  });
  syncFromState.push(() => sGJit.sync(state.params.gradientJitter));

  panel.appendChild(
    collapsibleSection(
      "Strands",
      true,
      sPer.el,
      sStroke.el,
      sEnd.el,
      sLen.el,
      sJit.el,
      sGJit.el,
    ),
  );

  const grad = gradientEditor({
    stops: p.gradient,
    onChange: (g) => set("gradient", g),
  });
  syncFromState.push(() => grad.sync(state.params.gradient));

  const bg = color({
    label: "background",
    value: p.bgColor,
    onChange: (v) => set("bgColor", v),
  });
  syncFromState.push(() => bg.sync(state.params.bgColor));

  const cVig = slider({
    label: "vignette",
    min: 0,
    max: 1,
    step: 0.02,
    value: p.vignetteIntensity,
    onChange: (v) => set("vignetteIntensity", v),
  });
  syncFromState.push(() => cVig.sync(state.params.vignetteIntensity));

  const cPy = slider({
    label: "pulse y",
    min: 0.2,
    max: 0.8,
    step: 0.01,
    value: p.pulseBandY,
    onChange: (v) => set("pulseBandY", v),
  });
  syncFromState.push(() => cPy.sync(state.params.pulseBandY));

  const cPh = slider({
    label: "pulse height",
    min: 0.005,
    max: 0.12,
    step: 0.005,
    value: p.pulseBandHeight,
    onChange: (v) => set("pulseBandHeight", v),
  });
  syncFromState.push(() => cPh.sync(state.params.pulseBandHeight));

  panel.appendChild(
    collapsibleSection("Color", true, grad.el, bg.el, cVig.el, cPy.el, cPh.el),
  );

  const lightDrift = slider({
    label: "light drift (L↔R)",
    min: 0,
    max: 10,
    step: 0.1,
    value: p.lightDriftSpeed,
    onChange: (v) => set("lightDriftSpeed", v),
  });
  syncFromState.push(() => lightDrift.sync(state.params.lightDriftSpeed));

  const lightSection = (idx: number, title: string, defaultOpen: boolean): HTMLElement => {
    const get = () => state.params.lightSources[idx]!;
    const setLight = <K extends keyof LightSource>(key: K, value: LightSource[K]) =>
      set(
        "lightSources",
        state.params.lightSources.map((l, i) => (i === idx ? { ...l, [key]: value } : l)),
      );
    const ls = (
      label: string,
      key: "intensity" | "distance" | "spread" | "falloff" | "diffusion",
      min: number,
      max: number,
      step: number,
    ) => {
      const c = slider({ label, min, max, step, value: get()[key], onChange: (v) => setLight(key, v) });
      syncFromState.push(() => c.sync(get()[key]));
      return c.el;
    };
    const en = toggle({
      label: "enabled",
      value: get().enabled,
      onChange: (v) => setLight("enabled", v),
    });
    syncFromState.push(() => en.sync(get().enabled));
    const co = color({ label: "color", value: get().color, onChange: (v) => setLight("color", v) });
    syncFromState.push(() => co.sync(get().color));
    return collapsibleSection(
      title,
      defaultOpen,
      en.el,
      co.el,
      ls("intensity", "intensity", 0, 1, 0.02),
      ls("distance", "distance", 0.1, 3, 0.05),
      ls("spread", "spread", 0.2, 4, 0.05),
      ls("falloff", "falloff", 0.3, 8, 0.1),
      ls("diffusion", "diffusion", 0, 1, 0.02),
    );
  };

  const lightCount = state.params.lightSources.length;

  panel.appendChild(
    collapsibleSection("Background lights", true, lightDrift.el, ...Array.from({ length: lightCount }, (_, i) => {
      const tag = i === 0 ? "base" : i === lightCount - 1 ? "tip" : "mid";
      return lightSection(i, `Light ${i + 1} (${tag})`, i === 0);
    })),
  );

  const mSpeed = slider({
    label: "speed",
    min: 0,
    max: 3,
    step: 0.05,
    value: p.speedMultiplier,
    onChange: (v) => set("speedMultiplier", v),
  });
  syncFromState.push(() => mSpeed.sync(state.params.speedMultiplier));

  const mAlpha = slider({
    label: "alpha",
    min: 0.1,
    max: 1,
    step: 0.02,
    value: p.alphaMultiplier,
    onChange: (v) => set("alphaMultiplier", v),
  });
  syncFromState.push(() => mAlpha.sync(state.params.alphaMultiplier));

  panel.appendChild(collapsibleSection("Motion", true, mSpeed.el, mAlpha.el));

  const behaviorToggle = (key: keyof BehaviorFlags, label: string): HTMLElement => {
    const t = toggle({
      label,
      value: state.params.behaviors[key],
      onChange: (v) => set("behaviors", { ...state.params.behaviors, [key]: v }),
    });
    syncFromState.push(() => t.sync(state.params.behaviors[key]));
    return t.el;
  };

  panel.appendChild(
    collapsibleSection(
      "Behaviors",
      true,
      behaviorToggle("spring", "memory (spring)"),
      behaviorToggle("couple", "coupling (neighbors)"),
      behaviorToggle("intent", "intent (attention)"),
      behaviorToggle("reactive", "reactive (event nudge)"),
      behaviorToggle("breathe", "breathe (modulation)"),
      behaviorToggle("mood", "mood (FSM)"),
    ),
  );

  const labelsToggle = toggle({
    label: "enabled",
    value: p.labelsEnabled,
    onChange: (v) => {
      set("labelsEnabled", v);
      if (!v) actions.clearLabels();
    },
  });
  syncFromState.push(() => labelsToggle.sync(state.params.labelsEnabled));

  const labelCopy = textInput({
    label: "pill text",
    value: p.labelText,
    placeholder: "test · operator",
    onChange: (v) =>
      set(
        "labelText",
        v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 128),
      ),
  });
  syncFromState.push(() => labelCopy.sync(state.params.labelText));

  const alertScale = slider({
    label: "alert scale",
    min: 0.25,
    max: 3,
    step: 0.05,
    value: p.alertScale,
    onChange: (v) => set("alertScale", v),
  });
  syncFromState.push(() => alertScale.sync(state.params.alertScale));

  panel.appendChild(
    collapsibleSection(
      "Labels",
      true,
      labelsToggle.el,
      labelCopy.el,
      alertScale.el,
      buttonRow(
        button("Fire test", () => {
          if (!state.params.labelsEnabled) state.set("labelsEnabled", true);
          actions.fireTestLabel();
        }),
        button("Clear all", () => actions.clearLabels()),
      ),
    ),
  );

  const towersToggle = toggle({
    label: "enabled",
    value: p.towersEnabled,
    onChange: (v) => {
      set("towersEnabled", v);
      if (!v) actions.clearTowers();
    },
  });
  syncFromState.push(() => towersToggle.sync(state.params.towersEnabled));

  const tSpawn = slider({
    label: "spawn interval",
    min: 0.3,
    max: 4,
    step: 0.1,
    value: p.towerSpawnInterval,
    onChange: (v) => set("towerSpawnInterval", v),
  });
  syncFromState.push(() => tSpawn.sync(state.params.towerSpawnInterval));

  const tPulse = slider({
    label: "pulse duration",
    min: 0.8,
    max: 6,
    step: 0.1,
    value: p.towerPulseDur,
    onChange: (v) => set("towerPulseDur", v),
  });
  syncFromState.push(() => tPulse.sync(state.params.towerPulseDur));

  const tChase = slider({
    label: "comet lap",
    min: 1,
    max: 10,
    step: 0.1,
    value: p.towerChasePeriod,
    onChange: (v) => set("towerChasePeriod", v),
  });
  syncFromState.push(() => tChase.sync(state.params.towerChasePeriod));

  const tReach = slider({
    label: "domain reach",
    min: 0,
    max: 1,
    step: 0.05,
    value: p.towerReach,
    onChange: (v) => set("towerReach", v),
  });
  syncFromState.push(() => tReach.sync(state.params.towerReach));

  const tStroke = slider({
    label: "line width",
    min: 0.3,
    max: 6,
    step: 0.1,
    value: p.towerStrokeWidth,
    onChange: (v) => set("towerStrokeWidth", v),
  });
  syncFromState.push(() => tStroke.sync(state.params.towerStrokeWidth));

  const tPulseW = slider({
    label: "pulse width",
    min: 0.3,
    max: 8,
    step: 0.1,
    value: p.towerPulseWidth,
    onChange: (v) => set("towerPulseWidth", v),
  });
  syncFromState.push(() => tPulseW.sync(state.params.towerPulseWidth));

  const tPulseTail = slider({
    label: "pulse length",
    min: 0.02,
    max: 0.6,
    step: 0.01,
    value: p.towerPulseTailLen,
    onChange: (v) => set("towerPulseTailLen", v),
  });
  syncFromState.push(() => tPulseTail.sync(state.params.towerPulseTailLen));

  const tPulseGlow = slider({
    label: "pulse glow",
    min: 0,
    max: 2,
    step: 0.05,
    value: p.towerPulseGlow,
    onChange: (v) => set("towerPulseGlow", v),
  });
  syncFromState.push(() => tPulseGlow.sync(state.params.towerPulseGlow));

  const tPulseLead = slider({
    label: "pulses ahead",
    min: 0,
    max: 4,
    step: 1,
    value: p.towerPulseLead,
    onChange: (v) => set("towerPulseLead", v),
  });
  syncFromState.push(() => tPulseLead.sync(state.params.towerPulseLead));

  const tPulseTrail = slider({
    label: "pulses behind",
    min: 0,
    max: 4,
    step: 1,
    value: p.towerPulseTrail,
    onChange: (v) => set("towerPulseTrail", v),
  });
  syncFromState.push(() => tPulseTrail.sync(state.params.towerPulseTrail));

  const tPulseSpacing = slider({
    label: "pulse spacing",
    min: 0.05,
    max: 0.6,
    step: 0.01,
    value: p.towerPulseSpacing,
    onChange: (v) => set("towerPulseSpacing", v),
  });
  syncFromState.push(() => tPulseSpacing.sync(state.params.towerPulseSpacing));

  const tBond = slider({
    label: "bond hold (s)",
    min: 0,
    max: 3,
    step: 0.05,
    value: p.towerBondDur,
    onChange: (v) => set("towerBondDur", v),
  });
  syncFromState.push(() => tBond.sync(state.params.towerBondDur));

  const tBurst = slider({
    label: "burst dur (s)",
    min: 0.15,
    max: 3,
    step: 0.05,
    value: p.towerBurstDur,
    onChange: (v) => set("towerBurstDur", v),
  });
  syncFromState.push(() => tBurst.sync(state.params.towerBurstDur));

  const tUnifyDur = slider({
    label: "unify pulse (s)",
    min: 0.6,
    max: 8,
    step: 0.05,
    value: p.unifyPulseDur,
    onChange: (v) => set("unifyPulseDur", v),
  });
  syncFromState.push(() => tUnifyDur.sync(state.params.unifyPulseDur));

  const tShimmerR = slider({
    label: "shimmer radius",
    min: 0,
    max: 600,
    step: 5,
    value: p.shimmerRadius,
    onChange: (v) => set("shimmerRadius", v),
  });
  syncFromState.push(() => tShimmerR.sync(state.params.shimmerRadius));

  const tShimmerI = slider({
    label: "shimmer power",
    min: 0,
    max: 3,
    step: 0.05,
    value: p.shimmerIntensity,
    onChange: (v) => set("shimmerIntensity", v),
  });
  syncFromState.push(() => tShimmerI.sync(state.params.shimmerIntensity));

  const phasePillsToggle = toggle({
    label: "Show phase pills (debug)",
    value: p.phasePillsEnabled,
    onChange: (v) => set("phasePillsEnabled", v),
  });
  syncFromState.push(() => phasePillsToggle.sync(state.params.phasePillsEnabled));

  const originGlowExtent = slider({
    label: "origin glow radius (× dot ø)",
    min: 8,
    max: 120,
    step: 1,
    value: p.originGlowExtentDots,
    onChange: (v) => set("originGlowExtentDots", v),
  });
  syncFromState.push(() => originGlowExtent.sync(state.params.originGlowExtentDots));

  const originGlowGridStep = slider({
    label: "origin grid step (× dot ø)",
    min: 0,
    max: 20,
    step: 0.1,
    value: p.originGlowGridStep,
    onChange: (v) => set("originGlowGridStep", v),
  });
  syncFromState.push(() => originGlowGridStep.sync(state.params.originGlowGridStep));

  const originGlowDot = slider({
    label: "origin dot size",
    min: 0.15,
    max: 1,
    step: 0.02,
    value: p.originGlowDotSize,
    onChange: (v) => set("originGlowDotSize", v),
  });
  syncFromState.push(() => originGlowDot.sync(state.params.originGlowDotSize));

  const originGlowStrength = slider({
    label: "origin glow strength",
    min: 0,
    max: 2,
    step: 0.02,
    value: p.originGlowStrength,
    onChange: (v) => set("originGlowStrength", v),
  });
  syncFromState.push(() => originGlowStrength.sync(state.params.originGlowStrength));

  const orbAgentsToggle = toggle({
    label: "orb agent sprites (unify glow)",
    value: p.orbAgentsEnabled,
    onChange: (v) => set("orbAgentsEnabled", v),
  });
  syncFromState.push(() => orbAgentsToggle.sync(state.params.orbAgentsEnabled));

  const orbAgentsSize = slider({
    label: "orb agents size",
    min: 0.25,
    max: 3,
    step: 0.05,
    value: p.orbAgentsSize,
    onChange: (v) => set("orbAgentsSize", v),
  });
  syncFromState.push(() => orbAgentsSize.sync(state.params.orbAgentsSize));

  const orbAgentsBrightness = slider({
    label: "orb agents brightness",
    min: 0,
    max: 2.5,
    step: 0.05,
    value: p.orbAgentsBrightness,
    onChange: (v) => set("orbAgentsBrightness", v),
  });
  syncFromState.push(() => orbAgentsBrightness.sync(state.params.orbAgentsBrightness));

  const orbAgentsGlow = slider({
    label: "orb agents glow",
    min: 0,
    max: 3,
    step: 0.05,
    value: p.orbAgentsGlow,
    onChange: (v) => set("orbAgentsGlow", v),
  });
  syncFromState.push(() => orbAgentsGlow.sync(state.params.orbAgentsGlow));

  panel.appendChild(
    collapsibleSection(
      "Control towers",
      true,
      towersToggle.el,
      tSpawn.el,
      tPulse.el,
      tChase.el,
      tBond.el,
      tBurst.el,
      tReach.el,
      tStroke.el,
      tPulseW.el,
      tPulseTail.el,
      tPulseGlow.el,
      tPulseLead.el,
      tPulseTrail.el,
      tPulseSpacing.el,
      tUnifyDur.el,
      tShimmerR.el,
      tShimmerI.el,
      originGlowExtent.el,
      originGlowGridStep.el,
      originGlowDot.el,
      originGlowStrength.el,
      phasePillsToggle.el,
      orbAgentsToggle.el,
      orbAgentsSize.el,
      orbAgentsBrightness.el,
      orbAgentsGlow.el,
      buttonRow(
        button("Fire one", () => {
          if (!state.params.towersEnabled) state.set("towersEnabled", true);
          actions.fireTower();
        }),
        button("Clear all", () => actions.clearTowers()),
      ),
    ),
  );

  const ambientToggle = toggle({
    label: "ambient loop (Unify→Alert→Investigate→Resolve→Automate)",
    value: p.ambientDemo,
    onChange: (v) => set("ambientDemo", v),
  });
  syncFromState.push(() => ambientToggle.sync(state.params.ambientDemo));

  panel.appendChild(
    collapsibleSection(
      "Demo  ·  1 unify  2 investigate  3 resolve  4 automate  0 reset",
      true,
      ambientToggle.el,
      buttonRow(
        button("Unify", () => actions.unify()),
        button("Investigate", () => actions.investigate()),
      ),
      buttonRow(
        button("Resolve", () => actions.resolve()),
        button("Automate", () => actions.automate()),
      ),
      buttonRow(button("Reset demo", () => actions.resetDemo())),
    ),
  );

  const fpsR = readout("FPS");
  const countR = readout("strands");
  const rendR = readout("renderer");
  const sizeR = readout("backing");
  panel.appendChild(
    collapsibleSection("Telemetry", true, fpsR.el, countR.el, rendR.el, sizeR.el),
  );

  const hint = document.createElement("div");
  hint.className = "overlay-hint";
  hint.textContent = "press ` to toggle tuners";

  root.appendChild(panel);
  root.appendChild(hint);

  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const unsubPersist = state.subscribe(() => {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => saveLastParams(state.params), 280);
  });
  disposers.push(() => {
    window.clearTimeout(persistTimer);
    unsubPersist();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "`" || e.key === "~") panel.classList.toggle("open");
  };
  window.addEventListener("keydown", onKey);

  return {
    setFps: (fps) => fpsR.set(fps.toFixed(1)),
    setStrandCount: (n) => countR.set(`${n} / 600`),
    setRendererInfo: (name, w, h, dpr) => {
      rendR.set(name);
      sizeR.set(`${w}x${h} @${dpr.toFixed(2)}x`);
    },
    destroy: () => {
      window.removeEventListener("keydown", onKey);
      for (const d of disposers) d();
      panel.remove();
      hint.remove();
      styleEl.remove();
    },
  };
};
