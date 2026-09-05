// @vitest-environment node

/**
 * The shared task retirement walk (`deleteTask` and `deleteProject` both run
 * it). Before it existed the project door FK-cascaded its tasks away: every
 * reviewer kept a phantom pending review in the attention badge, live agent
 * runs lost their row mid-turn with no provenance entry, bound automation
 * runs kept running against deleted tasks, and the tasks' blobs leaked.
 * This pins the walk's order and what it hands to each seam.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { cancelRunInTx } from '../automations/store.ts';
import { cancelAgentRunInTx } from './agent-runs.ts';
import { retireTasksInTx } from './retire.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../automations/store.ts', () => ({
  cancelRunInTx: vi.fn().mockResolvedValue({ cancelled: true }),
}));
vi.mock('./agent-runs.ts', () => ({
  cancelAgentRunInTx: vi.fn().mockResolvedValue(true),
}));

interface Statement {
  text: string;
  values: unknown[];
}

const TASKS = [
  {
    id: 'task-1',
    discussionThreadId: 'thread-1',
    attachments: [{ fileId: 's3:shared' }],
    outputs: [{ fileId: 's3:only-mine' }],
  },
  {
    id: 'task-2',
    discussionThreadId: null,
    attachments: null,
    outputs: null,
  },
];

function fakeTx(): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT id, discussion_thread_id')) {
      return Promise.resolve(TASKS);
    }
    if (
      text.startsWith(
        'SELECT id, task_id AS "taskId" FROM app.project_agent_runs',
      )
    ) {
      return Promise.resolve([{ id: 'run-a', taskId: 'task-1' }]);
    }
    if (text.startsWith('SELECT id FROM app.automation_runs')) {
      return Promise.resolve([{ id: 'wf-run-1' }]);
    }
    if (text.startsWith('SELECT r.ref FROM unnest')) {
      // `s3:shared` is still listed by a surviving task; only the other ref
      // is orphaned.
      return Promise.resolve([{ ref: 's3:only-mine' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: run as unknown as TransactionSql, statements };
}

const ARGS = {
  organizationId: 'org_1',
  projectId: 'project-1',
  taskIds: ['task-1', 'task-2'],
  closedReason: 'project_deleted' as const,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('retireTasksInTx', () => {
  it('does nothing for an empty set', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      retireTasksInTx(tx, { ...ARGS, taskIds: [] }),
    ).resolves.toEqual({ cancelledRunCount: 0, releasedRefs: [] });
    expect(statements).toEqual([]);
  });

  it('cancels the live runs through their ledgered doors and counts them', async () => {
    const { tx } = fakeTx();
    const result = await retireTasksInTx(tx, ARGS);
    expect(cancelAgentRunInTx).toHaveBeenCalledWith(tx, {
      organizationId: 'org_1',
      runId: 'run-a',
      taskId: 'task-1',
    });
    expect(cancelRunInTx).toHaveBeenCalledWith(tx, 'org_1', 'wf-run-1');
    expect(result.cancelledRunCount).toBe(2);
  });

  it('deletes the discussion threads, closes the pending reviews with the reason, then deletes the rows', async () => {
    const { tx, statements } = fakeTx();
    await retireTasksInTx(tx, ARGS);
    const threads = statements.find((s) =>
      s.text.startsWith('DELETE FROM app.threads'),
    );
    expect(threads?.values).toEqual([['thread-1']]);
    const approvals = statements.find((s) =>
      s.text.startsWith('UPDATE app.approvals'),
    );
    expect(approvals?.text).toContain("status = 'rejected'");
    expect(approvals?.text).toContain('closedReason');
    expect(approvals?.values).toContain('project_deleted');
    expect(approvals?.values).toContainEqual(['task-1', 'task-2']);
    const taskDelete = statements.findIndex((s) =>
      s.text.startsWith('DELETE FROM app.tasks'),
    );
    expect(taskDelete).toBeGreaterThan(statements.indexOf(approvals!));
  });

  it('releases only the blob refs no surviving task still lists, after the rows are gone', async () => {
    const { tx, statements } = fakeTx();
    const result = await retireTasksInTx(tx, ARGS);
    expect(result.releasedRefs).toEqual(['s3:only-mine']);
    const taskDelete = statements.findIndex((s) =>
      s.text.startsWith('DELETE FROM app.tasks'),
    );
    const orphanCheck = statements.findIndex((s) =>
      s.text.startsWith('SELECT r.ref FROM unnest'),
    );
    // The liveness check must run AFTER the delete, or every ref of the
    // tasks being removed would still look held.
    expect(orphanCheck).toBeGreaterThan(taskDelete);
    const trash = statements.find((s) =>
      s.text.startsWith('UPDATE app.file_metadata'),
    );
    expect(trash?.values).toContainEqual(['s3:only-mine']);
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'knowledge.release_refs', {
      organizationId: 'org_1',
      refs: ['s3:only-mine'],
    });
  });
});
