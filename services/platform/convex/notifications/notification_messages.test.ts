import { describe, expect, it } from 'vitest';

import deMessages from '../../messages/de.json';
import enMessages from '../../messages/en.json';
import frMessages from '../../messages/fr.json';
import {
  escapeSlackText,
  NOTIFICATIONS_I18N,
  renderNotificationMessage,
  SUPPORTED_NOTIFICATION_LOCALES,
} from './notification_messages';

const BUNDLES = {
  en: enMessages,
  de: deMessages,
  fr: frMessages,
} as const;

describe('notification_messages parity', () => {
  // The server-side copy MUST mirror the `notifications` namespace of the
  // client message bundles. This guard fails CI if a notification string is
  // edited in messages/ without updating the server copy (which would silently
  // ship a stale/raw string to Slack).
  for (const locale of SUPPORTED_NOTIFICATION_LOCALES) {
    it(`mirrors the ${locale} notifications namespace exactly`, () => {
      expect(NOTIFICATIONS_I18N[locale]).toEqual(BUNDLES[locale].notifications);
    });
  }
});

describe('renderNotificationMessage', () => {
  it('interpolates named placeholders', () => {
    expect(
      renderNotificationMessage('en', 'accountLocked', { email: 'a@b.com' }),
    ).toBe('Account temporarily locked: a@b.com');
  });

  it('renders the requested locale', () => {
    expect(renderNotificationMessage('de', 'dsarScheduled')).toBe(
      'Löschungsanfrage geplant',
    );
    expect(renderNotificationMessage('fr', 'dsarScheduled')).toBe(
      "Demande d'effacement planifiée",
    );
  });

  it('falls back to English for an unknown locale', () => {
    expect(renderNotificationMessage('it', 'dsarScheduled')).toBe(
      'Erasure request scheduled',
    );
  });

  it('renders the Slack-only workflow strings', () => {
    expect(
      renderNotificationMessage('en', 'workflowFailed', { slug: 'x' }),
    ).toBe('Workflow *x* failed');
  });

  it('escapes Slack mrkdwn control chars in interpolated values', () => {
    expect(
      renderNotificationMessage('en', 'accountLocked', { email: '<a&b>' }),
    ).toBe('Account temporarily locked: &lt;a&amp;b&gt;');
  });

  it('leaves an unmatched placeholder intact', () => {
    expect(renderNotificationMessage('en', 'accountLocked', {})).toBe(
      'Account temporarily locked: {email}',
    );
  });

  it('returns the key for an unknown key', () => {
    expect(renderNotificationMessage('en', 'totally-made-up')).toBe(
      'totally-made-up',
    );
  });
});

describe('escapeSlackText', () => {
  it('escapes & < > in order', () => {
    expect(escapeSlackText('<a> & <b>')).toBe('&lt;a&gt; &amp; &lt;b&gt;');
  });
});
