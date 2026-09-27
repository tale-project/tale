// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { documentWriteAdapters } from './documents';

/**
 * A document write is also a TASK fact: the task DTO stamps `hasFiles` /
 * `folderExists` from the project's documents, and an automation-owned
 * task's Start gate reads that stamp. Regression: uploading into a task's
 * bound folder from the task modal refreshed the Files zone (the `document`
 * family) while the panel beside it kept the pre-upload task DTO — "waiting
 * for input files", Start inert — until a reload.
 */

function invalidatedKeys(name: string): unknown[] {
  const adapter = documentWriteAdapters[name];
  if (adapter?.invalidate === undefined) {
    throw new Error(`${name} declares no invalidation`);
  }
  const invalidateQueries = vi.fn();
  adapter.invalidate(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only invalidateQueries is exercised
    { invalidateQueries } as never,
    { organizationId: 'org-1' },
    { organizationId: 'org-1' },
  );
  return invalidateQueries.mock.calls.map(
    (call) => (call[0] as { queryKey: unknown }).queryKey,
  );
}

describe('document write invalidations', () => {
  it.each([
    'documents/mutations:createDocumentFromUpload',
    'documents/mutations:deleteDocument',
    'documents/mutations:updateDocument',
  ])('%s refreshes the document AND task families', (name) => {
    const keys = invalidatedKeys(name);
    expect(keys).toContainEqual(['backend', 'org-1', 'document']);
    expect(keys).toContainEqual(['backend', 'org-1', 'task']);
  });

  it('a folder write refreshes folders, documents and the task facts', () => {
    const keys = invalidatedKeys('folders/mutations:deleteFolder');
    expect(keys).toContainEqual(['backend', 'org-1', 'folder']);
    expect(keys).toContainEqual(['backend', 'org-1', 'document']);
    expect(keys).toContainEqual(['backend', 'org-1', 'task']);
  });
});

/**
 * The replacement upload's begin door holds `lastModified` to the epoch
 * bound. A browser reports whatever the file system says — a pre-1970 or
 * far-future mtime is a number no `Date` holds or the door refuses — so the
 * adapter leaves such a stamp out, and the upload is dated when it lands
 * instead of failing on a 400 the person cannot act on.
 */
describe('the replacement upload begin', () => {
  const begin = async (lastModified: number) => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ intentId: 'i1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    window.__ENV__ = { BASE_PATH: '' };
    await documentWriteAdapters[
      'documents/record_actions:beginControlledDocumentReplacementUpload'
    ]?.run(
      {
        organizationId: 'org-1',
        documentId: 'doc-1',
        expectedRecordState: 'draft',
        expectedVersion: 1,
        expectedFileId: 's3:blob-1',
        fileName: 'policy.pdf',
        lastModified,
      },
      { organizationId: 'org-1' },
    );
    const init = fetchSpy.mock.calls[0]?.[1];
    fetchSpy.mockRestore();
    delete window.__ENV__;
    const body = init?.body;
    return (typeof body === 'string' ? JSON.parse(body) : {}) as Record<
      string,
      unknown
    >;
  };

  it('sends a file date a Date can hold', async () => {
    expect(await begin(1_790_400_000_000)).toMatchObject({
      lastModified: 1_790_400_000_000,
    });
  });

  it.each([9e15, -1])('leaves out a file date of %s', async (lastModified) => {
    expect(await begin(lastModified)).not.toHaveProperty('lastModified');
  });
});
