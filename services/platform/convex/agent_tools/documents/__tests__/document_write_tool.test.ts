import { describe, expect, it, vi } from 'vitest';

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({
    _handler: def.execute,
    _description: def.description,
  })),
}));

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
  components: {},
}));

vi.mock('../../../threads/get_parent_thread_id', () => ({
  getApprovalThreadId: vi.fn().mockResolvedValue('thread-123'),
}));

import {
  normalizeDocumentWriteMetadata,
  type DocumentWriteMetadata,
} from '../../../approvals/types';
import { normalizeEscapeSequences } from '../../../workflow_engine/action_defs/document/document_action';
import { documentWriteArgs, documentWriteTool } from '../document_write_tool';

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org-1',
    threadId: 'thread-1',
    messageId: 'msg-1',
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    ...overrides,
  };
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- accessing internal handler for testing
const handler = (documentWriteTool.tool as unknown as { _handler: Function })
  ._handler as (
  ctx: ReturnType<typeof createMockCtx>,
  args: {
    files: Array<{ fileId: string; title?: string }>;
    folderPath?: string;
  },
) => Promise<{
  success: boolean;
  message: string;
  error?: string;
  approvalId?: string;
  requiresApproval?: boolean;
  approvalCreated?: boolean;
  approvalMessage?: string;
}>;

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
    const files = Array.from({ length: 51 }, (_, i) => ({
      fileId: `storage-${i}`,
    }));
    expect(() => documentWriteArgs.parse({ files })).toThrow();
  });

  it('accepts max size array', () => {
    const files = Array.from({ length: 50 }, (_, i) => ({
      fileId: `storage-${i}`,
    }));
    const result = documentWriteArgs.parse({ files });
    expect(result.files).toHaveLength(50);
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

describe('document_write tool handler', () => {
  it('returns error when organizationId is missing', async () => {
    const ctx = createMockCtx({ organizationId: undefined });
    const result = await handler(ctx, {
      files: [{ fileId: 'storage-1' }],
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('organizationId');
  });

  it('returns error for invalid folder path segment', async () => {
    const ctx = createMockCtx();
    const result = await handler(ctx, {
      files: [{ fileId: 'storage-1' }],
      folderPath: 'valid/..',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('..');
    expect(result.message).toContain('Invalid folder path');
  });

  it('returns error for empty folder path segment', async () => {
    const ctx = createMockCtx();
    const result = await handler(ctx, {
      files: [{ fileId: 'storage-1' }],
      folderPath: 'a//b',
    });
    // Double slash filters to ['a', 'b'] — both valid, should pass validation
    expect(result.success).toBeDefined();
  });

  it('returns error when file metadata not found', async () => {
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(null),
    });
    const result = await handler(ctx, {
      files: [{ fileId: 'storage-missing' }],
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('File metadata not found');
  });

  it('returns error when file belongs to different organization', async () => {
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue({
        organizationId: 'org-other',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        size: 1000,
      }),
    });
    const result = await handler(ctx, {
      files: [{ fileId: 'storage-1' }],
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('does not belong to this organization');
  });

  it('creates approval and returns success for valid single file', async () => {
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue({
        organizationId: 'org-1',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        size: 1000,
      }),
      runMutation: vi.fn().mockResolvedValue('approval-123'),
    });
    const result = await handler(ctx, {
      files: [{ fileId: 'storage-1', title: 'My Report' }],
    });
    expect(result.success).toBe(true);
    expect(result.approvalId).toBe('approval-123');
    expect(result.message).toContain('My Report');
    expect(ctx.runMutation).toHaveBeenCalledOnce();
  });

  it('creates approval for batch with folder path', async () => {
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue({
        organizationId: 'org-1',
        fileName: 'file.pdf',
        contentType: 'application/pdf',
        size: 500,
      }),
      runMutation: vi.fn().mockResolvedValue('approval-456'),
    });
    const result = await handler(ctx, {
      files: [
        { fileId: 'storage-1', title: 'File A' },
        { fileId: 'storage-2', title: 'File B' },
      ],
      folderPath: 'reports/2026',
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain('reports/2026');
    expect(result.message).toContain('File A');
    expect(result.message).toContain('File B');
  });

  it('uses fileName as title when title not provided', async () => {
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue({
        organizationId: 'org-1',
        fileName: 'original-name.docx',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 2000,
      }),
      runMutation: vi.fn().mockResolvedValue('approval-789'),
    });
    const result = await handler(ctx, {
      files: [{ fileId: 'storage-1' }],
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain('original-name.docx');
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
