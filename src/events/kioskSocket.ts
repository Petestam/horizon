import type { EventBus, KioskEvent } from "./EventBus.js";

/**
 * Production WebSocket bridge. The mock and the real server emit the same
 * payload shape, so the bus contract is identical either way.
 */
export const connectKioskSocket = (bus: EventBus, url: string): (() => void) => {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;

  const open = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as Partial<KioskEvent>;
        if (msg && typeof msg.id === "string" && typeof msg.label === "string") {
          bus.emit("kiosk:event", {
            id: msg.id,
            label: msg.label,
            ttlMs: typeof msg.ttlMs === "number" ? msg.ttlMs : 4000,
          });
        }
      } catch {
        /* drop malformed frames silently */
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      const delay = Math.min(15000, 500 * 2 ** retry++);
      setTimeout(open, delay);
    };
    ws.onerror = () => ws?.close();
  };

  open();
  return () => {
    stopped = true;
    ws?.close();
  };
};
