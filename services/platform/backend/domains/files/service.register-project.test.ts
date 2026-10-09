// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { s3HeadObject } from '../../lib/object-store.ts';
import { projectChatAccess } from '../chat/threads.ts';
import { FileError, registerUpload } from './service.ts';

/**
 * A recording added to a project's new chat is transcribed before the chat's
 * first message creates its thread, so the upload itself names the project
 * its cost counts toward. Naming one is a claim on the project's budget: the
 * uploader must be able to chat in it, as they must to start the chat.
 */

vi.mock('./upload-intents.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./upload-intents.ts')>()),
  consumeUploadIntent: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../chat/threads.ts', () => ({
  projectChatAccess: vi.fn(),
}));
vi.mock(import('../../lib/object-store.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the store is only handed back to the mocked HEAD
  resolveObjectStore: vi.fn(() => Promise.resolve({} as never)),
  s3HeadObject: vi.fn(() => Promise.resolve({ size: 2048 } as never)),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/** A recording transaction: no row claims the blob yet, and the insert
 * answers the new row's id. */
function fakeTx(): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(
      text.startsWith('INSERT INTO app.file_metadata')
        ? [{ id: 'file_1' }]
        : [],
    );
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { tx: tag as unknown as TransactionSql, statements };
}

const scope = { organizationId: 'org_1', userId: 'user_1' };
const args = {
  storageRef: 's3:blobs/acme/memo',
  fileName: 'memo.m4a',
  contentType: 'audio/mp4',
};

function register(tx: TransactionSql, projectId?: string) {
  return registerUpload(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the org store lookups are mocked
    {} as Sql,
    tx,
    scope,
    { ...args, ...(projectId !== undefined && { projectId }) },
    { kind: 'app', purpose: 'file' },
  );
}

const inserts = (statements: Statement[]) =>
  statements.filter((s) => s.text.startsWith('INSERT INTO app.file_metadata'));

beforeEach(() => {
  vi.mocked(projectChatAccess).mockResolvedValue('ok');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('registerUpload — the project a new chat is made in', () => {
  it('writes the project onto the row when the uploader may chat in it [GOV-R14]', async () => {
    const fake = fakeTx();

    await expect(register(fake.tx, 'project_1')).resolves.toEqual({
      fileId: 'file_1',
      size: 2048,
    });

    expect(projectChatAccess).toHaveBeenCalledWith(fake.tx, {
      projectId: 'project_1',
      organizationId: 'org_1',
      userId: 'user_1',
    });
    const insert = inserts(fake.statements)[0];
    expect(insert?.text).toContain('thread_id, project_id,');
    expect(insert?.values).toContain('project_1');
  });

  it.each([
    ['not_found', 'PROJECT_NOT_FOUND', 404],
    ['forbidden', 'PROJECT_FORBIDDEN', 403],
  ] as const)(
    'refuses a project the uploader cannot chat in (%s), before the blob is read or a row written [GOV-R14]',
    async (access, code, status) => {
      vi.mocked(projectChatAccess).mockResolvedValue(access);
      const fake = fakeTx();

      const refused = await register(fake.tx, 'project_1').catch(
        (error: unknown) => error,
      );

      expect(refused).toBeInstanceOf(FileError);
      expect(refused).toMatchObject({ code, status });
      expect(s3HeadObject).not.toHaveBeenCalled();
      expect(inserts(fake.statements)).toEqual([]);
    },
  );

  it('asks nothing of a project when the upload names none', async () => {
    const fake = fakeTx();

    await register(fake.tx);

    expect(projectChatAccess).not.toHaveBeenCalled();
    const insert = inserts(fake.statements)[0];
    expect(insert?.values).not.toContain('project_1');
  });
});
