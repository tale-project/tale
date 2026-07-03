import type { ParsedMail } from 'mailparser';
import { simpleParser } from 'mailparser';
import { describe, it, expect } from 'vitest';

import { mapToEmailType } from './map_to_email_type';

describe('mapToEmailType', () => {
  it('maps a real RFC822 message parsed by mailparser into EmailType', async () => {
    const raw = [
      'From: Alice Example <alice@example.com>',
      'To: Bob <bob@corp.example>, carol@corp.example',
      'Cc: dave@corp.example',
      'Subject: Hello there',
      'Message-ID: <msg-123@example.com>',
      'In-Reply-To: <prev-1@example.com>',
      'References: <root@example.com> <prev-1@example.com>',
      'Date: Mon, 02 Jun 2025 10:00:00 +0000',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'This is the body text.',
      '',
    ].join('\r\n');

    const parsed = await simpleParser(raw);
    const email = mapToEmailType(42, ['\\Seen'], parsed);

    expect(email.uid).toBe(42);
    expect(email.flags).toEqual(['\\Seen']);
    // messageId is stripped of angle brackets for stable cross-system dedup.
    expect(email.messageId).toBe('msg-123@example.com');
    expect(email.from).toEqual([
      { name: 'Alice Example', address: 'alice@example.com' },
    ]);
    // Named + bare addresses both map; the bare one omits the name key.
    expect(email.to).toEqual([
      { name: 'Bob', address: 'bob@corp.example' },
      { address: 'carol@corp.example' },
    ]);
    expect(email.cc).toEqual([{ address: 'dave@corp.example' }]);
    expect(email.subject).toBe('Hello there');
    expect(email.text?.trim()).toBe('This is the body text.');
    // No HTML part → empty string, never the mailparser `false` sentinel.
    expect(email.html).toBe('');
    expect(email.date).toBe(new Date('2025-06-02T10:00:00Z').toISOString());
    // Raw header values are preserved (with brackets) for threading.
    expect(email.headers?.['message-id']).toBe('<msg-123@example.com>');
    expect(email.headers?.['in-reply-to']).toBe('<prev-1@example.com>');
    expect(email.headers?.references).toBe(
      '<root@example.com> <prev-1@example.com>',
    );
    // direction is left for createConversationFromEmail to derive.
    expect(email.direction).toBeUndefined();
  });

  it('maps html, bcc, array references, and attachment metadata', () => {
    const parsed = {
      messageId: '<a@b>',
      from: { value: [{ address: 'x@y.com', name: 'X' }] },
      to: { value: [{ address: 't@y.com', name: '' }] },
      cc: undefined,
      bcc: { value: [{ address: 'b@y.com', name: 'B' }] },
      subject: 'Sub',
      date: new Date('2025-01-01T00:00:00Z'),
      text: 'plain',
      html: '<p>hi</p>',
      references: ['<r1>', '<r2>'],
      inReplyTo: '<r1>',
      attachments: [
        {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
          size: 123,
          checksum: 'abc',
          contentId: '<cid1>',
        },
        {
          filename: undefined,
          contentType: 'image/png',
          size: 0,
          cid: 'cid2',
        },
      ],
    } as unknown as ParsedMail;

    const email = mapToEmailType(7, [], parsed);

    expect(email.html).toBe('<p>hi</p>');
    expect(email.bcc).toEqual([{ name: 'B', address: 'b@y.com' }]);
    // Array references are joined into a single header value.
    expect(email.headers?.references).toBe('<r1> <r2>');
    expect(email.attachments).toEqual([
      {
        id: 'abc',
        filename: 'doc.pdf',
        contentType: 'application/pdf',
        size: 123,
        contentId: 'cid1',
      },
      {
        // No checksum → stable `${uid}-${index}` id; no filename → 'attachment'.
        id: '7-1',
        filename: 'attachment',
        contentType: 'image/png',
        size: 0,
        contentId: 'cid2',
      },
    ]);
  });

  it('tolerates a message with no addresses or body', () => {
    const parsed = {
      subject: undefined,
      attachments: [],
    } as unknown as ParsedMail;

    const email = mapToEmailType(1, [], parsed);

    expect(email.from).toEqual([]);
    expect(email.to).toEqual([]);
    expect(email.subject).toBe('');
    expect(email.text).toBe('');
    expect(email.messageId).toBe('');
    expect(email.date).toBe('');
    expect(email.attachments).toEqual([]);
  });
});
