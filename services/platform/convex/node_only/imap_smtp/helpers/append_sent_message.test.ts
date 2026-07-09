import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnect = vi.fn();
const mockList = vi.fn();
const mockAppend = vi.fn();
const mockLogout = vi.fn();

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(function ImapFlowMock() {
    return {
      connect: mockConnect,
      list: mockList,
      append: mockAppend,
      logout: mockLogout,
    };
  }),
}));

vi.mock('./build_outbound_mail', () => ({
  buildOutboundRawMessage: vi
    .fn()
    .mockResolvedValue(Buffer.from('raw-message')),
}));

import { appendSentMessage } from './append_sent_message';

describe('appendSentMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockList.mockResolvedValue([
      { path: 'INBOX', flags: new Set<string>() },
      { path: 'Sent', flags: new Set<string>(), specialUse: '\\Sent' },
    ]);
    mockAppend.mockResolvedValue(true);
    mockLogout.mockResolvedValue(undefined);
  });

  const baseParams = {
    imap: {
      host: 'imap.example.com',
      port: 993,
      secure: true,
      user: 'user@example.com',
      password: 'secret',
    },
    from: 'hello@example.com',
    to: ['customer@example.com'],
    subject: 'Re: Test',
    text: 'Hello',
    messageId: '<test-id@example.com>',
  };

  it('appends to the discovered Sent folder', async () => {
    const result = await appendSentMessage(baseParams);

    expect(result).toEqual({ success: true, mailboxPath: 'Sent' });
    expect(mockAppend).toHaveBeenCalledWith(
      'Sent',
      Buffer.from('raw-message'),
      ['\\Seen'],
      expect.any(Date),
    );
  });

  it('returns error when Sent folder is missing', async () => {
    mockList.mockResolvedValue([{ path: 'INBOX', flags: new Set<string>() }]);

    const result = await appendSentMessage(baseParams);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Sent folder not found');
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('returns error when IMAP connect fails without throwing', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'));

    const result = await appendSentMessage(baseParams);

    expect(result).toEqual({
      success: false,
      error: 'IMAP connection failed: connection refused',
    });
  });
});
