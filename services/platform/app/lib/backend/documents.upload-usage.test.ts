// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backendFetch } from './api-client';
import {
  documentPaginatedAdapters,
  uploadUsageFilesPageQuery,
} from './documents';
import { backendEntityPrefix, backendKey } from './query-keys';

vi.mock('./api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api-client')>()),
  backendFetch: vi.fn(),
}));

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: '' };

/**
 * The files behind the Storage meter (Settings › Usage › Storage files),
 * paged largest first by `GET /documents/upload-usage/files`.
 */
describe('documents/queries:listUploadUsageFiles', () => {
  beforeEach(() => {
    vi.mocked(backendFetch).mockReset().mockResolvedValue(EMPTY_PAGE);
  });

  // A delete invalidates the `document` family: the list must sit inside it,
  // under the meter's own key, so the file leaves the list as the meter drops.
  it('keys the list under the meter, inside the document family', () => {
    const { queryKey } = uploadUsageFilesPageQuery('org-1');

    const family = backendEntityPrefix('org-1', 'document');
    const meter = backendKey('org-1', 'document', 'upload-usage');
    expect(queryKey.slice(0, family.length)).toEqual(family);
    expect(queryKey.slice(0, meter.length)).toEqual(meter);
    expect(queryKey).not.toEqual(meter);
  });

  it('asks for the first page, then each next one by its cursor', async () => {
    const { fetchPage } = uploadUsageFilesPageQuery('org-1');

    await expect(fetchPage(null, 50)).resolves.toBe(EMPTY_PAGE);
    await fetchPage('abc', 50);

    expect(vi.mocked(backendFetch).mock.calls).toEqual([
      ['/documents/upload-usage/files?numItems=50', { orgId: 'org-1' }],
      [
        '/documents/upload-usage/files?numItems=50&cursor=abc',
        { orgId: 'org-1' },
      ],
    ]);
  });

  it('reads the organization from the args, else from the route, and needs one', () => {
    const adapter =
      documentPaginatedAdapters['documents/queries:listUploadUsageFiles'];
    if (adapter === undefined) throw new Error('no adapter row');

    expect(adapter({ organizationId: 'org-1' }, {})?.queryKey).toEqual(
      uploadUsageFilesPageQuery('org-1').queryKey,
    );
    expect(adapter({}, { organizationId: 'org-2' })?.queryKey).toEqual(
      uploadUsageFilesPageQuery('org-2').queryKey,
    );
    expect(adapter({}, {})).toBeNull();
  });
});
