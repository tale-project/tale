/**
 * The per-connector outbound send shape. The regression that matters here: the
 * imap-smtp branch used to carry only to/subject/body/inReplyTo, silently
 * dropping cc, the References chain, and every attachment — a reply the sender
 * saw as sent with files attached left the mailbox without them.
 */

import { describe, expect, it } from 'vitest';

import { buildSendInput } from './send_input';

const ATTACHMENT = {
  name: 'invoice.pdf',
  contentType: 'application/pdf',
  size: 2048,
  storageRef: 's3:acme/blob-invoice',
  url: 'https://blob.example.test/invoice.pdf?sig=abc',
};

describe('buildSendInput — imap-smtp fidelity', () => {
  it('carries cc, references, and attachments on an imap-smtp reply', () => {
    const input = buildSendInput({
      connectorName: 'imap-smtp',
      to: ['person@example.com'],
      cc: ['watcher@example.com', 'boss@example.com'],
      subject: 'Re: Order 42',
      body: '<p>On its way.</p>',
      contentType: 'HTML',
      inReplyTo: '<parent@example.com>',
      references: ['<root@example.com>', '<parent@example.com>'],
      attachments: [ATTACHMENT],
    });

    expect(input).toMatchObject({
      to: 'person@example.com',
      cc: 'watcher@example.com, boss@example.com',
      subject: 'Re: Order 42',
      html: '<p>On its way.</p>',
      inReplyTo: '<parent@example.com>',
      references: ['<root@example.com>', '<parent@example.com>'],
    });
    // The native resolves bytes from the org blob ref itself; a URL handed to
    // the mail library would be a read of whatever it points at.
    expect(input.attachments).toEqual([
      {
        name: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 2048,
        storageRef: 's3:acme/blob-invoice',
      },
    ]);
  });

  it('omits cc/references/attachments when the reply has none', () => {
    const input = buildSendInput({
      connectorName: 'imap-smtp',
      to: ['person@example.com'],
      subject: 'Hello',
      body: 'Plain hi.',
      contentType: 'text/plain',
      attachments: [],
    });

    expect(input).toEqual({
      to: 'person@example.com',
      subject: 'Hello',
      text: 'Plain hi.',
    });
  });

  it('still carries attachments and cc for the API-mail connectors', () => {
    const gmail = buildSendInput({
      connectorName: 'gmail',
      to: ['person@example.com'],
      cc: ['boss@example.com'],
      subject: 'Hi',
      body: '<p>Hi.</p>',
      references: ['<root@example.com>'],
      attachments: [ATTACHMENT],
    });
    expect(gmail).toMatchObject({
      cc: 'boss@example.com',
      references: '<root@example.com>',
    });
    // The yaml-js bodies fetch the presigned URL through the mediated
    // `ctx.http`; the blob ref is the native's contract, not theirs.
    expect(gmail.attachments).toEqual([
      {
        name: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 2048,
        url: 'https://blob.example.test/invoice.pdf?sig=abc',
      },
    ]);
  });
});
