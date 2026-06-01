import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseNotifyChannels,
  resolveNotifyEnabled,
  sendWithSlack429Retry,
} from './notify_slack';

describe('resolveNotifyEnabled', () => {
  it('uses the catalog default when there is no override', () => {
    expect(resolveNotifyEnabled({}, 'workflow.failed', true)).toBe(true);
    expect(resolveNotifyEnabled({}, 'workflow.completed', false)).toBe(false);
    expect(resolveNotifyEnabled(undefined, 'security.alert', true)).toBe(true);
  });

  it('lets an explicit org override win over the default (both directions)', () => {
    expect(
      resolveNotifyEnabled(
        { notifyEvents: { 'workflow.failed': false } },
        'workflow.failed',
        true,
      ),
    ).toBe(false);
    expect(
      resolveNotifyEnabled(
        { notifyEvents: { 'workflow.completed': true } },
        'workflow.completed',
        false,
      ),
    ).toBe(true);
  });

  it('ignores non-boolean overrides', () => {
    expect(
      resolveNotifyEnabled(
        { notifyEvents: { 'workflow.failed': 'yes' } },
        'workflow.failed',
        false,
      ),
    ).toBe(false);
  });
});

describe('parseNotifyChannels', () => {
  it('returns [] for missing / non-array config', () => {
    expect(parseNotifyChannels(undefined)).toEqual([]);
    expect(parseNotifyChannels({})).toEqual([]);
    expect(parseNotifyChannels({ notifyChannels: 'C1' })).toEqual([]);
  });

  it('keeps only strings and dedupes', () => {
    expect(
      parseNotifyChannels({ notifyChannels: ['C1', 'C2', 'C1', 5, null] }),
    ).toEqual(['C1', 'C2']);
  });
});

describe('sendWithSlack429Retry', () => {
  const meta = { organizationId: 'org_1', channel: 'C1' };
  const noSleep = async () => {};

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends once on success', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    await sendWithSlack429Retry(send, meta, { sleep: noSleep });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once on a Slack 429 and then succeeds', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('Rate limited by Slack during send_message.'),
      )
      .mockResolvedValueOnce({ ok: true });
    await sendWithSlack429Retry(send, meta, { sleep: noSleep });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry when the 429 persists (no throw escapes)', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        new Error('Rate limited by Slack during send_message.'),
      );
    await expect(
      sendWithSlack429Retry(send, meta, { sleep: noSleep }),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-rate-limit error (logged, swallowed)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('channel_not_found'));
    await expect(
      sendWithSlack429Retry(send, meta, { sleep: noSleep }),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
