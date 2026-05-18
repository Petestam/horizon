import { Connection, type ConnDurations } from "./Connection.js";
import type { Strand } from "../entities/Strand.js";
import { mulberry32 } from "../util/math.js";
import { KIOSK_COUNT, MAX_WAVES } from "../config.js";

const TOWER_COUNT = KIOSK_COUNT;
/** Demo may attach one investigation per assigned wave on a kiosk. */
const MAX_PER_TOWER = MAX_WAVES;
/** Pixels from the bottom of the canvas (room for phase pill below orb). */
const TOWER_INSET = 36;
type OriginGridPhase = "closed" | "growing" | "open";

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export interface TowerParams {
  enabled: boolean;
  /** Mean seconds between spawn attempts across all towers. */
  spawnInterval: number;
  /** Seconds for the resolve pulse to travel origin → endpoint. */
  pulseDur: number;
  /** Time between burst starts during chase (burst + gap silence). */
  chasePeriod: number;
  /** Held beat between extend wrap and first burst — handshake. */
  bondDur: number;
  /** Single inbound telemetry burst duration during chase. */
  burstDur: number;
  /**
   * 0 = each tower may only target strands inside its own Voronoi cell;
   * 1 = any strand is reachable (cell edge linearly extended to canvas edge).
   */
  reach: number;
}

export interface Tower {
  x: number;
  y: number;
  conns: Connection[];
  /** Decays from 1 → 0 after a recent spawn; drives a subtle marker brightening. */
  pulse: number;
  /** Persistent 0..1 "this kiosk has unified its domains" level. Drives orb radius + halo. */
  unifiedLevel: number;
  /** Target level the orb is easing toward; set by demo unify pulses. */
  unifiedTarget: number;
  /** One-shot 0→1 expand for origin dot grid + orb (driven by unify, not per-pulse bumps). */
  originGrid: number;
  originGridPhase: OriginGridPhase;
  originGridTimer: number;
  originGridGrowDur: number;
  /** Fall pulses in flight for this kiosk's unify; origin grid waits for zero. */
  unifyPulsesPending: number;
  /** True from unify start until alert strand or domain connections replace the beat. */
  unifyPhasePill: boolean;
}

const durationsFor = (p: TowerParams): ConnDurations => ({
  extend: 1.0,
  bond: p.bondDur,
  pulse: p.pulseDur,
  retract: 1.0,
  chasePeriod: p.chasePeriod,
  burstDur: p.burstDur,
});

/**
 * Pick a bend Y between tower and target that clears the wave bands at both
 * elbow x's. We collect strand tops near `ox` and near `ex`, then return a
 * random y in the largest available gap between them. Returns -1 if no clean
 * slot fits, signaling the caller to try a different target.
 */
const findCleanBendY = (
  strands: readonly Strand[],
  ox: number,
  ex: number,
  oy: number,
  ey: number,
  rng: () => number,
): number => {
  const xTol = 22;
  const yMargin = 14;
  // The L runs from tower (oy) toward target (ey); sign(ey-oy) gives travel
  // direction. Reserve 40px next to the tower and 18px next to the target.
  const dir = ey >= oy ? 1 : -1;
  const a = oy + dir * 40;
  const b = ey - dir * 18;
  const minBy = Math.min(a, b);
  const maxBy = Math.max(a, b);
  if (maxBy <= minBy) return -1;

  const ys: number[] = [];
  for (const s of strands) {
    if (Math.abs(s.x - ox) < xTol || Math.abs(s.x - ex) < xTol) {
      ys.push(s.y0);
    }
  }
  ys.sort((a, b) => a - b);

  const gaps: Array<[number, number]> = [];
  let cursor = minBy;
  for (const y of ys) {
    const lo = y - yMargin;
    if (lo > cursor) gaps.push([cursor, Math.min(lo, maxBy)]);
    cursor = Math.max(cursor, y + yMargin);
    if (cursor >= maxBy) break;
  }
  if (cursor < maxBy) gaps.push([cursor, maxBy]);

  const valid = gaps.filter(([a, b]) => b - a >= 6);
  if (valid.length === 0) return -1;

  const total = valid.reduce((s, [a, b]) => s + (b - a), 0);
  let r = rng() * total;
  for (const [a, b] of valid) {
    const len = b - a;
    if (r < len) return a + r;
    r -= len;
  }
  return valid[0]![0];
};

export class TowerController {
  readonly towers: Tower[] = Array.from({ length: TOWER_COUNT }, () => ({
    x: 0,
    y: 0,
    conns: [] as Connection[],
    pulse: 0,
    unifiedLevel: 0,
    unifiedTarget: 0,
    originGrid: 0,
    originGridPhase: "closed" as OriginGridPhase,
    originGridTimer: 0,
    originGridGrowDur: 1.1,
    unifyPulsesPending: 0,
    unifyPhasePill: false,
  }));
  private spawnIn = 0.6;
  private rng = mulberry32(0xc01dca5e);
  private cssW = 0;

  resize(w: number, h: number): void {
    this.cssW = w;
    for (let i = 0; i < TOWER_COUNT; i++) {
      this.towers[i]!.x = w * (0.2 + 0.3 * i);
      this.towers[i]!.y = h - TOWER_INSET;
    }
  }

  /**
   * Per-tower Voronoi cell edges — midpoints to each adjacent tower, clamped
   * to the canvas edges for the leftmost / rightmost towers.
   */
  private cellEdges(towerX: number): [number, number] {
    let left = 0;
    let right = this.cssW;
    for (const o of this.towers) {
      if (o.x === towerX) continue;
      const mid = (o.x + towerX) / 2;
      if (o.x < towerX && mid > left) left = mid;
      else if (o.x > towerX && mid < right) right = mid;
    }
    return [left, right];
  }

  /**
   * Allowed target-x range for a tower, expanding the Voronoi cell linearly
   * with `reach` until it spans the full canvas at reach = 1. Returns
   * `[leftLimit, rightLimit]` in canvas pixels.
   */
  domainXRange(towerX: number, reach: number): [number, number] {
    const [cellL, cellR] = this.cellEdges(towerX);
    return [cellL * (1 - reach), cellR + (this.cssW - cellR) * reach];
  }

  /** Snap every live connection to its strand (run after the wave field for final geometry). */
  syncConnectionsFromTargets(): void {
    for (const t of this.towers) {
      for (const c of t.conns) c.syncFromTarget();
    }
  }

  /** Advance connection phases; geometry is synced elsewhere (see {@link syncConnectionsFromTargets}). */
  advanceConnections(dt: number): void {
    for (const t of this.towers) {
      for (const c of t.conns) c.advance(dt);
      for (let i = t.conns.length - 1; i >= 0; i--) {
        if (t.conns[i]!.dead) t.conns.splice(i, 1);
      }
      t.pulse = Math.max(0, t.pulse - dt * 0.7);
      t.unifiedLevel += (t.unifiedTarget - t.unifiedLevel) * Math.min(1, dt * 2.4);
    }
  }

  /** Ambient spawn attempts only; call after {@link syncConnectionsFromTargets} post-wave. */
  spawnTick(dt: number, strands: readonly Strand[], p: TowerParams): void {
    if (!p.enabled) return;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = p.spawnInterval * (0.5 + this.rng());
      this.trySpawn(strands, p);
    }
  }

  step(dt: number, strands: readonly Strand[], p: TowerParams): void {
    this.advanceConnections(dt);
    this.spawnTick(dt, strands, p);
  }

  fireOne(strands: readonly Strand[], p: TowerParams): void {
    this.trySpawn(strands, p);
  }

  clear(): void {
    for (const t of this.towers) {
      t.conns.length = 0;
      t.unifiedLevel = 0;
      t.unifiedTarget = 0;
      this.resetOriginGridState(t);
    }
  }

  resetOriginGrid(kiosk: number): void {
    const t = this.towers[kiosk];
    if (t) this.resetOriginGridState(t);
  }

  private resetOriginGridState(t: Tower): void {
    t.originGrid = 0;
    t.originGridPhase = "closed";
    t.originGridTimer = 0;
    t.unifyPulsesPending = 0;
    t.unifyPhasePill = false;
  }

  /** Awaiting unify fall pulses before origin grid / agent orbits may appear. */
  setUnifyPulsesPending(kiosk: number, count: number): void {
    const t = this.towers[kiosk];
    if (!t) return;
    const n = Math.max(0, count);
    if (n > 0) {
      t.originGrid = 0;
      t.originGridPhase = "closed";
      t.originGridTimer = 0;
      t.unifyPhasePill = true;
    }
    t.unifyPulsesPending = n;
  }

  clearUnifyPhasePill(kiosk: number): void {
    const t = this.towers[kiosk];
    if (t) t.unifyPhasePill = false;
  }

  /** Call when one unify pulse reaches the orb; starts grid grow after the last arrival. */
  onUnifyPulseArrived(kiosk: number, growDur = 1.0): void {
    const t = this.towers[kiosk];
    if (!t || t.unifyPulsesPending <= 0) return;
    t.unifyPulsesPending--;
    if (t.unifyPulsesPending > 0) return;
    t.pulse = 1;
    this.triggerOriginGridGrow(kiosk, growDur);
  }

  /** Single grow sweep for the origin dot field; retriggers on the next unify. */
  triggerOriginGridGrow(kiosk: number, growDur: number): void {
    const t = this.towers[kiosk];
    if (!t) return;
    if (t.originGridPhase === "open") return;
    t.originGridGrowDur = Math.max(0.35, growDur);
    t.originGridPhase = "growing";
    t.originGridTimer = 0;
    t.originGrid = 0;
  }

  /** Advance one-shot origin grow; stays open through alert → automate until reset. */
  stepOriginGrids(dt: number): void {
    for (const t of this.towers) {
      switch (t.originGridPhase) {
        case "growing": {
          t.originGridTimer += dt;
          const u = Math.min(1, t.originGridTimer / t.originGridGrowDur);
          t.originGrid = easeOutCubic(u);
          if (u >= 1) {
            t.originGrid = 1;
            t.originGridPhase = "open";
          }
          break;
        }
        case "open":
          t.originGrid = 1;
          break;
        case "closed":
          t.originGrid = 0;
          break;
      }
    }
  }

  /** Demo hook: bump kiosk N's orb a notch toward fully unified (clamped to 1). */
  bumpUnification(kiosk: number, amount = 0.25): void {
    const t = this.towers[kiosk];
    if (!t) return;
    t.unifiedTarget = Math.min(1, t.unifiedTarget + amount);
  }

  private trySpawn(strands: readonly Strand[], p: TowerParams): void {
    if (strands.length === 0) return;
    const order = [0, 1, 2];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const tower = order
      .map((i) => this.towers[i]!)
      .find((t) => t.conns.length < MAX_PER_TOWER);
    if (!tower) return;

    const [xLo, xHi] = this.domainXRange(tower.x, p.reach);
    const candidates = strands.filter((s) => s.x >= xLo && s.x <= xHi);
    if (candidates.length === 0) return;

    let target: Strand | null = null;
    let by = -1;
    for (let attempt = 0; attempt < 5 && by < 0; attempt++) {
      const t = candidates[Math.floor(this.rng() * candidates.length)]!;
      if (Math.abs(t.y0 - tower.y) < 60) continue;
      const candidate = findCleanBendY(strands, tower.x, t.x, tower.y, t.y0, this.rng);
      if (candidate >= 0) {
        target = t;
        by = candidate;
      }
    }
    if (!target || by < 0) return;

    const c = new Connection();
    c.init(tower.x, tower.y, by, target, 2.4 + this.rng() * 2.0, durationsFor(p));
    tower.conns.push(c);
    tower.pulse = 1;
    target.kick -= 80;
  }
}
