import { describe, expect, it } from 'vitest';

import { classifyMailFailure } from './mail_sync_failure';

/** A live body's failure as the connector door hands it over. */
function live(connector: string, action: string, sentence: string): Error {
  return new Error(
    `conversation.sync_mailbox: ${connector}.${action} failed (the live ${connector}.${action} call failed: ${sentence})`,
  );
}

describe('classifyMailFailure', () => {
  it('reads Gmail’s 429 and the wait it names as a rate limit', () => {
    expect(
      classifyMailFailure(
        live(
          'gmail',
          'get_message',
          'Gmail get_message failed (429, retry after 30s): Too many concurrent requests for user',
        ),
        'read',
      ),
    ).toMatchObject({ kind: 'rate_limited', retryAfterMs: 30_000 });
  });

  it('reads Gmail’s 403 rate-limit reasons as a rate limit with no wait named', () => {
    for (const reason of [
      'rateLimitExceeded',
      'userRateLimitExceeded',
      'quotaExceeded',
    ]) {
      expect(
        classifyMailFailure(
          live(
            'gmail',
            'list_messages',
            `Gmail list_messages failed (403): {"error":{"errors":[{"reason":"${reason}"}]}}`,
          ),
          'list',
        ),
      ).toMatchObject({ kind: 'rate_limited', retryAfterMs: null });
    }
  });

  it('reads Graph’s throttling sentence and its Retry-After', () => {
    expect(
      classifyMailFailure(
        live(
          'outlook',
          'list_messages',
          'Outlook list_messages failed: rate limited by Microsoft Graph (retry after 120s) — retry later.',
        ),
        'list',
      ),
    ).toMatchObject({ kind: 'rate_limited', retryAfterMs: 120_000 });
  });

  it('bounds a wait no provider would name', () => {
    expect(
      classifyMailFailure(new Error('(429, retry after 999999s)'), 'list'),
    ).toMatchObject({ kind: 'rate_limited', retryAfterMs: 86_400_000 });
  });

  it('reads a message gone since the listing, for each provider', () => {
    for (const error of [
      live(
        'gmail',
        'get_message',
        'Gmail get_message failed (404): Requested entity was not found.',
      ),
      live(
        'outlook',
        'get_message',
        'Outlook get_message failed: message AAMk123 not found.',
      ),
      live(
        'imap-smtp',
        'get_message',
        'no message with UID 41 in the requested mailbox',
      ),
    ]) {
      expect(classifyMailFailure(error, 'read').kind).toBe('gone');
    }
  });

  it('never reads a failed listing as a message gone', () => {
    expect(
      classifyMailFailure(
        live('gmail', 'list_messages', 'Gmail list_messages failed (404): x'),
        'list',
      ).kind,
    ).toBe('failed');
  });

  it('reads anything else as a failure that stops the pass', () => {
    for (const sentence of [
      'Outlook get_message failed: authentication expired — re-authorize the connection.',
      'Gmail get_message failed (403): insufficient permission',
      'IMAP connection closed unexpectedly',
      'Gmail list_messages failed (500): backend error',
    ]) {
      expect(
        classifyMailFailure(live('x', 'get_message', sentence), 'read').kind,
      ).toBe('failed');
    }
    expect(classifyMailFailure('not an error', 'list')).toEqual({
      kind: 'failed',
      message: 'not an error',
    });
  });
});
