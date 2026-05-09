const STEP = 1 / 60;
const MAX_DT = 0.05;

export interface LoopHooks {
  update: (dt: number) => void;
  render: (alpha: number) => void;
  onFps?: (fps: number) => void;
}

export const runLoop = ({ update, render, onFps }: LoopHooks): (() => void) => {
  let acc = 0;
  let prev = performance.now();
  let frames = 0;
  let fpsTimer = 0;
  let raf = 0;
  let stopped = false;

  const tick = (now: number) => {
    if (stopped) return;
    const dt = Math.min((now - prev) / 1000, MAX_DT);
    prev = now;
    acc += dt;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
    render(acc / STEP);

    frames++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      onFps?.(frames / fpsTimer);
      frames = 0;
      fpsTimer = 0;
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame((t) => {
    prev = t;
    raf = requestAnimationFrame(tick);
  });

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
};
