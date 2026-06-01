import { describe, expect, it } from 'vitest';

import {
  buildNotificationMessage,
  isKnownNotificationEventType,
  listNotificationEventTypes,
  NOTIFICATION_EVENT_META,
} from './event_catalog';

describe('notification event catalog', () => {
  it('every event type has a titleKey and renders without throwing on empty params', () => {
    for (const type of listNotificationEventTypes()) {
      const meta = NOTIFICATION_EVENT_META[type];
      expect(typeof meta.titleKey).toBe('string');
      expect(meta.titleKey.length).toBeGreaterThan(0);
      // Rendering must be defensive against empty params (never throw).
      const msg = buildNotificationMessage(type, {}, 'en');
      expect(typeof msg.text).toBe('string');
      expect(msg.text.length).toBeGreaterThan(0);
    }
  });

  it('renders workflow.failed with slug + error', () => {
    const text = buildNotificationMessage(
      'workflow.failed',
      { workflowSlug: 'nightly-sync', error: 'boom' },
      'en',
    ).text;
    expect(text).toContain('nightly-sync');
    expect(text).toContain('boom');
  });

  it('localizes the workflow headline by org locale', () => {
    expect(
      buildNotificationMessage('workflow.failed', { workflowSlug: 'x' }, 'de')
        .text,
    ).toContain('fehlgeschlagen');
    expect(
      buildNotificationMessage('workflow.failed', { workflowSlug: 'x' }, 'fr')
        .text,
    ).toContain('échoué');
  });

  it('security.alert renders real text from i18n keys + params, not the raw key', () => {
    const text = buildNotificationMessage(
      'security.alert',
      {
        titleKey: 'accountLocked',
        bodyKey: 'lockoutDetails',
        params: { email: 'a@b.com', consecutiveFailures: 5, ip: '1.2.3.4' },
      },
      'en',
    ).text;
    expect(text).toContain('Account temporarily locked: a@b.com');
    expect(text).toContain('5 failed sign-in attempts from 1.2.3.4');
    expect(text).not.toContain('accountLocked');
    expect(text).not.toContain('lockoutDetails');
  });

  it('escapes Slack mrkdwn control chars in interpolated values', () => {
    const text = buildNotificationMessage(
      'security.alert',
      { titleKey: 'accountLocked', params: { email: '<a&b>' } },
      'en',
    ).text;
    expect(text).toContain('&lt;a&amp;b&gt;');
  });

  it('guards unknown event types', () => {
    expect(isKnownNotificationEventType('workflow.failed')).toBe(true);
    expect(isKnownNotificationEventType('made.up')).toBe(false);
  });
});
