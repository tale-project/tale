import { describe, it, expect } from 'vitest';

import type { EmailType } from '../types';

import { normalizeEmail, normalizeEmails } from '../normalize_email';

const RAW_GMAIL_MESSAGE = {
  id: 'msg123',
  threadId: 'thread456',
  labelIds: ['INBOX'],
  internalDate: '1710000000000',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'Alice <alice@example.com>' },
      {
        name: 'To',
        value: 'Bob <bob@example.com>, Charlie <charlie@example.com>',
      },
      { name: 'Cc', value: 'Dave <dave@example.com>' },
      { name: 'Subject', value: 'Test subject' },
      { name: 'Date', value: 'Mon, 10 Mar 2025 12:00:00 +0000' },
      { name: 'Message-ID', value: '<abc@example.com>' },
      { name: 'In-Reply-To', value: '<parent@example.com>' },
      { name: 'References', value: '<root@example.com> <parent@example.com>' },
    ],
    parts: [
      {
        mimeType: 'text/plain',
        body: { data: 'SGVsbG8gd29ybGQ' }, // "Hello world" base64url
      },
      {
        mimeType: 'text/html',
        body: { data: 'PGI-SGVsbG88L2I-' }, // "<b>Hello</b>" base64url (approx)
      },
    ],
  },
};

const ALREADY_MAPPED_EMAIL: EmailType = {
  uid: 0,
  messageId: 'msg789',
  from: [{ name: 'Alice', address: 'alice@example.com' }],
  to: [{ name: 'Bob', address: 'bob@example.com' }],
  subject: 'Already mapped',
  date: 'Mon, 10 Mar 2025 12:00:00 +0000',
  text: 'Hello',
  flags: [],
  headers: {
    'message-id': '<msg789@example.com>',
    'in-reply-to': '',
    references: '',
  },
};

describe('normalizeEmail', () => {
  it('converts a raw Gmail API message to EmailType', () => {
    const result = normalizeEmail(RAW_GMAIL_MESSAGE);

    expect(result.messageId).toBe('msg123');
    expect(result.from).toEqual([
      { name: 'Alice', address: 'alice@example.com' },
    ]);
    expect(result.to).toEqual([
      { name: 'Bob', address: 'bob@example.com' },
      { name: 'Charlie', address: 'charlie@example.com' },
    ]);
    expect(result.cc).toEqual([{ name: 'Dave', address: 'dave@example.com' }]);
    expect(result.subject).toBe('Test subject');
    expect(result.date).toBe('Mon, 10 Mar 2025 12:00:00 +0000');
    expect(result.headers).toEqual({
      'message-id': '<abc@example.com>',
      'in-reply-to': '<parent@example.com>',
      references: '<root@example.com> <parent@example.com>',
    });
    expect(result.uid).toBe(0);
    expect(result.direction).toBeUndefined();
  });

  it('extracts text body from Gmail payload', () => {
    const result = normalizeEmail(RAW_GMAIL_MESSAGE);
    expect(result.text).toBe('Hello world');
  });

  it('sets flags to Seen when UNREAD is not in labelIds', () => {
    const result = normalizeEmail(RAW_GMAIL_MESSAGE);
    expect(result.flags).toEqual(['\\Seen']);
  });

  it('sets empty flags when UNREAD is in labelIds', () => {
    const msg = {
      ...RAW_GMAIL_MESSAGE,
      labelIds: ['INBOX', 'UNREAD'],
    };
    const result = normalizeEmail(msg);
    expect(result.flags).toEqual([]);
  });

  it('passes through an already-mapped EmailType unchanged', () => {
    const result = normalizeEmail(ALREADY_MAPPED_EMAIL);
    expect(result).toBe(ALREADY_MAPPED_EMAIL);
  });

  it('handles Gmail message with attachments', () => {
    const msgWithAttachment = {
      ...RAW_GMAIL_MESSAGE,
      payload: {
        ...RAW_GMAIL_MESSAGE.payload,
        parts: [
          ...RAW_GMAIL_MESSAGE.payload.parts,
          {
            mimeType: 'application/pdf',
            filename: 'report.pdf',
            headers: [{ name: 'Content-ID', value: '<cid123>' }],
            body: { attachmentId: 'att001', size: 1024 },
          },
        ],
      },
    };

    const result = normalizeEmail(msgWithAttachment);
    expect(result.attachments).toEqual([
      {
        id: 'att001',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 1024,
        contentId: 'cid123',
      },
    ]);
  });

  it('uses internalDate as fallback when Date header is missing', () => {
    const msg = {
      ...RAW_GMAIL_MESSAGE,
      payload: {
        ...RAW_GMAIL_MESSAGE.payload,
        headers: RAW_GMAIL_MESSAGE.payload.headers.filter(
          (h) => h.name !== 'Date',
        ),
      },
    };

    const result = normalizeEmail(msg);
    expect(result.date).toBe('1710000000000');
  });

  it('handles empty/null payload gracefully', () => {
    const msg = { id: 'empty', payload: { headers: [] } };
    const result = normalizeEmail(msg);
    expect(result.messageId).toBe('empty');
    expect(result.from).toEqual([{ name: '', address: '' }]);
    expect(result.text).toBe('');
  });
});

const RAW_OUTLOOK_MESSAGE = {
  id: 'AAMkAGI2TG93',
  internetMessageId: '<outlook-msg-123@prod.outlook.com>',
  subject: 'Outlook test subject',
  receivedDateTime: '2025-03-10T12:00:00Z',
  isRead: true,
  hasAttachments: false,
  from: {
    emailAddress: { name: 'Alice Outlook', address: 'alice@outlook.com' },
  },
  toRecipients: [
    {
      emailAddress: { name: 'Bob', address: 'bob@example.com' },
    },
    {
      emailAddress: { name: 'Charlie', address: 'charlie@example.com' },
    },
  ],
  ccRecipients: [
    {
      emailAddress: { name: 'Dave', address: 'dave@example.com' },
    },
  ],
  body: { contentType: 'HTML', content: '<p>Hello from Outlook</p>' },
};

describe('normalizeEmail (Outlook)', () => {
  it('converts a raw Outlook Graph API message to EmailType', () => {
    const result = normalizeEmail(RAW_OUTLOOK_MESSAGE);

    expect(result.messageId).toBe('<outlook-msg-123@prod.outlook.com>');
    expect(result.from).toEqual([
      { name: 'Alice Outlook', address: 'alice@outlook.com' },
    ]);
    expect(result.to).toEqual([
      { name: 'Bob', address: 'bob@example.com' },
      { name: 'Charlie', address: 'charlie@example.com' },
    ]);
    expect(result.cc).toEqual([{ name: 'Dave', address: 'dave@example.com' }]);
    expect(result.subject).toBe('Outlook test subject');
    expect(result.date).toBe('2025-03-10T12:00:00Z');
    expect(result.html).toBe('<p>Hello from Outlook</p>');
    expect(result.text).toBe('');
    expect(result.flags).toEqual(['\\Seen']);
    expect(result.headers).toEqual({
      'message-id': '<outlook-msg-123@prod.outlook.com>',
      'in-reply-to': '',
      references: '',
    });
    expect(result.uid).toBe(0);
    expect(result.direction).toBeUndefined();
  });

  it('populates headers with empty message-id when internetMessageId is missing', () => {
    const { internetMessageId: _, ...msgWithoutInternetId } =
      RAW_OUTLOOK_MESSAGE;
    const result = normalizeEmail(msgWithoutInternetId);
    expect(result.headers).toEqual({
      'message-id': '',
      'in-reply-to': '',
      references: '',
    });
  });

  it('falls back to Graph id when internetMessageId is missing', () => {
    const { internetMessageId: _, ...msgWithoutInternetId } =
      RAW_OUTLOOK_MESSAGE;
    const result = normalizeEmail(msgWithoutInternetId);
    expect(result.messageId).toBe('AAMkAGI2TG93');
  });

  it('sets empty flags when isRead is false', () => {
    const msg = { ...RAW_OUTLOOK_MESSAGE, isRead: false };
    const result = normalizeEmail(msg);
    expect(result.flags).toEqual([]);
  });

  it('handles text/plain body content', () => {
    const msg = {
      ...RAW_OUTLOOK_MESSAGE,
      body: { contentType: 'Text', content: 'Plain text body' },
    };
    const result = normalizeEmail(msg);
    expect(result.text).toBe('Plain text body');
    expect(result.html).toBe('');
  });

  it('handles Outlook message with attachments', () => {
    const msg = {
      ...RAW_OUTLOOK_MESSAGE,
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          id: 'att001',
          name: 'report.pdf',
          contentType: 'application/pdf',
          size: 2048,
          contentId: '<cid456>',
        },
        {
          '@odata.type': '#microsoft.graph.itemAttachment',
          id: 'att002',
          name: 'embedded.msg',
        },
      ],
    };
    const result = normalizeEmail(msg);
    expect(result.attachments).toEqual([
      {
        id: 'att001',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 2048,
        contentId: 'cid456',
      },
    ]);
  });

  it('handles minimal Outlook message (only toRecipients)', () => {
    const msg = {
      toRecipients: [{ emailAddress: { address: 'someone@example.com' } }],
    };
    const result = normalizeEmail(msg);
    expect(result.messageId).toBe('');
    expect(result.to).toEqual([{ name: '', address: 'someone@example.com' }]);
  });

  it('normalizes bcc recipients', () => {
    const msg = {
      ...RAW_OUTLOOK_MESSAGE,
      bccRecipients: [
        { emailAddress: { name: 'Eve', address: 'eve@example.com' } },
      ],
    };
    const result = normalizeEmail(msg);
    expect(result.bcc).toEqual([{ name: 'Eve', address: 'eve@example.com' }]);
  });

  it('handles missing from field gracefully', () => {
    const { from: _, ...msgNoFrom } = RAW_OUTLOOK_MESSAGE;
    const result = normalizeEmail(msgNoFrom);
    expect(result.from).toEqual([{ name: '', address: '' }]);
  });

  it('handles missing body gracefully', () => {
    const { body: _, ...msgNoBody } = RAW_OUTLOOK_MESSAGE;
    const result = normalizeEmail(msgNoBody);
    expect(result.text).toBe('');
    expect(result.html).toBe('');
  });

  it('uses sentDateTime when receivedDateTime is absent', () => {
    const { receivedDateTime: _, ...msg } = RAW_OUTLOOK_MESSAGE;
    const result = normalizeEmail({
      ...msg,
      sentDateTime: '2025-03-10T11:00:00Z',
    });
    expect(result.date).toBe('2025-03-10T11:00:00Z');
  });

  it('handles file attachment without contentId', () => {
    const msg = {
      ...RAW_OUTLOOK_MESSAGE,
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          id: 'att003',
          name: 'doc.txt',
          contentType: 'text/plain',
          size: 128,
        },
      ],
    };
    const result = normalizeEmail(msg);
    expect(result.attachments).toEqual([
      {
        id: 'att003',
        filename: 'doc.txt',
        contentType: 'text/plain',
        size: 128,
      },
    ]);
  });

  it('does not detect an object with both payload and from.emailAddress as Outlook', () => {
    const ambiguous = {
      ...RAW_GMAIL_MESSAGE,
      from: { emailAddress: { name: 'Trick', address: 'trick@example.com' } },
    };
    const result = normalizeEmail(ambiguous);
    // Should be detected as Gmail (payload wins), not Outlook
    expect(result.messageId).toBe('msg123');
    expect(result.subject).toBe('Test subject');
  });
});

describe('normalizeEmails', () => {
  it('normalizes an array of mixed raw and mapped emails', () => {
    const results = normalizeEmails([RAW_GMAIL_MESSAGE, ALREADY_MAPPED_EMAIL]);
    expect(results).toHaveLength(2);
    expect(results[0].messageId).toBe('msg123');
    expect(results[1].messageId).toBe('msg789');
  });

  it('wraps a single email in an array', () => {
    const results = normalizeEmails(ALREADY_MAPPED_EMAIL);
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(ALREADY_MAPPED_EMAIL);
  });

  it('wraps a single raw Gmail message in an array', () => {
    const results = normalizeEmails(RAW_GMAIL_MESSAGE);
    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe('msg123');
  });

  it('normalizes a mixed array of Gmail, Outlook, and pre-mapped emails', () => {
    const results = normalizeEmails([
      RAW_GMAIL_MESSAGE,
      RAW_OUTLOOK_MESSAGE,
      ALREADY_MAPPED_EMAIL,
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].messageId).toBe('msg123');
    expect(results[1].messageId).toBe('<outlook-msg-123@prod.outlook.com>');
    expect(results[1].headers?.['message-id']).toBe(
      '<outlook-msg-123@prod.outlook.com>',
    );
    expect(results[2]).toBe(ALREADY_MAPPED_EMAIL);
  });
});
