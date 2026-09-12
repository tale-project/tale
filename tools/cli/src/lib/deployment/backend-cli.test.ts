import { describe, expect, test } from 'bun:test';

import { backendCliFailure, backendDataOwner } from './backend-cli';

const ok = (stdout: string) => ({
  success: true,
  stdout,
  stderr: '',
  exitCode: 0,
});

describe('backendDataOwner', () => {
  test('reads the data directory owner from the container as uid:gid', async () => {
    const calls: string[][] = [];
    const owner = await backendDataOwner(async (args) => {
      calls.push(args);
      return ok('1001:1001\n');
    }, 'tale-backend-api-blue');
    expect(owner).toBe('1001:1001');
    expect(calls).toEqual([
      ['exec', 'tale-backend-api-blue', 'stat', '-c', '%u:%g', '/app/data'],
    ]);
  });

  test.each(['', 'app:app', '1001', '1001:1001 extra', '-1:0'])(
    'refuses an owner it cannot hand to docker exec: %j',
    async (stdout) => {
      await expect(
        backendDataOwner(async () => ok(stdout), 'backend'),
      ).rejects.toThrow('owner could not be read');
    },
  );
});

describe('backendCliFailure', () => {
  const base = 'The backend-local Tale CLI did not complete provisioning.';

  test('repeats the inner JSON summary and exit code', () => {
    expect(
      backendCliFailure(base, {
        stdout: `${JSON.stringify({
          ok: false,
          command: 'tale',
          error: {
            summary:
              'Native deployment state has an unsafe directory or owner.',
            code: 4,
          },
        })}\n`,
      }),
    ).toBe(
      `${base} It reported: Native deployment state has an unsafe directory or owner. (exit 4)`,
    );
  });

  test('never surfaces stderr, only stdout in the summary shape', () => {
    expect(
      backendCliFailure(base, {
        stdout: '',
        stderr: 'synthetic-operator-password',
      } as { stdout: string }),
    ).toBe(base);
    expect(
      backendCliFailure(base, {
        stdout: 'panic: synthetic-operator-password',
      }),
    ).toBe(base);
  });

  test.each([
    '{not json',
    JSON.stringify({ ok: true, command: 'deploy provision', data: {} }),
    JSON.stringify({ ok: false, error: { summary: '' } }),
    JSON.stringify({ ok: false, error: { summary: 'x'.repeat(513) } }),
  ])('falls back to the base message for %j', (stdout) => {
    expect(backendCliFailure(base, { stdout })).toBe(base);
  });

  test('flattens control characters out of the repeated summary', () => {
    expect(
      backendCliFailure(base, {
        stdout: JSON.stringify({
          ok: false,
          error: { summary: 'line one\n\tline two\x1b[0m' },
        }),
      }),
    ).toBe(`${base} It reported: line one line two [0m`);
  });
});
