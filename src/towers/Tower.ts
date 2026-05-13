import { Connection, type ConnDurations } from "./Connection.js";
import type { Strand } from "../entities/Strand.js";
import { mulberry32 } from "../util/math.js";

const TOWER_COUNT = 3;
const MAX_PER_TOWER = 3;
/** Pixels from the bottom of the canvas. */
const TOWER_INSET = 22;

export interface TowerParams {
  enabled: boolean;
  /** Mean seconds between spawn attempts across all towers. */
  spawnInterval: number;
  /** Seconds for the gradient comet to travel origin → endpoint. */
  pulseDur: number;
  /** Seconds for one comet lap along the path during chase. */
  chasePeriod: number;
}

export interface Tower {
  x: number;
  y: number;
  conns: Connection[];
  /** Decays from 1 → 0 after a recent spawn; drives a subtle marker brightening. */
  pulse: number;
}

const between = (v: number, a: number, b: number): boolean =>
  v >= Math.min(a, b) && v <= Math.max(a, b);

/**
 * For each new connection, find every crossing with already-spawned connections
 * from the same tower and return the distances along this path where they meet.
 * The renderer paints a soft drop shadow at each point so the later trace reads
 * as floating above the earlier one.
 */
const computeBridges = (c: Connection, before: readonly Connection[]): number[] => {
  const out: number[] = [];
  for (const o of before) {
    // c's horizontal at y=c.by may cross o's seg-3 (vertical from o.by to o.ey).
    if (between(c.by, o.by, o.ey) && between(o.ex, c.ox, c.ex)) {
      out.push(c.l1 + Math.abs(o.ex - c.ox));
    }
    // c's seg-3 (vertical from c.by to c.ey) may cross o's horizontal at y=o.by.
    if (between(o.by, c.by, c.ey) && between(c.ex, o.ox, o.ex)) {
      out.push(c.l1 + c.l2 + Math.abs(o.by - c.by));
    }
  }
  return out.sort((a, b) => a - b);
};

const durationsFor = (p: TowerParams): ConnDurations => ({
  extend: 1.0,
  pulse: p.pulseDur,
  retract: 1.0,
  chasePeriod: p.chasePeriod,
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
  }));
  private spawnIn = 0.6;
  private rng = mulberry32(0xc01dca5e);

  resize(w: number, h: number): void {
    for (let i = 0; i < TOWER_COUNT; i++) {
      this.towers[i]!.x = w * (0.2 + 0.3 * i);
      this.towers[i]!.y = h - TOWER_INSET;
    }
  }

  step(dt: number, strands: readonly Strand[], p: TowerParams): void {
    for (const t of this.towers) {
      for (const c of t.conns) c.step(dt);
      for (let i = t.conns.length - 1; i >= 0; i--) {
        if (t.conns[i]!.dead) t.conns.splice(i, 1);
      }
      for (let i = 0; i < t.conns.length; i++) {
        t.conns[i]!.bridges = computeBridges(t.conns[i]!, t.conns.slice(0, i));
      }
      t.pulse = Math.max(0, t.pulse - dt * 0.7);
    }
    if (!p.enabled) return;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = p.spawnInterval * (0.5 + this.rng());
      this.trySpawn(strands, p);
    }
  }

  fireOne(strands: readonly Strand[], p: TowerParams): void {
    this.trySpawn(strands, p);
  }

  clear(): void {
    for (const t of this.towers) t.conns.length = 0;
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

    let target: Strand | null = null;
    let by = -1;
    for (let attempt = 0; attempt < 5 && by < 0; attempt++) {
      const t = strands[Math.floor(this.rng() * strands.length)]!;
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
