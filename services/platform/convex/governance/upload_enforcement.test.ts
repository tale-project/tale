import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { UploadPolicyConfig } from '../../lib/shared/schemas/governance';

const mockReadPolicyConfig = vi.fn<() => Promise<UploadPolicyConfig | null>>();

vi.mock('./helpers', () => ({
  readPolicyConfig: () => mockReadPolicyConfig(),
}));

const mockFileMetadataRows: Array<{
  organizationId: string;
  uploadedBy?: string;
  size: number;
}> = [];

function createMockQueryBuilder() {
  return {
    withIndex: (_indexName: string, _fn: (q: unknown) => unknown) => ({
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          next: () => {
            if (i < mockFileMetadataRows.length) {
              return Promise.resolve({
                done: false,
                value: mockFileMetadataRows[i++],
              });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    }),
  };
}

const mockCtx = {
  db: {
    query: (table: string) => {
      if (table === 'fileMetadata') {
        return createMockQueryBuilder();
      }
      return createMockQueryBuilder();
    },
  },
};

import { checkUploadPolicy } from './upload_enforcement';

describe('checkUploadPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMetadataRows.length = 0;
  });

  it('allows upload when no policy exists', async () => {
    mockReadPolicyConfig.mockResolvedValue(null);

    const result = await checkUploadPolicy(
      // @ts-expect-error -- mock ctx
      mockCtx,
      'org-1',
      'user-1',
      'pdf',
      'application/pdf',
      1024,
    );

    expect(result.allowed).toBe(true);
  });

  it('allows upload when policy is disabled', async () => {
    mockReadPolicyConfig.mockResolvedValue({ enabled: false });

    const result = await checkUploadPolicy(
      // @ts-expect-error -- mock ctx
      mockCtx,
      'org-1',
      'user-1',
      'pdf',
      'application/pdf',
      1024,
    );

    expect(result.allowed).toBe(true);
  });

  describe('blocked extensions', () => {
    it('rejects file with blocked extension', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        blockedExtensions: ['exe', 'bat'],
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'exe',
        'application/octet-stream',
        1024,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('.exe');
      expect(result.reasonCode).toBe('extension_blocked');
    });

    it('allows file not in blocked list', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        blockedExtensions: ['exe', 'bat'],
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'pdf',
        'application/pdf',
        1024,
      );

      expect(result.allowed).toBe(true);
    });

    it('normalises extension with leading dot', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        blockedExtensions: ['.EXE'],
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        '.exe',
        'application/octet-stream',
        1024,
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe('allowed extensions', () => {
    it('rejects file not in allowed list', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        allowedExtensions: ['pdf', 'png'],
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'exe',
        'application/octet-stream',
        1024,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('.exe');
      expect(result.reasonCode).toBe('extension_not_allowed');
    });

    it('allows file in allowed list', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        allowedExtensions: ['pdf', 'png'],
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'pdf',
        'application/pdf',
        1024,
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('allowed MIME types', () => {
    it('rejects file with disallowed MIME type', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        allowedMimeTypes: ['image/*', 'application/pdf'],
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'exe',
        'application/octet-stream',
        1024,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('application/octet-stream');
      expect(result.reasonCode).toBe('mime_not_allowed');
    });

    it('allows file matching wildcard MIME type', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        allowedMimeTypes: ['image/*'],
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'png',
        'image/png',
        1024,
      );

      expect(result.allowed).toBe(true);
    });

    it('allows file matching exact MIME type', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        allowedMimeTypes: ['application/pdf'],
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'pdf',
        'application/pdf',
        1024,
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('max file size', () => {
    it('rejects file exceeding max size', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        maxFileSizeBytes: 5 * 1024 * 1024,
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'pdf',
        'application/pdf',
        10 * 1024 * 1024,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('MB limit');
      expect(result.reasonCode).toBe('file_too_large');
      expect(result.limitBytes).toBe(5 * 1024 * 1024);
    });

    it('allows file within max size', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        maxFileSizeBytes: 10 * 1024 * 1024,
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'pdf',
        'application/pdf',
        5 * 1024 * 1024,
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('max total volume per user', () => {
    it('rejects upload that would exceed per-user volume limit', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        maxTotalVolumeBytesPerUser: 100 * 1024 * 1024,
      });

      mockFileMetadataRows.push(
        {
          organizationId: 'org-1',
          uploadedBy: 'user-1',
          size: 80 * 1024 * 1024,
        },
        {
          organizationId: 'org-1',
          uploadedBy: 'user-1',
          size: 15 * 1024 * 1024,
        },
      );

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'pdf',
        'application/pdf',
        10 * 1024 * 1024,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('GB limit');
      // Structured data the client turns into an actionable message.
      expect(result.reasonCode).toBe('volume_exceeded');
      expect(result.usedBytes).toBe(95 * 1024 * 1024);
      expect(result.limitBytes).toBe(100 * 1024 * 1024);
    });

    it('allows upload within per-user volume limit', async () => {
      mockReadPolicyConfig.mockResolvedValue({
        enabled: true,
        maxTotalVolumeBytesPerUser: 1024 * 1024 * 1024,
      });

      mockFileMetadataRows.push({
        organizationId: 'org-1',
        uploadedBy: 'user-1',
        size: 10 * 1024 * 1024,
      });

      const result = await checkUploadPolicy(
        // @ts-expect-error -- mock ctx
        mockCtx,
        'org-1',
        'user-1',
        'pdf',
        'application/pdf',
        5 * 1024 * 1024,
      );

      expect(result.allowed).toBe(true);
    });
  });
});
