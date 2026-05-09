export class ObjectPool<T> {
  private free: T[] = [];
  private active: T[] = [];

  constructor(
    private readonly create: () => T,
    private readonly reset: (t: T) => void,
    public readonly cap: number,
  ) {}

  acquire(): T | null {
    if (this.active.length >= this.cap) return null;
    const obj = this.free.pop() ?? this.create();
    this.active.push(obj);
    return obj;
  }

  release(obj: T): void {
    const i = this.active.indexOf(obj);
    if (i < 0) return;
    this.active.splice(i, 1);
    this.reset(obj);
    this.free.push(obj);
  }

  releaseAll(): void {
    for (const obj of this.active) {
      this.reset(obj);
      this.free.push(obj);
    }
    this.active.length = 0;
  }

  getActive(): readonly T[] {
    return this.active;
  }

  get activeCount(): number {
    return this.active.length;
  }
}
