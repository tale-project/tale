import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHUTDOWN_TIMEOUT_MS } from './domains/sessions/runtime.ts';
import { SHUTDOWN_MARGIN_MS, createShutdown } from './shutdown.ts';

const DEADLINE_MS = 5000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A shutdown whose stop the test settles, and whose exits and lines it records. */
function setup(stop: () => Promise<void> = () => new Promise(() => {})) {
  const exits: number[] = [];
  const lines: string[] = [];
  const causes: unknown[] = [];
  const stopping = vi.fn(stop);
  const shutdown = createShutdown({
    stop: stopping,
    exit: (code) => {
      exits.push(code);
    },
    log: (line, cause) => {
      lines.push(line);
      if (cause !== undefined) causes.push(cause);
    },
    deadlineMs: DEADLINE_MS,
  });
  return { shutdown, stopping, exits, lines, causes };
}

describe('the first signal', () => {
  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
    'stops the server on %s and exits 0 once it has stopped',
    async (signal) => {
      const { shutdown, stopping, exits } = setup(() => Promise.resolve());
      shutdown(signal);
      expect(stopping).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(0);
      expect(exits).toEqual([0]);
    },
  );

  it('says why it exits 1 when the stop fails', async () => {
    const error = new Error('the browsers would not close');
    const { shutdown, exits, lines, causes } = setup(() =>
      Promise.reject(error),
    );
    shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(exits).toEqual([1]);
    expect(lines).toEqual(['[session-manager] stopping failed']);
    expect(causes).toEqual([error]);
  });

  it('waits for a stop that takes a while, and exits once it is over', async () => {
    let finish: () => void = () => {};
    const { shutdown, exits } = setup(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    shutdown('SIGINT');
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(exits).toEqual([]);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(exits).toEqual([0]);
    // The watchdog is gone with the stop.
    await vi.advanceTimersByTimeAsync(DEADLINE_MS * 2);
    expect(exits).toEqual([0]);
  });
});

describe('a second signal', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const)(
    'exits at once on %s with the code a shell gives it (%d), and says so in one line',
    async (signal, code) => {
      const { shutdown, stopping, exits, lines } = setup();
      shutdown('SIGINT');
      shutdown(signal);
      expect(exits).toEqual([code]);
      expect(lines).toEqual([
        `[session-manager] ${signal} again: not waiting for the browsers any longer`,
      ]);
      expect(stopping).toHaveBeenCalledOnce();
    },
  );

  it('does not wait for the deadline', async () => {
    const { shutdown, exits } = setup();
    shutdown('SIGTERM');
    shutdown('SIGTERM');
    expect(exits).toEqual([143]);
  });
});

describe('the watchdog', () => {
  it('exits 1 with a message when the server has not stopped by the deadline', async () => {
    const { shutdown, exits, lines } = setup();
    shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(exits).toEqual([1]);
    expect(lines).toEqual([
      '[session-manager] the server did not stop within 5 seconds: exiting',
    ]);
  });

  it('is no more than the time the browsers get to close, and a little more', () => {
    expect(SHUTDOWN_MARGIN_MS).toBe(10_000);
    expect(SHUTDOWN_TIMEOUT_MS + SHUTDOWN_MARGIN_MS).toBe(40_000);
  });

  it('does not start before there is a signal', async () => {
    const { exits } = setup();
    await vi.advanceTimersByTimeAsync(DEADLINE_MS * 3);
    expect(exits).toEqual([]);
  });
});
