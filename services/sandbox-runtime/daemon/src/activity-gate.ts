import { randomUUID } from 'node:crypto';

/** Runnerd owns this gate so every spawner replica shares one stop decision.
 * A successful claim never expires: a timed-out backend stop may still finish
 * later, so admitting fresh work again would risk stopping that new work. */
export class ActivityGate {
  private generation = randomUUID();
  private activeOperations = 0;
  private released = false;
  private pinned = false;
  private reclaimClaim: string | null = null;

  constructor(private readonly liveExecs: () => number) {}

  snapshot() {
    return {
      generation: this.generation,
      activeOperations: this.activeOperations,
      released: this.released,
      pinned: this.pinned,
      reclaiming: this.reclaimClaim !== null,
    };
  }

  /** Called synchronously before reading a request body or starting I/O. */
  enter(markUsed = true): (() => void) | null {
    if (this.reclaimClaim !== null) return null;
    this.activeOperations += 1;
    if (markUsed) this.released = false;
    return () => {
      this.activeOperations -= 1;
    };
  }

  acquire(): string | null {
    if (this.reclaimClaim !== null) return null;
    this.generation = randomUUID();
    this.released = false;
    return this.generation;
  }

  /** An older owner's completion cannot release a newer owner's allocation. */
  release(generation: string): boolean {
    if (
      this.reclaimClaim !== null ||
      generation !== this.generation ||
      this.activeOperations > 0 ||
      this.liveExecs() > 0
    ) {
      return false;
    }
    this.released = true;
    return true;
  }

  setPinned(pinned: boolean): boolean {
    if (this.reclaimClaim !== null) return false;
    this.pinned = pinned;
    return true;
  }

  /** Check and freeze without awaiting between them. Busy/unknown sessions
   * never reach this state, and every later operation sees the freeze. */
  claim(claimId: string, generation: string): boolean {
    if (generation !== this.generation) return false;
    // A replacement spawner may finish a previously frozen stop. The backend
    // also fences removal to the original immutable container/Pod identity.
    if (this.reclaimClaim !== null) return true;
    if (
      !this.released ||
      this.pinned ||
      this.activeOperations > 0 ||
      this.liveExecs() > 0
    ) {
      return false;
    }
    this.reclaimClaim = claimId;
    return true;
  }
}
