import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { materializeEmailAttachments } from './materialize_email_attachments';

describe('materializeEmailAttachments', () => {
  beforeEach(() => {
    process.env.SITE_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    delete process.env.SITE_URL;
  });

  it('stores base64 parts and strips the wire field', async () => {
    const storeOrgBlob = vi.fn(async () => 'storage-att-1');
    const saveFileMetadata = vi.fn(async () => undefined);
    const ctx = {
      runAction: vi.fn(async (_ref: unknown, args: unknown) => {
        expect(args).toMatchObject({
          organizationId: 'org_1',
          contentType: 'application/pdf',
        });
        return storeOrgBlob();
      }),
      runMutation: vi.fn(async () => {
        await saveFileMetadata();
        return null;
      }),
      storage: { getUrl: vi.fn() },
    };

    const emails = await materializeEmailAttachments(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      ctx as never,
      {
        organizationId: 'org_1',
        source: 'imap-smtp',
        emails: [
          {
            messageId: '<cv@x>',
            subject: 'Test CV emails',
            attachments: [
              {
                id: 'cv',
                filename: 'CV.pdf',
                contentType: 'application/pdf',
                size: 3,
                contentBase64: Buffer.from('pdf').toString('base64'),
              },
            ],
          },
        ],
      },
    );

    expect(storeOrgBlob).toHaveBeenCalledOnce();
    expect(saveFileMetadata).toHaveBeenCalledOnce();
    expect(emails).toEqual([
      {
        messageId: '<cv@x>',
        subject: 'Test CV emails',
        attachments: [
          {
            id: 'cv',
            filename: 'CV.pdf',
            contentType: 'application/pdf',
            size: 3,
            storageId: 'storage-att-1',
            url: expect.stringContaining('CV.pdf'),
          },
        ],
      },
    ]);
    expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by expect
      (emails[0] as { attachments: Array<{ contentBase64?: string }> })
        .attachments[0]?.contentBase64,
    ).toBeUndefined();
  });

  // Regression: this path stored attachments with the *defer* flag, whose
  // contract is "I will dispatch the indexing job myself" — a promise nothing
  // downstream of here keeps. Each row was left at `ragStatus: 'queued'` and
  // unparked, which `countRagInFlight` charges against
  // MAX_CONCURRENT_RAG_INDEXING_PER_ORG (3), so three inbound attachments
  // permanently saturated an org's indexing budget and every document a person
  // uploaded parked instead — invisibly, since a parked row still reads
  // "Queued", which is one of the few statuses RagStatusBadge gives no retry
  // affordance, and the watchdog skips parked rows by design.
  it('stores attachments without claiming a RAG indexing slot', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const ctx = {
      runAction: vi.fn(async () => 'storage-att-1'),
      runMutation: vi.fn(
        async (_ref: unknown, args: Record<string, unknown>) => {
          saved.push(args);
          return null;
        },
      ),
      storage: { getUrl: vi.fn() },
    };

    await materializeEmailAttachments(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      ctx as never,
      {
        organizationId: 'org_1',
        source: 'imap-smtp',
        emails: [
          {
            messageId: '<cv@x>',
            attachments: [
              {
                id: 'cv',
                // An indexable format, so nothing but the explicit skip keeps
                // this row out of the queue.
                filename: 'CV.pdf',
                contentType: 'application/pdf',
                size: 3,
                contentBase64: Buffer.from('pdf').toString('base64'),
              },
            ],
          },
        ],
      },
    );

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ skipRagIndexing: true });
    expect(saved[0]).not.toHaveProperty('deferRagDispatch');
  });

  it('passes through emails with no wire bytes', async () => {
    const ctx = {
      runAction: vi.fn(),
      runMutation: vi.fn(),
      storage: { getUrl: vi.fn() },
    };
    const emails = await materializeEmailAttachments(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      ctx as never,
      {
        organizationId: 'org_1',
        source: 'imap-smtp',
        emails: [
          {
            messageId: '<plain@x>',
            attachments: [
              {
                id: 'a',
                filename: 'a.txt',
                contentType: 'text/plain',
                size: 1,
              },
            ],
          },
        ],
      },
    );
    expect(ctx.runAction).not.toHaveBeenCalled();
    expect(emails[0]).toMatchObject({
      attachments: [{ id: 'a', filename: 'a.txt' }],
    });
  });
});
