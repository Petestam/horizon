import type { Strand } from "./Strand.js";
import type { Connection } from "../towers/Connection.js";

/**
 * A labeled pill anchored to either:
 *  - a strand (legacy kiosk events; pill sits above the strand endpoint)
 *  - a connection (demo phases; pill follows the moving endpoint, primary line is the phase label
 *    and the optional secondary line is detail copy from the socket payload)
 */
export class Highlight {
  strand: Strand | null = null;
  conn: Connection | null = null;
  label = "";
  subtext = "";
  age = 0;
  fadeIn = 0.8;
  hold = 4;
  fadeOut = 1.2;
  /** When true the pill ignores `hold`; demo controller manages life via `release()`. */
  pinned = false;
  dead = false;
  /** Smoothed pill rect mirrored from layout targets; pillX = left, pillY = center, pillW/H = size. */
  dispX = 0;
  dispY = 0;
  dispW = 0;
  dispH = 0;
  /** False until the renderer has snapped disp* to its first target (avoids slide from origin). */
  displayed = false;

  reset(): void {
    if (this.strand) this.strand.highlighted = false;
    this.strand = null;
    this.conn = null;
    this.label = "";
    this.subtext = "";
    this.age = 0;
    this.fadeIn = 0.8;
    this.hold = 4;
    this.fadeOut = 1.2;
    this.pinned = false;
    this.dead = false;
    this.dispX = 0;
    this.dispY = 0;
    this.dispW = 0;
    this.dispH = 0;
    this.displayed = false;
  }

  init(strand: Strand, label: string, ttlMs: number): void {
    this.strand = strand;
    this.label = label;
    this.subtext = "";
    this.age = 0;
    this.hold = Math.max(0.5, ttlMs / 1000);
    this.pinned = false;
    this.dead = false;
    strand.highlighted = true;
  }

  initConn(conn: Connection, label: string, subtext = ""): void {
    this.conn = conn;
    this.label = label;
    this.subtext = subtext;
    this.age = 0;
    this.pinned = true;
    this.dead = false;
  }

  setText(label: string, subtext = ""): void {
    this.label = label;
    this.subtext = subtext;
  }

  /** Demo: end pinned mode; pill fades out via fadeOut window. */
  release(): void {
    if (!this.pinned) return;
    this.pinned = false;
    this.age = this.fadeIn + this.hold;
  }

  step(dt: number): void {
    this.age += dt;
    if (this.pinned) {
      this.age = Math.min(this.age, this.fadeIn);
      return;
    }
    if (this.age >= this.fadeIn + this.hold + this.fadeOut) this.dead = true;
    if (this.conn && this.conn.phase === "dead") this.dead = true;
  }

  opacity(): number {
    const { age, fadeIn, hold, fadeOut, pinned } = this;
    const ease = (t: number): number =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    if (age < fadeIn) return ease(age / fadeIn);
    if (pinned || age < fadeIn + hold) return 1;
    return Math.max(0, 1 - ease((age - fadeIn - hold) / fadeOut));
  }
}

export const createHighlight = (): Highlight => new Highlight();
export const resetHighlight = (h: Highlight): void => h.reset();
