import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { closePendingTaskReviewOnStatusLeave } from './reviews.ts';
import type { TaskRow } from './service.ts';

/**
 * A member decides the review of their own task — the decision is the move
 * to Done, and the task is theirs to work — unless the organization
 * requires an independent reviewer: then the person who started the run
 * cannot accept its work, and a member's own run waits for an editor. A run
 * an editor started on the member's task the member may still accept.
 */

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(),
}));
vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  dismissReviewRequestNotifications: vi.fn(),
  notifyTaskReviewRequested: vi.fn(),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));

const task = {
  id: 't-own',
  organizationId: 'org-1',
  projectId: 'p-1',
  title: 'Summarize the supplier contracts',
  status: 'in_review',
  createdBy: 'u-member',
  createdByType: 'user',
} as unknown as TaskRow;

/** The review the agent's settle opened, and the run behind it. */
function reviewTx(runStartedBy: string): {
  tx: TransactionSql;
  approved: () => boolean;
} {
  let approved = false;
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.includes('FROM app.approvals')) {
      return Promise.resolve([
        {
          id: 'a-1',
          organizationId: 'org-1',
          status: 'pending',
          wfExecutionId: null,
          metadata: { runId: 'r-1' },
        },
      ]);
    }
    if (text.includes('FROM app.project_agent_runs')) {
      return Promise.resolve([{ taskId: 't-own', startedBy: runStartedBy }]);
    }
    if (text.startsWith("UPDATE app.approvals SET status = 'completed'")) {
      approved = true;
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (text: string) => text,
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the members the review close reaches
    tx: tx as unknown as TransactionSql,
    approved: () => approved,
  };
}

const accept = (tx: TransactionSql) =>
  closePendingTaskReviewOnStatusLeave(tx, {
    task,
    toStatus: 'done',
    actor: { kind: 'user', userId: 'u-member' },
  });

beforeEach(() => {
  vi.mocked(readGovernancePolicyForOrg).mockReset().mockResolvedValue(null);
});

describe('a member accepting the review of their own task', () => {
  it('accepts the work of the run they started', async () => {
    const { tx, approved } = reviewTx('u-member');
    await accept(tx);
    expect(approved()).toBe(true);
  });

  it('cannot accept their own run where an independent reviewer is required', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      requireIndependentReviewer: true,
    } as never);
    const { tx, approved } = reviewTx('u-member');
    await expect(accept(tx)).rejects.toMatchObject({
      code: 'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
      status: 403,
    });
    expect(approved()).toBe(false);
  });

  it('accepts a run an editor started on it, even then', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      requireIndependentReviewer: true,
    } as never);
    const { tx, approved } = reviewTx('u-editor');
    await accept(tx);
    expect(approved()).toBe(true);
  });
});
