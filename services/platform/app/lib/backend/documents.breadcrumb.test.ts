// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { backendFetch } from './api-client';
import { documentReadAdapters } from './documents';

vi.mock('./api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api-client')>()),
  backendFetch: vi.fn(),
}));

/**
 * The folder breadcrumb is read by the 0.4 call site as `{_id, name}` rows,
 * while the pg backend answers folder ROWS keyed `id`. The adapter used to
 * hand the wire rows through untouched, so every crumb rendered with an
 * undefined React key and — the real defect — clicking a parent crumb
 * navigated to `undefined`, i.e. the hub root, instead of that folder.
 */
describe('folders/queries:getFolderBreadcrumb', () => {
  it('maps the wire rows onto the 0.4 shape the crumbs read', async () => {
    vi.mocked(backendFetch).mockResolvedValueOnce({
      breadcrumb: [
        {
          id: 'fold-contracts',
          organizationId: 'org-1',
          name: 'Contracts',
          parentId: null,
          teamId: null,
          teamTags: [],
          projectId: null,
          createdBy: 'user-1',
          createdAt: 1_700_000_000_000,
        },
        {
          id: 'fold-2026',
          organizationId: 'org-1',
          name: '2026',
          parentId: 'fold-contracts',
          teamId: null,
          teamTags: [],
          projectId: null,
          createdBy: null,
          createdAt: 1_700_000_000_500,
        },
      ],
    });
    const adapter = documentReadAdapters['folders/queries:getFolderBreadcrumb'];
    expect(adapter).toBeDefined();
    if (!adapter) return;
    const query = adapter(
      { organizationId: 'org-1', folderId: 'fold-2026' },
      { organizationId: 'org-1' },
    );
    expect(query).not.toBeNull();
    if (query === null) return;
    expect(query.queryKey).toEqual([
      'backend',
      'org-1',
      'folder',
      'breadcrumb',
      'fold-2026',
    ]);
    const crumbs = (await query.queryFn()) as { _id: string; name: string }[];
    expect(crumbs.map((crumb) => [crumb._id, crumb.name])).toEqual([
      ['fold-contracts', 'Contracts'],
      ['fold-2026', '2026'],
    ]);
    expect(vi.mocked(backendFetch)).toHaveBeenCalledWith(
      '/folders/fold-2026/breadcrumb',
      { orgId: 'org-1' },
    );
  });
});
