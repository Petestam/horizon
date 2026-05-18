import type { Strand } from "../entities/Strand.js";

export type Phase = "extend" | "bond" | "chase" | "pulse" | "retract" | "dead";

/** Per-connection timings; locked at init so mid-flight tuner changes don't jump in-progress traces. */
export interface ConnDurations {
  extend: number;
  /** Held bond beat between extend wrap and the first telemetry burst — reads as "handshake established". */
  bond: number;
  pulse: number;
  retract: number;
  /** Time between burst starts during chase. Burst itself is `burstDur` seconds, then a gap until the next burst. */
  chasePeriod: number;
  /** Single inbound telemetry burst duration. Gap silence = chasePeriod - burstDur. */
  burstDur: number;
}

/** Shared L-shape (vertical→horizontal→vertical) geometry. walkPath/pathThrough operate on this shape. */
export interface PathGeom {
  ox: number;
  oy: number;
  by: number;
  ex: number;
  ey: number;
  l1: number;
  l2: number;
  l3: number;
  total: number;
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
export class Connection implements PathGeom {
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
  bondDur = 0.6;
  pulseDur = 2.5;
  retractDur = 1;
  chasePeriod = 4;
  burstDur = 0.5;
  chaseDur = 3;
  /** Comet direction along the path. +1 = origin→endpoint (default, "push"), -1 = endpoint→origin ("intel inbound"). */
  pulseDir: 1 | -1 = 1;
  /** Counts up while in pulse + retract; renderer reads it to drive the post-resolve shimmer wave. */
  shimmerT = 0;
  /** Renderer multiplies shimmer reach + brightness by this. Automate sets it >1 for a larger ripple. */
  shimmerMul = 1;
  /** True when spawned by the autonomous sequencer; renderer keeps Morse-style chase for these. */
  automated = false;

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
    this.bondDur = d.bond;
    this.pulseDur = d.pulse;
    this.retractDur = d.retract;
    this.chasePeriod = d.chasePeriod;
    this.burstDur = d.burstDur;
    this.pulseDir = 1;
    this.shimmerT = 0;
    this.shimmerMul = 1;
    this.automated = false;
  }

  /** Demo: switch a freshly-extended connection into a loop of endpoint→origin "intel" pulses. */
  startInvestigation(): void {
    this.phase = "chase";
    this.pt = 0;
    this.chaseDur = Number.POSITIVE_INFINITY;
    this.pulseDir = -1;
  }

  /** Demo: fire one bright origin→endpoint pulse, then the existing ripple+retract. */
  startResolve(): void {
    this.phase = "pulse";
    this.pt = 0;
    this.pulseDir = 1;
    this.shimmerT = 0;
  }

  private recompute(): void {
    recomputePath(this);
  }

  /** Snap endpoint and elbow from the live target strand; safe to call twice per frame around wave phases. */
  syncFromTarget(): void {
    if (!this.target) return;
    this.ex = this.target.x;
    this.ey = this.target.y0;
    this.by = this.oy + this.byRatio * (this.ey - this.oy);
    this.recompute();
  }

  /** Phase timing only; pair with {@link syncFromTarget} after wave motion. */
  advance(dt: number): void {
    this.pt += dt;
    // Shimmer ring starts only after the outbound resolve pulse reaches the strand.
    if (
      this.phase === "retract" ||
      (this.phase === "pulse" && this.pt >= this.pulseDur)
    ) {
      this.shimmerT += dt;
    }
    if (this.phase === "extend" && this.pt >= this.extendDur) {
      this.phase = "bond";
      this.pt -= this.extendDur;
    } else if (this.phase === "bond" && this.pt >= this.bondDur) {
      this.phase = "chase";
      this.pt -= this.bondDur;
    } else if (this.phase === "chase" && this.pt >= this.chaseDur) {
      this.phase = "pulse";
      this.pt -= this.chaseDur;
      this.shimmerT = 0;
    } else if (this.phase === "pulse" && this.pt >= this.pulseDur) {
      this.phase = "retract";
      this.pt -= this.pulseDur;
    } else if (this.phase === "retract" && this.pt >= this.retractDur) {
      this.phase = "dead";
    }
  }

  step(dt: number): void {
    this.syncFromTarget();
    this.advance(dt);
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
export const walkPath = (c: PathGeom, u: number): Pt => {
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

/** Recompute segment lengths and total from ox/oy/by/ex/ey. Shared by Connection and one-shot pulses. */
export const recomputePath = (g: PathGeom): void => {
  g.l1 = Math.abs(g.by - g.oy);
  g.l2 = Math.abs(g.ex - g.ox);
  g.l3 = Math.abs(g.ey - g.by);
  g.total = g.l1 + g.l2 + g.l3;
};
