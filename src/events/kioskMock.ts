import type { EventBus } from "./EventBus.js";

const SAMPLE_LABELS = [
  "kiosk-04 · check-in",
  "kiosk-12 · ticket scan",
  "kiosk-07 · membership",
  "kiosk-19 · payment",
  "kiosk-22 · sign-up",
  "kiosk-31 · gate",
];

let counter = 0;

/**
 * Deliberately slow synthetic event cadence — quiet by default to match the
 * "something is alive" tone. Returns a stop fn.
 */
export const startKioskMock = (
  bus: EventBus,
  opts: { minDelayMs?: number; maxDelayMs?: number } = {},
): (() => void) => {
  const minDelay = opts.minDelayMs ?? 4500;
  const maxDelay = opts.maxDelayMs ?? 9000;
  let timer = 0;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    timer = window.setTimeout(() => {
      bus.emit("kiosk:event", {
        id: `evt-${++counter}`,
        label: SAMPLE_LABELS[counter % SAMPLE_LABELS.length]!,
        ttlMs: 4000 + Math.random() * 2000,
      });
      schedule();
    }, delay);
  };

  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
};
