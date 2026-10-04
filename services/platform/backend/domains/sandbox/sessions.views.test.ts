import type { Sql } from 'postgres';
import { describe, expect, test } from 'vitest';

import { listSandboxViewsForOrg, type SessionRow } from './sessions.ts';

function session(sessionId: string, createdAt = 1): SessionRow {
  return {
    id: `row-${sessionId}`,
    organizationId: 'org-1',
    sessionId,
    profile: {},
    status: 'stopped',
    ownerType: 'project_agent',
    ownerId: 'agent-1',
    createdBy: 'user-1',
    agentKind: 'opencode',
    llmGatewayKeyId: null,
    pinned: false,
    createdAt,
    expiresAt: 1000,
    lastActivityAt: null,
    destroyedAt: null,
  };
}

function operation(sessionId: string, execId: string, startedAt: number) {
  return {
    sessionId,
    execId,
    startedAt,
    threadId: null,
    status: 'completed',
    continuationCount: null,
    spentCents: 1 as number | null,
    pausedReason: null,
    progressText: null as string | null,
    heartbeatAt: null,
    finalizedAt: 100 as number | null,
  };
}

function viewSql(sessions: SessionRow[], ops: ReturnType<typeof operation>[]) {
  const query = (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('FROM app.sandbox_session_ops'))
      return Promise.resolve(ops);
    if (text.includes('coalesce(a.name, r.name)')) return Promise.resolve([]);
    if (text.includes('FROM app.sandbox_sessions'))
      return Promise.resolve(sessions);
    if (text.includes('FROM "user"')) return Promise.resolve([]);
    if (text.includes('FROM app.project_agent_runs'))
      return Promise.resolve([
        { sessionId: 'busy', execId: 'live-new', taskId: 'task-new' },
        { sessionId: 'busy', execId: 'live-old', taskId: 'task-old' },
      ]);
    throw new Error(`Unexpected session view query: ${text}`);
  };
  Object.assign(query, { unsafe: (text: string) => text });
  return query as unknown as Sql;
}

describe('listSandboxViewsForOrg', () => {
  test.each(['oldest-first', 'newest-first'])(
    'visits lifetime history once across all visible workspaces (%s)',
    async (order) => {
      const sessions = Array.from({ length: 48 }, (_, i) =>
        session(`ses-${i}`, i),
      );
      let sessionReads = 0;
      let progressReads = 0;
      const ops = sessions.flatMap((row) =>
        Array.from({ length: 256 }, (_, i) => ({
          ...operation(
            row.sessionId,
            `exec-${order === 'oldest-first' ? i : 255 - i}`,
            order === 'oldest-first' ? i : 255 - i,
          ),
          get sessionId() {
            sessionReads += 1;
            return row.sessionId;
          },
          get progressText() {
            progressReads += 1;
            return 'Latest progress';
          },
        })),
      );

      const views = await listSandboxViewsForOrg(
        viewSql(sessions, ops),
        'org-1',
      );

      expect(views).toHaveLength(sessions.length);
      expect(views.every((view) => view.totalSpentCents === 256)).toBe(true);
      expect(views.every((view) => view.currentOp?.execId === 'exec-255')).toBe(
        true,
      );
      // A settings poll must not revisit every operation for every workspace,
      // nor project progress for settled history which cannot be displayed.
      expect(sessionReads).toBeLessThanOrEqual(ops.length * 2);
      expect(progressReads).toBeLessThanOrEqual(sessions.length * 2);
    },
  );

  test('preserves running priority, finalization, ordering, spend and task lookup', async () => {
    const ops = [
      { ...operation('busy', 'settled-new', 90), spentCents: 7 },
      {
        ...operation('busy', 'live-new', 60),
        status: 'running',
        finalizedAt: null,
      },
      {
        ...operation('busy', 'live-old', 30),
        status: 'running',
        finalizedAt: null,
        spentCents: null,
      },
      {
        ...operation('busy', 'finalized', 100),
        status: 'running',
        spentCents: 3,
      },
      { ...operation('idle', 'finalized-only', 110), status: 'running' },
      operation('idle', 'settled-old', 10),
    ];
    const views = await listSandboxViewsForOrg(
      viewSql(
        [session('idle', 2), session('busy', 1), session('empty', 3)],
        ops,
      ),
      'org-1',
    );

    expect(views.map((view) => view.sessionId)).toEqual([
      'busy',
      'empty',
      'idle',
    ]);
    expect(views[0]).toMatchObject({
      busy: true,
      totalSpentCents: 11,
      currentOp: { execId: 'live-new', taskId: 'task-new' },
    });
    expect(views[0]?.runningOps.map((op) => op.taskId)).toEqual([
      'task-old',
      'task-new',
    ]);
    expect(views[1]).toMatchObject({
      busy: false,
      totalSpentCents: 0,
      currentOp: null,
      runningOps: [],
    });
    expect(views[2]).toMatchObject({
      busy: false,
      totalSpentCents: 2,
      currentOp: { execId: 'finalized-only', status: 'running' },
      runningOps: [],
    });
  });
});
