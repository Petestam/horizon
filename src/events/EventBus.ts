export interface KioskEvent {
  id: string;
  label: string;
  ttlMs: number;
}

export type EventMap = {
  "kiosk:event": KioskEvent;
};

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export class EventBus {
  private handlers = new Map<keyof EventMap, Set<Handler<keyof EventMap>>>();

  on<K extends keyof EventMap>(type: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<keyof EventMap>);
    return () => set!.delete(fn as Handler<keyof EventMap>);
  }

  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as Handler<K>)(payload);
  }
}
