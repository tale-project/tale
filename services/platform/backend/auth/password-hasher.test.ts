// @vitest-environment node

import { APIError } from 'better-auth/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifySignInOutcome } from './auth.ts';
import {
  createPasswordHasher,
  defaultConcurrency,
  retryAfterFor,
  type PasswordHasherOptions,
} from './password-hasher.ts';

/**
 * The bound on password hashing (`password-hasher.ts`): scrypt runs on
 * libuv's four shared threads, and unbounded it queued a sign-in storm ahead
 * of every file read and DNS lookup of the process.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** A hash that settles when the test says so, and notes when it started. */
function controlled() {
  const started: string[] = [];
  const settle: Array<(value: boolean) => void> = [];
  const verify: PasswordHasherOptions['verify'] = ({ password }) =>
    new Promise<boolean>((resolve) => {
      started.push(password);
      settle.push(resolve);
    });
  return { started, settle, verify };
}

const check = (password: string) => ({ hash: 'salt:key', password });

/** Settle every check that has started, until none is left running or waiting. */
async function drain(
  settle: Array<(value: boolean) => void>,
  hasher: { stats(): { active: number; waiting: number } },
) {
  for (let turn = 0; turn < 20; turn += 1) {
    for (const resolve of settle) resolve(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const { active, waiting } = hasher.stats();
    if (active === 0 && waiting === 0) return;
  }
}

/** What a refused check threw, or null when it was served. */
async function refusal(promise: Promise<unknown>): Promise<APIError | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof APIError) return error;
    throw error;
  }
}

describe('the bounded password hasher', () => {
  it('runs `concurrency` checks at once and starts the rest as slots free, in order', async () => {
    const { started, settle, verify } = controlled();
    const hasher = createPasswordHasher({
      concurrency: 2,
      maxQueued: 8,
      verify,
    });

    const results = ['a', 'b', 'c', 'd'].map((password) =>
      hasher.verify(check(password)),
    );
    await Promise.resolve();
    expect(started).toEqual(['a', 'b']);
    expect(hasher.stats()).toMatchObject({ active: 2, waiting: 2 });

    settle[0]?.(true);
    await results[0];
    await Promise.resolve();
    expect(started).toEqual(['a', 'b', 'c']);

    settle[1]?.(true);
    await results[1];
    await Promise.resolve();
    expect(started).toEqual(['a', 'b', 'c', 'd']);

    settle[2]?.(true);
    settle[3]?.(false);
    expect(await Promise.all(results)).toEqual([true, true, true, false]);
    expect(hasher.stats()).toMatchObject({ active: 0, waiting: 0 });
  });

  it('refuses with a retryable 503 before hashing once the queue is full', async () => {
    const { started, settle, verify } = controlled();
    const hasher = createPasswordHasher({
      concurrency: 1,
      maxQueued: 2,
      verify,
    });

    const served = [
      hasher.verify(check('runs')),
      hasher.verify(check('waits-1')),
      hasher.verify(check('waits-2')),
    ];
    const refused = await refusal(hasher.verify(check('refused')));

    expect(refused).toBeInstanceOf(APIError);
    expect(refused?.statusCode).toBe(503);
    expect(refused?.body).toMatchObject({ code: 'PASSWORD_CHECK_BUSY' });
    const headers = new Headers(refused?.headers);
    expect(Number(headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(headers.get('Cache-Control')).toBe('no-store');
    // It never started: no hash was spent on it.
    await Promise.resolve();
    expect(started).toEqual(['runs']);
    expect(hasher.stats().refusedQueueFull).toBe(1);

    await drain(settle, hasher);
    expect(await Promise.all(served)).toEqual([true, true, true]);
  });

  it('refuses a check that waited out its deadline, and keeps counting slots right afterwards', async () => {
    vi.useFakeTimers();
    const { settle, verify } = controlled();
    const hasher = createPasswordHasher({
      concurrency: 1,
      maxQueued: 4,
      maxWaitMs: 1_000,
      verify,
    });

    const running = hasher.verify(check('runs'));
    const waiting = refusal(hasher.verify(check('gives-up')));
    await vi.advanceTimersByTimeAsync(1_000);

    const refused = await waiting;
    expect(refused?.statusCode).toBe(503);
    expect(hasher.stats()).toMatchObject({
      active: 1,
      waiting: 0,
      refusedWaitExpired: 1,
    });

    settle[0]?.(true);
    await running;
    // The expired waiter left no slot held and none lost.
    const next = hasher.verify(check('next'));
    await Promise.resolve();
    expect(hasher.stats()).toMatchObject({ active: 1, waiting: 0 });
    settle[1]?.(true);
    expect(await next).toBe(true);
  });

  it('frees the slot of a check that throws', async () => {
    const hasher = createPasswordHasher({
      concurrency: 1,
      verify: () => Promise.reject(new Error('Invalid password hash')),
    });

    await expect(hasher.verify(check('x'))).rejects.toThrow(
      'Invalid password hash',
    );
    expect(hasher.stats()).toMatchObject({ active: 0, waiting: 0 });
    await expect(hasher.verify(check('y'))).rejects.toThrow(
      'Invalid password hash',
    );
  });

  it('says to wait as long as the hashes ahead take, at least one second and at most ten', () => {
    // 33 behind two slots at 150 ms each: just under two and a half seconds.
    expect(retryAfterFor(33, 2, 150)).toBe(3);
    expect(retryAfterFor(1, 2, 150)).toBe(1);
    expect(retryAfterFor(0, 2, 150)).toBe(1);
    // A slow machine and a deep queue do not ask a person to wait minutes.
    expect(retryAfterFor(500, 2, 1_000)).toBe(10);
  });

  it('hashes and verifies with Better Auth’s own scrypt, so every stored hash still checks', async () => {
    const hasher = createPasswordHasher();

    const stored = await hasher.hash('correct horse battery staple');

    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(
      await hasher.verify({
        hash: stored,
        password: 'correct horse battery staple',
      }),
    ).toBe(true);
    expect(await hasher.verify({ hash: stored, password: 'wrong' })).toBe(
      false,
    );
  });

  it('is a check that was not attempted to the sign-in lockout, never a failure', async () => {
    const hasher = createPasswordHasher({
      concurrency: 1,
      maxQueued: 0,
      verify: () => new Promise<boolean>(() => {}),
    });
    void hasher.verify(check('runs'));

    const refused = await refusal(hasher.verify(check('refused')));

    expect(classifySignInOutcome(refused, null)).toBe('not-attempted');
  });
});

describe('the default number of slots', () => {
  it('is half the libuv pool, so reads and lookups keep threads of their own', () => {
    expect(defaultConcurrency({}, 16)).toBe(2);
    expect(defaultConcurrency({ UV_THREADPOOL_SIZE: '16' }, 16)).toBe(8);
  });

  it('never exceeds the cores, and is at least one', () => {
    expect(defaultConcurrency({ UV_THREADPOOL_SIZE: '64' }, 4)).toBe(4);
    expect(defaultConcurrency({ UV_THREADPOOL_SIZE: '1' }, 16)).toBe(1);
    expect(defaultConcurrency({}, 1)).toBe(1);
  });

  it('ignores a pool size that is not a positive whole number', () => {
    expect(defaultConcurrency({ UV_THREADPOOL_SIZE: 'lots' }, 16)).toBe(2);
    expect(defaultConcurrency({ UV_THREADPOOL_SIZE: '0' }, 16)).toBe(2);
  });
});
