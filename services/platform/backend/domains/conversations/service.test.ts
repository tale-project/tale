/**
 * A mail attachment chip that appears must download. Materialize stores only a
 * durable storageId (a URL baked in the retired proxy path that now 404s), so
 * the detail projection mints a fresh presigned download URL from the storageId
 * at read time — and drops the URL for a chip whose bytes were never captured,
 * so the client shows no broken download affordance.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFileUrl } = vi.hoisted(() => ({ getFileUrl: vi.fn() }));

vi.mock('../files/service.ts', () => ({ getFileUrl }));

import { presignMessageAttachments } from './service.ts';
import type { ConversationMessageRow } from './service.ts';

const SQL = {} as never;

function message(attachments: unknown): ConversationMessageRow {
  return {
    metadata: { attachments },
  } as unknown as ConversationMessageRow;
}

function attachmentsOf(rows: ConversationMessageRow[]): unknown[] {
  const meta = rows[0]?.metadata as { attachments?: unknown[] } | null;
  return meta?.attachments ?? [];
}

describe('presignMessageAttachments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mints a fresh download URL from a materialized storageId', async () => {
    getFileUrl.mockResolvedValue('https://blob.example.test/get?sig=abc');
    const out = await presignMessageAttachments(SQL, 'o1', [
      message([
        {
          id: 'a1',
          filename: 'CV.pdf',
          storageId: 's3:o1/cv',
          url: '/http_api/storage?id=dead',
        },
      ]),
    ]);
    expect(getFileUrl).toHaveBeenCalledWith(
      SQL,
      { organizationId: 'o1' },
      's3:o1/cv',
    );
    // The stale baked-in URL is replaced with the fresh presigned one.
    expect(attachmentsOf(out)[0]).toMatchObject({
      storageId: 's3:o1/cv',
      url: 'https://blob.example.test/get?sig=abc',
    });
  });

  it('leaves a metadata-only chip (no storageId) without a download URL', async () => {
    const out = await presignMessageAttachments(SQL, 'o1', [
      message([{ id: 'a1', filename: 'photo.jpg' }]),
    ]);
    expect(getFileUrl).not.toHaveBeenCalled();
    expect(attachmentsOf(out)[0]).not.toHaveProperty('url');
  });

  it('drops the URL when the presign fails rather than serving a broken link', async () => {
    getFileUrl.mockRejectedValue(new Error('blob gone'));
    const out = await presignMessageAttachments(SQL, 'o1', [
      message([
        { id: 'a1', filename: 'CV.pdf', storageId: 's3:o1/cv', url: '/stale' },
      ]),
    ]);
    expect(attachmentsOf(out)[0]).not.toHaveProperty('url');
    expect(attachmentsOf(out)[0]).toMatchObject({ storageId: 's3:o1/cv' });
  });
});
