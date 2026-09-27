// @vitest-environment node

/**
 * The write shim is where a domain refusal becomes the coded `AppError` the
 * workspace-tool bridge answers from: `{code, message}`, the message being
 * the domain's own sentence that names the limit a value broke. These run
 * the REAL domain writers on a stub transaction, so the sentence pinned here
 * is the one an agent's tool result carries.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  TASK_COMMENT_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_LABEL_CHARS_MAX,
} from '../../core/tasks/helpers.ts';
import { MentionDirectoryError } from '../collab/mention-directory.ts';
import { workspaceWriteShimHandlers } from './workspace-write-shim.ts';

const PROJECT = {
  id: 'proj-1',
  organizationId: 'org-1',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null,
};
const TASK = {
  id: 'task-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  archivedAt: null,
  discussionThreadId: 'thread-1',
};

/** A postgres.js stand-in: both `begin` overloads run the callback on a
 * transaction that answers the project and task reads, records every
 * statement, and answers nothing else. A statement `fails` matches rejects
 * the way a dropped connection does. */
function stubSql(fails: (text: string) => boolean = () => false): {
  sql: Sql;
  statements: string[];
} {
  const statements: string[] = [];
  const tx = Object.assign(
    (strings: TemplateStringsArray) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      statements.push(text);
      if (fails(text)) {
        return Promise.reject(
          Object.assign(new Error('Connection terminated unexpectedly'), {
            code: 'CONNECTION_ENDED',
          }),
        );
      }
      if (text.startsWith('SELECT ? FROM app.projects WHERE id = ?')) {
        return Promise.resolve([PROJECT]);
      }
      if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
        return Promise.resolve([TASK]);
      }
      return Promise.resolve([]);
    },
    { json: (value: unknown) => value, unsafe: (text: string) => text },
  );
  const sql = {
    begin: (first: unknown, second?: unknown) => {
      const run = typeof first === 'function' ? first : second;
      if (typeof run !== 'function') throw new Error('begin without a body');
      return Promise.resolve(run(tx));
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `begin` is all the shim's writers reach
  return { sql: sql as unknown as Sql, statements };
}

/** One handler of the map, by the function name the bridge calls. */
function writer(sql: Sql, name: string): (args: unknown) => Promise<unknown> {
  const handler = workspaceWriteShimHandlers(sql)[name];
  if (handler === undefined) throw new Error(`no shim handler for ${name}`);
  return handler;
}

/** The `{code, message}` a shim handler rejected with. */
async function codedRefusal(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    if (error instanceof AppError) return error.data;
    throw error;
  }
  throw new Error('expected a coded refusal');
}

const writes = (statements: string[]): string[] =>
  statements.filter((text) => /^(INSERT|UPDATE|DELETE)\b/.test(text));

describe('workspaceWriteShimHandlers — a refusal carries its sentence', () => {
  const createArgs = {
    organizationId: 'org-1',
    actorId: 'agent-7',
    projectId: 'proj-1',
    title: 'Filed by an agent',
  };

  it('agentCreateTask answers a description over the cap with the limit named', async () => {
    const { sql, statements } = stubSql();
    const create = writer(sql, 'tasks/internal_mutations:agentCreateTask');
    expect(
      await codedRefusal(
        create({
          ...createArgs,
          description: 'd'.repeat(TASK_DESCRIPTION_MAX + 1),
        }),
      ),
    ).toEqual({
      code: 'TASK_DESCRIPTION_INVALID',
      message:
        'The task description is capped at 20,000 UTF-16 code units (most ' +
        'emoji count as 2); this one has 20,001.',
    });
    expect(writes(statements)).toEqual([]);
  });

  it('agentCreateTask answers a label over 50 code units with the limit named', async () => {
    const { sql, statements } = stubSql();
    const create = writer(sql, 'tasks/internal_mutations:agentCreateTask');
    expect(
      await codedRefusal(
        create({
          ...createArgs,
          labels: ['l'.repeat(TASK_LABEL_CHARS_MAX + 1)],
        }),
      ),
    ).toEqual({
      code: 'TASK_LABELS_INVALID',
      message:
        'A label name is capped at 50 UTF-16 code units (most emoji count ' +
        'as 2); this one has 51.',
    });
    expect(writes(statements)).toEqual([]);
  });

  it('agentAddComment answers an over-long body coded, like its siblings', async () => {
    // It used to live outside this map, uncoded: the domain's TaskError
    // reached the bridge raw and the agent read `error`, which says "try
    // again", instead of `invalid_args`.
    const { sql, statements } = stubSql();
    const comment = writer(sql, 'tasks/internal_mutations:agentAddComment');
    expect(
      await codedRefusal(
        comment({
          organizationId: 'org-1',
          actorId: 'agent-7',
          taskId: 'task-1',
          body: 'c'.repeat(TASK_COMMENT_MAX + 1),
        }),
      ),
    ).toEqual({
      code: 'TASK_COMMENT_INVALID',
      message:
        'The comment is capped at 10,000 UTF-16 code units (most emoji ' +
        'count as 2); this one has 10,001.',
    });
    expect(writes(statements)).toEqual([]);
  });
});

describe('workspaceWriteShimHandlers — an outage is not a refusal', () => {
  it('agentAddComment leaves a mention directory it could not list as a plain error', async () => {
    // Every agent comment builds the mention directory. A leg that cannot be
    // listed throws MentionDirectoryError — coded, but a 503: a retryable
    // outage. Translated like a 4xx refusal, it reached the agent as
    // `invalid_args` ("your arguments were wrong") and was audited so.
    const { sql, statements } = stubSql((text) =>
      text.startsWith('SELECT m."userId"'),
    );
    const comment = writer(sql, 'tasks/internal_mutations:agentAddComment');
    const attempt = comment({
      organizationId: 'org-1',
      actorId: 'agent-7',
      taskId: 'task-1',
      body: 'A body that fits',
    });
    await expect(attempt).rejects.toBeInstanceOf(MentionDirectoryError);
    await expect(attempt).rejects.not.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({
      code: 'MENTION_DIRECTORY_UNAVAILABLE',
      status: 503,
    });
    expect(writes(statements)).toEqual([]);
  });
});
