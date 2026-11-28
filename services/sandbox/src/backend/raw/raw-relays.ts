// Where a raw device's sessions reach the platform: the device spawner's
// relay listeners (devices/device.ts) take loopback ports the kernel picks,
// and publish them here once they listen; the raw session backend hands each
// session the map from the deployment's addresses to those ports (its view,
// runnerd's session-view.ts). A session started before the relays listen
// waits for them, a bounded while.

export type RelayOrigins = ReadonlyArray<readonly [string, string]>;

export class RawRelayDirectory {
  private origins: RelayOrigins | null = null;
  private waiters: Array<(origins: RelayOrigins) => void> = [];

  /** The relays listen: `[deployment origin, loopback origin]` pairs. */
  publish(origins: RelayOrigins): void {
    this.origins = origins;
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake(origins);
  }

  /** The published pairs; THROWS when none were published within
   * `timeoutMs`, so a session never starts with doors it cannot reach. */
  async ready(timeoutMs: number, signal?: AbortSignal): Promise<RelayOrigins> {
    if (this.origins !== null) return this.origins;
    return await new Promise<RelayOrigins>((resolve, reject) => {
      let wake: ((origins: RelayOrigins) => void) | null = null;
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        this.waiters = this.waiters.filter((waiter) => waiter !== wake);
      };
      const timer = setTimeout(() => {
        done();
        reject(
          new Error(
            `the device's relays did not listen within ${timeoutMs} ms; the session cannot reach the platform`,
          ),
        );
      }, timeoutMs);
      const aborted = () => {
        done();
        reject(signal?.reason ?? new Error('aborted'));
      };
      signal?.addEventListener('abort', aborted, { once: true });
      wake = (origins) => {
        done();
        resolve(origins);
      };
      this.waiters.push(wake);
    });
  }

  /** The published pairs now, or null. */
  current(): RelayOrigins | null {
    return this.origins;
  }
}

/** The device's one directory. */
export const rawRelays = new RawRelayDirectory();
