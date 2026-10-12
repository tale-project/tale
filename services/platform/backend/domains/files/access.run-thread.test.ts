// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { ProjectAuthContext } from '../projects/service.ts';
import { type FileBindingFields, resolveFileReadAccess } from './access.ts';

/**
 * A file a task run's tools made is bound to the run's transcript thread. The
 * transcript belongs to the task, not to a conversation anyone shares: the
 * people who can read the task's project read the files its runs made, as they
 * read the transcript that shows them, and no one else does.
 */

const viewer: ProjectAuthContext = {
  organizationId: 'org-a',
  userId: 'user-reader',
  role: 'member',
  teamIds: [],
};

const file: FileBindingFields = {
  organizationId: 'org-a',
  storageRef: 's3:tale/org-a/blob-1',
  uploadedBy: 'user-starter',
  documentId: null,
  threadId: 'thread-run',
  conversationId: null,
};

/** A pool answering the thread's row and the run's project, by statement. */
function pool(answers: {
  thread: { userId: string | null; kind: string | null } | null;
  runProjectTeams?: string[] | null;
}): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT user_id AS "userId", kind FROM app.threads')) {
      return Promise.resolve(answers.thread === null ? [] : [answers.thread]);
    }
    if (text.includes('FROM app.project_agent_runs r')) {
      return Promise.resolve(
        answers.runProjectTeams === undefined ||
          answers.runProjectTeams === null
          ? []
          : [{ teamIds: answers.runProjectTeams }],
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
  return { sql: sql as unknown as Sql, statements };
}

describe('a file bound to a task run’s transcript [TASK-R32]', () => {
  it('reads for anyone who can read an organization-wide project', async () => {
    const { sql } = pool({
      thread: { userId: 'user-starter', kind: 'task_run' },
      runProjectTeams: [],
    });

    await expect(resolveFileReadAccess(sql, viewer, file)).resolves.toBe(true);
  });

  it('reads for a member of a team the project is shared with', async () => {
    const { sql } = pool({
      thread: { userId: 'user-starter', kind: 'task_run' },
      runProjectTeams: ['team-1'],
    });

    await expect(
      resolveFileReadAccess(sql, { ...viewer, teamIds: ['team-1'] }, file),
    ).resolves.toBe(true);
  });

  it('does not read for someone outside the project’s teams', async () => {
    const { sql } = pool({
      thread: { userId: 'user-starter', kind: 'task_run' },
      runProjectTeams: ['team-1'],
    });

    await expect(resolveFileReadAccess(sql, viewer, file)).resolves.toBe(false);
  });

  it('does not read once the run is gone, which leaves no project to read through', async () => {
    const { sql } = pool({
      thread: { userId: 'user-starter', kind: 'task_run' },
      runProjectTeams: null,
    });

    await expect(resolveFileReadAccess(sql, viewer, file)).resolves.toBe(false);
  });

  it('is the starter’s own to read whatever the project says', async () => {
    const { sql, statements } = pool({
      thread: { userId: 'user-starter', kind: 'task_run' },
      runProjectTeams: ['team-1'],
    });

    await expect(
      resolveFileReadAccess(sql, { ...viewer, userId: 'user-starter' }, file),
    ).resolves.toBe(true);
    expect(statements).toEqual([]);
  });

  it('still shuts a chat out of everyone but its owner and the project it is shared with', async () => {
    const { sql, statements } = pool({
      thread: { userId: 'user-starter', kind: null },
      runProjectTeams: [],
    });

    await expect(resolveFileReadAccess(sql, viewer, file)).resolves.toBe(false);
    // A chat is never read through a run's project.
    expect(statements.some((text) => text.includes('project_agent_runs'))).toBe(
      false,
    );
  });
});
