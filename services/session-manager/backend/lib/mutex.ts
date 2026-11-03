// Mutual exclusion for async code, in the order callers arrive (used for the
// creation of sessions and for every action on one session).
//
// JavaScript runs on one thread, so the only way two operations interleave is
// at an `await`. Code between two awaits needs no lock; a lock is for an
// operation that awaits and must not be joined by another one meanwhile.

/** One operation at a time; the others wait their turn. */
export class Mutex {
  /** Resolves when the last operation that asked for the lock is over. */
  #tail: Promise<void> = Promise.resolve();
  #waiting = 0;

  /** Is an operation running, or waiting for its turn? */
  get isLocked(): boolean {
    return this.#waiting > 0;
  }

  /**
   * Runs `task` once every earlier operation is over, and holds the lock until
   * `task` has settled, whether it returned or threw.
   */
  async run<T>(task: () => T | PromiseLike<T>): Promise<T> {
    const before = this.#tail;
    const { promise: over, resolve: release } = Promise.withResolvers<void>();
    this.#tail = over;
    this.#waiting += 1;
    // `before` never rejects: it only resolves when its operation is over.
    await before;
    try {
      return await task();
    } finally {
      this.#waiting -= 1;
      release();
    }
  }
}

/**
 * A `Mutex` for each key (a session's id): operations on one key run one at a
 * time, operations on different keys do not wait for each other. A key that
 * nobody holds or waits for is forgotten, so the map does not grow with the
 * number of sessions the app has ever had.
 */
export class KeyedMutex<K> {
  readonly #locks = new Map<K, { mutex: Mutex; users: number }>();

  /** How many keys are held or waited for right now. */
  get size(): number {
    return this.#locks.size;
  }

  isLocked(key: K): boolean {
    return this.#locks.get(key)?.mutex.isLocked ?? false;
  }

  async run<T>(key: K, task: () => T | PromiseLike<T>): Promise<T> {
    let entry = this.#locks.get(key);
    if (entry === undefined) {
      entry = { mutex: new Mutex(), users: 0 };
      this.#locks.set(key, entry);
    }
    entry.users += 1;
    try {
      return await entry.mutex.run(task);
    } finally {
      entry.users -= 1;
      if (entry.users === 0) this.#locks.delete(key);
    }
  }
}
