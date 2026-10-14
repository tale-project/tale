/**
 * The heavy-phase lease pair rides the workspace-tool dispatch: the run, its
 * session and its organization come from the token, the answers tell the
 * model whether to run the phase, wait or go on without a lease, and
 * `workspace_status` lists both as tools that are not read-only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../../lib/ctx';
import { readHostLeaseArgs } from './workspace_host_lease_tools';
import {
  dispatchWorkspaceToolImpl,
  workspaceToolStatusImpl,
} from './workspace_tools_bridge';

const answers = vi.hoisted(() => ({
  acquire: undefined as unknown,
  release: undefined as unknown,
}));
const runQuery = vi.fn(async () => null);
const runMutation = vi.fn(async (ref: unknown, _args: unknown) => {
  const name = functionRefName(ref);
  if (name === 'sandbox/heavy_leases:acquireRunLease') return answers.acquire;
  if (name === 'sandbox/heavy_leases:releaseRunLease') return answers.release;
  return null;
});
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the dispatch reaches only runQuery/runMutation here
const ctx = { runQuery, runMutation } as unknown as ActionCtx;

const TOKEN = {
  organizationId: 'org-1',
  sessionId: 'pa-ada-1',
  taskRunExecId: 'exec-1',
};
const EXPIRES = Date.UTC(2026, 9, 14, 17, 0, 0);

function call(tool: string, callArgs: unknown) {
  return dispatchWorkspaceToolImpl(ctx, { ...TOKEN, tool, callArgs });
}

function seamCall(name: string): unknown {
  return runMutation.mock.calls.find(
    ([ref]) => functionRefName(ref) === name,
  )?.[1];
}

beforeEach(() => {
  runQuery.mockClear();
  runMutation.mockClear();
  answers.acquire = undefined;
  answers.release = undefined;
});

describe('host_lease_acquire', () => {
  it('tells the agent to run the phase and release its lease after [SBX-R28]', async () => {
    answers.acquire = {
      outcome: 'granted',
      lease: { leaseId: 'lease-1', label: 'npm ci', expiresAtMs: EXPIRES },
    };

    const result = await call('host_lease_acquire', {
      label: '  npm   ci ',
      predictedGrowthGiB: 3,
      minutes: 10,
    });

    expect(result).toMatchObject({
      status: 'ok',
      output: {
        granted: true,
        leaseId: 'lease-1',
        expiresAt: '2026-10-14T17:00:00.000Z',
      },
    });
    expect(JSON.stringify(result)).toContain(
      'host_lease_release {leaseId: \\"lease-1\\"}',
    );
    expect(seamCall('sandbox/heavy_leases:acquireRunLease')).toEqual({
      ...TOKEN,
      label: 'npm ci',
      predictedGrowthBytes: 3 * 1024 ** 3,
      ttlMs: 600_000,
    });
    // Audited by parameter keys, never values.
    const audit = seamCall('sandbox/session_mutations:recordToolCall');
    expect(audit).toMatchObject({
      tool: 'host_lease_acquire',
      outcome: 'ok',
      paramsFingerprint: 'label,minutes,predictedGrowthGiB',
    });
  });

  it('answers the lease the run already holds, one heavy phase at a time [SBX-R28]', async () => {
    answers.acquire = {
      outcome: 'already_held',
      lease: {
        leaseId: 'lease-0',
        label: 'docker build',
        expiresAtMs: EXPIRES,
      },
    };

    const result = await call('host_lease_acquire', { label: 'npm ci' });

    expect(result).toMatchObject({
      status: 'ok',
      output: {
        granted: false,
        reason: 'held',
        heldLease: {
          leaseId: 'lease-0',
          label: 'docker build',
          expiresAt: '2026-10-14T17:00:00.000Z',
        },
      },
    });
  });

  it.each([
    { reason: 'pressure', retryAfterMs: 15_000, seconds: 15 },
    { reason: 'limit', retryAfterMs: 30_000, seconds: 30 },
    { reason: 'disk', retryAfterMs: 60_000, seconds: 60 },
    { reason: 'memory', retryAfterMs: 14_200, seconds: 15 },
    { reason: 'stale', retryAfterMs: 400, seconds: 1 },
  ])(
    'tells the agent to wait out a $reason refusal and ask again [SBX-R29]',
    async ({ reason, retryAfterMs, seconds }) => {
      answers.acquire = { outcome: 'refused', reason, retryAfterMs };

      const result = await call('host_lease_acquire', { label: 'npm ci' });

      expect(result).toMatchObject({
        status: 'ok',
        output: { granted: false, reason, retryAfterSeconds: seconds },
      });
      const guidance = JSON.stringify(result);
      expect(guidance).toContain('Do not run the phase yet');
      expect(guidance).toContain(`sleep ${seconds}`);
    },
  );

  it('tells the agent to ask again when the host did not answer [SBX-R29]', async () => {
    answers.acquire = { outcome: 'unreachable', retryAfterMs: 15_000 };

    await expect(
      call('host_lease_acquire', { label: 'npm ci' }),
    ).resolves.toMatchObject({
      status: 'ok',
      output: {
        granted: false,
        reason: 'unreachable',
        retryAfterSeconds: 15,
      },
    });
  });

  it('tells the agent to run the phase without a lease where leases do not exist [SBX-R30]', async () => {
    answers.acquire = { outcome: 'unavailable' };

    const result = await call('host_lease_acquire', { label: 'npm ci' });

    expect(result).toMatchObject({
      status: 'ok',
      output: { granted: false, reason: 'unavailable' },
    });
    expect(result).not.toHaveProperty('output.retryAfterSeconds');
    expect(JSON.stringify(result)).toContain('Run the phase without a lease');
  });

  it('acts for the run its token names, whatever the call claims [SBX-R31]', async () => {
    answers.acquire = { outcome: 'run_ended' };

    const result = await call('host_lease_acquire', {
      label: 'npm ci',
      sessionId: 'pa-noah-1',
      organizationId: 'org-2',
      runId: 'noah-run',
    });

    expect(result).toEqual({
      status: 'unavailable',
      blockers: [expect.objectContaining({ code: 'run_ended' })],
    });
    expect(seamCall('sandbox/heavy_leases:acquireRunLease')).toEqual({
      ...TOKEN,
      label: 'npm ci',
    });
  });

  it('refuses a session that is no project agent’s task run, telling it to go on [SBX-R31]', async () => {
    answers.acquire = { outcome: 'not_a_project_agent_run' };

    const result = await call('host_lease_acquire', { label: 'npm ci' });

    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'not_a_project_agent_run' }],
    });
    expect(JSON.stringify(result)).toContain('without a lease');
  });

  it.each([
    {},
    { label: '' },
    { label: 'x'.repeat(121) },
    { label: 'npm ci', predictedGrowthGiB: -1 },
    { label: 'npm ci', memoryGiB: 300 },
    { label: 'npm ci', minutes: 0.5 },
    { label: 'npm ci', minutes: 121 },
    { label: 'npm ci', minutes: '10' },
  ])(
    'refuses arguments out of bounds before asking anyone: %j',
    async (args) => {
      await expect(call('host_lease_acquire', args)).resolves.toMatchObject({
        status: 'invalid_args',
      });
      expect(seamCall('sandbox/heavy_leases:acquireRunLease')).toBeUndefined();
    },
  );
});

describe('readHostLeaseArgs', () => {
  it('reads sizes in GiB and the duration in minutes', () => {
    expect(
      readHostLeaseArgs({
        label: 'bun install',
        predictedGrowthGiB: 0.5,
        memoryGiB: 2,
        minutes: 120,
      }),
    ).toEqual({
      label: 'bun install',
      predictedGrowthBytes: 512 * 1024 ** 2,
      memoryBytes: 2 * 1024 ** 3,
      ttlMs: 7_200_000,
    });
    expect(readHostLeaseArgs({ label: 'tsc -b' })).toEqual({
      label: 'tsc -b',
    });
  });
});

describe('host_lease_release', () => {
  it('releases a lease of the run [SBX-R31]', async () => {
    answers.release = {
      outcome: 'released',
      leaseId: 'lease-1',
      alreadyReleased: false,
    };

    await expect(
      call('host_lease_release', { leaseId: 'lease-1' }),
    ).resolves.toEqual({
      status: 'ok',
      output: { released: true, leaseId: 'lease-1' },
    });
    expect(seamCall('sandbox/heavy_leases:releaseRunLease')).toEqual({
      ...TOKEN,
      leaseId: 'lease-1',
    });
  });

  it('answers another run’s lease as not found [SBX-R31]', async () => {
    answers.release = { outcome: 'not_found' };

    await expect(
      call('host_lease_release', { leaseId: 'noah-lease' }),
    ).resolves.toMatchObject({ status: 'not_found' });
  });

  it('lets the agent go on when the host cannot be asked now [SBX-R32]', async () => {
    answers.release = {
      outcome: 'deferred',
      leaseId: 'lease-1',
      expiresAtMs: EXPIRES,
    };

    const result = await call('host_lease_release', { leaseId: 'lease-1' });

    expect(result).toMatchObject({
      status: 'ok',
      output: { released: false, leaseId: 'lease-1' },
    });
    expect(JSON.stringify(result)).toContain('when your run ends');
  });

  it('refuses a lease id it cannot be', async () => {
    await expect(
      call('host_lease_release', { leaseId: '../../etc' }),
    ).resolves.toMatchObject({ status: 'invalid_args' });
    expect(seamCall('sandbox/heavy_leases:releaseRunLease')).toBeUndefined();
  });
});

describe('workspaceToolStatusImpl — the lease pair', () => {
  it('describes both and never badges them read-only', () => {
    const status = workspaceToolStatusImpl([
      'rag_search',
      'host_lease_acquire',
      'host_lease_release',
    ]);
    const acquire = status.tools.find(
      (tool) => tool.name === 'host_lease_acquire',
    );
    const release = status.tools.find(
      (tool) => tool.name === 'host_lease_release',
    );
    expect(acquire?.readOnly).toBe(false);
    expect(release?.readOnly).toBe(false);
    expect(acquire?.description).toContain('retryAfterSeconds');
    expect(acquire?.description).toContain('"unavailable"');
    expect(release?.description).toContain('leaseId');
  });
});
