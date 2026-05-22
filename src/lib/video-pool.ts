import { POOL_SIZE } from "../theme";

class VideoPool {
  private elements: HTMLVideoElement[];
  // tileId → index into elements[]
  private assignments: Map<number, number> = new Map();
  // tileIds oldest-first (front = LRU candidate)
  private lru: number[] = [];

  constructor(size: number = POOL_SIZE) {
    this.elements = Array.from({ length: size }, () => {
      const el = document.createElement("video");
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.preload = "metadata";
      el.style.display = "none";
      el.style.position = "absolute";
      document.body.appendChild(el);
      return el;
    });
  }

  acquire(tileId: number, src: string): HTMLVideoElement | null {
    // Already assigned — update LRU position and return
    const existing = this.assignments.get(tileId);
    if (existing !== undefined) {
      this.touchLRU(tileId);
      const el = this.elements[existing];
      if (el.src !== src && src) {
        el.src = src;
        el.play().catch(() => {});
      }
      return el;
    }

    // Find a free slot (not in assignments)
    const usedIndices = new Set(this.assignments.values());
    let freeIndex = this.elements.findIndex((_, i) => !usedIndices.has(i));

    if (freeIndex === -1) {
      // Pool full — evict LRU
      this.evictLRU();
      const used = new Set(this.assignments.values());
      freeIndex = this.elements.findIndex((_, i) => !used.has(i));
    }

    if (freeIndex === -1) return null;

    this.assignments.set(tileId, freeIndex);
    this.lru.push(tileId);

    const el = this.elements[freeIndex];
    el.src = src;
    el.play().catch(() => {});
    return el;
  }

  release(tileId: number): void {
    const index = this.assignments.get(tileId);
    if (index === undefined) return;
    const el = this.elements[index];
    el.pause();
    el.src = "";
    el.load();
    this.assignments.delete(tileId);
    this.lru = this.lru.filter((id) => id !== tileId);
  }

  private touchLRU(tileId: number): void {
    this.lru = this.lru.filter((id) => id !== tileId);
    this.lru.push(tileId);
  }

  private evictLRU(): void {
    const oldest = this.lru[0];
    if (oldest !== undefined) this.release(oldest);
  }

  getElement(tileId: number): HTMLVideoElement | undefined {
    const index = this.assignments.get(tileId);
    return index !== undefined ? this.elements[index] : undefined;
  }

  destroy(): void {
    for (const el of this.elements) {
      el.pause();
      el.src = "";
      document.body.removeChild(el);
    }
    this.assignments.clear();
    this.lru = [];
  }
}

export const videoPool = new VideoPool();
