import { POOL_SIZE } from "../theme";

class VideoPool {
  private elements: HTMLVideoElement[];
  // tileId (cell key "gx:gy") → index into elements[]
  private assignments: Map<string, number> = new Map();
  // tileIds oldest-first (front = LRU candidate)
  private lru: string[] = [];

  constructor(size: number = POOL_SIZE) {
    this.elements = Array.from({ length: size }, () => {
      const el = document.createElement("video");
      el.muted = true;
      // Required: B2-hosted videos are drawn into a WebGL VideoTexture, which taints
      // the canvas (SecurityError) unless the element opts into CORS and the bucket
      // returns Access-Control-Allow-Origin. Set before any src is assigned.
      el.crossOrigin = "anonymous";
      el.loop = true;
      el.playsInline = true;
      el.preload = "metadata";
      // NOT display:none. Browsers keep playing a hidden video's audio but stop decoding
      // its frames, so a WebGL VideoTexture would never receive pixels. Park it as a 1px,
      // near-invisible, click-through element so the compositor still produces frames.
      el.style.position = "fixed";
      el.style.top = "0";
      el.style.left = "0";
      el.style.width = "1px";
      el.style.height = "1px";
      el.style.opacity = "0.01";
      el.style.pointerEvents = "none";
      el.style.zIndex = "-1";
      document.body.appendChild(el);
      return el;
    });
  }

  acquire(tileId: string, src: string): HTMLVideoElement | null {
    // Already assigned — update LRU position and return
    const existing = this.assignments.get(tileId);
    if (existing !== undefined) {
      this.touchLRU(tileId);
      const el = this.elements[existing];
      if (el.src !== src && src) {
        el.src = src;
        el.load();
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

  release(tileId: string): void {
    const index = this.assignments.get(tileId);
    if (index === undefined) return;
    const el = this.elements[index];
    el.pause();
    el.src = "";
    el.load();
    this.assignments.delete(tileId);
    this.lru = this.lru.filter((id) => id !== tileId);
  }

  private touchLRU(tileId: string): void {
    this.lru = this.lru.filter((id) => id !== tileId);
    this.lru.push(tileId);
  }

  private evictLRU(): void {
    const oldest = this.lru[0];
    if (oldest !== undefined) this.release(oldest);
  }

  setAllVolume(v: number): void {
    for (const el of this.elements) el.volume = Math.max(0, Math.min(1, v));
  }

  getElement(tileId: string): HTMLVideoElement | undefined {
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
