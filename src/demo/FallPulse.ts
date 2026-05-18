import type { PathGeom } from "../towers/Connection.js";
import { recomputePath } from "../towers/Connection.js";

/**
 * A one-shot comet that follows an L-shape from a wave point down to a kiosk orb.
 * Geometry-only — no extend/retract lifecycle — so the renderer just draws the
 * head + tail at `t / duration`. Pooled by `DemoController`.
 *
 * On arrival the controller bumps the destination orb's unification level.
 */
export class FallPulse implements PathGeom {
  ox = 0;
  oy = 0;
  by = 0;
  ex = 0;
  ey = 0;
  l1 = 0;
  l2 = 0;
  l3 = 0;
  total = 0;
  t = 0;
  duration = 1;
  /** Hold at the strand before traveling (staggered multi-wave unify). */
  hold = 0;
  /** Credits the orb on arrival; split across pulses in a unify swarm. */
  bump = 0.2;
  /** Destination kiosk index; bumped on arrival. */
  kiosk = 0;
  /** Set true once `bumpUnification` has fired so we only credit the orb once. */
  arrived = false;
  dead = false;

  reset(): void {
    this.ox = 0;
    this.oy = 0;
    this.by = 0;
    this.ex = 0;
    this.ey = 0;
    this.l1 = 0;
    this.l2 = 0;
    this.l3 = 0;
    this.total = 0;
    this.t = 0;
    this.duration = 1;
    this.hold = 0;
    this.bump = 0.2;
    this.kiosk = 0;
    this.arrived = false;
    this.dead = false;
  }

  init(
    ox: number,
    oy: number,
    ex: number,
    ey: number,
    by: number,
    kiosk: number,
    duration: number,
    hold = 0,
    bump = 0.2,
  ): void {
    this.ox = ox;
    this.oy = oy;
    this.ex = ex;
    this.ey = ey;
    this.by = by;
    this.kiosk = kiosk;
    this.duration = Math.max(0.1, duration);
    this.hold = Math.max(0, hold);
    this.bump = bump;
    this.t = 0;
    this.arrived = false;
    this.dead = false;
    recomputePath(this);
  }

  step(dt: number): void {
    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    this.t += dt;
    if (this.t >= this.duration) this.dead = true;
  }
}

export const createFallPulse = (): FallPulse => new FallPulse();
export const resetFallPulse = (p: FallPulse): void => p.reset();
