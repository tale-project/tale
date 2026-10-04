import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { stageBlobCacheKey } from '../node_only/sandbox/managed_stage';

const stage = vi.hoisted(() => ({
  files: vi.fn(),
  remove: vi.fn(),
  url: vi.fn(),
}));
vi.mock(
  '../node_only/sandbox/helpers/session_client',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../node_only/sandbox/helpers/session_client')
    >()),
    sessionStageFiles: stage.files,
    sessionDeleteFiles: stage.remove,
  }),
);
vi.mock('../node_only/sandbox/helpers/stage_url', () => ({
  stageUrlForBlobRef: stage.url,
}));

import { stageWorkflowFiles } from './agent_host';

beforeEach(() => {
  stage.files.mockReset().mockResolvedValue({ staged: [], skipped: [] });
  stage.remove.mockReset().mockResolvedValue({ deleted: [], skipped: [] });
  stage.url.mockReset().mockResolvedValue('https://authorized.test/blob');
});

describe('workflow file staging authority and reuse', () => {
  it('passes an organization-scoped authorized manifest without clearing unchanged folders', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      files: [{ fileId: 'blob', name: 'report.txt' }],
      truncated: false,
    });
    const ctx = { runQuery } as unknown as ActionCtx;
    const result = await stageWorkflowFiles(
      ctx,
      'org',
      'session',
      { data: { folderId: 'folder' } },
      'inputs/',
    );
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org',
      folderId: 'folder',
      recursive: true,
    });
    expect(stage.url).toHaveBeenCalledWith('blob', 'org');
    expect(stage.remove).not.toHaveBeenCalled();
    expect(stage.files).toHaveBeenCalledWith(
      'session',
      [
        {
          path: 'inputs/data/report.txt',
          url: 'https://authorized.test/blob',
          sourceId: stageBlobCacheKey('org', 'blob'),
        },
      ],
      { reuse: true, replaceRoots: ['inputs/data'] },
    );
    expect(result.stagedPaths).toEqual(['inputs/data/report.txt']);
    runQuery.mockResolvedValue(null);
    await expect(
      stageWorkflowFiles(
        ctx,
        'org',
        'session',
        { data: { folderId: 'folder' } },
        'inputs/',
      ),
    ).rejects.toThrow('does not exist');
    expect(stage.files).toHaveBeenCalledTimes(1);
  });

  it('reconciles an empty current folder so old files cannot survive', async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({ files: [], truncated: false }),
    } as unknown as ActionCtx;
    await stageWorkflowFiles(
      ctx,
      'org',
      'session',
      { data: { folderId: 'folder' } },
      'inputs/',
    );
    expect(stage.files).toHaveBeenCalledWith('session', [], {
      reuse: true,
      replaceRoots: ['inputs/data'],
    });
  });

  it('fails a refused inline mount replacement before staging', async () => {
    stage.remove.mockResolvedValue({
      deleted: [],
      skipped: [{ path: 'inputs/data', reason: 'permission' }],
    });
    await expect(
      stageWorkflowFiles(
        {} as ActionCtx,
        'org',
        'session',
        { data: { content: 'new' } },
        'inputs/',
      ),
    ).rejects.toThrow('staging input files failed');
    expect(stage.files).not.toHaveBeenCalled();
  });
});
