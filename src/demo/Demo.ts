import { ObjectPool } from "../entities/pool.js";
import type { Strand } from "../entities/Strand.js";
import type { Highlight } from "../entities/Highlight.js";
import type { WaveField } from "../waves/WaveField.js";
import type { TowerController } from "../towers/Tower.js";
import { Connection, type ConnDurations } from "../towers/Connection.js";
import { FallPulse, createFallPulse, resetFallPulse } from "./FallPulse.js";
import { KIOSK_COUNT, MAX_WAVES, type Params } from "../config.js";
import type { DemoStoryPhase } from "../render/phasePills.js";
import { mulberry32 } from "../util/math.js";

export type { DemoStoryPhase };

const FALL_CAP = 16;
const ALERT_LABEL = "Alert";
const INVESTIGATE_LABEL = "Investigating";
const RESOLVE_LABEL = "Resolving";
const AUTO_AGENT_LABEL = "auto · agent";
/** Total orb growth budget per unify trigger (split across arriving pulses). */
const UNIFY_BUMP = 0.45;
/** Seconds between each domain pulse leaving its wave. */
const UNIFY_STAGGER = 0.09;
/** Origin dot grid + agent orbits grow after the last unify pulse lands. */
const ORIGIN_GROW_AFTER_ARRIVAL = 1.0;

/** Quiet beats between ambient phases — ok to linger so each moment reads. */
const AMBIENT_AFTER_UNIFY = 0.7;
const AMBIENT_ALERT_HOLD = 3.2;
const AMBIENT_INVESTIGATE_HOLD = 2.8;
const AMBIENT_RESOLVE_DUR = 2.4;
const AMBIENT_RETRACT_DUR = 1.1;
const AMBIENT_AFTER_RESOLVE = 1.2;
const AMBIENT_AUTOMATE_CHASE_MAX = 8;
const AMBIENT_AFTER_AUTOMATE = 1.4;
const AMBIENT_BETWEEN_KIOSKS = 1.8;
const AMBIENT_CYCLE_REST = 4.5;

/** One kiosk session: many domain connections, single phase callout. */
interface KioskInvestigation {
  kiosk: number;
  conns: Connection[];
  /** Shown only during chase / resolve — not during extend or bond. */
  highlight: Highlight | null;
  label: string;
  detail: string;
  automated: boolean;
  /** Conns waiting for extend→chase before inbound telemetry starts. */
  pending: Set<Connection>;
}

/** Sequencer state for the operator `4` automate action (single kiosk). */
interface AutoStep {
  kind: "arm" | "wait" | "rest";
  remaining: number;
  kiosk: number;
}

/** Ambient story order per kiosk: Unify → Alert → Investigate → Resolve → Automate. */
type AmbientPhase =
  | "unify"
  | "alert"
  | "investigate"
  | "resolve"
  | "automate"
  | "automate_resolve"
  | "rest";

interface AmbientCycle {
  phase: AmbientPhase;
  remaining: number;
  kiosk: number;
  /** Strand callout shown during the alert beat. */
  alertHighlight: Highlight | null;
  /** Seconds left in the investigate chase hold once every domain link is chasing. */
  chaseHold: number;
}

export interface DemoDeps {
  field: WaveField;
  towers: TowerController;
  highlights: ObjectPool<Highlight>;
  paramsRef: () => Params;
}

/**
 * Operator-driven demo flow on top of the existing field + towers.
 *
 * Phases:
 *  - unify: fall pulse from domain strand into the kiosk orb
 *  - alert: strand callout pill (kiosk-event style)
 *  - investigate: one connection per domain wave, single shared phase callout
 *  - resolve: all domain connections pulse, shimmer, and retract together
 *  - automate: scripted Morse-style investigate → resolve
 *
 * With `ambientDemo`, each kiosk cycles through that order automatically.
 * While the demo is active the ambient `TowerController` auto-spawn is suppressed.
 */
export class DemoController {
  readonly pulses = new ObjectPool<FallPulse>(createFallPulse, resetFallPulse, FALL_CAP);
  private rng = mulberry32(0xdee70);
  private investigations: KioskInvestigation[] = [];
  private auto: AutoStep | null = null;
  private ambient: AmbientCycle | null = null;
  private nextUnifyKiosk = 0;
  private nextInvestigateKiosk = 0;

  constructor(private readonly deps: DemoDeps) {}

  get active(): boolean {
    return (
      this.investigations.length > 0 ||
      this.pulses.activeCount > 0 ||
      this.auto !== null ||
      this.ambientActive()
    );
  }

  unify(): void {
    const kiosk = this.nextUnifyKiosk;
    this.nextUnifyKiosk = (this.nextUnifyKiosk + 1) % KIOSK_COUNT;
    this.fireUnify(kiosk);
  }

  investigate(detail = ""): void {
    const kiosk = this.nextInvestigateKiosk;
    this.nextInvestigateKiosk = (this.nextInvestigateKiosk + 1) % KIOSK_COUNT;
    this.fireInvestigate(kiosk, detail);
  }

  resolve(): void {
    for (const g of this.investigations) {
      for (const c of g.conns) {
        if (c.phase === "chase") c.startResolve();
      }
    }
  }

  automate(): void {
    if (this.auto) return;
    this.auto = { kind: "arm", remaining: 0, kiosk: 0 };
  }

  /** Operator override: force a story phase on one kiosk (clears that kiosk's demo state first). */
  forcePhase(kiosk: number, phase: DemoStoryPhase): void {
    if (kiosk < 0 || kiosk >= KIOSK_COUNT) return;
    this.clearKiosk(kiosk);
    const detail = this.deps.paramsRef().labelText.trim() || "test · operator";
    switch (phase) {
      case "unify":
        this.fireUnify(kiosk);
        break;
      case "alert":
        this.fireAlert(kiosk, detail);
        break;
      case "investigate":
        this.fireInvestigate(kiosk, "");
        break;
      case "resolve":
        this.resolveKiosk(kiosk);
        break;
      case "automate": {
        this.fireInvestigate(kiosk, "auto · agent", true);
        const g = this.groupForKiosk(kiosk);
        if (g) {
          for (const c of g.conns) {
            if (c.phase === "chase") {
              c.shimmerMul = 1.8;
              c.startResolve();
            }
          }
        }
        break;
      }
      case "idle":
        break;
    }
  }

  reset(): void {
    for (const g of this.investigations) {
      for (const c of g.conns) c.phase = "dead";
      if (g.highlight) this.deps.highlights.release(g.highlight);
    }
    this.investigations.length = 0;
    for (const p of this.pulses.getActive().slice()) this.pulses.release(p);
    if (this.ambient?.alertHighlight) this.deps.highlights.release(this.ambient.alertHighlight);
    this.deps.towers.clear();
    this.auto = null;
    this.ambient = null;
    this.nextUnifyKiosk = 0;
    this.nextInvestigateKiosk = 0;
  }

  step(dt: number): void {
    for (const p of this.pulses.getActive().slice()) {
      p.step(dt);
      if (!p.arrived && p.t >= p.duration * 0.96) {
        p.arrived = true;
        this.deps.towers.bumpUnification(p.kiosk, p.bump);
        this.deps.towers.onUnifyPulseArrived(p.kiosk, ORIGIN_GROW_AFTER_ARRIVAL);
      }
      if (p.dead) this.pulses.release(p);
    }

    for (let i = this.investigations.length - 1; i >= 0; i--) {
      const g = this.investigations[i]!;
      for (const c of g.conns) {
        if (g.pending.has(c) && c.phase === "chase") {
          c.startInvestigation();
          g.pending.delete(c);
        }
      }
      this.syncGroupLabel(g);
      this.syncHighlightAnchor(g);
      if (g.highlight?.pinned && g.conns.some((c) => c.phase === "retract")) g.highlight.release();
      g.conns = g.conns.filter((c) => !c.dead);
      if (g.conns.length === 0) {
        if (g.highlight) this.deps.highlights.release(g.highlight);
        this.investigations.splice(i, 1);
      }
    }

    if (this.auto) this.stepAuto(dt);
    if (this.deps.paramsRef().ambientDemo && !this.auto) this.stepAmbient(dt);
  }

  // ─── unify ────────────────────────────────────────────────────────────────

  private fireUnify(kiosk: number): void {
    const tower = this.deps.towers.towers[kiosk];
    if (!tower) return;
    const p = this.deps.paramsRef();
    const strands = this.deps.field.pool.getActive();
    if (strands.length === 0) return;
    const waves = this.assignedWavesForKiosk(kiosk, p);
    if (waves.length === 0) return;

    const hasSecondary = p.secondaryScale > 0.01 && p.secondaryDensity > 0.01;
    const targets: Strand[] = [];
    for (const w of waves) {
      const primary = this.pickStrandOnWave(strands, w, kiosk, true);
      if (primary) targets.push(primary);
      if (hasSecondary) {
        const secondary = this.pickStrandOnWave(strands, w, kiosk, false);
        if (secondary) targets.push(secondary);
      }
    }
    if (targets.length === 0) return;

    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [targets[i], targets[j]] = [targets[j]!, targets[i]!];
    }

    const hitTime = (targets.length - 1) * UNIFY_STAGGER + p.unifyPulseDur;
    this.deps.towers.setUnifyPulsesPending(kiosk, targets.length);
    const bumpEach = UNIFY_BUMP / targets.length;
    for (let i = 0; i < targets.length; i++) {
      const depart = i * UNIFY_STAGGER;
      const duration = Math.max(0.35, hitTime - depart);
      this.scheduleFallPulse(tower.x, tower.y, targets[i]!, kiosk, duration, depart, bumpEach);
    }
  }

  /** Wall-clock length of a full multi-wave unify swarm for one kiosk. */
  private unifyBeatDuration(kiosk: number): number {
    const n = this.unifyPulseCount(kiosk);
    const p = this.deps.paramsRef();
    return Math.max(p.unifyPulseDur, (Math.max(1, n) - 1) * UNIFY_STAGGER + p.unifyPulseDur);
  }

  private unifyPulseCount(kiosk: number): number {
    const p = this.deps.paramsRef();
    const layers = p.secondaryScale > 0.01 && p.secondaryDensity > 0.01 ? 2 : 1;
    return this.assignedWavesForKiosk(kiosk, p).length * layers;
  }

  private scheduleFallPulse(
    orbX: number,
    orbY: number,
    target: Strand,
    kiosk: number,
    duration: number,
    hold = 0,
    bump = UNIFY_BUMP,
  ): void {
    const pulse = this.pulses.acquire();
    if (!pulse) return;
    const oy = target.y0;
    const by = oy + (orbY - oy) * (0.45 + this.rng() * 0.2);
    pulse.init(target.x, oy, orbX, orbY, by, kiosk, duration, hold, bump);
  }

  // ─── alert / investigate / resolve ────────────────────────────────────────

  private fireAlert(kiosk: number, detail: string): Highlight | null {
    this.deps.towers.clearUnifyPhasePill(kiosk);
    const p = this.deps.paramsRef();
    const strands = this.deps.field.pool.getActive();
    if (strands.length === 0) return null;
    const candidateWaves = this.reachableWavesForKiosk(kiosk, strands, p, true, true);
    if (candidateWaves.length === 0) return null;
    const wave = candidateWaves[Math.floor(this.rng() * candidateWaves.length)]!;
    const target = this.pickStrandOnWave(strands, wave, kiosk, true, true);
    if (!target) return null;
    const h = this.deps.highlights.acquire();
    if (!h) return null;
    h.init(target, ALERT_LABEL, 3.2);
    h.setText(ALERT_LABEL, detail);
    target.kick -= 50;
    return h;
  }

  /** One investigation link per assigned domain wave (respects kiosk reach). */
  private fireInvestigate(kiosk: number, detail: string, automated = false): Connection[] {
    const tower = this.deps.towers.towers[kiosk];
    if (!tower) return [];
    const p = this.deps.paramsRef();
    const strands = this.deps.field.pool.getActive();
    if (strands.length === 0) return [];
    const waves = this.reachableWavesForKiosk(kiosk, strands, p, true);
    if (waves.length === 0) return [];

    let group = this.groupForKiosk(kiosk);
    const created: Connection[] = [];
    for (const w of waves) {
      if (tower.conns.length >= MAX_WAVES) break;
      const target = this.pickStrandOnWave(strands, w, kiosk);
      if (!target) continue;
      if (tower.conns.some((c) => c.target === target && !c.dead)) continue;
      if (this.investigations.some((g) => g.conns.some((c) => c.target === target && !c.dead))) continue;

      const c = new Connection();
      const dy = target.y0 - tower.y;
      const by = tower.y + dy * 0.55;
      c.init(tower.x, tower.y, by, target, 9_999, this.durations(p));
      c.automated = automated;
      tower.conns.push(c);
      target.kick -= 80;
      if (!group) {
        group = {
          kiosk,
          conns: [],
          highlight: null,
          label: "",
          detail,
          automated,
          pending: new Set(),
        };
        this.investigations.push(group);
      }
      if (!automated) group.pending.add(c);
      group.conns.push(c);
      created.push(c);
    }
    if (created.length > 0) tower.pulse = 1;
    if (created.length > 0) this.deps.towers.clearUnifyPhasePill(kiosk);
    return created;
  }

  private durations(p: Params): ConnDurations {
    return {
      extend: 1.0,
      bond: p.towerBondDur,
      pulse: Math.min(2.2, p.towerPulseDur),
      retract: 1.0,
      chasePeriod: p.towerChasePeriod,
      burstDur: p.towerBurstDur,
    };
  }

  private groupForKiosk(kiosk: number): KioskInvestigation | undefined {
    return this.investigations.find((g) => g.kiosk === kiosk);
  }

  private leadConn(g: KioskInvestigation): Connection | undefined {
    let lead: Connection | undefined;
    for (const c of g.conns) {
      if (c.dead) continue;
      if (!lead || c.ey < lead.ey) lead = c;
    }
    return lead;
  }

  private syncGroupLabel(g: KioskInvestigation): void {
    const resolving = g.conns.some((c) => c.phase === "pulse" || c.phase === "retract");
    const chasing = g.conns.some((c) => c.phase === "chase");
    if (!resolving && !chasing) return;

    if (!g.highlight) {
      const lead = this.leadConn(g);
      if (!lead) return;
      const h = this.deps.highlights.acquire();
      if (!h) return;
      h.initConn(lead, "", g.detail);
      g.highlight = h;
    }
    this.syncHighlightAnchor(g);

    if (resolving && g.label !== RESOLVE_LABEL) {
      g.label = RESOLVE_LABEL;
      g.highlight!.setText(RESOLVE_LABEL, g.automated ? "" : g.detail);
    } else if (chasing && g.label !== RESOLVE_LABEL) {
      if (g.automated) {
        g.label = AUTO_AGENT_LABEL;
        g.highlight!.setText(AUTO_AGENT_LABEL, "");
      } else {
        g.label = INVESTIGATE_LABEL;
        g.highlight!.setText(INVESTIGATE_LABEL, g.detail);
      }
    }
  }

  /** Anchor the shared callout on the topmost active domain endpoint. */
  private syncHighlightAnchor(g: KioskInvestigation): void {
    const lead = this.leadConn(g);
    if (lead && g.highlight) g.highlight.conn = lead;
  }

  private clearKiosk(kiosk: number): void {
    const tower = this.deps.towers.towers[kiosk];
    if (!tower) return;
    this.deps.towers.resetOriginGrid(kiosk);
    const g = this.groupForKiosk(kiosk);
    if (g) {
      for (const c of g.conns) c.phase = "dead";
      if (g.highlight) this.deps.highlights.release(g.highlight);
      this.investigations = this.investigations.filter((x) => x !== g);
    }
    tower.conns.length = 0;
    for (const p of this.pulses.getActive().slice()) {
      if (p.kiosk === kiosk) this.pulses.release(p);
    }
    if (this.ambient?.kiosk === kiosk) {
      if (this.ambient.alertHighlight) {
        this.deps.highlights.release(this.ambient.alertHighlight);
        this.ambient.alertHighlight = null;
      }
    }
  }

  private allDomainsChasing(kiosk: number): boolean {
    const g = this.groupForKiosk(kiosk);
    return !!g && g.conns.length > 0 && g.conns.every((c) => c.phase === "chase");
  }

  private resolveKiosk(kiosk: number): void {
    const g = this.groupForKiosk(kiosk);
    if (!g) return;
    for (const c of g.conns) {
      if (c.phase === "chase") c.startResolve();
    }
  }

  // ─── ambient sequencer ──────────────────────────────────────────────────────

  private ambientActive(): boolean {
    return this.ambient !== null && this.deps.paramsRef().ambientDemo;
  }

  private stepAmbient(dt: number): void {
    const p = this.deps.paramsRef();
    if (!p.ambientDemo) {
      if (this.ambient?.alertHighlight) this.deps.highlights.release(this.ambient.alertHighlight);
      this.ambient = null;
      return;
    }
    if (!this.ambient) {
      this.ambient = {
        phase: "unify",
        remaining: 1.2,
        kiosk: 0,
        alertHighlight: null,
        chaseHold: 0,
      };
    }
    const a = this.ambient;
    a.remaining -= dt;

    if (a.phase === "investigate") {
      if (!this.groupForKiosk(a.kiosk)) {
        if (a.alertHighlight) {
          this.deps.highlights.release(a.alertHighlight);
          a.alertHighlight = null;
        }
        const conns = this.fireInvestigate(a.kiosk, "");
        a.chaseHold = 0;
        a.remaining = 8;
        if (conns.length === 0) this.enterAmbientPhase(a, "automate", 1.0);
        return;
      }
      if (this.allDomainsChasing(a.kiosk)) {
        if (a.chaseHold <= 0) a.chaseHold = AMBIENT_INVESTIGATE_HOLD;
        a.chaseHold -= dt;
        if (a.chaseHold <= 0) this.enterAmbientPhase(a, "resolve", 0);
      } else if (a.remaining <= 0) {
        this.enterAmbientPhase(a, "automate", 1.0);
      }
      return;
    }

    if (a.phase === "automate_resolve") {
      let started = false;
      const g = this.groupForKiosk(a.kiosk);
      if (g) {
        for (const c of g.conns) {
          if (c.phase !== "chase") continue;
          c.shimmerMul = 1.8;
          c.startResolve();
          started = true;
        }
      }
      if (started) {
        const p = this.deps.paramsRef();
        this.enterAmbientPhase(
          a,
          "rest",
          Math.min(AMBIENT_RESOLVE_DUR, p.towerPulseDur) + AMBIENT_RETRACT_DUR + AMBIENT_AFTER_AUTOMATE,
        );
      } else if (a.remaining <= -AMBIENT_AUTOMATE_CHASE_MAX) {
        this.enterAmbientPhase(a, "rest", AMBIENT_AFTER_AUTOMATE);
      }
      return;
    }

    if (a.remaining > 0) return;

    switch (a.phase) {
      case "unify":
        this.fireUnify(a.kiosk);
        this.enterAmbientPhase(a, "alert", this.unifyBeatDuration(a.kiosk) + AMBIENT_AFTER_UNIFY);
        break;
      case "alert": {
        const detail = p.labelText.trim() || "test · operator";
        if (a.alertHighlight) this.deps.highlights.release(a.alertHighlight);
        a.alertHighlight = this.fireAlert(a.kiosk, detail);
        this.enterAmbientPhase(a, "investigate", AMBIENT_ALERT_HOLD);
        break;
      }
      case "resolve": {
        this.resolveKiosk(a.kiosk);
        this.enterAmbientPhase(
          a,
          "automate",
          Math.min(AMBIENT_RESOLVE_DUR, p.towerPulseDur) + AMBIENT_RETRACT_DUR + AMBIENT_AFTER_RESOLVE,
        );
        break;
      }
      case "automate": {
        this.fireInvestigate(a.kiosk, "auto · agent", true);
        this.enterAmbientPhase(a, "automate_resolve", AMBIENT_AUTOMATE_CHASE_MAX);
        break;
      }
      case "rest": {
        const next = (a.kiosk + 1) % KIOSK_COUNT;
        const gap = next === 0 ? AMBIENT_CYCLE_REST : AMBIENT_BETWEEN_KIOSKS;
        a.kiosk = next;
        this.enterAmbientPhase(a, "unify", gap);
        break;
      }
    }
  }

  private enterAmbientPhase(a: AmbientCycle, phase: AmbientPhase, remaining: number): void {
    a.phase = phase;
    a.remaining = remaining;
  }

  // ─── operator automate sequencer ──────────────────────────────────────────

  private stepAuto(dt: number): void {
    const a = this.auto;
    if (!a) return;
    a.remaining -= dt;
    if (a.remaining > 0) return;
    if (a.kind === "arm") {
      this.fireInvestigate(a.kiosk, "auto · agent", true);
      this.auto = { kind: "wait", remaining: 2.2, kiosk: a.kiosk };
    } else if (a.kind === "wait") {
      const g = this.groupForKiosk(a.kiosk);
      if (g) {
        for (const c of g.conns) {
          if (c.phase !== "chase") continue;
          c.shimmerMul = 1.8;
          c.startResolve();
        }
      }
      this.auto = { kind: "rest", remaining: 1.8, kiosk: a.kiosk };
    } else if (a.kind === "rest") {
      const next = a.kiosk + 1;
      this.auto = next >= KIOSK_COUNT ? null : { kind: "arm", remaining: 0.5, kiosk: next };
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private assignedWavesForKiosk(kiosk: number, p: Params): number[] {
    const waves: number[] = [];
    for (let w = 0; w < p.waves; w++) {
      if ((p.kioskAssignments[w] ?? 0) === kiosk) waves.push(w);
    }
    return waves;
  }

  private domainXRange(kiosk: number): [number, number] | null {
    const tower = this.deps.towers.towers[kiosk];
    if (!tower) return null;
    return this.deps.towers.domainXRange(tower.x, this.deps.paramsRef().towerReach);
  }

  private strandInDomain(kiosk: number, s: Strand, p: Params): boolean {
    if ((p.kioskAssignments[s.waveRow] ?? 0) !== kiosk) return false;
    const range = this.domainXRange(kiosk);
    if (!range) return false;
    return s.x >= range[0] && s.x <= range[1];
  }

  /** Waves assigned to `kiosk` that have at least one matching strand inside domain reach. */
  private reachableWavesForKiosk(
    kiosk: number,
    strands: readonly Strand[],
    p: Params,
    primary: boolean,
    preferUnhighlighted = false,
  ): number[] {
    const out: number[] = [];
    for (const w of this.assignedWavesForKiosk(kiosk, p)) {
      if (this.pickStrandOnWave(strands, w, kiosk, primary, preferUnhighlighted)) out.push(w);
    }
    return out;
  }

  private pickStrandOnWave(
    strands: readonly Strand[],
    waveRow: number,
    kiosk: number,
    primary = true,
    preferUnhighlighted = false,
  ): Strand | null {
    const p = this.deps.paramsRef();
    const range = this.domainXRange(kiosk);
    if (!range) return null;
    const [xLo, xHi] = range;
    const matches: Strand[] = [];
    for (const s of strands) {
      if (s.waveRow !== waveRow || s.primary !== primary) continue;
      if (!this.strandInDomain(kiosk, s, p)) continue;
      if (preferUnhighlighted && s.highlighted) continue;
      matches.push(s);
    }
    if (matches.length === 0) {
      for (const s of strands) {
        if (s.waveRow !== waveRow || s.primary !== primary) continue;
        if ((p.kioskAssignments[s.waveRow] ?? 0) !== kiosk) continue;
        if (s.x < xLo || s.x > xHi) continue;
        if (preferUnhighlighted && s.highlighted) continue;
        matches.push(s);
      }
    }
    if (matches.length === 0) return null;
    return matches[Math.floor(this.rng() * matches.length)]!;
  }
}
