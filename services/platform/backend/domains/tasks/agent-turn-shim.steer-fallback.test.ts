import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { agentTurnShimHandlers } from './agent-turn-shim.ts';

/**
 * A steer that reaches a run which has settled meanwhile becomes a fresh
 * mention run. The run's starter may steer it on a task that is no longer
 * theirs, but that exception is for a live run: a NEW run is a change to
 * the task, so the fallback kicks only for an author who may work it — as
 * the project stands when the kick lands, inside the kick's transaction.
 */

function fakeSql(
  authorRole: string,
  project: { archivedAt: number | null } = { archivedAt: null },
): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.includes('FROM app.tasks')) {
      // Handed to the agent by the member it was assigned to; an editor
      // created it, so it is no longer the member's.
      return Promise.resolve([
        {
          projectId: 'p-1',
          assigneeType: 'agent',
          assigneeId: 'agent-1',
          createdBy: 'u-editor',
          createdByType: 'user',
          parentTaskId: null,
        },
      ]);
    }
    if (text.includes('FROM "member"')) {
      return Promise.resolve([{ role: authorRole }]);
    }
    if (text.includes('FROM app.projects') && text.includes('FOR SHARE')) {
      return Promise.resolve([{ id: 'p-1' }]);
    }
    if (text.startsWith('SELECT ? FROM app.projects WHERE id = ?')) {
      return Promise.resolve([
        {
          id: 'p-1',
          organizationId: 'org-1',
          teamId: null,
          sharedWithTeamIds: [],
          teamIds: [],
          archivedAt: project.archivedAt,
        },
      ]);
    }
    return Promise.resolve([]);
  };
  const begin = async (
    first: unknown,
    second?: (tx: unknown) => Promise<unknown>,
  ) => {
    const body = typeof first === 'function' ? first : second;
    if (typeof body !== 'function') throw new Error('begin without a body');
    return body(sql);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the members the fallback's reads reach
  return { sql: sql as unknown as Sql, statements };
}

describe('the settled-run fallback of a steer', () => {
  it('starts no new run for an author who may not work the task', async () => {
    const { sql, statements } = fakeSql('member');
    const kick =
      agentTurnShimHandlers(sql)[
        'tasks/mutations:kickMentionRunAfterSteerMiss'
      ];
    if (kick === undefined) throw new Error('no handler');

    expect(
      await kick({
        organizationId: 'org-1',
        taskId: 't-1',
        authorId: 'u-member',
        feedback: '@agent use the signed copies only',
        mentionSource: 'comment',
      }),
    ).toEqual({ started: false, reason: 'not_permitted' });
    expect(
      statements.some((text) =>
        text.startsWith('INSERT INTO app.project_agent_runs'),
      ),
    ).toBe(false);
  });

  it('starts no new run once the project is archived, for an editor too', async () => {
    const { sql, statements } = fakeSql('editor', {
      archivedAt: 1_700_000_000_000,
    });
    const kick =
      agentTurnShimHandlers(sql)[
        'tasks/mutations:kickMentionRunAfterSteerMiss'
      ];
    if (kick === undefined) throw new Error('no handler');

    expect(
      await kick({
        organizationId: 'org-1',
        taskId: 't-1',
        authorId: 'u-editor',
        feedback: '@agent use the signed copies only',
        mentionSource: 'comment',
      }),
    ).toEqual({ started: false, reason: 'project_archived' });
    // The project was held, and read, inside the kick's transaction.
    expect(
      statements.findIndex((text) => text.includes('FOR SHARE')),
    ).toBeGreaterThan(-1);
    expect(
      statements.some((text) =>
        text.startsWith('INSERT INTO app.project_agent_runs'),
      ),
    ).toBe(false);
  });
});
