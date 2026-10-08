// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';
import { fileAttachmentProjectId, fileSpenderUserId } from './attribution.ts';

/**
 * The rules a file's transcription and its indexing share: whose spend the
 * work is — the first named who acts in the organization, else nobody's —
 * and the project it counts toward — the one named when the file was
 * registered, else the uploader's own chat's.
 */

interface Statement {
  text: string;
  values: unknown[];
}

/** A chat owned by `owner`, in `projectId`: the read answers only when it
 * asks for the owner's chat. */
function threadSql(thread: { owner: string; projectId: string | null }): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(
      values.includes(thread.owner) ? [{ projectId: thread.projectId }] : [],
    );
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: tag as unknown as Sql, statements };
}

const file = {
  organizationId: 'org-1',
  uploadedBy: 'mia',
  projectId: null,
  threadId: 'thread-1',
};

describe('fileAttachmentProjectId', () => {
  it('takes the project named when the file was registered, asking no chat [GOV-R14]', async () => {
    const fake = threadSql({ owner: 'mia', projectId: 'chat-project' });

    await expect(
      fileAttachmentProjectId(fake.sql, { ...file, projectId: 'new-chat' }),
    ).resolves.toBe('new-chat');
    expect(fake.statements).toEqual([]);
  });

  it('takes the project of the chat the uploader owns [GOV-R14]', async () => {
    const fake = threadSql({ owner: 'mia', projectId: 'chat-project' });

    await expect(fileAttachmentProjectId(fake.sql, file)).resolves.toBe(
      'chat-project',
    );
    expect(fake.statements[0]?.text).toContain('FROM app.thread_metadata');
    expect(fake.statements[0]?.values).toEqual(['thread-1', 'org-1', 'mia']);
  });

  it('names no project for a chat the uploader does not own', async () => {
    const fake = threadSql({ owner: 'noah', projectId: 'chat-project' });

    await expect(fileAttachmentProjectId(fake.sql, file)).resolves.toBeNull();
  });

  it('names none for a file nobody uploaded, or one added to no chat', async () => {
    const fake = threadSql({ owner: 'mia', projectId: 'chat-project' });

    await expect(
      fileAttachmentProjectId(fake.sql, { ...file, uploadedBy: null }),
    ).resolves.toBeNull();
    await expect(
      fileAttachmentProjectId(fake.sql, { ...file, threadId: null }),
    ).resolves.toBeNull();
    expect(fake.statements).toEqual([]);
  });
});

/** An organization whose members are `people`, and no API key identity. */
function memberSql(people: readonly string[]): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    const userId = values[1];
    if (text.includes('FROM "member"')) {
      return Promise.resolve(
        typeof userId === 'string' && people.includes(userId)
          ? [
              {
                id: `m-${userId}`,
                organizationId: 'org-1',
                userId,
                role: 'member',
              },
            ]
          : [],
      );
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return tag as unknown as Sql;
}

describe('fileSpenderUserId', () => {
  it('names the uploader who acts in the organization [GOV-R14]', async () => {
    await expect(
      fileSpenderUserId(memberSql(['mia']), 'org-1', ['mia', 'noah']),
    ).resolves.toBe('mia');
  });

  it('passes over a name no one acts under to the next — the document’s creator', async () => {
    await expect(
      fileSpenderUserId(memberSql(['drive-owner']), 'org-1', [
        'workflow',
        'drive-owner',
      ]),
    ).resolves.toBe('drive-owner');
  });

  it('books to automations when nobody named acts in the organization', async () => {
    await expect(
      fileSpenderUserId(memberSql([]), 'org-1', [
        'workflow',
        null,
        undefined,
        '',
      ]),
    ).resolves.toBe(AUTOMATION_SUBJECT_ID);
  });
});
