import { describe, expect, it } from 'vitest';

import { parseDocumentArtifact } from './document-artifact';

describe('parseDocumentArtifact', () => {
  it('accepts the document create/upsert contract', () => {
    expect(
      parseDocumentArtifact({
        title: 'return.xml',
        documentId: 'd',
        fileId: 'f',
        action: 'created',
        success: true,
      }),
    ).toEqual({
      title: 'return.xml',
      documentId: 'd',
      fileId: 'f',
      action: 'created',
      success: true,
    });
  });

  it('rejects incomplete or unknown shapes', () => {
    expect(parseDocumentArtifact({ title: 'x' })).toBeUndefined();
    expect(
      parseDocumentArtifact({
        title: 'x',
        documentId: 'd',
        action: 'deleted',
      }),
    ).toBeUndefined();
  });
});
