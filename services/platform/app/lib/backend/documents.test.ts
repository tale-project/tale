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
