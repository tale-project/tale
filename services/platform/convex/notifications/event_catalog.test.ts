import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_EVENTS,
  isKnownNotificationEventType,
  listNotificationEventTypes,
} from './event_catalog';

describe('notification event catalog', () => {
  it('every event type has a titleKey and a working buildMessage', () => {
    for (const type of listNotificationEventTypes()) {
      const entry = NOTIFICATION_EVENTS[type];
      expect(typeof entry.titleKey).toBe('string');
      expect(entry.titleKey.length).toBeGreaterThan(0);
      // buildMessage must be defensive against empty params (never throw).
      const msg = entry.buildMessage({});
      expect(typeof msg.text).toBe('string');
      expect(msg.text.length).toBeGreaterThan(0);
    }
  });

  it('renders provided params', () => {
    expect(
      NOTIFICATION_EVENTS['workflow.failed'].buildMessage({
        workflowSlug: 'nightly-sync',
        error: 'boom',
      }).text,
    ).toContain('nightly-sync');
    expect(
      NOTIFICATION_EVENTS['workflow.failed'].buildMessage({
        workflowSlug: 'nightly-sync',
        error: 'boom',
      }).text,
    ).toContain('boom');
  });

  it('guards unknown event types', () => {
    expect(isKnownNotificationEventType('workflow.failed')).toBe(true);
    expect(isKnownNotificationEventType('made.up')).toBe(false);
  });
});
