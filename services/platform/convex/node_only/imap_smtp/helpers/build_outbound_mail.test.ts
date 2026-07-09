import { describe, expect, it } from 'vitest';

import { buildOutboundRawMessage } from './build_outbound_mail';

describe('buildOutboundRawMessage', () => {
  it('embeds the provided Message-ID in the raw RFC 822 body', async () => {
    const raw = await buildOutboundRawMessage({
      from: 'hello@example.com',
      to: ['customer@example.com'],
      subject: 'Re: Test',
      text: 'Hello',
      messageId: '<test-id@example.com>',
    });

    const text = raw.toString('utf8');
    expect(text).toContain('Message-ID: <test-id@example.com>');
    expect(text).toContain('Subject: Re: Test');
    expect(text).toContain('From: hello@example.com');
  });
});
