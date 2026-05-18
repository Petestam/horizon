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
import { mountPhaseMenu } from "./ui/phaseMenu.js";
import { loadLastParams } from "./ui/tunerStorage.js";
import { TowerController, type TowerParams } from "./towers/Tower.js";
import { DemoController } from "./demo/Demo.js";
/** Stage content is always this width ÷ height (letterboxed to the window). */
const STAGE_ASPECT = 12 / 5;

/** Inset of the persistent header from the 12:5 stage edges (CSS px). */
const stageHeaderInsetX = (cssW: number): number =>
  Math.min(42, Math.max(16, Math.round(cssW * 0.028)));
const stageHeaderInsetY = (cssH: number): number =>
  Math.min(28, Math.max(10, Math.round(cssH * 0.022)));

const stageCssSize = (vw: number, vh: number): { cssW: number; cssH: number } => {
  if (vw <= 0 || vh <= 0) return { cssW: 1, cssH: 1 };
  if (vw / vh > STAGE_ASPECT) return { cssW: vh * STAGE_ASPECT, cssH: vh };
  return { cssW: vw, cssH: vw / STAGE_ASPECT };
};

export class App {
  readonly state = new State();
  readonly bus = new EventBus();
  private renderer: Renderer;
  private field = new WaveField();
  private towers = new TowerController();
  private highlights = new ObjectPool<Highlight>(createHighlight, resetHighlight, HIGHLIGHT_CAP);
  private demo: DemoController;
  private overlay: ReturnType<typeof mountOverlay>;
  private phaseMenu: ReturnType<typeof mountPhaseMenu>;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private stopLoop?: () => void;
  private stopMock?: () => void;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private canvasClickHandler = (e: MouseEvent) => this.onCanvasClick(e);
  constructor(
    private readonly canvas: HTMLCanvasElement,
    overlayRoot: HTMLElement,
  ) {
    const hydrated = loadLastParams();
    if (hydrated) this.state.replace(hydrated);

    this.renderer = new Canvas2DRenderer(canvas);
    this.demo = new DemoController({
      field: this.field,
      towers: this.towers,
      highlights: this.highlights,
      paramsRef: () => this.state.params,
    });
    this.overlay = mountOverlay(overlayRoot, this.state, {
      fireTestLabel: () => this.fireTestLabel(),
      clearLabels: () => this.clearLabels(),
      fireTower: () => this.fireTower(),
      clearTowers: () => this.clearTowers(),
      unify: () => this.demo.unify(),
      investigate: () => this.demo.investigate(),
      resolve: () => this.demo.resolve(),
      automate: () => this.demo.automate(),
      resetDemo: () => this.demo.reset(),
    });
    this.phaseMenu = mountPhaseMenu(overlayRoot, (kiosk, phase) => {
      this.demo.forcePhase(kiosk, phase);
    });

    this.field.afterHorizontal = () => {
      this.towers.syncConnectionsFromTargets();
    };

    this.applyResize();
    this.field.rebuild(this.state.params);
    this.renderer.paramsChanged(this.state.params, true);

    this.state.subscribe((changed) => {
      this.renderer.paramsChanged(this.state.params, isColorChange(changed));
      if (isCountChange(changed)) {
        this.field.rebuild(this.state.params);
        this.demo.reset();
      }
    });

    window.addEventListener("resize", () => this.applyResize());
    window.addEventListener("keydown", this.keyHandler);
    this.canvas.addEventListener("click", this.canvasClickHandler);

    this.bus.on("kiosk:event", (e) => {
      if (!this.state.params.labelsEnabled || this.state.params.ambientDemo) return;
      this.spawnHighlight(e.label, e.ttlMs);
    });
  }

  fireTestLabel(): void {
    const t = this.state.params.labelText.trim();
    this.bus.emit("kiosk:event", {
      id: `manual-${Date.now()}`,
      label: t.length > 0 ? t : "test · operator",
      ttlMs: 4000,
    });
  }

  clearLabels(): void {
    for (const h of this.highlights.getActive().slice()) this.highlights.release(h);
  }

  fireTower(): void {
    this.towers.fireOne(this.field.pool.getActive(), this.towerParams());
  }

  clearTowers(): void {
    this.towers.clear();
  }

  private towerParams(): TowerParams {
    const p = this.state.params;
    return {
      // Suppress ambient auto-spawn while the demo is driving the stage; existing
      // connections keep stepping so demo-owned traces survive.
      enabled: p.towersEnabled && !this.demo.active,
      spawnInterval: p.towerSpawnInterval,
      pulseDur: p.towerPulseDur,
      chasePeriod: p.towerChasePeriod,
      bondDur: p.towerBondDur,
      burstDur: p.towerBurstDur,
      reach: p.towerReach,
    };
  }

  start(): void {
    this.stopMock = startKioskMock(this.bus, {
      getLabel: () => {
        const t = this.state.params.labelText.trim();
        return t.length > 0 ? t : "test · operator";
      },
    });
    this.stopLoop = runLoop({
      update: (dt) => this.update(dt),
      render: () => this.render(),
      onFps: (fps) => this.overlay.setFps(fps),
    });
  }

  stop(): void {
    this.stopLoop?.();
    this.stopMock?.();
    window.removeEventListener("keydown", this.keyHandler);
    this.canvas.removeEventListener("click", this.canvasClickHandler);
    this.phaseMenu.destroy();
    this.overlay.destroy();
  }

  private applyResize(): void {
    const { cssW, cssH } = stageCssSize(window.innerWidth, window.innerHeight);
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = effectiveDpr();
    this.renderer.resize(this.cssW, this.cssH, this.dpr);
    this.field.resize(this.cssW, this.cssH);
    this.towers.resize(this.cssW, this.cssH);

    const insetX = stageHeaderInsetX(this.cssW);
    const insetY = stageHeaderInsetY(this.cssH);
    const stageLeft = (window.innerWidth - this.cssW) * 0.5;
    const stageTop = (window.innerHeight - this.cssH) * 0.5;
    const header = document.getElementById("stage-header");
    if (header) {
      header.style.left = `${Math.round(stageLeft + insetX)}px`;
      header.style.top = `${Math.round(stageTop + insetY)}px`;
      header.style.width = `${Math.round(this.cssW - 2 * insetX)}px`;
      header.style.transform = "none";
      void header.offsetHeight;
      const calloutTop = insetY + header.offsetHeight + 14;
      this.renderer.setHighlightMargins({ topMin: calloutTop, sidePad: insetX });
    }

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
    target.kick -= 50;
  }

  private onCanvasClick(e: MouseEvent): void {
    if (!this.state.params.phasePillsEnabled) return;
    const pt = this.stagePoint(e.clientX, e.clientY);
    if (!pt) return;
    const kiosk = this.renderer.hitPhasePill(pt.x, pt.y, this.towers.towers);
    if (kiosk === null) return;
    e.preventDefault();
    this.phaseMenu.open(kiosk, e.clientX, e.clientY);
  }

  private stagePoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const { cssW, cssH } = stageCssSize(window.innerWidth, window.innerHeight);
    const left = (window.innerWidth - cssW) * 0.5;
    const top = (window.innerHeight - cssH) * 0.5;
    const x = clientX - left;
    const y = clientY - top;
    if (x < 0 || y < 0 || x > cssW || y > cssH) return null;
    return { x, y };
  }

  /** Hotkeys: 1 unify, 2 investigate, 3 resolve, 4 automate, 0 reset. Ignored when typing in an input. */
  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    switch (e.key) {
      case "1": this.demo.unify(); break;
      case "2": this.demo.investigate(); break;
      case "3": this.demo.resolve(); break;
      case "4": this.demo.automate(); break;
      case "0": this.demo.reset(); break;
      default: return;
    }
    e.preventDefault();
  }

  private update(dt: number): void {
    const p: Params = this.state.params;
    this.towers.advanceConnections(dt);
    this.demo.step(dt);
    this.towers.stepOriginGrids(dt);
    this.field.step(dt, p);
    this.towers.syncConnectionsFromTargets();
    this.towers.spawnTick(dt, this.field.pool.getActive(), this.towerParams());
    for (const h of this.highlights.getActive().slice()) {
      h.step(dt);
      if (h.dead) this.highlights.release(h);
    }
  }

  private render(): void {
    this.renderer.beginFrame(performance.now() * 0.001);
    const strands = this.field.pool.getActive();
    this.renderer.drawStrands(strands);
    this.renderer.drawShimmers(strands, this.towers.towers);
    this.renderer.drawTowers(this.towers.towers);
    this.renderer.drawFallPulses(this.demo.pulses.getActive());
    this.renderer.drawPhasePills(this.towers.towers);
    this.renderer.drawHighlights(this.highlights.getActive());
    this.renderer.endFrame();
    this.overlay.setStrandCount(this.field.pool.activeCount);
  }
}
