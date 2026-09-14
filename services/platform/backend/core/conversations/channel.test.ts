/**
 * The channel default is a compatibility promise, not a style choice: every
 * conversation that existed before a conversation could be anything but mail
 * either carries `channel: 'email'` or carries nothing at all, and both must
 * keep taking the mail path.
 */

import { describe, expect, it } from 'vitest';

import {
  conversationChannel,
  EMAIL_CHANNEL,
  isEmailChannel,
  WEBHOOK_CHANNEL_CONNECTOR,
} from './channel';

describe('conversationChannel', () => {
  it('reads a row that never had a channel written as email', () => {
    expect(conversationChannel(null)).toBe(EMAIL_CHANNEL);
    expect(conversationChannel(undefined)).toBe(EMAIL_CHANNEL);
    expect(conversationChannel('')).toBe(EMAIL_CHANNEL);
    expect(conversationChannel('   ')).toBe(EMAIL_CHANNEL);
  });

  it('passes any other channel through untouched', () => {
    expect(conversationChannel('api')).toBe('api');
    expect(conversationChannel('support-widget')).toBe('support-widget');
  });
});

describe('isEmailChannel', () => {
  it('is true for email and for every shape of absent', () => {
    for (const value of ['email', null, undefined, '', '  ']) {
      expect(isEmailChannel(value)).toBe(true);
    }
  });

  it('is false for a channel that is not mail', () => {
    expect(isEmailChannel('api')).toBe(false);
    expect(isEmailChannel('support-widget')).toBe(false);
  });
});

describe('WEBHOOK_CHANNEL_CONNECTOR', () => {
  it('matches the slug the shipped catalog entry declares', () => {
    expect(WEBHOOK_CHANNEL_CONNECTOR).toBe('webhook-channel');
  });
});
