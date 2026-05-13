import type { EventBus } from "./EventBus.js";

let counter = 0;

/**
 * Deliberately slow synthetic event cadence — quiet by default to match the
 * "something is alive" tone. Returns a stop fn.
 */
export const startKioskMock = (
  bus: EventBus,
  opts: {
    minDelayMs?: number;
    maxDelayMs?: number;
    /** Called when each synthetic event fires; use tunable label copy from app state. */
    getLabel?: () => string;
  } = {},
): (() => void) => {
  const minDelay = opts.minDelayMs ?? 4500;
  const maxDelay = opts.maxDelayMs ?? 9000;
  const getLabel = opts.getLabel ?? (() => "test · operator");
  let timer = 0;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    timer = window.setTimeout(() => {
      bus.emit("kiosk:event", {
        id: `evt-${++counter}`,
        label: getLabel(),
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
