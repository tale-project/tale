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
