import { describe, expect, it } from 'vitest';

import { parseNotifyChannels, resolveNotifyEnabled } from './notify_slack';

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
