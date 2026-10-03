import { beforeEach, describe, expect, it, vi } from 'vitest';

const wire = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('./helpers/session_client', () => ({
  sessionListFiles: wire.list,
  sessionDeleteFiles: wire.remove,
}));
import { pruneManagedStageFiles, stageBlobCacheKey } from './managed_stage';

beforeEach(() => {
  vi.clearAllMocks();
  wire.remove.mockResolvedValue({ deleted: [], skipped: [] });
});

describe('managed input reconciliation', () => {
  it('keeps unchanged files and removes obsolete files/subtrees inside the managed root', async () => {
    wire.list.mockImplementation(async (_session: string, path: string) => {
      if (path === '/agent/inputs/task')
        return [
          { name: 'attachments', type: 'dir' },
          { name: 'outputs', type: 'dir' },
          { name: 'scratch.txt', type: 'file' },
        ];
      if (path === '/agent/inputs/task/attachments')
        return [
          { name: 'current.pdf', type: 'file' },
          { name: 'removed.pdf', type: 'file' },
        ];
      throw new Error('must not walk an obsolete subtree');
    });
    await pruneManagedStageFiles('session-a', '/agent/inputs/task', [
      '/agent/inputs/task/attachments/current.pdf',
    ]);
    expect(wire.remove).toHaveBeenCalledExactlyOnceWith('session-a', [
      '/agent/inputs/task/outputs',
      '/agent/inputs/task/scratch.txt',
      '/agent/inputs/task/attachments/removed.pdf',
    ]);
  });

  it('preserves correct files and treats a new session as a cache miss', async () => {
    wire.list
      .mockResolvedValueOnce([{ name: 'SKILL.md', type: 'file' }])
      .mockResolvedValueOnce(null);
    for (const session of ['existing', 'recreated']) {
      await pruneManagedStageFiles(session, 'workspace/.tale/skills/a', [
        'workspace/.tale/skills/a/SKILL.md',
      ]);
    }
    expect(wire.remove).not.toHaveBeenCalled();
  });

  it('fails closed when obsolete files cannot be removed', async () => {
    wire.list.mockResolvedValue([{ name: 'gone', type: 'file' }]);
    wire.remove.mockResolvedValue({
      skipped: [{ path: 'gone', reason: 'refused' }],
    });
    await expect(
      pruneManagedStageFiles('session', 'inputs/task', []),
    ).rejects.toThrow('obsolete');
  });

  it.each(['/agent', '/agent/inputs/../workspace'])(
    'refuses broad or escaping roots: %s',
    async (root) => {
      await expect(pruneManagedStageFiles('session', root, [])).rejects.toThrow(
        'Invalid',
      );
      expect(wire.list).not.toHaveBeenCalled();
    },
  );

  it('scopes immutable cache identity to organization and blob version', () => {
    expect(stageBlobCacheKey('a', 's3:blob')).toBe(
      stageBlobCacheKey('a', 's3:blob'),
    );
    expect(stageBlobCacheKey('a', 's3:blob')).not.toBe(
      stageBlobCacheKey('b', 's3:blob'),
    );
    expect(stageBlobCacheKey('a', 's3:blob')).not.toBe(
      stageBlobCacheKey('a', 's3:new'),
    );
    expect(stageBlobCacheKey('a', 's3:blob')).toMatch(/^[a-f0-9]{64}$/);
  });
});
