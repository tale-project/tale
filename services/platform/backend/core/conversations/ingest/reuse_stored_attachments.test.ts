import { describe, expect, it, vi } from 'vitest';

import {
  reuseStoredAttachments,
  settledAttachmentsOfIngested,
} from './reuse_stored_attachments';

/**
 * One fetched email carrying wire bytes, as a mail connector returns it on
 * every fetch — including a re-fetch of a message already ingested.
 */
function emailWithBytes(
  messageId: string,
  filename = 'report.pdf',
): Record<string, unknown> {
  return {
    messageId,
    subject: 'Quarterly figures',
    attachments: [
      {
        // A per-fetch part handle, NOT stable across fetches — which is why
        // filename is the identifier used for matching.
        id: '2.1',
        filename,
        contentType: 'application/pdf',
        size: 128,
        contentBase64: 'Ynl0ZXM=',
      },
    ],
  };
}

/** A stored attachment as it sits in an ingested message's metadata. */
function storedMetadata(filename = 'report.pdf', storageId = 'blob_abc') {
  return {
    attachments: [
      {
        id: '1.2',
        filename,
        contentType: 'application/pdf',
        size: 128,
        storageId,
        url: `/storage/${storageId}/${filename}`,
      },
    ],
  };
}

function ctxReturning(existing: unknown) {
  const runQuery = vi.fn(async () => existing);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
  return { ctx: { runQuery } as never, runQuery };
}

describe('reuseStoredAttachments', () => {
  it('reuses the stored pointers for an already-ingested message', async () => {
    const { ctx } = ctxReturning({
      _id: 'msg_1',
      metadata: storedMetadata(),
    });

    const [out] = await reuseStoredAttachments(ctx, {
      organizationId: 'org_1',
      emails: [emailWithBytes('<q3@example.com>')],
    });

    const attachments = (out as { attachments: Array<Record<string, unknown>> })
      .attachments;
    expect(attachments).toHaveLength(1);
    // The existing blob, and crucially NO wire bytes — so the materializer
    // downstream has nothing to store.
    expect(attachments[0].storageId).toBe('blob_abc');
    expect(attachments[0]).not.toHaveProperty('contentBase64');
  });

  it('leaves a new message untouched so its bytes are stored', async () => {
    const { ctx } = ctxReturning(null);
    const email = emailWithBytes('<new@example.com>');

    const [out] = await reuseStoredAttachments(ctx, {
      organizationId: 'org_1',
      emails: [email],
    });

    expect(out).toBe(email);
  });

  // A chip from before attachment storage shipped, or a materialization that
  // failed: there is nothing to reuse, and this pass is the chance to fix it.
  it('stores normally when the existing message has no stored bytes', async () => {
    const { ctx } = ctxReturning({
      _id: 'msg_1',
      metadata: {
        attachments: [
          {
            id: '1.2',
            filename: 'report.pdf',
            contentType: 'application/pdf',
            size: 128,
          },
        ],
      },
    });
    const email = emailWithBytes('<q3@example.com>');

    const [out] = await reuseStoredAttachments(ctx, {
      organizationId: 'org_1',
      emails: [email],
    });

    expect(out).toBe(email);
  });

  it('stores normally when the fetched parts do not all match what is stored', async () => {
    // Stored covers report.pdf; this fetch also carries invoice.pdf. Reusing
    // partially would silently drop the new file.
    const { ctx } = ctxReturning({ _id: 'msg_1', metadata: storedMetadata() });
    const email = emailWithBytes('<q3@example.com>');
    (email.attachments as Array<Record<string, unknown>>).push({
      id: '2.2',
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 64,
      contentBase64: 'bW9yZQ==',
    });

    const [out] = await reuseStoredAttachments(ctx, {
      organizationId: 'org_1',
      emails: [email],
    });

    expect(out).toBe(email);
  });

  it('stores normally when the lookup throws', async () => {
    const runQuery = vi.fn(async () => {
      throw new Error('transient');
    });
    const email = emailWithBytes('<q3@example.com>');

    const [out] = await reuseStoredAttachments(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      { runQuery } as never,
      { organizationId: 'org_1', emails: [email] },
    );

    // Never lose a file to a failed lookup: a duplicate blob is recoverable,
    // a dropped attachment is not.
    expect(out).toBe(email);
  });

  it('does not look up an email with no attachments', async () => {
    const { ctx, runQuery } = ctxReturning(null);

    await reuseStoredAttachments(ctx, {
      organizationId: 'org_1',
      emails: [{ messageId: '<plain@example.com>', subject: 'no files' }],
    });

    expect(runQuery).not.toHaveBeenCalled();
  });

  it('passes through a non-email value untouched', async () => {
    const { ctx } = ctxReturning(null);
    const out = await reuseStoredAttachments(ctx, {
      organizationId: 'org_1',
      emails: [null, 'nonsense'],
    });
    expect(out).toEqual([null, 'nonsense']);
  });

  it('does not look up an email whose attachments are already stored', async () => {
    const { ctx, runQuery } = ctxReturning(null);
    const email = {
      messageId: '<q3@example.com>',
      attachments: storedMetadata().attachments,
    };

    const [out] = await reuseStoredAttachments(ctx, {
      organizationId: 'org_1',
      emails: [email],
    });

    expect(out).toBe(email);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe('settledAttachmentsOfIngested', () => {
  const truncated = {
    id: '1.3',
    filename: 'scan.pdf',
    contentType: 'application/pdf',
    size: 9_000_000,
    truncated: true,
  };

  it('hands back every part of a message whose attachments are settled', async () => {
    const stored = storedMetadata().attachments[0];
    const { ctx } = ctxReturning({
      _id: 'msg_1',
      metadata: { attachments: [stored, truncated] },
    });

    // A truncated part counts as settled: the connector could not carry it,
    // so asking again would store nothing either.
    await expect(
      settledAttachmentsOfIngested(ctx, 'org_1', '<q3@example.com>'),
    ).resolves.toEqual([stored, truncated]);
  });

  it('answers null while any part still lacks its bytes', async () => {
    const { ctx } = ctxReturning({
      _id: 'msg_1',
      metadata: {
        attachments: [
          storedMetadata().attachments[0],
          {
            id: '1.4',
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            size: 64,
          },
        ],
      },
    });

    await expect(
      settledAttachmentsOfIngested(ctx, 'org_1', '<q3@example.com>'),
    ).resolves.toBeNull();
  });

  it('answers null for a new message and for one with no attachments recorded', async () => {
    await expect(
      settledAttachmentsOfIngested(
        ctxReturning(null).ctx,
        'org_1',
        '<new@example.com>',
      ),
    ).resolves.toBeNull();
    await expect(
      settledAttachmentsOfIngested(
        ctxReturning({ _id: 'msg_1', metadata: { attachments: [] } }).ctx,
        'org_1',
        '<q3@example.com>',
      ),
    ).resolves.toBeNull();
  });

  it('answers null when the lookup throws, so the bytes are fetched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runQuery = vi.fn(async () => {
      throw new Error('transient');
    });

    await expect(
      settledAttachmentsOfIngested(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
        { runQuery } as never,
        'org_1',
        '<q3@example.com>',
      ),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
