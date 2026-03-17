import { describe, expect, it, vi } from 'vitest';

import {
  normalizeDocumentWriteMetadata,
  type DocumentWriteMetadata,
} from '../../../approvals/types';
import { normalizeEscapeSequences } from '../../../workflow_engine/action_defs/document/document_action';
import { documentWriteArgs } from '../document_write_tool';

vi.mock('../../../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_queries: {
        getByStorageId: 'mock-get-by-storage-id',
      },
    },
    agent_tools: {
      documents: {
        internal_mutations: {
          createDocumentWriteApproval: 'mock-create-approval',
        },
      },
    },
  },
}));

describe('documentWriteArgs schema validation', () => {
  it('accepts single file', () => {
    const result = documentWriteArgs.parse({
      files: [{ fileId: 'storage-123' }],
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].fileId).toBe('storage-123');
    expect(result.files[0].title).toBeUndefined();
    expect(result.folderPath).toBeUndefined();
  });

  it('accepts multiple files with titles', () => {
    const result = documentWriteArgs.parse({
      files: [
        { fileId: 'storage-1', title: 'Report A' },
        { fileId: 'storage-2', title: 'Report B' },
        { fileId: 'storage-3' },
      ],
      folderPath: 'reports/2026/q1',
    });
    expect(result.files).toHaveLength(3);
    expect(result.files[0].title).toBe('Report A');
    expect(result.files[2].title).toBeUndefined();
    expect(result.folderPath).toBe('reports/2026/q1');
  });

  it('rejects empty files array', () => {
    expect(() => documentWriteArgs.parse({ files: [] })).toThrow();
  });

  it('rejects missing files', () => {
    expect(() => documentWriteArgs.parse({})).toThrow();
  });

  it('rejects file with empty fileId', () => {
    expect(() =>
      documentWriteArgs.parse({ files: [{ fileId: '' }] }),
    ).toThrow();
  });

  it('rejects array exceeding max size', () => {
    const files = Array.from({ length: 21 }, (_, i) => ({
      fileId: `storage-${i}`,
    }));
    expect(() => documentWriteArgs.parse({ files })).toThrow();
  });

  it('accepts max size array', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      fileId: `storage-${i}`,
    }));
    const result = documentWriteArgs.parse({ files });
    expect(result.files).toHaveLength(20);
  });

  it('accepts folderPath without titles', () => {
    const result = documentWriteArgs.parse({
      files: [{ fileId: 'storage-123' }],
      folderPath: 'documents/drafts',
    });
    expect(result.folderPath).toBe('documents/drafts');
  });
});

describe('normalizeDocumentWriteMetadata', () => {
  it('passes through batch metadata unchanged', () => {
    const metadata: DocumentWriteMetadata = {
      files: [
        {
          fileId: 'f1',
          fileName: 'a.pdf',
          title: 'A',
          mimeType: 'application/pdf',
          fileSize: 100,
        },
        {
          fileId: 'f2',
          fileName: 'b.pdf',
          title: 'B',
          mimeType: 'application/pdf',
          fileSize: 200,
        },
      ],
      folderPath: 'reports',
      requestedAt: 1000,
    };
    const result = normalizeDocumentWriteMetadata(metadata);
    expect(result).toBe(metadata);
  });

  it('wraps legacy single-file metadata into files array', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- testing legacy metadata shape
    const legacy = {
      fileId: 'f1',
      fileName: 'report.pdf',
      title: 'My Report',
      mimeType: 'application/pdf',
      fileSize: 500,
      folderPath: 'docs',
      requestedAt: 2000,
      executedAt: 3000,
      createdDocumentId: 'doc-123',
    } as unknown as DocumentWriteMetadata;

    const result = normalizeDocumentWriteMetadata(legacy);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].fileId).toBe('f1');
    expect(result.files[0].fileName).toBe('report.pdf');
    expect(result.files[0].title).toBe('My Report');
    expect(result.files[0].mimeType).toBe('application/pdf');
    expect(result.files[0].fileSize).toBe(500);
    expect(result.files[0].createdDocumentId).toBe('doc-123');
    expect(result.folderPath).toBe('docs');
    expect(result.requestedAt).toBe(2000);
    expect(result.executedAt).toBe(3000);
  });

  it('wraps legacy metadata with execution error', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- testing legacy metadata shape
    const legacy = {
      fileId: 'f1',
      fileName: 'a.txt',
      title: 'A',
      mimeType: 'text/plain',
      fileSize: 10,
      requestedAt: 1000,
      executionError: 'File not found',
    } as unknown as DocumentWriteMetadata;

    const result = normalizeDocumentWriteMetadata(legacy);
    expect(result.files[0].executionError).toBe('File not found');
  });

  it('handles metadata with empty files array as legacy', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- testing edge case
    const edge = {
      files: [],
      fileId: 'f1',
      fileName: 'a.txt',
      title: 'A',
      mimeType: 'text/plain',
      fileSize: 10,
      requestedAt: 1000,
    } as unknown as DocumentWriteMetadata;

    const result = normalizeDocumentWriteMetadata(edge);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].fileId).toBe('f1');
  });
});

describe('normalizeEscapeSequences (shared by document action)', () => {
  it('replaces unescaped \\n with newline', () => {
    expect(normalizeEscapeSequences('hello\\nworld')).toBe('hello\nworld');
  });

  it('replaces unescaped \\t with tab', () => {
    expect(normalizeEscapeSequences('col1\\tcol2')).toBe('col1\tcol2');
  });

  it('preserves escaped \\\\n', () => {
    expect(normalizeEscapeSequences('path\\\\nfile')).toBe('path\\\\nfile');
  });

  it('handles multiple replacements', () => {
    expect(normalizeEscapeSequences('a\\nb\\nc')).toBe('a\nb\nc');
  });

  it('handles empty string', () => {
    expect(normalizeEscapeSequences('')).toBe('');
  });

  it('handles string with no escape sequences', () => {
    expect(normalizeEscapeSequences('plain text')).toBe('plain text');
  });
});
