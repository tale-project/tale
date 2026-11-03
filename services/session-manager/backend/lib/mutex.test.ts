import { describe, expect, it } from 'vitest';

import { settle } from '../testing/promises.ts';
import { KeyedMutex, Mutex } from './mutex.ts';

/** A promise that a test settles by hand. */
function latch<T = void>() {
  return Promise.withResolvers<T>();
}

describe('Mutex', () => {
  it('runs one task at a time, in the order they asked', async () => {
    const mutex = new Mutex();
    const log: string[] = [];
    const first = latch();
    const second = latch();

    const a = mutex.run(async () => {
      log.push('a starts');
      await first.promise;
      log.push('a ends');
      return 'a';
    });
    const b = mutex.run(async () => {
      log.push('b starts');
      await second.promise;
      log.push('b ends');
      return 'b';
    });
    const c = mutex.run(() => {
      log.push('c runs');
      return 'c';
    });

    await settle();
    expect(log).toEqual(['a starts']);
    // The one that asked later is ready first, and still waits its turn.
    second.resolve();
    await settle();
    expect(log).toEqual(['a starts']);
    first.resolve();
    expect(await Promise.all([a, b, c])).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a starts', 'a ends', 'b starts', 'b ends', 'c runs']);
  });

  it('is locked while a task runs or waits, and free afterwards', async () => {
    const mutex = new Mutex();
    expect(mutex.isLocked).toBe(false);
    const hold = latch();
    const running = mutex.run(() => hold.promise);
    const waiting = mutex.run(() => 'later');
    expect(mutex.isLocked).toBe(true);
    hold.resolve();
    await Promise.all([running, waiting]);
    expect(mutex.isLocked).toBe(false);
  });

  it('passes the result of a task on, whether it is sync or async', async () => {
    const mutex = new Mutex();
    expect(await mutex.run(() => 1)).toBe(1);
    expect(await mutex.run(async () => 2)).toBe(2);
  });

  it('lets the next task run when a task throws, and tells the caller', async () => {
    const mutex = new Mutex();
    const hold = latch();
    const failing = mutex.run(async () => {
      await hold.promise;
      throw new Error('boom');
    });
    const after = mutex.run(() => 'still runs');
    const failed = expect(failing).rejects.toThrow('boom');
    hold.resolve();
    await failed;
    expect(await after).toBe('still runs');
    expect(mutex.isLocked).toBe(false);
  });

  it('lets the next task run when a task throws at once', async () => {
    const mutex = new Mutex();
    const failing = mutex.run(() => {
      throw new Error('sync boom');
    });
    await expect(failing).rejects.toThrow('sync boom');
    expect(await mutex.run(() => 'ok')).toBe('ok');
  });

  it('does not let a task join the one that holds the lock (it is not reentrant)', async () => {
    const mutex = new Mutex();
    const log: string[] = [];
    let inner: Promise<number> | undefined;
    await mutex.run(async () => {
      log.push('outer');
      // Asked from inside, it waits for the outer task to end.
      inner = mutex.run(() => log.push('inner'));
      await settle();
      log.push('outer ends');
    });
    await inner;
    expect(log).toEqual(['outer', 'outer ends', 'inner']);
  });
});

describe('KeyedMutex', () => {
  it('serializes the tasks of one key and not those of different keys', async () => {
    const locks = new KeyedMutex<number>();
    const log: string[] = [];
    const one = latch();
    const other = latch();

    const first = locks.run(1, async () => {
      log.push('1a');
      await one.promise;
      log.push('1a ends');
    });
    const second = locks.run(1, () => {
      log.push('1b');
    });
    const elsewhere = locks.run(2, async () => {
      log.push('2');
      await other.promise;
    });

    await settle();
    expect(log).toEqual(['1a', '2']);
    expect(locks.isLocked(1)).toBe(true);
    expect(locks.isLocked(3)).toBe(false);
    one.resolve();
    other.resolve();
    await Promise.all([first, second, elsewhere]);
    expect(log).toEqual(['1a', '2', '1a ends', '1b']);
  });

  it('forgets a key that nobody holds or waits for', async () => {
    const locks = new KeyedMutex<string>();
    expect(locks.size).toBe(0);
    const hold = latch();
    const a = locks.run('a', () => hold.promise);
    const b = locks.run('a', () => undefined);
    const c = locks.run('b', () => undefined);
    expect(locks.size).toBe(2);
    await c;
    expect(locks.size).toBe(1);
    hold.resolve();
    await Promise.all([a, b]);
    expect(locks.size).toBe(0);
  });

  it('forgets a key whose task threw, and keeps working', async () => {
    const locks = new KeyedMutex<number>();
    await expect(
      locks.run(7, () => {
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(locks.size).toBe(0);
    expect(await locks.run(7, () => 'fine')).toBe('fine');
  });
});
