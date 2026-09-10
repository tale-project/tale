// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sessionReleaseIdle,
  sessionReleaseTicket,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  releaseIdleSession,
  stopWorkflowSessionSlotsInTx,
} from './idle-release.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sessionReleaseTicket: vi.fn(),
  sessionReleaseIdle: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

const session = { organizationId: 'org-1', sessionId: 'session-1' };
const args = { ...session, generation: 'use-1' };

function scriptedSql(answers: unknown[][], events: string[] = []) {
  const query = vi.fn((strings: TemplateStringsArray) => {
    if (strings.join('').includes('pg_advisory_xact_lock')) {
      events.push('lock');
      return Promise.resolve([]);
    }
    events.push(strings.join('').trim().startsWith('SELECT') ? 'read' : 'stop');
    return Promise.resolve(answers.shift() ?? []);
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- scripted postgres tag
  return query as unknown as Sql;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SANDBOX_TOKEN', 'idle-release-test');
  vi.mocked(sessionReleaseTicket).mockResolvedValue('use-1');
  vi.mocked(sessionReleaseIdle).mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('transactional idle eligibility', () => {
  it('captures the use before freeing its allocation and queues only committed release candidates', async () => {
    const events: string[] = [];
    const other = { organizationId: 'org-1', sessionId: 'session-2' };
    const tx = scriptedSql([[session, other], [session]], events);
    vi.mocked(sessionReleaseTicket).mockImplementation(async () => {
      events.push('ticket');
      return 'use-1';
    });
    vi.mocked(addJobInTx).mockImplementation(async () => {
      events.push('enqueue');
      return 'job-1';
    });

    await stopWorkflowSessionSlotsInTx(tx, {
      organizationId: 'org-1',
      executionId: 'run-1',
    });

    // The spawner round-trip for the tickets runs BEFORE the org admission
    // lock — never under it — and the job is queued in the same transaction
    // as the row update.
    expect(events).toEqual([
      'read',
      'ticket',
      'ticket',
      'lock',
      'stop',
      'enqueue',
    ]);
    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      tx,
      'sandbox.release_idle',
      args,
    );
    // This transaction can still roll back. Only its queued job is allowed
    // to mutate runtime eligibility, once pg-boss observes the commit.
    expect(sessionReleaseIdle).not.toHaveBeenCalled();
  });

  it('never releases runtime eligibility when a cancellation transaction fails', async () => {
    const tx = scriptedSql([[session], [session]]);
    vi.mocked(addJobInTx).mockRejectedValue(new Error('transaction aborted'));

    await expect(
      stopWorkflowSessionSlotsInTx(tx, {
        organizationId: 'org-1',
        executionId: 'run-1',
      }),
    ).rejects.toThrow('transaction aborted');

    expect(sessionReleaseIdle).not.toHaveBeenCalled();
  });

  it.each(['old runtime', 'unreachable', 'missing config'])(
    'still releases the allocation without an idle ticket: %s',
    async (reason) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      if (reason === 'unreachable')
        vi.mocked(sessionReleaseTicket).mockRejectedValue(new Error('offline'));
      else vi.mocked(sessionReleaseTicket).mockResolvedValue(null);
      if (reason === 'missing config') vi.stubEnv('SANDBOX_TOKEN', '');
      const events: string[] = [];
      const tx = scriptedSql([[session], [session]], events);

      await stopWorkflowSessionSlotsInTx(tx, {
        organizationId: 'org-1',
        executionId: 'run-1',
        onlyIdle: true,
      });

      expect(events).toEqual(['read', 'lock', 'stop']);
      expect(addJobInTx).not.toHaveBeenCalled();
      expect(sessionReleaseIdle).not.toHaveBeenCalled();
    },
  );

  it('does not give a concurrently discovered session another session’s ticket', async () => {
    const tx = scriptedSql([
      [session],
      [{ organizationId: 'org-1', sessionId: 'new-session' }],
    ]);
    await stopWorkflowSessionSlotsInTx(tx, {
      organizationId: 'org-1',
      executionId: 'run-1',
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('idle release worker', () => {
  it('forwards the original generation, allowing a newer acquire to refuse a stale job', async () => {
    vi.mocked(sessionReleaseIdle).mockResolvedValue(false);
    await expect(
      releaseIdleSession(scriptedSql([[session]]), args),
    ).resolves.toBeUndefined();
    expect(sessionReleaseIdle).toHaveBeenCalledExactlyOnceWith(
      'session-1',
      'use-1',
    );
  });

  it('does nothing when the committed allocation or live-owner guard refuses eligibility', async () => {
    await releaseIdleSession(scriptedSql([[]]), args);
    expect(sessionReleaseIdle).not.toHaveBeenCalled();
  });

  it('lets the queue retry transport failures with the same captured generation', async () => {
    vi.mocked(sessionReleaseIdle).mockRejectedValue(new Error('offline'));
    await expect(
      releaseIdleSession(scriptedSql([[session]]), args),
    ).rejects.toThrow('offline');
    expect(sessionReleaseIdle).toHaveBeenCalledWith('session-1', 'use-1');
  });
});
