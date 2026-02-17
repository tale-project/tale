import { describe, it, expect } from 'vitest';

import {
  hasMessageListOperation,
  hasThreadOperation,
  inferChannel,
} from '../provision_conversation_sync_workflow';

describe('hasMessageListOperation', () => {
  it('returns true for list_messages', () => {
    expect(hasMessageListOperation([{ name: 'list_messages' }])).toBe(true);
  });

  it('returns true for list_emails', () => {
    expect(hasMessageListOperation([{ name: 'list_emails' }])).toBe(true);
  });

  it('returns true for sync_messages', () => {
    expect(hasMessageListOperation([{ name: 'sync_messages' }])).toBe(true);
  });

  it('returns true when mixed with other operations', () => {
    expect(
      hasMessageListOperation([
        { name: 'get_message' },
        { name: 'send_message' },
        { name: 'list_messages' },
      ]),
    ).toBe(true);
  });

  it('returns false for unrelated operations', () => {
    expect(
      hasMessageListOperation([
        { name: 'get_message' },
        { name: 'send_message' },
      ]),
    ).toBe(false);
  });

  it('returns false for empty operations', () => {
    expect(hasMessageListOperation([])).toBe(false);
  });

  it('returns false for undefined operations', () => {
    expect(hasMessageListOperation(undefined)).toBe(false);
  });
});

describe('hasThreadOperation', () => {
  it('returns true for get_thread', () => {
    expect(hasThreadOperation([{ name: 'get_thread' }])).toBe(true);
  });

  it('returns true for get_conversation', () => {
    expect(hasThreadOperation([{ name: 'get_conversation' }])).toBe(true);
  });

  it('returns false for unrelated operations', () => {
    expect(
      hasThreadOperation([{ name: 'list_messages' }, { name: 'send_message' }]),
    ).toBe(false);
  });

  it('returns false for empty operations', () => {
    expect(hasThreadOperation([])).toBe(false);
  });

  it('returns false for undefined operations', () => {
    expect(hasThreadOperation(undefined)).toBe(false);
  });
});

describe('inferChannel', () => {
  it('returns email for gmail', () => {
    expect(inferChannel('gmail')).toBe('email');
  });

  it('returns email for outlook', () => {
    expect(inferChannel('outlook')).toBe('email');
  });

  it('returns whatsapp for whatsapp integrations', () => {
    expect(inferChannel('whatsapp')).toBe('whatsapp');
    expect(inferChannel('WhatsApp Business')).toBe('whatsapp');
  });

  it('returns sms for sms/twilio integrations', () => {
    expect(inferChannel('twilio')).toBe('sms');
    expect(inferChannel('sms_provider')).toBe('sms');
  });

  it('returns messenger for facebook/meta integrations', () => {
    expect(inferChannel('facebook_messenger')).toBe('messenger');
    expect(inferChannel('meta_business')).toBe('messenger');
    expect(inferChannel('messenger')).toBe('messenger');
  });

  it('returns instagram for instagram integrations', () => {
    expect(inferChannel('instagram')).toBe('instagram');
    expect(inferChannel('Instagram DM')).toBe('instagram');
  });

  it('returns slack for slack integrations', () => {
    expect(inferChannel('slack')).toBe('slack');
  });

  it('returns telegram for telegram integrations', () => {
    expect(inferChannel('telegram')).toBe('telegram');
  });

  it('returns email as default for unknown integrations', () => {
    expect(inferChannel('custom_provider')).toBe('email');
    expect(inferChannel('my_integration')).toBe('email');
  });
});
