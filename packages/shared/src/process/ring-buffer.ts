/**
 * A fixed-capacity ring buffer — O(1) push, bounded memory. Used to retain the
 * tail of a captured subprocess stream for `--verbose` replay and failure dumps
 * without growing unbounded over a multi-hour dev session.
 *
 * Ported from the old `terminal.ts` RingBuffer, generalized.
 */
export class RingBuffer<T> {
  private readonly buf: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Array<T | undefined>(Math.max(1, capacity));
  }

  push(item: T): void {
    const cap = this.buf.length;
    this.buf[(this.head + this.count) % cap] = item;
    if (this.count < cap) this.count++;
    else this.head = (this.head + 1) % cap;
  }

  /** The most recent `n` items, oldest-first. */
  tail(n: number): T[] {
    const cap = this.buf.length;
    const take = Math.min(n, this.count);
    const out: T[] = [];
    const start = (this.head + this.count - take) % cap;
    for (let i = 0; i < take; i++) {
      const item = this.buf[(start + i) % cap];
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  toArray(): T[] {
    return this.tail(this.count);
  }

  get size(): number {
    return this.count;
  }
}
