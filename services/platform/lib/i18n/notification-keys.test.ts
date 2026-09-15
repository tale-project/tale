/**
 * Regression guard for the Notifications bell (issue #2055).
 *
 * The bell renders a stored `titleKey`/`bodyKey` under a fixed namespace and
 * interpolates the row's `params`. Two ways it used to show raw template text:
 *
 *   1. Agent budget / circuit-breaker org notifications referenced six keys
 *      (`agentBudget*`, `agentCircuit*`) that did not exist in the
 *      `notifications` namespace, so the bell printed the raw key string.
 *   2. `task_review_requested` used a single body with an `{agentSlug}`
 *      placeholder; when no agent slug was present the bell printed the raw
 *      `{agentSlug}` token.
 *
 * These tests assert the keys exist in every base locale and that, given the
 * params the Convex mutations actually pass, nothing renders as a raw key or a
 * leftover `{placeholder}` — including the no-agentSlug path. None of these
 * messages use ICU plural/select, so plain `{name}` interpolation (i18next is
 * configured with `escapeValue: false`, prefix `{`, suffix `}`) models the
 * real render faithfully.
 */

import { describe, expect, it } from 'vitest';

import deMessages from '@/messages/de.yml';
import enMessages from '@/messages/en.yml';
import frMessages from '@/messages/fr.yml';

type Bundle = Record<string, Record<string, string>>;

const LOCALES: Record<string, Bundle> = {
  en: enMessages,
  de: deMessages,
  fr: frMessages,
};

/** Substitute `{name}` placeholders the way i18next does (no ICU here). */
function render(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (raw, name: string) =>
    name in params ? String(params[name]) : raw,
  );
}

/** Any `{...}` left after substitution is an unfilled placeholder. */
function hasRawPlaceholder(s: string): boolean {
  return /\{\w+\}/.test(s);
}

// The keys + the params their Convex mutations pass, per namespace.
const NOTIFICATION_CASES: {
  key: string;
  params: Record<string, unknown>;
}[] = [
  {
    key: 'agentBudgetWarnTitle',
    params: {
      agentSlug: 'researcher',
      pct: 80,
      spent: '$8.00',
      monthly: '$10.00',
    },
  },
  {
    key: 'agentBudgetWarnBody',
    params: {
      agentSlug: 'researcher',
      pct: 80,
      spent: '$8.00',
      monthly: '$10.00',
    },
  },
  {
    key: 'agentBudgetExceededTitle',
    params: { agentSlug: 'researcher', spent: '$10.00', monthly: '$10.00' },
  },
  {
    key: 'agentBudgetExceededBody',
    params: { agentSlug: 'researcher', spent: '$10.00', monthly: '$10.00' },
  },
  {
    key: 'agentCircuitTrippedTitle',
    params: {
      agentSlug: 'researcher',
      taskTitle: 'Ship it',
      windowRuns: 5,
      windowHours: 1,
    },
  },
  {
    key: 'agentCircuitTrippedBody',
    params: {
      agentSlug: 'researcher',
      taskTitle: 'Ship it',
      windowRuns: 5,
      windowHours: 1,
    },
  },
];

describe('notifications namespace — agent budget & circuit-breaker keys', () => {
  for (const [locale, bundle] of Object.entries(LOCALES)) {
    for (const { key, params } of NOTIFICATION_CASES) {
      it(`${locale}: ${key} exists and fully substitutes`, () => {
        const template = bundle.notifications?.[key];
        expect(
          template,
          `missing notifications.${key} in ${locale}`,
        ).toBeTruthy();
        expect(hasRawPlaceholder(render(template, params))).toBe(false);
      });
    }
  }
});

describe('inbox.taskReviewRequested — no raw {agentSlug} when slug is absent', () => {
  for (const [locale, bundle] of Object.entries(LOCALES)) {
    it(`${locale}: with an agent slug, the body names the agent`, () => {
      const template = bundle.inbox?.taskReviewRequestedBody;
      expect(template).toBeTruthy();
      const out = render(template, {
        agentSlug: 'researcher',
        taskTitle: 'Ship it',
      });
      expect(hasRawPlaceholder(out)).toBe(false);
      expect(out).toContain('researcher');
    });

    it(`${locale}: with no agent slug, the fallback body fully substitutes`, () => {
      const template = bundle.inbox?.taskReviewRequestedBodyNoAgent;
      expect(
        template,
        `missing inbox.taskReviewRequestedBodyNoAgent in ${locale}`,
      ).toBeTruthy();
      // The no-agent fallback must not reference agentSlug at all.
      expect(template).not.toContain('{agentSlug}');
      const out = render(template, { taskTitle: 'Ship it' });
      expect(hasRawPlaceholder(out)).toBe(false);
    });
  }
});

// The cloud-sync failure rows (`domains/onedrive/sync-health.ts`) carry the
// vendor, the synced item and the run's error; the bell renders the title
// WITHOUT params, so a title with a placeholder would print it raw.
const CLOUD_SYNC_PARAMS = {
  provider: 'OneDrive',
  itemName: 'Reports',
  reason: 'HTTP 503 throttled',
};

describe('inbox.cloudSync* — the sync-failure bell rows', () => {
  for (const [locale, bundle] of Object.entries(LOCALES)) {
    for (const title of ['cloudSyncFailed', 'cloudSyncNeedsReauth']) {
      it(`${locale}: ${title} is a static title`, () => {
        const template = bundle.inbox?.[title];
        expect(template, `missing inbox.${title} in ${locale}`).toBeTruthy();
        expect(hasRawPlaceholder(template)).toBe(false);
      });
    }
    for (const body of ['cloudSyncFailedBody', 'cloudSyncNeedsReauthBody']) {
      it(`${locale}: ${body} fully substitutes and names the item`, () => {
        const template = bundle.inbox?.[body];
        expect(template, `missing inbox.${body} in ${locale}`).toBeTruthy();
        const out = render(template, CLOUD_SYNC_PARAMS);
        expect(hasRawPlaceholder(out)).toBe(false);
        expect(out).toContain('Reports');
        expect(out).toContain('OneDrive');
      });
    }
  }
});
