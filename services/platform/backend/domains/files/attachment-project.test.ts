// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { fileAttachmentProjectId } from './attachment-project.ts';

/**
 * The one rule for the project a file was added in, which its
 * transcription and its indexing both count toward: the project named when
 * it was registered, else the uploader's own chat's.
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
