import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dismissAgentRunFailedNotifications,
  notifyAgentRunFailed,
} from '../collab/service.ts';
import { markAutoRetryRetired } from './kick-plan.ts';
import {
  announceAgentRunFailed,
  retireAutoRetry,
  withdrawAgentRunFailedNotices,
} from './run-failure-notice.ts';

vi.mock('../collab/service.ts', () => ({
  notifyAgentRunFailed: vi.fn(async () => 1),
  dismissAgentRunFailedNotifications: vi.fn(async () => 1),
}));
vi.mock('./kick-plan.ts', () => ({ markAutoRetryRetired: vi.fn() }));

type Row = Record<string, unknown>;

/** A tagged-template stand-in answering the failed-run read. */
function fakeTx(rows: Row[]): {
  tx: TransactionSql;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
  return { tx: tag as unknown as TransactionSql, calls };
}

const FAILED = {
  taskId: 'task-1',
  projectId: 'proj-1',
  title: 'Compare the two offers',
  archived: false,
  agentId: 'agent-1',
  startedBy: 'user:member-1',
  failureCode: 'budget_exceeded',
};

describe('announceAgentRunFailed', () => {
  beforeEach(() => {
    vi.mocked(notifyAgentRunFailed).mockClear();
  });

  it('tells the task’s people about the failed run, naming the person behind its starter', async () => {
    const { tx, calls } = fakeTx([FAILED]);

    await announceAgentRunFailed(tx, { organizationId: 'org-1', runId: 'r-1' });

    // Read in the organization, and only while the run is failed.
    expect(calls[0]?.text).toContain('WHERE r.id = ? AND r.org_id = ?');
    expect(calls[0]?.text).toContain("AND r.status = 'failed'");
    expect(calls[0]?.values).toEqual(['r-1', 'org-1']);
    expect(notifyAgentRunFailed).toHaveBeenCalledWith(tx, {
      task: {
        id: 'task-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        title: 'Compare the two offers',
      },
      agentId: 'agent-1',
      starterUserId: 'member-1',
      failureCode: 'budget_exceeded',
    });
  });

  it('names nobody behind a schedule’s start', async () => {
    const { tx } = fakeTx([{ ...FAILED, startedBy: 'trigger:trg-1' }]);

    await announceAgentRunFailed(tx, { organizationId: 'org-1', runId: 'r-1' });

    expect(notifyAgentRunFailed).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ starterUserId: null }),
    );
  });

  it('stays silent about an archived task, and about a run that is not failed', async () => {
    await announceAgentRunFailed(fakeTx([{ ...FAILED, archived: true }]).tx, {
      organizationId: 'org-1',
      runId: 'r-1',
    });
    await announceAgentRunFailed(fakeTx([]).tx, {
      organizationId: 'org-1',
      runId: 'r-1',
    });

    expect(notifyAgentRunFailed).not.toHaveBeenCalled();
  });
});

describe('retireAutoRetry', () => {
  beforeEach(() => {
    vi.mocked(notifyAgentRunFailed).mockClear();
    vi.mocked(markAutoRetryRetired).mockReset();
  });

  const ARGS = { organizationId: 'org-1', taskId: 'task-1', runId: 'r-1' };

  it('marks the run retired and tells, the first time', async () => {
    vi.mocked(markAutoRetryRetired).mockResolvedValue(true);
    const { tx } = fakeTx([FAILED]);

    await retireAutoRetry(tx, { ...ARGS, announce: true });

    expect(markAutoRetryRetired).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      taskId: 'task-1',
      failedRunId: 'r-1',
    });
    expect(notifyAgentRunFailed).toHaveBeenCalledTimes(1);
  });

  it('tells nobody again when another delivery retired it first', async () => {
    vi.mocked(markAutoRetryRetired).mockResolvedValue(false);

    await retireAutoRetry(fakeTx([FAILED]).tx, { ...ARGS, announce: true });

    expect(notifyAgentRunFailed).not.toHaveBeenCalled();
  });

  it('retires without a bell when the refusal follows someone else’s decision', async () => {
    vi.mocked(markAutoRetryRetired).mockResolvedValue(true);

    await retireAutoRetry(fakeTx([FAILED]).tx, { ...ARGS, announce: false });

    expect(markAutoRetryRetired).toHaveBeenCalledTimes(1);
    expect(notifyAgentRunFailed).not.toHaveBeenCalled();
  });
});

describe('withdrawAgentRunFailedNotices', () => {
  it('answers the task’s unread notices', async () => {
    const { tx } = fakeTx([]);

    await withdrawAgentRunFailedNotices(tx, {
      organizationId: 'org-1',
      taskId: 'task-1',
    });

    expect(dismissAgentRunFailedNotifications).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      taskId: 'task-1',
    });
  });
});
