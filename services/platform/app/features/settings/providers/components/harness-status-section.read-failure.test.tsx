import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import type { HarnessStatus } from '../hooks/queries';
import { HarnessStatusSection } from './harness-status-section';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3891: when the harness-health read failed, every runtime lost its
// "Recently failing" badge and nothing said why, so a runtime that kept
// failing looked healthy. Both reads run for real here (hooks, adapter rows,
// `backendFetch`, the four-attempt retry policy) against a closed synthetic
// transport.

const STATUS = /^GET \/api\/app\/providers\/harness-status\?orgId=org-1$/;
const HEALTH = /^GET \/api\/app\/sandbox\/harness-health\?orgId=org-1$/;

const ROWS: HarnessStatus[] = [
  {
    slug: 'claude-code',
    label: 'Claude Code',
    managed: {
      available: true,
      modelCount: 2,
      defaultModelId: 'deepseek/deepseek-v3.2',
    },
    subscriptions: [],
  },
  {
    slug: 'codex',
    label: 'Codex',
    managed: {
      available: true,
      modelCount: 1,
      defaultModelId: 'openai/gpt-5.5',
    },
    subscriptions: [],
  },
];

/** Claude Code failed four of its last five turns; Codex is fine. */
const CLAUDE_FAILING = [
  { harness: 'claude-code', recentTotal: 5, recentFailures: 4, degraded: true },
  { harness: 'codex', recentTotal: 3, recentFailures: 0, degraded: false },
];

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  backend.on(STATUS, () => Response.json({ statuses: ROWS }));
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderSection() {
  return render(
    <QueryClientProvider client={client}>
      <HarnessStatusSection
        organizationId="org-1"
        displayNames={new Map<string, string>()}
      />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'settings' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const runtimes = () =>
  screen.getByRole('list', { name: t('providers.harnesses.title') });
const failingBadge = () =>
  screen.queryByText(t('providers.harnesses.degraded'));

/** Both reads have settled — nothing is in flight or waiting on a retry. */
async function settled() {
  await screen.findByText('Claude Code');
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

describe(
  'HarnessStatusSection when the harness-health read fails',
  { timeout: 30_000 },
  () => {
    it('marks the runtime the health read flags as failing', async () => {
      backend.on(HEALTH, () => Response.json({ health: CLAUDE_FAILING }));
      renderSection();

      // A control that holds before and after #3891: no list name needed.
      const badge = await screen.findByText(t('providers.harnesses.degraded'));
      expect(screen.getAllByRole('listitem')[0]).toContainElement(badge);
      expect(
        screen.getAllByText(t('providers.harnesses.degraded')),
      ).toHaveLength(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('marks nothing and says nothing when the health read answers with no failures', async () => {
      backend.on(HEALTH, () => Response.json({ health: [] }));
      renderSection();
      await settled();

      expect(failingBadge()).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
      expect(backend.count(HEALTH)).toBe(1);
    });

    it('keeps the runtimes, says their health is unknown and recovers on Try again', async () => {
      backend.on(HEALTH, () => serviceUnavailable());
      const { user } = renderSection();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        t('providers.harnesses.healthLoadFailed'),
      );
      expect(backend.count(HEALTH)).toBe(4);
      // The status read answered: its rows stay, unmarked but not called
      // healthy, and the status read is not retried for the health read.
      expect(within(runtimes()).getByText('Claude Code')).toBeVisible();
      expect(
        within(runtimes()).getByText(
          '2 models · default deepseek/deepseek-v3.2',
        ),
      ).toBeVisible();
      expect(failingBadge()).not.toBeInTheDocument();
      expect(backend.count(STATUS)).toBe(1);
      // The failed read shows no toast; the section says it.
      expect(document.querySelector('li[data-swipe-direction]')).toBeNull();

      backend.on(HEALTH, () => Response.json({ health: CLAUDE_FAILING }));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));

      const badge = await screen.findByText(t('providers.harnesses.degraded'));
      expect(within(runtimes()).getAllByRole('listitem')[0]).toContainElement(
        badge,
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      // The Try again that held the focus is gone: the focus is on the
      // runtime list, where the answer shows, not on the page.
      await waitFor(() => expect(runtimes()).toHaveFocus());
    });

    it('keeps Try again busy and focused while it runs, and says so afresh when it fails again', async () => {
      backend.on(HEALTH, () => serviceUnavailable());
      const { user } = renderSection();
      const alert = await screen.findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });

      let answer: (response: Response) => void = () => {};
      backend.on(
        HEALTH,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      await user.click(retry);

      // react-query resets a read that never answered to `pending` as the
      // retry starts; the notice holds still, its button busy and focused.
      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(retry).toHaveFocus();
      expect(screen.getByRole('alert')).toBe(alert);
      expect(failingBadge()).not.toBeInTheDocument();

      backend.on(HEALTH, () => serviceUnavailable());
      answer(serviceUnavailable());
      await waitFor(() => expect(backend.count(HEALTH)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(screen.getByRole('alert')).toBe(alert);
      expect(alert).toHaveTextContent(
        t('providers.harnesses.healthLoadFailed'),
      );
      expect(retry).toHaveFocus();
      expect(within(runtimes()).getByText('Claude Code')).toBeVisible();
    });

    it('keeps the last marks through a failed refresh and says they may be out of date', async () => {
      backend.on(HEALTH, () => Response.json({ health: CLAUDE_FAILING }));
      const { user } = renderSection();
      await screen.findByText(t('providers.harnesses.degraded'));

      backend.on(HEALTH, () => serviceUnavailable());
      void client.invalidateQueries();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        t('providers.harnesses.healthRefreshFailed'),
      );
      expect(failingBadge()).toBeVisible();

      // Meanwhile Claude Code recovered.
      backend.on(HEALTH, () => Response.json({ health: [] }));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      await waitFor(() => expect(failingBadge()).not.toBeInTheDocument());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(within(runtimes()).getByText('Claude Code')).toBeVisible();
      await waitFor(() => expect(runtimes()).toHaveFocus());
    });

    it('passes an axe audit with the failure shown', async () => {
      backend.on(HEALTH, () => serviceUnavailable());
      const { container } = renderSection();
      await screen.findByRole('alert');

      await checkAccessibility(container);
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failed health read and its retry in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(HEALTH, () => serviceUnavailable());
        renderSection();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
          t('providers.harnesses.healthLoadFailed'),
        );
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        for (const key of [
          'providers.harnesses.healthLoadFailed',
          'providers.harnesses.healthRefreshFailed',
        ]) {
          expect(t(key)).not.toBe(key);
          // A translation of its own, not the English fallback.
          if (locale !== 'en') {
            expect(t(key)).not.toBe(i18n.t(key, { ns: 'settings', lng: 'en' }));
          }
        }
      });
    });
  },
);
