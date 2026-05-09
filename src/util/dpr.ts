export const MAX_DPR = 2;

export const effectiveDpr = (): number =>
  Math.min(window.devicePixelRatio || 1, MAX_DPR);

export const sizeCanvas = (
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr = effectiveDpr(),
): { dpr: number; w: number; h: number } => {
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  return { dpr, w, h };
};
