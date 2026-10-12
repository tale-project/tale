// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { createThread } from '../threads/store.ts';
import { saveAgentFileMetadata } from './agent-file-metadata.ts';
import { emitTaskRunHint } from './agent-runs.ts';
import {
  attachRunThread,
  listRunFiles,
  moveRunToHarnessInTx,
  readNativeRunOp,
} from './native-runs.ts';
import { TASK_RUN_THREAD_KIND } from './run-transcripts.ts';
import { agentRecordTaskOutputsTrusted } from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../threads/store.ts', () => ({ createThread: vi.fn() }));
vi.mock('./agent-file-metadata.ts', () => ({ saveAgentFileMetadata: vi.fn() }));
vi.mock('./agent-runs.ts', () => ({ emitTaskRunHint: vi.fn() }));
vi.mock('./comments.ts', () => ({
  queuedOnTask: (_tx: unknown, _taskId: string, work: () => unknown) => work(),
}));
vi.mock('./service.ts', () => ({ agentRecordTaskOutputsTrusted: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

/** A pool answering each statement from `answers` by a fragment of its text
 * (the first fragment contained wins), recording them all. */
function fakeSql(answers: [string, unknown[]][] = []): {
  sql: Sql;
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const hit = answers.find(([fragment]) => text.includes(fragment));
    return Promise.resolve(hit?.[1] ?? []);
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    begin: (work: (tx: unknown) => unknown) => work(sql),
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
    sql: sql as unknown as Sql,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same fake as a transaction
    tx: sql as unknown as TransactionSql,
    statements,
  };
}

beforeEach(() => {
  vi.mocked(addJobInTx).mockReset();
  vi.mocked(createThread).mockReset().mockResolvedValue('thread-1');
  vi.mocked(saveAgentFileMetadata).mockReset();
  vi.mocked(emitTaskRunHint).mockReset();
  vi.mocked(agentRecordTaskOutputsTrusted).mockReset();
});

describe('attachRunThread [TASK-R32]', () => {
  const ARGS = {
    organizationId: 'org-1',
    runId: 'run-1',
    execId: 'exec-1',
    userId: 'user-1',
    title: 'Contacts',
  };

  it('opens the run’s transcript for the person it acts for, a bare thread no chat list shows, and points the run at it', async () => {
    const { sql, statements } = fakeSql([['FOR UPDATE', [{ id: 'run-1' }]]]);

    await expect(attachRunThread(sql, ARGS)).resolves.toBe('thread-1');

    expect(createThread).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      userId: 'user-1',
      title: 'Contacts',
      kind: TASK_RUN_THREAD_KIND,
    });
    const update = statements.find((statement) =>
      statement.text.startsWith('UPDATE app.project_agent_runs SET thread_id'),
    );
    expect(update?.values[0]).toBe('thread-1');
  });

  it('opens it once, for the exec that owns a running native run', async () => {
    const { sql, statements } = fakeSql([['FOR UPDATE', []]]);

    await expect(attachRunThread(sql, ARGS)).resolves.toBeNull();

    expect(createThread).not.toHaveBeenCalled();
    const claim = statements[0];
    expect(claim?.text).toContain("status = 'running'");
    expect(claim?.text).toContain("engine = 'native'");
    expect(claim?.text).toContain('thread_id IS NULL');
  });
});

describe('listRunFiles [TASK-R32]', () => {
  const row = (fileId: string, fileName: string) => ({
    fileId,
    fileName,
    fileType: 'text/plain',
    fileSize: 1,
  });

  it('answers the files in the order they were made', async () => {
    const { sql } = fakeSql([
      ['FROM app.file_metadata', [row('s3:a', 'a.csv'), row('s3:b', 'b.md')]],
    ]);

    await expect(
      listRunFiles(sql, { organizationId: 'org-1', threadId: 'thread-1' }),
    ).resolves.toEqual([row('s3:a', 'a.csv'), row('s3:b', 'b.md')]);
  });

  it('keeps a revised file as its last version, where it was made last', async () => {
    const { sql } = fakeSql([
      [
        'FROM app.file_metadata',
        [
          row('s3:v1', 'report.md'),
          row('s3:b', 'b.md'),
          row('s3:v2', 'report.md'),
        ],
      ],
    ]);

    await expect(
      listRunFiles(sql, { organizationId: 'org-1', threadId: 'thread-1' }),
    ).resolves.toEqual([row('s3:b', 'b.md'), row('s3:v2', 'report.md')]);
  });

  it('reads only the run’s own rows: agent-made, not trashed', async () => {
    const { sql, statements } = fakeSql();

    await listRunFiles(sql, { organizationId: 'org-1', threadId: 'thread-1' });

    expect(statements[0]?.text).toContain("source IN ('agent', 'task-output')");
    expect(statements[0]?.text).toContain("lifecycle_status = 'active'");
    expect(statements[0]?.values).toEqual(['org-1', 'thread-1']);
  });
});

describe('moveRunToHarnessInTx [TASK-R31]', () => {
  const ARGS = { organizationId: 'org-1', runId: 'run-1', execId: 'exec-1' };

  function answering(live: boolean) {
    return fakeSql([
      [
        'SELECT task_id AS "taskId"',
        live ? [{ taskId: 'task-1', projectId: 'p-1' }] : [],
      ],
      ['FOR UPDATE', live ? [{ id: 'run-1' }] : []],
    ]);
  }

  it('hands the run over: its files become the task’s deliverables, and the harness starts under a fresh exec with the pass’s brief', async () => {
    const { tx, statements } = answering(true);
    const handoff = { reason: 'needs git', brief: 'Clone it.' };
    const files = [
      {
        fileId: 's3:a',
        fileName: 'draft.md',
        fileType: 'text/markdown',
        fileSize: 5,
      },
    ];

    const execId = await moveRunToHarnessInTx(tx, { ...ARGS, handoff, files });

    expect(execId).toEqual(expect.any(String));
    expect(execId).not.toBe('exec-1');
    expect(saveAgentFileMetadata).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      storageId: 's3:a',
      fileName: 'draft.md',
      contentType: 'text/markdown',
      size: 5,
      source: 'task-output',
    });
    expect(agentRecordTaskOutputsTrusted).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      taskId: 'task-1',
      runId: 'run-1',
      files,
    });
    const flip = statements.find((statement) =>
      statement.text.startsWith('UPDATE app.project_agent_runs SET engine'),
    );
    expect(flip?.text).toContain("engine = 'harness', status = 'queued'");
    expect(flip?.values).toEqual([
      execId,
      { json: handoff },
      expect.any(Number),
      'run-1',
    ]);
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'task.agent_turn', {
      organizationId: 'org-1',
      runId: 'run-1',
      execId,
    });
    expect(emitTaskRunHint).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      taskId: 'task-1',
    });
  });

  it('routes a run the engine cannot serve to the harness with no brief and no files', async () => {
    const { tx, statements } = answering(true);

    await moveRunToHarnessInTx(tx, ARGS);

    expect(saveAgentFileMetadata).not.toHaveBeenCalled();
    const flip = statements.find((statement) =>
      statement.text.startsWith('UPDATE app.project_agent_runs SET engine'),
    );
    // No handoff: a retry of such a run decides the engine afresh.
    expect(flip?.values[1]).toBeNull();
    expect(addJobInTx).toHaveBeenCalledOnce();
  });

  it('moves nothing for a pass that lost the run to a stop or a steer', async () => {
    const { tx, statements } = answering(false);

    await expect(
      moveRunToHarnessInTx(tx, {
        ...ARGS,
        handoff: { reason: 'r', brief: 'b' },
      }),
    ).resolves.toBeNull();

    expect(addJobInTx).not.toHaveBeenCalled();
    expect(agentRecordTaskOutputsTrusted).not.toHaveBeenCalled();
    expect(
      statements.some((statement) =>
        statement.text.startsWith('UPDATE app.project_agent_runs'),
      ),
    ).toBe(false);
  });

  it('is fenced on the exec and the native engine, and takes the run before it writes', async () => {
    const { tx, statements } = answering(true);

    await moveRunToHarnessInTx(tx, ARGS);

    for (const statement of statements.slice(0, 2)) {
      expect(statement.text).toContain("engine = 'native'");
      expect(statement.text).toContain('exec_id =');
    }
    expect(statements[1]?.text).toContain('FOR UPDATE');
  });
});

describe('readNativeRunOp [TASK-R32]', () => {
  const RUN = {
    execId: 'exec-1',
    status: 'running',
    threadId: 'thread-1',
    model: 'claude-sonnet-5',
    modelProvider: 'anthropic',
    startedAt: 100,
    launchedAt: 150,
    settledAt: null,
    updatedAt: 400,
  };
  const PARTS = [
    { type: 'text', text: 'Working on it.' },
    {
      type: 'tool-call',
      callId: 'c1',
      capabilityId: 'create_file',
      input: { name: 'a.md' },
    },
    {
      type: 'tool-result',
      callId: 'c1',
      capabilityId: 'create_file',
      output: { status: 'ok' },
      structured: true,
    },
  ];

  it('is nothing for a run that is not native, or has no transcript yet', async () => {
    await expect(
      readNativeRunOp(
        fakeSql([['FROM app.project_agent_runs', []]]).sql,
        'org-1',
        'run-1',
      ),
    ).resolves.toBeNull();
    await expect(
      readNativeRunOp(
        fakeSql([['FROM app.project_agent_runs', [{ ...RUN, threadId: null }]]])
          .sql,
        'org-1',
        'run-1',
      ),
    ).resolves.toBeNull();
  });

  it('shows the transcript in the wire a harness run’s log is read in, with the round streaming now', async () => {
    const { sql } = fakeSql([
      ['FROM app.project_agent_runs', [RUN]],
      ['FROM app.messages', [{ parts: PARTS, text: null }]],
      ['FROM app.generations', [{ text: 'Almost there' }]],
    ]);

    await expect(readNativeRunOp(sql, 'org-1', 'run-1')).resolves.toEqual({
      execId: 'exec-1',
      status: 'running',
      progressText: 'Almost there',
      liveTimeline: [
        { type: 'text', text: 'Working on it.' },
        {
          type: 'tool-create_file',
          state: 'output-available',
          toolCallId: 'c1',
          input: { name: 'a.md' },
          output: { status: 'ok' },
        },
      ],
      modelRef: 'anthropic/claude-sonnet-5',
      startedAt: 150,
      lastEventAt: 400,
    });
  });

  it.each([
    ['settled', 'completed'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    ['queued', 'running'],
  ])(
    'reads a %s run as %s, finished at its settle',
    async (status, opStatus) => {
      const { sql } = fakeSql([
        [
          'FROM app.project_agent_runs',
          [{ ...RUN, status, settledAt: status === 'queued' ? null : 900 }],
        ],
        ['FROM app.messages', [{ parts: PARTS, text: null }]],
      ]);

      const op = await readNativeRunOp(sql, 'org-1', 'run-1');

      expect(op?.status).toBe(opStatus);
      if (status !== 'queued') expect(op?.finishedAt).toBe(900);
      // Nothing streams once the turn's generation row is gone.
      expect(op).not.toHaveProperty('progressText');
    },
  );
});
