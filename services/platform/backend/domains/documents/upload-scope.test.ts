// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { createDocumentFromUpload, createHubDocument } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('./hints.ts', () => ({ emitDocumentChangeHints: vi.fn() }));
vi.mock('../knowledge/service.ts', () => ({ markRagQueued: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx: vi.fn(),
}));

const auth = {
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'editor',
  teamIds: [],
};

function database(options: {
  existingProjectId: string | null;
  boundDuringLock?: boolean;
}) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings
      .reduce(
        (query, part, i) =>
          query +
          part +
          (typeof values[i] === 'object' &&
          values[i] !== null &&
          'sql' in values[i]
            ? String(values[i].sql)
            : i < values.length
              ? '?'
              : ''),
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();
    statements.push({ text, values });
    if (text.includes('FROM app.file_metadata'))
      return [
        {
          id: 'file-1',
          organizationId: 'org-1',
          uploadedBy: 'user-1',
          storageRef: 's3:acme/file-1',
          contentType: 'text/plain',
          documentId:
            options.boundDuringLock && !text.includes('FOR UPDATE')
              ? null
              : 'doc-1',
          threadId: null,
          conversationId: null,
        },
      ];
    if (text.includes('FROM app.documents'))
      return [
        {
          id: 'doc-1',
          organizationId: 'org-1',
          projectId: options.existingProjectId,
        },
      ];
    if (text.includes('FROM app.projects'))
      return [
        {
          id: 'p-1',
          organizationId: 'org-1',
          teamId: null,
          sharedWithTeamIds: [],
        },
      ];
    if (text.startsWith('INSERT INTO app.documents')) return [{ id: 'doc-2' }];
    return [];
  };
  const tx = Object.assign(tag, {
    unsafe: (sql: string) => ({ sql }),
    json: (value: unknown) => value,
  }) as unknown as TransactionSql;
  return { tx, statements };
}

describe('document upload scope admission', () => {
  it.each([
    [null, 'p-1'],
    ['p-1', undefined],
    ['p-1', 'p-2'],
  ])(
    'refuses to reuse a %s upload in scope %s',
    async (existingProjectId, projectId) => {
      const { tx, statements } = database({ existingProjectId });
      await expect(
        createDocumentFromUpload(tx, auth, {
          fileId: 'file-1',
          fileName: 'Private.txt',
          ...(projectId !== undefined ? { projectId } : {}),
        }),
      ).rejects.toMatchObject({ code: 'UPLOAD_SCOPE_CONFLICT' });
      expect(
        statements.some(({ text }) =>
          text.startsWith('INSERT INTO app.documents'),
        ),
      ).toBe(false);
    },
  );

  it.each([null, 'p-1'])(
    'preserves repeated document creation within scope %s',
    async (projectId) => {
      const { tx } = database({ existingProjectId: projectId });
      await expect(
        createDocumentFromUpload(tx, auth, {
          fileId: 'file-1',
          fileName: 'Shared.txt',
          ...(projectId !== null ? { projectId } : {}),
        }),
      ).resolves.toBe('doc-2');
    },
  );

  it('sees a project binding that committed while the Hub writer waited', async () => {
    const { tx, statements } = database({
      existingProjectId: 'p-1',
      boundDuringLock: true,
    });
    await expect(
      createHubDocument(tx, auth, { title: 'Published', fileId: 'file-1' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      statements.some(({ text }) =>
        text.startsWith('INSERT INTO app.documents'),
      ),
    ).toBe(false);
  });

  it('sees a Hub binding that committed while the project writer waited', async () => {
    const { tx, statements } = database({
      existingProjectId: null,
      boundDuringLock: true,
    });
    await expect(
      createDocumentFromUpload(tx, auth, {
        fileId: 'file-1',
        fileName: 'Private.txt',
        projectId: 'p-1',
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_SCOPE_CONFLICT' });
    expect(
      statements.some(({ text }) =>
        text.startsWith('INSERT INTO app.documents'),
      ),
    ).toBe(false);
  });
});
