import type { Strand } from "../entities/Strand.js";
import type { Highlight } from "../entities/Highlight.js";
import type { Tower } from "../towers/Tower.js";
import type { FallPulse } from "../demo/FallPulse.js";
import type { Params } from "../config.js";

export interface Renderer {
  readonly name: string;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  /** Min Y (canvas px) for the top edge of callout pills; horizontal inset for clamping pill X. */
  setHighlightMargins(m: { topMin: number; sidePad: number }): void;
  paramsChanged(params: Params, recacheStatic: boolean): void;
  beginFrame(timeSeconds: number): void;
  drawStrands(strands: readonly Strand[]): void;
  drawTowers(towers: readonly Tower[]): void;
  /**
   * Additive overlay across nearby strand strokes + endpoints emanating from
   * any tower connection in pulse/retract. Called between strands and towers
   * so the brightening reads as "the resolve wave touched this strand".
   */
  drawShimmers(strands: readonly Strand[], towers: readonly Tower[]): void;
  drawFallPulses(pulses: readonly FallPulse[]): void;
  /** Debug phase pills below each tower; drawn above origin grid and pulses. */
  drawPhasePills(towers: readonly Tower[]): void;
  drawHighlights(highlights: readonly Highlight[]): void;
  /** Stage-space hit test for debug phase pills; returns kiosk index or null. */
  hitPhasePill(cssX: number, cssY: number, towers: readonly Tower[]): number | null;
  endFrame(): void;
}
