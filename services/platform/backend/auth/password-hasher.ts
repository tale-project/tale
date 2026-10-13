import { availableParallelism } from 'node:os';

import { APIError } from 'better-auth/api';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

/**
 * Every password hash and check Better Auth makes, bounded.
 *
 * Better Auth hashes with scrypt (`node:crypto`, N=16384, r=16: 32 MiB and
 * 100–150 ms each) on libuv's thread pool, whose four threads are one FIFO
 * queue shared with every file read and DNS lookup the process makes. Left
 * unbounded, a wave of sign-ins queues thousands of hashes ahead of all of
 * them: 3,000 people signing in over a minute left 138 sign-ins served, and
 * every other route that touches a file or resolves a name timed out behind
 * the backlog, for the four minutes it took to drain. A client that gave up
 * did not cancel its hash.
 *
 * Here at most `concurrency` hashes run at once (half the pool, so reads and
 * lookups always have threads of their own), up to `maxQueued` more wait, and
 * a wait lasts at most `maxWaitMs`. Past either, the check is refused with a
 * retryable 503 `PASSWORD_CHECK_BUSY` and `Retry-After` — before any hashing,
 * so the person gets an answer in milliseconds and the server stays whole.
 *
 * The refusal is an `APIError` so that Better Auth's sign-in hooks read it as
 * a check that was not attempted (`classifySignInOutcome`): it must never
 * count toward an account's lockout.
 *
 * Not bound: the admin and recovery doors that write a new password
 * themselves, and the forced rotation of one (`domains/users/service.ts`,
 * `domains/control/service.ts`), hash it directly. Each runs at a person's
 * pace, and a forced rotation only follows a sign-in that was bound.
 */

/** libuv's own default. */
const DEFAULT_THREAD_POOL_SIZE = 4;
/** The longest a check waits for a free slot. */
const DEFAULT_MAX_WAIT_MS = 4_000;
/** Waiters allowed per running hash: about 2.5 s of work at 150 ms each. */
const QUEUE_PER_SLOT = 16;
/** The ceiling on `Retry-After`, in seconds. */
const MAX_RETRY_AFTER_SECONDS = 10;
/** What a hash is assumed to cost before any has been measured. */
const ASSUMED_HASH_MS = 150;

export interface PasswordHasherOptions {
  /** Hashes that may run at once. */
  concurrency: number;
  /** Checks that may wait for a slot. */
  maxQueued: number;
  /** The longest a check may wait, in milliseconds. */
  maxWaitMs: number;
  hash: (password: string) => Promise<string>;
  verify: (data: { hash: string; password: string }) => Promise<boolean>;
  /** The clock, for the duration of a hash. */
  now: () => number;
}

export interface PasswordHasherStats {
  concurrency: number;
  maxQueued: number;
  active: number;
  waiting: number;
  /** Checks refused because the queue was full, since the process started. */
  refusedQueueFull: number;
  /** Checks refused after waiting out `maxWaitMs`, since the process started. */
  refusedWaitExpired: number;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(data: { hash: string; password: string }): Promise<boolean>;
  stats(): PasswordHasherStats;
}

interface Waiter {
  start: () => void;
  refuse: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The slots to run with: half the libuv pool (`UV_THREADPOOL_SIZE`, default
 * 4), no more than the cores there are, at least one.
 */
export function defaultConcurrency(
  env: Record<string, string | undefined> = process.env,
  cores: number = availableParallelism(),
): number {
  const raw = Number(env.UV_THREADPOOL_SIZE);
  const pool =
    Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_THREAD_POOL_SIZE;
  return Math.max(1, Math.min(Math.floor(pool / 2), cores));
}

/**
 * Seconds a refused caller should wait: the time the hashes ahead of it take
 * to clear at the measured pace, at least one, at most ten.
 */
export function retryAfterFor(
  backlog: number,
  concurrency: number,
  averageMs: number,
): number {
  const seconds = Math.ceil(((backlog / concurrency) * averageMs) / 1000);
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, seconds));
}

export function createPasswordHasher(
  overrides: Partial<PasswordHasherOptions> = {},
): PasswordHasher {
  const concurrency = overrides.concurrency ?? defaultConcurrency();
  const options: PasswordHasherOptions = {
    concurrency,
    maxQueued: concurrency * QUEUE_PER_SLOT,
    maxWaitMs: DEFAULT_MAX_WAIT_MS,
    hash: hashPassword,
    verify: verifyPassword,
    now: () => performance.now(),
    ...overrides,
  };

  let active = 0;
  const waiting: Waiter[] = [];
  let refusedQueueFull = 0;
  let refusedWaitExpired = 0;
  // Smoothed duration of a hash, to say how long a refused caller should wait.
  let averageMs = ASSUMED_HASH_MS;

  function busy(): APIError {
    const seconds = retryAfterFor(
      active + waiting.length + 1,
      options.concurrency,
      averageMs,
    );
    return new APIError(
      'SERVICE_UNAVAILABLE',
      {
        message: 'Too many passwords are being checked at once — retry shortly',
        code: 'PASSWORD_CHECK_BUSY',
      },
      { 'Retry-After': String(seconds), 'Cache-Control': 'no-store' },
    );
  }

  function release(): void {
    active -= 1;
    while (active < options.concurrency) {
      const next = waiting.shift();
      if (next === undefined) return;
      clearTimeout(next.timer);
      active += 1;
      next.start();
    }
  }

  /** A slot, or the refusal. */
  function acquire(): Promise<void> {
    if (active < options.concurrency) {
      active += 1;
      return Promise.resolve();
    }
    if (waiting.length >= options.maxQueued) {
      refusedQueueFull += 1;
      return Promise.reject(busy());
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        start: resolve,
        refuse: () => {
          refusedWaitExpired += 1;
          reject(busy());
        },
        timer: setTimeout(() => {
          const at = waiting.indexOf(waiter);
          if (at === -1) return;
          waiting.splice(at, 1);
          waiter.refuse();
        }, options.maxWaitMs),
      };
      waiting.push(waiter);
    });
  }

  async function run<T>(task: () => Promise<T>): Promise<T> {
    await acquire();
    const started = options.now();
    try {
      return await task();
    } finally {
      const took = options.now() - started;
      averageMs = averageMs * 0.8 + took * 0.2;
      release();
    }
  }

  return {
    hash: (password) => run(() => options.hash(password)),
    verify: (data) => run(() => options.verify(data)),
    stats: () => ({
      concurrency: options.concurrency,
      maxQueued: options.maxQueued,
      active,
      waiting: waiting.length,
      refusedQueueFull,
      refusedWaitExpired,
    }),
  };
}

/** The process-wide hasher Better Auth's `password` option is wired to. */
export const passwordHasher: PasswordHasher = createPasswordHasher();
