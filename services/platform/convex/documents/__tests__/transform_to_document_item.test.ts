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

  describe('sourceMode normalization', () => {
    it('maps sync to auto', () => {
      const doc = createMockDocument({ metadata: { sourceMode: 'sync' } });
      const result = transformToDocumentItem(doc);
      expect(result.sourceMode).toBe('auto');
    });

    it('preserves auto', () => {
      const doc = createMockDocument({ metadata: { sourceMode: 'auto' } });
      const result = transformToDocumentItem(doc);
      expect(result.sourceMode).toBe('auto');
    });

    it('preserves manual', () => {
      const doc = createMockDocument({ metadata: { sourceMode: 'manual' } });
      const result = transformToDocumentItem(doc);
      expect(result.sourceMode).toBe('manual');
    });

    it('defaults to manual when sourceMode is undefined', () => {
      const doc = createMockDocument();
      const result = transformToDocumentItem(doc);
      expect(result.sourceMode).toBe('manual');
    });

    it('defaults to manual for unrecognized values', () => {
      const doc = createMockDocument({ metadata: { sourceMode: 'bogus' } });
      const result = transformToDocumentItem(doc);
      expect(result.sourceMode).toBe('manual');
    });
  });

  describe('extension fallback chain', () => {
    it('uses document.extension as highest priority', () => {
      const doc = createMockDocument({
        extension: 'pdf',
        title: 'report.docx',
        metadata: { extension: 'txt' },
      });
      const result = transformToDocumentItem(doc);
      expect(result.extension).toBe('pdf');
    });

    it('falls back to metadata.extension', () => {
      const doc = createMockDocument({
        title: 'report',
        metadata: { extension: 'txt' },
      });
      const result = transformToDocumentItem(doc);
      expect(result.extension).toBe('txt');
    });

    it('falls back to extracting from title', () => {
      const doc = createMockDocument({ title: 'report.docx' });
      const result = transformToDocumentItem(doc);
      expect(result.extension).toBe('docx');
    });

    it('returns undefined when no extension source is available', () => {
      const doc = createMockDocument({ title: 'report' });
      const result = transformToDocumentItem(doc);
      expect(result.extension).toBeUndefined();
    });
  });

  describe('sourceProvider fallback', () => {
    it('uses document.sourceProvider as highest priority', () => {
      const doc = createMockDocument({
        sourceProvider: 'google_drive',
        metadata: { sourceProvider: 'dropbox' },
      });
      const result = transformToDocumentItem(doc);
      expect(result.sourceProvider).toBe('google_drive');
    });

    it('falls back to metadata.sourceProvider', () => {
      const doc = createMockDocument({
        metadata: { sourceProvider: 'dropbox' },
      });
      const result = transformToDocumentItem(doc);
      expect(result.sourceProvider).toBe('dropbox');
    });

    it('defaults to upload when no sourceProvider is set', () => {
      const doc = createMockDocument();
      const result = transformToDocumentItem(doc);
      expect(result.sourceProvider).toBe('upload');
    });
  });

  describe('uploadedAt', () => {
    it('equals document._creationTime', () => {
      const doc = createMockDocument({ _creationTime: 5000 });
      const result = transformToDocumentItem(doc);
      expect(result.uploadedAt).toBe(5000);
    });
  });

  describe('teamId with null fallback', () => {
    it('returns teamId when present', () => {
      const doc = createMockDocument({ teamId: 'team1' });
      const result = transformToDocumentItem(doc);
      expect(result.teamId).toBe('team1');
    });

    it('returns null when teamId is undefined', () => {
      const doc = createMockDocument();
      const result = transformToDocumentItem(doc);
      expect(result.teamId).toBeNull();
    });
  });

  describe('teamIds from teamTags', () => {
    it('returns teamTags as teamIds', () => {
      const doc = createMockDocument({ teamTags: ['team1', 'team2'] });
      const result = transformToDocumentItem(doc);
      expect(result.teamIds).toEqual(['team1', 'team2']);
    });

    it('returns empty array when teamTags is undefined', () => {
      const doc = createMockDocument();
      const result = transformToDocumentItem(doc);
      expect(result.teamIds).toEqual([]);
    });
  });
});
