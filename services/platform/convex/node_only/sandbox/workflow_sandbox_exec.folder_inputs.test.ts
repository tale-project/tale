import { describe, expect, it } from 'vitest';

import { folderStageFiles } from './workflow_sandbox_exec';

type FolderFileRow = { fileId: string; name: string };

function mockCtx(
  files: FolderFileRow[] | null,
  urls: Record<string, string | null> = {},
) {
  const queries: unknown[] = [];
  const raw = {
    runQuery: (_ref: unknown, args: unknown) => {
      queries.push(args);
      return Promise.resolve(files);
    },
    storage: {
      getUrl: (fileId: string) =>
        Promise.resolve(
          fileId in urls
            ? urls[fileId]
            : `http://convex:3210/storage/${fileId}`,
        ),
    },
  };
  // The helper only uses runQuery + storage.getUrl; the cast keeps the mock
  // this small instead of faking the full ActionCtx surface.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const ctx = raw as unknown as Parameters<typeof folderStageFiles>[0];
  return { queries, ctx };
}

describe('folderStageFiles', () => {
  it('stages every folder file under <prefix><as>/<name>', async () => {
    const { ctx } = mockCtx([
      { fileId: 'f1', name: 'sales Q1.xlsx' },
      { fileId: 'f2', name: 'import-vat.pdf' },
    ]);
    const staged = await folderStageFiles(
      ctx,
      'org1',
      { folderPath: 'Clients/Acme GmbH/2026-Q1' },
      'input',
      'uploads/',
    );
    expect(staged).toEqual([
      {
        path: 'uploads/input/sales Q1.xlsx',
        url: expect.stringContaining('/storage/f1'),
      },
      {
        path: 'uploads/input/import-vat.pdf',
        url: expect.stringContaining('/storage/f2'),
      },
    ]);
  });

  it('strips a trailing slash from `as` so paths never double up', async () => {
    const { ctx } = mockCtx([{ fileId: 'f1', name: 'a.txt' }]);
    const staged = await folderStageFiles(
      ctx,
      'org1',
      { folderId: 'fold1' },
      'setup/',
      '',
    );
    expect(staged?.[0]?.path).toBe('setup/a.txt');
  });

  it('passes folderId and folderPath through to the query distinctly', async () => {
    const byId = mockCtx([]);
    await folderStageFiles(byId.ctx, 'org1', { folderId: 'fold1' }, 'x', '');
    expect(byId.queries[0]).toEqual({
      organizationId: 'org1',
      folderId: 'fold1',
    });

    const byPath = mockCtx([]);
    await folderStageFiles(byPath.ctx, 'org1', { folderPath: 'A/B' }, 'x', '');
    expect(byPath.queries[0]).toEqual({
      organizationId: 'org1',
      folderPath: 'A/B',
    });
  });

  it('returns null when the folder does not resolve (caller fails legibly)', async () => {
    const { ctx } = mockCtx(null);
    const staged = await folderStageFiles(
      ctx,
      'org1',
      { folderPath: 'No/Such/Folder' },
      'input',
      'uploads/',
    );
    expect(staged).toBeNull();
  });

  it('returns an empty list for an empty folder (stage nothing, not an error)', async () => {
    const { ctx } = mockCtx([]);
    const staged = await folderStageFiles(
      ctx,
      'org1',
      { folderId: 'fold1' },
      'input',
      '',
    );
    expect(staged).toEqual([]);
  });

  it('skips a row whose blob was purged instead of failing the step', async () => {
    const { ctx } = mockCtx(
      [
        { fileId: 'gone', name: 'purged.bin' },
        { fileId: 'f2', name: 'kept.txt' },
      ],
      { gone: null },
    );
    const staged = await folderStageFiles(
      ctx,
      'org1',
      { folderId: 'fold1' },
      'input',
      '',
    );
    expect(staged).toEqual([
      { path: 'input/kept.txt', url: expect.stringContaining('/storage/f2') },
    ]);
  });
});
