import { describe, expect, it } from 'vitest';

import deMessages from '../../messages/de.yml';
import enMessages from '../../messages/en.yml';
import frMessages from '../../messages/fr.yml';
import {
  ACTIONABLE_INBOX_KEYS,
  escapeSlackText,
  INBOX_I18N,
  NOTIFICATIONS_I18N,
  renderActionableEmailContent,
  renderInboxMessage,
  renderNotificationMessage,
  SUPPORTED_NOTIFICATION_LOCALES,
} from './notification_messages';

const BUNDLES = {
  en: enMessages,
  de: deMessages,
  fr: frMessages,
} as const;

function pickActionableInbox(
  bundle: (typeof BUNDLES)[keyof typeof BUNDLES],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ACTIONABLE_INBOX_KEYS) {
    if (key.startsWith('email.')) {
      const subKey = key.slice('email.'.length);
      result[key] =
        bundle.inbox.email[subKey as keyof typeof bundle.inbox.email];
    } else {
      const value = bundle.inbox[key as keyof typeof bundle.inbox];
      if (typeof value !== 'string') {
        throw new Error(`Expected inbox.${key} to be a string`);
      }
      result[key] = value;
    }
  }
  return result;
}

describe('notification_messages parity', () => {
  // The server-side copy MUST mirror the `notifications` namespace of the
  // client message bundles. This guard fails CI if a notification string is
  // edited in messages/ without updating the server copy (which would silently
  // ship a stale/raw string to Slack).
  for (const locale of SUPPORTED_NOTIFICATION_LOCALES) {
    it(`mirrors the ${locale} notifications namespace exactly`, () => {
      expect(NOTIFICATIONS_I18N[locale]).toEqual(BUNDLES[locale].notifications);
    });

    it(`mirrors the ${locale} actionable inbox keys exactly`, () => {
      expect(INBOX_I18N[locale]).toEqual(pickActionableInbox(BUNDLES[locale]));
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

describe('renderInboxMessage', () => {
  it('interpolates task assignment copy', () => {
    expect(
      renderInboxMessage('en', 'taskAssignedByBody', {
        actor: 'Alex',
        title: 'Ship it',
      }),
    ).toBe('Alex assigned you to "Ship it".');
  });
});

describe('renderActionableEmailContent', () => {
  it('includes a deep link and footer in plain text', () => {
    const content = renderActionableEmailContent('en', {
      titleKey: 'taskAssigned',
      bodyKey: 'taskAssignedBody',
      params: { title: 'Ship it', projectId: 'proj_1' },
      deepLink:
        'https://app.example.com/dashboard/org_1/projects/proj_1/tasks?task=task_1',
    });
    expect(content.subject).toBe('Task assigned to you');
    expect(content.text).toContain('You were assigned "Ship it".');
    expect(content.text).toContain('Open in Tale: https://app.example.com');
    expect(content.text).toContain('notifications enabled in Tale');
    expect(content.html).toContain('href="https://app.example.com');
  });
});

describe('escapeSlackText', () => {
  it('escapes & < > in order', () => {
    expect(escapeSlackText('<a> & <b>')).toBe('&lt;a&gt; &amp; &lt;b&gt;');
  });
});
