import type { FlowLayout } from '../types';

/**
 * Fresh layouts this session already computed, by structural signature:
 * switching back to a version or reopening a tab draws at once. Holds the
 * 32 used last. Live relayouts are not kept — they depend on the picture
 * they started from — and neither is a one-column fallback, so a later
 * attempt can still succeed.
 */
export class FlowLayoutCache {
  readonly #entries = new Map<string, FlowLayout>();

  constructor(readonly capacity = 32) {}

  get(signature: string): FlowLayout | undefined {
    const layout = this.#entries.get(signature);
    if (layout === undefined) return undefined;
    // Most recently used goes last; the first entry is evicted next.
    this.#entries.delete(signature);
    this.#entries.set(signature, layout);
    return layout;
  }

  /** Reads without marking the entry used (safe during a render). */
  peek(signature: string): FlowLayout | undefined {
    return this.#entries.get(signature);
  }

  set(layout: FlowLayout): void {
    if (layout.engine === 'fallback-column') return;
    this.#entries.delete(layout.signature);
    this.#entries.set(layout.signature, layout);
    while (this.#entries.size > this.capacity) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }
}

/** The cache every canvas in the tab shares. */
export const flowLayoutCache = new FlowLayoutCache();
