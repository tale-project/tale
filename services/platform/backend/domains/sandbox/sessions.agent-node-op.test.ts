import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { sessionIdForWorkflowExecution } from '../../core/sandbox/session_naming.ts';
import { getAgentNodeSandboxOp } from './sessions.ts';

const operations = [
  {
    execId: 'review-exec',
    status: 'completed',
    progressText: null,
    liveTimeline: [{ type: 'text', text: 'SECOND_TRANSCRIPT' }],
    modelRef: null,
    visionModelRef: null,
    startedAt: 2,
    finishedAt: 3,
    lastEventAt: 3,
  },
  {
    execId: 'draft-exec',
    status: 'completed',
    progressText: null,
    liveTimeline: [{ type: 'text', text: 'FIRST_TRANSCRIPT' }],
    modelRef: null,
    visionModelRef: null,
    startedAt: 1,
    finishedAt: 2,
    lastEventAt: 2,
  },
];

function database(run: unknown) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const sql = vi.fn<Sql>();
  sql.mockImplementation(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      statements.push({ text, values });
      const rows = text.includes('app.automation_runs')
        ? run === null
          ? []
          : [run]
        : operations
            .filter(
              (op) =>
                !text.includes('exec_id =') ||
                values.at(-1) === null ||
                op.execId === values.at(-1),
            )
            .slice(0, 1);
      return Promise.resolve(rows) as never;
    },
  );
  return { sql: sql as unknown as Sql, statements };
}

const completedRun = {
  id: 'run-1',
  checkpoints: {
    nodes: {
      draft_report: {
        trace: { node: 'draft_report', type: 'agent', execId: 'draft-exec' },
      },
      review_report: {
        trace: { node: 'review_report', type: 'agent', execId: 'review-exec' },
      },
    },
  },
  trace: [],
};

describe('agent-node sandbox operation selection', () => {
  it.each([
    ['draft_report', 'draft-exec', 'FIRST_TRANSCRIPT'],
    ['review_report', 'review-exec', 'SECOND_TRANSCRIPT'],
  ])(
    'selects the recorded execution for %s rather than the latest run operation',
    async (nodeId, execId, text) => {
      const { sql, statements } = database(completedRun);
      expect(
        await getAgentNodeSandboxOp(sql, {
          organizationId: 'org-1',
          runId: 'run-1',
          nodeId,
        }),
      ).toMatchObject({ execId, liveTimeline: [{ text }] });
      expect(statements[0]?.values).toEqual(['run-1', 'org-1']);
      expect(statements[1]?.text).toContain('org_id =');
      expect(statements[1]?.text).toContain('kind =');
      expect(statements[1]?.text).toContain('exec_id =');
      expect(statements[1]?.values).toEqual([
        sessionIdForWorkflowExecution('run-1'),
        'org-1',
        'workflow-agent',
        execId,
        execId,
      ]);
    },
  );

  it('reads the running node s current cursor execution', async () => {
    const { sql } = database({
      id: 'run-1',
      checkpoints: {
        nodes: {},
        cursor: { node: 'draft_report', agent: { execId: 'draft-exec' } },
      },
      trace: [],
    });
    expect(
      await getAgentNodeSandboxOp(sql, {
        organizationId: 'org-1',
        runId: 'run-1',
        nodeId: 'draft_report',
      }),
    ).toMatchObject({ execId: 'draft-exec' });
  });

  it('reads a failed node s final trace after the cursor was cleared', async () => {
    const { sql } = database({
      id: 'run-1',
      checkpoints: { nodes: {} },
      trace: [
        {
          node: 'draft_report',
          type: 'agent',
          status: 'error',
          execId: 'draft-exec',
        },
      ],
    });
    expect(
      await getAgentNodeSandboxOp(sql, {
        organizationId: 'org-1',
        runId: 'run-1',
        nodeId: 'draft_report',
      }),
    ).toMatchObject({ execId: 'draft-exec' });
  });

  it.each(['unknown', '', 'historical', 'no-op'])(
    'does not substitute a later transcript for %s',
    async (nodeId) => {
      const { sql } = database({
        ...completedRun,
        trace: [
          { node: 'historical', type: 'agent' },
          { node: 'no-op', type: 'agent', execId: 'missing-exec' },
        ],
      });
      expect(
        await getAgentNodeSandboxOp(sql, {
          organizationId: 'org-1',
          runId: 'run-1',
          nodeId,
        }),
      ).toBeNull();
    },
  );

  it('preserves the latest-operation read for run-wide consumers', async () => {
    const { sql } = database(completedRun);
    expect(
      await getAgentNodeSandboxOp(sql, {
        organizationId: 'org-1',
        runId: 'run-1',
      }),
    ).toMatchObject({ execId: 'review-exec' });
  });

  it('does not query operations for a missing or foreign-organization run', async () => {
    const { sql } = database(null);
    expect(
      await getAgentNodeSandboxOp(sql, {
        organizationId: 'foreign-org',
        runId: 'run-1',
        nodeId: 'draft_report',
      }),
    ).toBeNull();
    expect(sql).toHaveBeenCalledTimes(1);
  });
});
