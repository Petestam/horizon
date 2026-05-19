import type { Tower } from "../towers/Tower.js";
import type { Connection } from "../towers/Connection.js";

const PHASE_RANK = { dead: 0, extend: 1, bond: 2, chase: 3, retract: 4, pulse: 5 } as const;

export const PHASE_PILL_H = 14;
export const PHASE_PILL_PAD_X = 6;
export const PHASE_PILL_FONT = "9px ui-monospace, SFMono-Regular, Menlo, monospace";

export type DemoStoryPhase = "unify" | "alert" | "investigate" | "resolve" | "automate" | "idle";

export interface PhasePillRect {
  kiosk: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export const phaseLabelForTower = (t: Tower): string | null => {
  if (t.conns.length > 0) {
    let top = t.conns[0]!;
    for (const c of t.conns) if (PHASE_RANK[c.phase] > PHASE_RANK[top.phase]) top = c;
    return phaseLabelForConnection(top);
  }
  if (t.unifyPhasePill) return "unifying";
  return null;
};

export const phaseLabelForConnection = (c: Connection): string | null => {
  switch (c.phase) {
    case "extend":
    case "bond":
      return null;
    case "chase":
      return c.automated ? "auto · agent" : "investigating";
    case "pulse":
    case "retract":
      return "resolving";
    default:
      return null;
  }
};

export const layoutPhasePills = (
  towers: readonly Tower[],
  cssW: number,
  cssH: number,
  sidePad: number,
  textWidth: (label: string) => number,
): PhasePillRect[] => {
  const edgePad = 8;
  const pills: PhasePillRect[] = [];
  for (let kiosk = 0; kiosk < towers.length; kiosk++) {
    const t = towers[kiosk]!;
    const label = phaseLabelForTower(t);
    if (label === null) continue;
    const w = textWidth(label) + PHASE_PILL_PAD_X * 2;
    const orbR = 3.5 + 6 * Math.max(0, Math.min(1, t.originGrid));
    let x = t.x - w / 2;
    x = Math.min(cssW - sidePad - w, Math.max(sidePad, x));
    let y = t.y + orbR + 5;
    y = Math.min(y, cssH - edgePad - PHASE_PILL_H);
    pills.push({ kiosk, x, y, w, h: PHASE_PILL_H, label });
  }
  return pills;
};

export const hitPhasePill = (
  pills: readonly PhasePillRect[],
  cssX: number,
  cssY: number,
): number | null => {
  for (const p of pills) {
    if (cssX >= p.x && cssX <= p.x + p.w && cssY >= p.y && cssY <= p.y + p.h) return p.kiosk;
  }
  return null;
};
