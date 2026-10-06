// @vitest-environment node

/**
 * A project agent's task and document tools answer to the person who
 * started the run a turn serves. The tool door reads that run from the
 * exec the turn's token names: a run a project editor started acts with the
 * agent's project scope; a run a member started — someone who works their
 * own tasks but may not edit the project — is confined to its own task, and
 * so is any run in a member's workspace; a run that has ended acts for
 * nobody.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { sandboxToolShimHandlers } from './shim.ts';

const STANDING = 'pa-agent-1';
const MEMBER_WORKSPACE = 'pa-agent-1-m0123456789abcdef';

interface Run {
  taskId: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  startedBy: string;
  execId: string;
}

function fakeSql(script: {
  run?: Run;
  /** Roles of `org-1`'s members by user id. */
  roles?: Record<string, string>;
}): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM app.sandbox_sessions')) {
      return Promise.resolve([
        { ownerType: 'project_agent', ownerId: 'agent-1' },
      ]);
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve([{ id: 'agent-1', projectId: 'p-1' }]);
    }
    if (text.includes('FROM app.project_agent_runs')) {
      const [organizationId, sessionId, execId] = values;
      const run = script.run;
      return Promise.resolve(
        run !== undefined &&
          organizationId === 'org-1' &&
          sessionId === run.sessionId &&
          execId === run.execId
          ? [run]
          : [],
      );
    }
    if (text.includes('AS "teamIds"')) {
      return Promise.resolve([{ teamIds: [] }]);
    }
    if (text.includes('FROM app.projects')) {
      return Promise.resolve([{ id: 'p-1' }]);
    }
    if (text.includes('FROM "member"')) {
      const userId = values[1];
      const role =
        typeof userId === 'string' ? script.roles?.[userId] : undefined;
      return Promise.resolve(
        role === undefined
          ? []
          : [{ id: 'm', organizationId: 'org-1', userId, role }],
      );
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the members the binding and run reads reach
  return Object.assign(fn, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

async function context(
  sql: Sql,
  args: { sessionId: string; taskRunExecId?: string },
): Promise<unknown> {
  const resolve =
    sandboxToolShimHandlers(sql)[
      'sandbox/workspace_access:resolveSessionActionContext'
    ];
  if (resolve === undefined) throw new Error('no handler');
  return resolve({
    organizationId: 'org-1',
    subject: 'tasks',
    effect: 'write',
    ...args,
  });
}

const run = (overrides: Partial<Run> = {}): Run => ({
  taskId: 'task-own',
  projectId: 'p-1',
  agentId: 'agent-1',
  sessionId: STANDING,
  startedBy: 'u-editor',
  execId: 'exec-1',
  ...overrides,
});

describe('a task turn’s tool authority follows the run’s starter [SBX-R7]', () => {
  it('a run a project editor started acts with the agent’s project scope', async () => {
    const sql = fakeSql({ run: run(), roles: { 'u-editor': 'editor' } });
    expect(
      await context(sql, { sessionId: STANDING, taskRunExecId: 'exec-1' }),
    ).toEqual({
      allowed: true,
      actorId: 'agent-1',
      scope: { kind: 'project', projectId: 'p-1' },
    });
  });

  it('a run a member started is confined to its own task', async () => {
    const sql = fakeSql({
      run: run({ sessionId: MEMBER_WORKSPACE, startedBy: 'u-member' }),
      roles: { 'u-member': 'member' },
    });
    expect(
      await context(sql, {
        sessionId: MEMBER_WORKSPACE,
        taskRunExecId: 'exec-1',
      }),
    ).toMatchObject({ allowed: true, confinedToTaskId: 'task-own' });
  });

  it('a run in a member’s workspace stays confined whoever steered it since', async () => {
    // An editor's steer re-books the run to them; the workspace is still
    // the member's, and so is what it may do.
    const sql = fakeSql({
      run: run({ sessionId: MEMBER_WORKSPACE, startedBy: 'u-editor' }),
      roles: { 'u-editor': 'editor' },
    });
    expect(
      await context(sql, {
        sessionId: MEMBER_WORKSPACE,
        taskRunExecId: 'exec-1',
      }),
    ).toMatchObject({ confinedToTaskId: 'task-own' });
  });

  it('a starter who lost the Editor role mid-run stops acting as one', async () => {
    const sql = fakeSql({ run: run(), roles: { 'u-editor': 'member' } });
    expect(
      await context(sql, { sessionId: STANDING, taskRunExecId: 'exec-1' }),
    ).toMatchObject({ confinedToTaskId: 'task-own' });
  });

  it('a run that has ended acts for nobody', async () => {
    const sql = fakeSql({ run: run(), roles: { 'u-editor': 'editor' } });
    expect(
      await context(sql, { sessionId: STANDING, taskRunExecId: 'exec-gone' }),
    ).toEqual({ allowed: false, reason: 'run_ended' });
  });

  it('a token that names no run keeps the standing workspace’s scope, and nothing in a member’s', async () => {
    const sql = fakeSql({ roles: {} });
    expect(await context(sql, { sessionId: STANDING })).toMatchObject({
      allowed: true,
      scope: { kind: 'project', projectId: 'p-1' },
    });
    expect(await context(sql, { sessionId: MEMBER_WORKSPACE })).toEqual({
      allowed: false,
      reason: 'run_ended',
    });
  });
});
