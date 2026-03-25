import { describe, expect, it } from 'vitest';

import { transformToDocumentItem } from '../transform_to_document_item';

function createMockDocument(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'doc1',
    _creationTime: 1000,
    organizationId: 'org1',
    ...overrides,
  } as never;
}

describe('transformToDocumentItem', () => {
  describe('sourceCreatedAt and sourceModifiedAt passthrough', () => {
    it('includes sourceCreatedAt from document', () => {
      const doc = createMockDocument({ sourceCreatedAt: 2000 });
      const result = transformToDocumentItem(doc);
      expect(result.sourceCreatedAt).toBe(2000);
    });

    it('includes sourceModifiedAt from document', () => {
      const doc = createMockDocument({ sourceModifiedAt: 3000 });
      const result = transformToDocumentItem(doc);
      expect(result.sourceModifiedAt).toBe(3000);
    });

    it('returns undefined when sourceCreatedAt is not set', () => {
      const doc = createMockDocument();
      const result = transformToDocumentItem(doc);
      expect(result.sourceCreatedAt).toBeUndefined();
    });

    it('returns undefined when sourceModifiedAt is not set', () => {
      const doc = createMockDocument();
      const result = transformToDocumentItem(doc);
      expect(result.sourceModifiedAt).toBeUndefined();
    });
  });

  describe('lastModified fallback chain', () => {
    it('uses document.sourceModifiedAt as highest priority', () => {
      const doc = createMockDocument({
        sourceModifiedAt: 4000,
        metadata: {
          sourceModifiedAt: 3000,
          lastModified: 2000,
        },
      });
      const result = transformToDocumentItem(doc);
      expect(result.lastModified).toBe(4000);
    });

    it('falls back to metadata.sourceModifiedAt', () => {
      const doc = createMockDocument({
        metadata: {
          sourceModifiedAt: 3000,
          lastModified: 2000,
        },
      });
      const result = transformToDocumentItem(doc);
      expect(result.lastModified).toBe(3000);
    });

    it('falls back to metadata.lastModified', () => {
      const doc = createMockDocument({
        metadata: {
          lastModified: 2000,
        },
      });
      const result = transformToDocumentItem(doc);
      expect(result.lastModified).toBe(2000);
    });

    it('returns undefined when no source dates available', () => {
      const doc = createMockDocument();
      const result = transformToDocumentItem(doc);
      expect(result.lastModified).toBeUndefined();
    });

    it('returns undefined when metadata is undefined', () => {
      const doc = createMockDocument({ metadata: undefined });
      const result = transformToDocumentItem(doc);
      expect(result.lastModified).toBeUndefined();
    });
  });

  describe('basic transform', () => {
    it('returns correct id and default name', () => {
      const doc = createMockDocument();
      const result = transformToDocumentItem(doc);
      expect(result.id).toBe('doc1');
      expect(result.name).toBe('Untitled');
    });

    it('uses document title over metadata name', () => {
      const doc = createMockDocument({
        title: 'Doc Title',
        metadata: { name: 'Meta Name' },
      });
      const result = transformToDocumentItem(doc);
      expect(result.name).toBe('Doc Title');
    });

    it('defaults type to file', () => {
      const doc = createMockDocument();
      const result = transformToDocumentItem(doc);
      expect(result.type).toBe('file');
    });
  });
});
