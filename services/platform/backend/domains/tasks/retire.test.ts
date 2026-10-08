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
import { RELEASE_REFS_PER_JOB } from '../knowledge/release-queue.ts';
import { cancelAgentRunInTx } from './agent-runs.ts';
import { releaseUnlistedTaskBlobRefs, retireTasksInTx } from './retire.ts';

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

function fakeTx(held = false): { tx: TransactionSql; statements: Statement[] } {
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
      if (text.includes("status = 'quarantined'"))
        return Promise.resolve(held ? [{ id: 'held' }] : []);
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

describe('retireTasksInTx [TASK-R13]', () => {
  it('refuses an unresolved hold before cancellation, deletion or blob release', async () => {
    const { tx, statements } = fakeTx(true);
    await expect(retireTasksInTx(tx, ARGS)).rejects.toMatchObject({
      code: 'TASK_HAS_LIVE_RUN',
      status: 409,
    });
    expect(cancelRunInTx).not.toHaveBeenCalled();
    expect(cancelAgentRunInTx).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(
      statements.every((statement) => statement.text.startsWith('SELECT')),
    ).toBe(true);
  });
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

describe('releaseUnlistedTaskBlobRefs', () => {
  it('trashes the tasks’ own unbound rows of a dropped ref, never a product’s image or a video link’s row (#4110)', async () => {
    const { tx, statements } = fakeTx();

    await expect(
      releaseUnlistedTaskBlobRefs(tx, 'org_1', ['s3:only-mine']),
    ).resolves.toEqual(['s3:only-mine']);

    const trash = statements.find((s) =>
      s.text.startsWith('UPDATE app.file_metadata SET'),
    );
    expect(trash?.text).toContain(
      'document_id IS NULL AND thread_id IS NULL AND conversation_id IS NULL',
    );
    expect(trash?.text).toContain(
      "AND source IS DISTINCT FROM 'product-image'",
    );
    // Nor a row a video-link job names: its job's cleanup and GC end it.
    expect(trash?.text).toContain(
      'AND NOT EXISTS ( SELECT 1 FROM app.video_link_jobs job WHERE job.org_id = file_metadata.org_id AND job.file_metadata_id = file_metadata.id )',
    );
    expect(trash?.values).toContainEqual(['s3:only-mine']);
  });

  it('queues a large release in bounded jobs, as every lane releasing more than one ref does', async () => {
    // A project's whole task tree can release thousands of refs at once.
    const refs = Array.from(
      { length: RELEASE_REFS_PER_JOB + 1 },
      (_, at) => `s3:org/f${String(at).padStart(4, '0')}.pdf`,
    );
    // No surviving task lists any of them.
    const run = (strings: TemplateStringsArray, ...values: unknown[]) =>
      Promise.resolve(
        strings.join('?').includes('FROM unnest')
          ? (values[0] as string[]).map((ref) => ({ ref }))
          : [],
      );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
    const tx = run as unknown as TransactionSql;
    await expect(
      releaseUnlistedTaskBlobRefs(tx, 'org_1', refs),
    ).resolves.toEqual(refs);
    expect(
      vi
        .mocked(addJobInTx)
        .mock.calls.map(([handle, name, payload]) => [
          handle,
          name,
          (payload as { refs: string[] }).refs,
        ]),
    ).toEqual([
      [tx, 'knowledge.release_refs', refs.slice(0, RELEASE_REFS_PER_JOB)],
      [tx, 'knowledge.release_refs', refs.slice(RELEASE_REFS_PER_JOB)],
    ]);
  });
});
