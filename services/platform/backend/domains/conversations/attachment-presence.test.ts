/**
 * `presignMessageAttachments` presigns a download URL per attachment, and a
 * presigned URL is only a signed path — it does not prove the object exists.
 * When a deployment loses its blob store (a database recovered without the
 * files, #3017) the message kept offering a download that failed in the
 * browser with no explanation.
 *
 * So the projection probes for the object and marks a missing one
 * `unavailable`. The probe FAILS OPEN: an unreachable store or an unresolved
 * org throws, and a throw is not evidence of absence, so the attachment is
 * offered as before. Only a definite `null` marks it.
 *
 * The integration harness drives this against a real store; these cover the
 * three branches in CI, where the harness cannot run.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFileUrl, statOrgBlob } = vi.hoisted(() => ({
  getFileUrl: vi.fn(),
  statOrgBlob: vi.fn(),
}));

vi.mock('../files/service.ts', () => ({ getFileUrl, statOrgBlob }));

const { presignMessageAttachments } = await import('./service.ts');

/** One inbound message carrying a single stored attachment. */
function messageWith(attachment: Record<string, unknown>) {
  return [
    {
      id: 'm1',
      metadata: { attachments: [attachment] },
    },
  ] as unknown as Parameters<typeof presignMessageAttachments>[2];
}

const sql = {} as never;

describe('presignMessageAttachments — attachment presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFileUrl.mockResolvedValue('https://blobs.test/signed');
  });

  function firstAttachment(
    rows: Awaited<ReturnType<typeof presignMessageAttachments>>,
  ) {
    const metadata = rows[0]?.metadata as {
      attachments: Record<string, unknown>[];
    };
    return metadata.attachments[0]!;
  }

  it('offers the download when the object is there', async () => {
    statOrgBlob.mockResolvedValue({ size: 12 });

    const out = await presignMessageAttachments(
      sql,
      'org-1',
      messageWith({ storageId: 's1', name: 'invoice.pdf' }),
    );

    expect(firstAttachment(out)).toMatchObject({
      url: 'https://blobs.test/signed',
      name: 'invoice.pdf',
    });
    expect(firstAttachment(out).unavailable).toBeUndefined();
  });

  it('marks it unavailable and drops the URL when the object is gone', async () => {
    statOrgBlob.mockResolvedValue(null);

    const out = await presignMessageAttachments(
      sql,
      'org-1',
      messageWith({ storageId: 's1', name: 'invoice.pdf' }),
    );

    // The URL must be GONE, not merely flagged — a dead link next to the
    // notice is the bug this fixes.
    expect(firstAttachment(out)).toEqual({
      storageId: 's1',
      name: 'invoice.pdf',
      unavailable: true,
    });
  });

  it('offers it anyway when the probe throws — a throw is not absence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    statOrgBlob.mockRejectedValue(new Error('store unreachable'));

    const out = await presignMessageAttachments(
      sql,
      'org-1',
      messageWith({ storageId: 's1', name: 'invoice.pdf' }),
    );

    expect(firstAttachment(out)).toMatchObject({
      url: 'https://blobs.test/signed',
    });
    expect(firstAttachment(out).unavailable).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
