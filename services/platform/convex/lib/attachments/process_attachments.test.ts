import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
const mockParseFile = vi.fn();
vi.mock('../../agent_tools/files/helpers/parse_file', () => ({
  parseFile: (...args: unknown[]) => mockParseFile(...args),
}));

const mockAnalyzeImageCached = vi.fn();
vi.mock('../../agent_tools/files/helpers/analyze_image', () => ({
  analyzeImageCached: (...args: unknown[]) => mockAnalyzeImageCached(...args),
}));

const mockAnalyzeTextContent = vi.fn();
vi.mock('../../agent_tools/files/helpers/analyze_text', () => ({
  analyzeTextContent: (...args: unknown[]) => mockAnalyzeTextContent(...args),
}));

vi.mock('../../_generated/api', () => ({
  internal: {
    node_only: {
      documents: {
        internal_actions: {
          parseExcel: 'mock-parseExcel',
        },
      },
    },
  },
}));

vi.mock('../type_cast_helpers', () => ({
  toId: (id: string) => id,
}));

vi.mock('./register_files', () => ({
  registerFilesWithAgent: vi.fn(),
}));

vi.mock('../../../lib/shared/file-types', () => ({
  isImage: (type: string) => type.startsWith('image/'),
  isAudio: (type: string) => type.startsWith('audio/'),
  isSpreadsheet: (name: string) =>
    name.endsWith('.xlsx') || name.endsWith('.xls'),
  isTextFile: (type: string, name: string) =>
    name.endsWith('.txt') || name.endsWith('.ts') || name.endsWith('.js'),
}));

vi.mock('../../providers/resolve_model', () => ({
  resolveLanguageModel: vi.fn().mockResolvedValue({ languageModel: {} }),
}));

import { processAttachments } from './process_attachments';

function makeFakeCtx() {
  return {
    storage: { getUrl: vi.fn() },
    runAction: vi.fn(),
    runQuery: vi.fn(),
    runMutation: vi.fn(),
  } as never;
}

function makeAttachment(
  overrides: Partial<{
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }> = {},
) {
  return {
    fileId: overrides.fileId ?? 'file-1',
    fileName: overrides.fileName ?? 'doc.pdf',
    fileType: overrides.fileType ?? 'application/pdf',
    fileSize: overrides.fileSize ?? 1024,
  } as never;
}

describe('processAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result for no attachments', async () => {
    const result = await processAttachments(makeFakeCtx(), [], 'hello', {
      model: 'test-model',
    });
    expect(result.parsedDocuments).toEqual([]);
    expect(result.promptContent).toBeUndefined();
  });

  describe('multi-document truncation', () => {
    it('uses reduced limit when multiple documents are attached', async () => {
      mockParseFile.mockResolvedValue({
        success: true,
        full_text: 'A'.repeat(20000),
      });

      const attachments = [
        makeAttachment({ fileId: 'f1', fileName: 'doc1.pdf' }),
        makeAttachment({ fileId: 'f2', fileName: 'doc2.pdf' }),
      ];

      const result = await processAttachments(
        makeFakeCtx(),
        attachments,
        'Compare these documents',
        { model: 'test-model' },
      );

      expect(result.parsedDocuments).toHaveLength(2);
      // With multi-doc limit of 15000, content of 20000 chars should be truncated
      expect(result.promptContent).toBeDefined();
      const parts = result.promptContent?.[0]?.content ?? [];
      const docTexts = parts
        .filter((p) => p.type === 'text' && 'text' in p)
        .map((p) => ('text' in p ? p.text : ''))
        .filter((t) => t.includes('Document:'));
      for (const text of docTexts) {
        // Each document text part should be truncated (15000 + truncation note)
        expect(text).toContain('[... Document truncated due to length ...]');
      }
    });

    it('uses full limit for single document', async () => {
      mockParseFile.mockResolvedValue({
        success: true,
        full_text: 'B'.repeat(20000),
      });

      const attachments = [
        makeAttachment({ fileId: 'f1', fileName: 'doc1.pdf' }),
      ];

      const result = await processAttachments(
        makeFakeCtx(),
        attachments,
        'Summarize this document',
        { model: 'test-model' },
      );

      expect(result.parsedDocuments).toHaveLength(1);
      // With single-doc limit of 50000, content of 20000 chars should NOT be truncated
      const parts = result.promptContent?.[0]?.content ?? [];
      const docTexts = parts
        .filter((p) => p.type === 'text' && 'text' in p)
        .map((p) => ('text' in p ? p.text : ''))
        .filter((t) => t.includes('Document:'));
      for (const text of docTexts) {
        expect(text).not.toContain(
          '[... Document truncated due to length ...]',
        );
      }
    });
  });

  describe('performance logging', () => {
    it('calls debugLog with PERF_PARSE_FILE for each document', async () => {
      mockParseFile.mockResolvedValue({
        success: true,
        full_text: 'parsed text',
      });

      const debugLog = vi.fn();
      const attachments = [
        makeAttachment({ fileId: 'f1', fileName: 'a.pdf' }),
        makeAttachment({ fileId: 'f2', fileName: 'b.pdf' }),
      ];

      await processAttachments(makeFakeCtx(), attachments, 'analyze', {
        model: 'test-model',
        debugLog,
      });

      const perfCalls = debugLog.mock.calls.filter(
        (call) => call[0] === 'PERF_PARSE_FILE',
      );
      expect(perfCalls).toHaveLength(2);
      expect(perfCalls[0][1]).toHaveProperty('durationMs');
      expect(perfCalls[0][1]).toHaveProperty('fileName');
    });

    it('calls debugLog with PERF_PARSE_ALL after all documents', async () => {
      mockParseFile.mockResolvedValue({
        success: true,
        full_text: 'text',
      });

      const debugLog = vi.fn();

      await processAttachments(makeFakeCtx(), [makeAttachment()], 'analyze', {
        model: 'test-model',
        debugLog,
      });

      const perfAllCalls = debugLog.mock.calls.filter(
        (call) => call[0] === 'PERF_PARSE_ALL',
      );
      expect(perfAllCalls).toHaveLength(1);
      expect(perfAllCalls[0][1]).toHaveProperty('durationMs');
      expect(perfAllCalls[0][1]).toHaveProperty('fileCount');
    });
  });
});
