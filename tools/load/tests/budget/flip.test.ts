import { describe, expect, test } from 'bun:test';

import { runFlip } from '../../src/budget/flip.ts';

describe('runFlip', () => {
  test('runs the command to its end on the sampler’s clock, keeping its last lines', async () => {
    let clock = 1_000;
    const lines: string[] = [];
    const flip = await runFlip({
      command:
        'for n in $(seq 1 25); do echo "line $n"; done; echo oops >&2; exit 3',
      deadlineMs: 10_000,
      clock: () => {
        clock += 500;
        return clock;
      },
      log: (line) => lines.push(line),
    });
    expect(flip).toMatchObject({
      command:
        'for n in $(seq 1 25); do echo "line $n"; done; echo oops >&2; exit 3',
      startedAtMs: 1_500,
      endedAtMs: 2_000,
      exitCode: 3,
      signal: null,
      timedOut: false,
    });
    expect(lines).toHaveLength(26);
    expect(flip.tail).toHaveLength(20);
    expect(flip.tail.at(-1)).toBe('oops');
    expect(flip.tail[0]).toBe('line 7');
  });

  test('a command past its deadline is stopped and says so', async () => {
    const flip = await runFlip({
      command: 'echo started; sleep 30',
      deadlineMs: 300,
      clock: () => 0,
      log: () => {},
    });
    expect(flip.timedOut).toBe(true);
    expect(flip.exitCode).toBeNull();
    expect(flip.signal).toBe('SIGTERM');
    expect(flip.tail).toEqual([
      'started',
      'the flip ran past its deadline of 300 ms',
    ]);
  });

  test('a shell that cannot start ends the flip without an exit code', async () => {
    const flip = await runFlip({
      command: 'true',
      deadlineMs: 5_000,
      clock: () => 0,
      log: () => {},
      shell: '/nonexistent/shell',
    });
    expect(flip.exitCode).toBeNull();
    expect(flip.timedOut).toBe(false);
    expect(flip.tail[0]).toStartWith('the flip could not start:');
  });
});
