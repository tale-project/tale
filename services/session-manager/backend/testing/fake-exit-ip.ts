// A scripted `ExitIpChecker` for tests.
//
// Every proxy exits through 203.0.113.<last octet of its host> (a documentation
// range) unless the test says otherwise:
//
//     const checker = new FakeExitIpChecker();
//     checker.setIp('1.2.3.4:8080', '198.51.100.7', 'DE'); // by `host:port`; country defaults to 'US'
//     checker.setError('5.6.7.8:80', 'the proxy rejected the credentials');
//     await checker.check(proxy);                          // -> { ip, country, latencyMs: 42 } or rejects with ExitIpError
//     checker.calls;                                       // every proxy checked, in order
//
// To control timing, hold the checks and let them go when the test is ready:
//
//     const gate = checker.hold();                         // checks now wait ...
//     await checker.waitForCalls(2);                       // ... until two have started
//     expect(checker.inFlight).toBe(2);
//     gate.release();                                      // and now they finish
//
// `delayMs` makes each check take that long (a real timer, so it works with
// `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync`). `maxInFlight` is the
// most checks that ever ran at once, for tests of a concurrency limit.

import { ExitIpError, hostPort } from '../domains/proxies/types.ts';
import type {
  ExitIp,
  ExitIpChecker,
  ProxyConfig,
} from '../domains/proxies/types.ts';

/** Checks wait for a gate until it is released; released for good, like an event that is set. */
export class Gate {
  private released = false;
  private waiters: Array<() => void> = [];

  get isReleased(): boolean {
    return this.released;
  }

  release(): void {
    this.released = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  wait(): Promise<void> {
    if (this.released) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/** A stable address in 203.0.113.0/24 for a proxy host that is no IPv4 address. */
function lastOctetOf(host: string): number {
  const octet = /^\d+\.\d+\.\d+\.(\d+)$/.exec(host)?.[1];
  if (octet !== undefined && Number(octet) <= 255) return Number(octet);
  let hash = 0;
  for (const char of host) hash = (hash * 31 + char.charCodeAt(0)) % 254;
  return hash + 1;
}

export class FakeExitIpChecker implements ExitIpChecker {
  /** By `host:port` (`hostPort(proxy)`). */
  readonly results = new Map<string, ExitIp | ExitIpError>();
  /** Every proxy checked, in order of arrival. */
  readonly calls: ProxyConfig[] = [];
  /** Checks wait for it when set. */
  gate: Gate | null = null;
  /** The country of an exit IP that no `setIp` named. */
  defaultCountry: string | null = 'US';
  /** Every check takes this long (after the gate). */
  delayMs = 0;
  /** Checks that have started and not finished. */
  inFlight = 0;
  /** The most checks that were ever in flight at once. */
  maxInFlight = 0;

  private callWaiters: Array<{ count: number; wake: () => void }> = [];

  setIp(
    hostAndPort: string,
    ip: string,
    country: string | null = 'US',
    latencyMs = 42,
  ): void {
    this.results.set(hostAndPort, { ip, country, latencyMs });
  }

  setError(hostAndPort: string, message: string): void {
    this.results.set(hostAndPort, new ExitIpError(message));
  }

  /** From now on checks wait until the returned gate is released. */
  hold(): Gate {
    this.gate = new Gate();
    return this.gate;
  }

  /** Resolve when at least `count` checks have started. */
  waitForCalls(count: number, timeoutMs = 5000): Promise<void> {
    if (this.calls.length >= count) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = {
        count,
        wake: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        this.callWaiters = this.callWaiters.filter(
          (candidate) => candidate !== waiter,
        );
        reject(
          new Error(`only ${this.calls.length} of ${count} checks started`),
        );
      }, timeoutMs);
      this.callWaiters.push(waiter);
    });
  }

  async check(proxy: ProxyConfig): Promise<ExitIp> {
    this.calls.push(proxy);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const ready = this.callWaiters.filter(
      (waiter) => this.calls.length >= waiter.count,
    );
    this.callWaiters = this.callWaiters.filter(
      (waiter) => !ready.includes(waiter),
    );
    for (const waiter of ready) waiter.wake();
    try {
      await this.gate?.wait();
      if (this.delayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      const result =
        this.results.get(hostPort(proxy)) ??
        ({
          ip: `203.0.113.${lastOctetOf(proxy.host)}`,
          country: this.defaultCountry,
          latencyMs: 42,
        } satisfies ExitIp);
      if (result instanceof ExitIpError) throw result;
      return { ...result };
    } finally {
      this.inFlight -= 1;
    }
  }
}
