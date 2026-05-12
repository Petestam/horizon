import type { Strand } from "../entities/Strand.js";

export type Phase = "extend" | "chase" | "pulse" | "retract" | "dead";

/** Per-connection timings; locked at init so mid-flight tuner changes don't jump in-progress traces. */
export interface ConnDurations {
  extend: number;
  pulse: number;
  retract: number;
  chasePeriod: number;
}

/**
 * One control-tower-to-endpoint trace, drawn as an L-shape (vertical → horizontal → vertical).
 * Lifecycle: extend → chase → pulse → retract → dead.
 *
 * The endpoint follows the target strand each frame; the elbow rides at a fixed
 * fraction `byRatio` between origin and endpoint Y so the L-shape stays proportional
 * as the strand drifts vertically. The geometry is direction-agnostic, so the same
 * code paths work whether the L runs downward (origin above target) or upward
 * (origin below target, as in the bottom-towers layout).
 */
export class Connection {
  ox = 0;
  oy = 0;
  ex = 0;
  ey = 0;
  by = 0;
  byRatio = 0.5;
  l1 = 0;
  l2 = 0;
  l3 = 0;
  total = 0;
  target: Strand | null = null;
  phase: Phase = "extend";
  pt = 0;
  extendDur = 1;
  pulseDur = 2.5;
  retractDur = 1;
  chasePeriod = 4;
  chaseDur = 3;
  /** Distances along this path where it crosses earlier connections from the same tower. */
  bridges: number[] = [];

  init(
    ox: number,
    oy: number,
    by: number,
    target: Strand,
    chaseDur: number,
    d: ConnDurations,
  ): void {
    this.ox = ox;
    this.oy = oy;
    this.target = target;
    this.ex = target.x;
    this.ey = target.y0;
    this.by = by;
    const dy = this.ey - this.oy;
    this.byRatio = Math.abs(dy) > 1 ? (by - this.oy) / dy : 0.5;
    this.recompute();
    this.phase = "extend";
    this.pt = 0;
    this.chaseDur = chaseDur;
    this.extendDur = d.extend;
    this.pulseDur = d.pulse;
    this.retractDur = d.retract;
    this.chasePeriod = d.chasePeriod;
    this.bridges.length = 0;
  }

  private recompute(): void {
    this.l1 = Math.abs(this.by - this.oy);
    this.l2 = Math.abs(this.ex - this.ox);
    this.l3 = Math.abs(this.ey - this.by);
    this.total = this.l1 + this.l2 + this.l3;
  }

  step(dt: number): void {
    if (this.target) {
      this.ex = this.target.x;
      this.ey = this.target.y0;
      this.by = this.oy + this.byRatio * (this.ey - this.oy);
      this.recompute();
    }
    this.pt += dt;
    if (this.phase === "extend" && this.pt >= this.extendDur) {
      this.phase = "chase";
      this.pt -= this.extendDur;
    } else if (this.phase === "chase" && this.pt >= this.chaseDur) {
      this.phase = "pulse";
      this.pt -= this.chaseDur;
    } else if (this.phase === "pulse" && this.pt >= this.pulseDur) {
      this.phase = "retract";
      this.pt -= this.pulseDur;
    } else if (this.phase === "retract" && this.pt >= this.retractDur) {
      this.phase = "dead";
    }
  }

  get dead(): boolean {
    return this.phase === "dead";
  }
}

export interface Pt {
  x: number;
  y: number;
}

/** Return the (x,y) point at fraction u ∈ [0,1] along the L-shape (sharp-corner geometry). */
export const walkPath = (c: Connection, u: number): Pt => {
  const d = (u < 0 ? 0 : u > 1 ? 1 : u) * c.total;
  const dy1 = c.by >= c.oy ? 1 : -1;
  const dy3 = c.ey >= c.by ? 1 : -1;
  if (d <= c.l1) return { x: c.ox, y: c.oy + dy1 * d };
  if (d <= c.l1 + c.l2) {
    const dx = c.ex >= c.ox ? 1 : -1;
    return { x: c.ox + dx * (d - c.l1), y: c.by };
  }
  return { x: c.ex, y: c.by + dy3 * (d - c.l1 - c.l2) };
};
