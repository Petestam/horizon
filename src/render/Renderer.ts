import type { Strand } from "../entities/Strand.js";
import type { Highlight } from "../entities/Highlight.js";
import type { Tower } from "../towers/Tower.js";
import type { Params } from "../config.js";

export interface Renderer {
  readonly name: string;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  paramsChanged(params: Params, recacheStatic: boolean): void;
  beginFrame(): void;
  drawStrands(strands: readonly Strand[]): void;
  drawTowers(towers: readonly Tower[]): void;
  drawHighlights(highlights: readonly Highlight[]): void;
  endFrame(): void;
}
