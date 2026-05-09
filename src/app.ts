import { State, isColorChange, isCountChange } from "./state.js";
import { type Params, HIGHLIGHT_CAP } from "./config.js";
import { WaveField } from "./waves/WaveField.js";
import { ObjectPool } from "./entities/pool.js";
import { type Highlight, createHighlight, resetHighlight } from "./entities/Highlight.js";
import { Canvas2DRenderer } from "./render/Canvas2DRenderer.js";
import type { Renderer } from "./render/Renderer.js";
import { EventBus } from "./events/EventBus.js";
import { startKioskMock } from "./events/kioskMock.js";
import { runLoop } from "./loop.js";
import { effectiveDpr } from "./util/dpr.js";
import { mountOverlay } from "./ui/Overlay.js";
import { loadLastParams } from "./ui/tunerStorage.js";

export class App {
  readonly state = new State();
  readonly bus = new EventBus();
  private renderer: Renderer;
  private field = new WaveField();
  private highlights = new ObjectPool<Highlight>(createHighlight, resetHighlight, HIGHLIGHT_CAP);
  private overlay: ReturnType<typeof mountOverlay>;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private stopLoop?: () => void;
  private stopMock?: () => void;

  constructor(canvas: HTMLCanvasElement, overlayRoot: HTMLElement) {
    const hydrated = loadLastParams();
    if (hydrated) this.state.replace(hydrated);

    this.renderer = new Canvas2DRenderer(canvas);
    this.overlay = mountOverlay(overlayRoot, this.state, {
      fireTestLabel: () => this.fireTestLabel(),
      clearLabels: () => this.clearLabels(),
    });

    this.applyResize();
    this.field.rebuild(this.state.params);
    this.renderer.paramsChanged(this.state.params, true);

    this.state.subscribe((changed) => {
      this.renderer.paramsChanged(this.state.params, isColorChange(changed));
      if (isCountChange(changed)) this.field.rebuild(this.state.params);
    });

    window.addEventListener("resize", () => this.applyResize());

    this.bus.on("kiosk:event", (e) => {
      if (this.state.params.labelsEnabled) this.spawnHighlight(e.label, e.ttlMs);
    });
  }

  fireTestLabel(): void {
    this.bus.emit("kiosk:event", {
      id: `manual-${Date.now()}`,
      label: "test · operator",
      ttlMs: 4000,
    });
  }

  clearLabels(): void {
    for (const h of this.highlights.getActive().slice()) this.highlights.release(h);
  }

  start(): void {
    this.stopMock = startKioskMock(this.bus);
    this.stopLoop = runLoop({
      update: (dt) => this.update(dt),
      render: () => this.render(),
      onFps: (fps) => this.overlay.setFps(fps),
    });
  }

  stop(): void {
    this.stopLoop?.();
    this.stopMock?.();
    this.overlay.destroy();
  }

  private applyResize(): void {
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    this.dpr = effectiveDpr();
    this.renderer.resize(this.cssW, this.cssH, this.dpr);
    this.field.resize(this.cssW, this.cssH);
    this.overlay.setRendererInfo(
      this.renderer.name,
      Math.round(this.cssW * this.dpr),
      Math.round(this.cssH * this.dpr),
      this.dpr,
    );
  }

  private spawnHighlight(label: string, ttlMs: number): void {
    const strands = this.field.pool.getActive();
    const candidates = strands.filter((s) => s.primary && !s.highlighted);
    if (candidates.length === 0) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)]!;
    const h = this.highlights.acquire();
    if (!h) return;
    h.init(target, label, ttlMs);
  }

  private update(dt: number): void {
    const p: Params = this.state.params;
    this.field.step(dt, p);
    for (const h of this.highlights.getActive().slice()) {
      h.step(dt);
      if (h.dead) this.highlights.release(h);
    }
  }

  private render(): void {
    this.renderer.beginFrame();
    this.renderer.drawStrands(this.field.pool.getActive());
    this.renderer.drawHighlights(this.highlights.getActive());
    this.renderer.endFrame();
    this.overlay.setStrandCount(this.field.pool.activeCount);
  }
}
