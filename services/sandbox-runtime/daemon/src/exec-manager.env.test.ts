// What an exec's environment holds of runnerd's own: everything but what is
// runnerd's alone. The exec is a real process on this host that prints its
// environment, as a harness dumping `env` into its transcript would.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { EnvStore } from './env-store.ts';
import { execBaseEnv, ExecManager } from './exec-manager.ts';
import type { RunnerdExecEvent } from './protocol.ts';

const ROOT = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-env-`));
const saved = {
  token: process.env.TALE_RUNNERD_TOKEN,
  incarnation: process.env.TALE_RUNNERD_INCARNATION,
  seed: process.env.TALE_SESSION_ENV,
  kept: process.env.TALE_ENV_TEST_KEPT,
};

beforeAll(() => {
  process.env.TALE_WORKSPACE_ROOT = ROOT;
  process.env.TALE_RUNNERD_TOKEN = 'secret-runnerd-token';
  process.env.TALE_RUNNERD_INCARNATION = '1700000000000';
  process.env.TALE_SESSION_ENV = '{"SEEDED":"1"}';
  process.env.TALE_ENV_TEST_KEPT = 'kept';
});
afterAll(() => {
  delete process.env.TALE_WORKSPACE_ROOT;
  for (const [name, value] of [
    ['TALE_RUNNERD_TOKEN', saved.token],
    ['TALE_RUNNERD_INCARNATION', saved.incarnation],
    ['TALE_SESSION_ENV', saved.seed],
    ['TALE_ENV_TEST_KEPT', saved.kept],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(ROOT, { recursive: true, force: true });
});

describe("an exec's environment", () => {
  test('leaves out runnerd-private names, in any case, and keeps the rest', () => {
    expect(
      execBaseEnv({
        TALE_RUNNERD_TOKEN: 'x',
        tale_runnerd_token: 'x',
        TALE_RUNNERD_INCARNATION: '1',
        TALE_SESSION_ENV: '{}',
        TALE_EXEC_STALL_MS: '0',
        PATH: '/usr/bin',
      }),
    ).toEqual({ TALE_EXEC_STALL_MS: '0', PATH: '/usr/bin' });
  });

  test('a command printing its environment never sees the token', async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      {
        stall: { windowMs: 0 },
      },
    );
    const events: RunnerdExecEvent[] = [];
    await mgr.run(
      {
        execId: 'env1',
        shell: 'env',
        timeoutMs: 30_000,
        stdoutMaxBytes: 1_000_000,
        stderrMaxBytes: 1_000_000,
        cwd: ROOT,
      },
      (e) => events.push(e),
    );
    const stdout = events
      .filter((e) => e.t === 'stdout')
      .map((e) => Buffer.from(e.b64, 'base64').toString('utf8'))
      .join('');
    expect(stdout).toContain('TALE_ENV_TEST_KEPT=kept');
    expect(stdout).not.toContain('secret-runnerd-token');
    expect(stdout).not.toContain('TALE_RUNNERD_');
    expect(stdout).not.toContain('TALE_SESSION_ENV');
  });
});
