import { describe, expect, it } from 'vitest';

import {
  conversationConnectorSlug,
  sendConnectorAction,
} from './connector_slug';

describe('conversationConnectorSlug', () => {
  it('maps legacy imap_smtp to imap-smtp', () => {
    expect(conversationConnectorSlug('imap_smtp')).toBe('imap-smtp');
    expect(conversationConnectorSlug('gmail')).toBe('gmail');
  });
});

describe('sendConnectorAction', () => {
  it('selects send vs send_message per connector', () => {
    expect(sendConnectorAction('imap_smtp')).toEqual({
      connector: 'imap-smtp',
      action: 'send',
    });
    expect(sendConnectorAction('gmail')).toEqual({
      connector: 'gmail',
      action: 'send_message',
    });
    expect(sendConnectorAction('outlook')).toEqual({
      connector: 'outlook',
      action: 'send_message',
    });
  });
});
