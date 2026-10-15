// @vitest-environment node

/**
 * Deleting a project agent used to leave every task it was assigned to
 * "assigned" to a raw id — the docs promised the references were cleared.
 * The tasks side of that delete: one set-based UPDATE scoped to the org and
 * the agent, on every board (a dispatch puts its agents on other projects'
 * boards), plus an `assignee.changed` line per task, in the task's own
 * project, so the timeline says why the card is unassigned.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAgentAssignmentsInTx } from './unassign.ts';

const { outbox } = vi.hoisted(() => ({ outbox: { emitHintInTx: vi.fn() } }));
vi.mock('../../realtime/outbox.ts', () => outbox);

interface Statement {
  text: string;
  values: unknown[];
}

interface ClearedRow {
  id: string;
  projectId?: string;
  repeat: unknown;
  createdByType: string;
}

/** Each cleared task: an id alone is a task a person filed, with no rule. */
function fakeTx(cleared: (string | ClearedRow)[]): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('UPDATE app.tasks SET assignee_type')) {
      return Promise.resolve(
        cleared.map((row) =>
          typeof row === 'string'
            ? {
                id: row,
                projectId: 'project-1',
                repeat: null,
                createdByType: 'user',
              }
            : { projectId: 'project-1', ...row },
        ),
      );
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

const args = {
  organizationId: 'org_1',
  agentId: 'agent-1',
  actorId: 'user-1',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('clearAgentAssignmentsInTx', () => {
  it('clears only the tasks that name this agent, on every board, and answers their ids [PROJ-R12]', async () => {
    const { tx, statements } = fakeTx(['task-1', 'task-2']);
    const cleared = await clearAgentAssignmentsInTx(tx, args);
    expect(cleared).toEqual(['task-1', 'task-2']);
    const update = statements.find((s) =>
      s.text.startsWith('UPDATE app.tasks'),
    );
    expect(update?.text).toContain('assignee_type = NULL');
    expect(update?.text).toContain('assignee_id = NULL');
    expect(update?.text).toContain("assignee_type = 'agent'");
    expect(update?.text).toContain('RETURNING id');
    expect(update?.text).not.toContain('project_id = ?');
    expect(update?.values).toEqual([
      expect.any(Number),
      'org_1',
      'agent-1',
      null,
    ]);
  });

  it('leaves the tasks of a project deleted with the agent as they are', async () => {
    const { tx, statements } = fakeTx([]);
    await clearAgentAssignmentsInTx(tx, {
      ...args,
      exceptProjectId: 'project-1',
    });
    const update = statements.find((s) =>
      s.text.startsWith('UPDATE app.tasks'),
    );
    expect(update?.text).toContain('project_id IS DISTINCT FROM ?');
    expect(update?.values.at(-1)).toBe('project-1');
  });

  it('writes the line in each task’s own project, and hints every board that lost the agent [PROJ-R12]', async () => {
    const { tx, statements } = fakeTx([
      {
        id: 'task-dev',
        projectId: 'p-dev',
        repeat: null,
        createdByType: 'user',
      },
      {
        id: 'task-billing',
        projectId: 'p-billing',
        repeat: null,
        createdByType: 'user',
      },
    ]);
    await clearAgentAssignmentsInTx(tx, args);
    expect(
      statements
        .filter((s) => s.text.startsWith('INSERT INTO app.task_activity'))
        .map((s) => [s.values[1], s.values[2]]),
    ).toEqual([
      ['task-dev', 'p-dev'],
      ['task-billing', 'p-billing'],
    ]);
    expect(outbox.emitHintInTx).toHaveBeenCalledWith(tx, {
      orgId: 'org_1',
      entity: 'project',
      entityId: 'p-billing',
    });
    expect(outbox.emitHintInTx).toHaveBeenCalledWith(tx, {
      orgId: 'org_1',
      entity: 'project',
      entityId: 'p-dev',
    });
  });

  it('writes one assignee.changed line per task, from the agent to nobody, and hints each task', async () => {
    const { tx, statements } = fakeTx(['task-1', 'task-2']);
    await clearAgentAssignmentsInTx(tx, args);
    const activities = statements.filter((s) =>
      s.text.startsWith('INSERT INTO app.task_activity'),
    );
    expect(activities).toHaveLength(2);
    expect(activities[0]?.values).toEqual([
      'org_1',
      'task-1',
      'project-1',
      'user',
      'user-1',
      'assignee.changed',
      'agent-1',
      null,
      null,
      expect.any(Number),
    ]);
    expect(
      outbox.emitHintInTx.mock.calls.filter(
        ([, hint]) => (hint as { entity: string }).entity === 'task',
      ),
    ).toHaveLength(2);
    expect(outbox.emitHintInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ entity: 'task', entityId: 'task-2' }),
    );
  });

  it('writes no activity when no task named the agent', async () => {
    const { tx, statements } = fakeTx([]);
    expect(await clearAgentAssignmentsInTx(tx, args)).toEqual([]);
    expect(
      statements.some((s) =>
        s.text.startsWith('INSERT INTO app.task_activity'),
      ),
    ).toBe(false);
    expect(outbox.emitHintInTx).not.toHaveBeenCalled();
  });

  it('ends the series of a repeating task an automation filed — nobody holds it now, so the automation owns it', async () => {
    const weekly = {
      frequency: 'weekly',
      interval: 1,
      weekdays: [1],
      timezone: 'Europe/Zurich',
    };
    const { tx, statements } = fakeTx([
      { id: 'task-filed', repeat: weekly, createdByType: 'app' },
      { id: 'task-mine', repeat: weekly, createdByType: 'user' },
    ]);
    await clearAgentAssignmentsInTx(tx, args);
    expect(
      statements
        .filter((s) => s.text.startsWith('UPDATE app.tasks SET repeat_rule'))
        .map((s) => [s.text, s.values]),
    ).toEqual([
      ['UPDATE app.tasks SET repeat_rule = NULL WHERE id = ?', ['task-filed']],
    ]);
    expect(
      statements
        .filter((s) => s.text.startsWith('INSERT INTO app.task_activity'))
        .map((s) => [s.values[1], s.values[5], s.values[6], s.values[7]]),
    ).toEqual([
      ['task-filed', 'assignee.changed', 'agent-1', null],
      ['task-filed', 'repeat.changed', JSON.stringify(weekly), null],
      ['task-mine', 'assignee.changed', 'agent-1', null],
    ]);
  });
});
