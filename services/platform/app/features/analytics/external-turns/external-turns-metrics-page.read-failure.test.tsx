import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReturnsOf } from '@/app/lib/backend/contract';
import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
  type ShippedLocale,
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

import { ExternalTurnMetricsPage } from './external-turns-metrics-page';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3868: a harness-turn read that failed showed zero turns, em-dash rates and
// "No harness turns have run in the selected period" — the page a quiet
// period gets. The whole read lane runs for real here — `useBackendQuery`,
// the adapter row, `backendFetch` and the read retry policy (four attempts
// for a fault) — against a closed synthetic transport, so the same mounted
// page can be watched failing and recovering.

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));

const TURNS = /^GET \/api\/app\/sandbox\/external-turn-metrics\?/;

type ExternalTurnMetrics = NonNullable<
  ReturnsOf<'sandbox/session_queries_public:getExternalTurnMetrics'>
>;

const NO_TURNS: ExternalTurnMetrics = {
  periodDays: 30,
  capped: false,
  total: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  timeout: 0,
  recovered: 0,
  successRate: null,
  timeoutRate: null,
  durationP50Ms: 0,
  durationP95Ms: 0,
  spentCents: 0,
  byHarness: [],
};

const MEASURED: ExternalTurnMetrics = {
  ...NO_TURNS,
  total: 20,
  completed: 15,
  failed: 3,
  cancelled: 1,
  timeout: 1,
  recovered: 2,
  successRate: 15 / 19,
  timeoutRate: 1 / 19,
  durationP50Ms: 4000,
  durationP95Ms: 12000,
  spentCents: 250,
  byHarness: [
    {
      harness: 'claude-code',
      total: 12,
      completed: 10,
      failed: 1,
      timeout: 1,
      successRate: 10 / 12,
    },
  ],
};

const answer = (metrics: ExternalTurnMetrics) => () => Response.json(metrics);

/** The alert's own sentence in each shipped locale — the catalog entries
 * the alert must read, pinned here so a missing translation fails. */
const LOAD_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't load harness turn metrics.",
  de: 'Die Metriken der Harness-Runden konnten nicht geladen werden.',
  fr: 'Impossible de charger les métriques des tours de harness.',
};
const REFRESH_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't refresh harness turn metrics. The figures shown may be out of date.",
  de: 'Die Metriken der Harness-Runden konnten nicht aktualisiert werden. Die angezeigten Zahlen sind möglicherweise veraltet.',
  fr: "Impossible d'actualiser les métriques des tours de harness. Les chiffres affichés peuvent être obsolètes.",
};
const TRY_AGAIN: Record<ShippedLocale, string> = {
  en: 'Try again',
  de: 'Erneut versuchen',
  fr: 'Réessayer',
};

let backend: SyntheticBackend;
let client: QueryClient;
const onChangePeriod = vi.fn();

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/settings/metrics/external-turns',
  );
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  onChangePeriod.mockReset();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderTurns(periodDays: 7 | 30 | 90 = 30) {
  return render(
    <QueryClientProvider client={client}>
      <ExternalTurnMetricsPage
        organizationId="org-1"
        periodDays={periodDays}
        onChangePeriod={onChangePeriod}
      />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'analytics' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const turnsRegion = () =>
  screen.getByRole('region', { name: t('externalTurns.title') });

describe(
  'ExternalTurnMetricsPage when its read fails',
  { timeout: 30_000 },
  () => {
    it('shows a failed read as a failure with Try again, never as a period with no turns, and recovers in place', async () => {
      backend.on(TURNS, () => serviceUnavailable());
      const { user } = renderTurns();

      const alert = await screen.findByRole('alert');
      // The policy's four attempts, then the failure — not a dashboard.
      expect(backend.count(TURNS)).toBe(4);
      expect(alert).toHaveTextContent(LOAD_FAILED.en);
      // No figure was read, so none is shown: no zero or em-dash SLO card, no
      // per-harness table claiming nothing ran.
      expect(screen.queryByText(t('externalTurns.cards.total'))).toBeNull();
      expect(
        screen.queryByText(t('externalTurns.cards.successRate')),
      ).toBeNull();
      expect(screen.queryByText(t('externalTurns.byHarness.title'))).toBeNull();
      expect(screen.queryByText(t('externalTurns.byHarness.empty'))).toBeNull();
      expect(screen.queryByText('0')).toBeNull();
      expect(screen.queryByText('—')).toBeNull();
      // The page and its period control stay.
      expect(
        screen.getByRole('heading', { name: t('externalTurns.title') }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: i18n.t('labels.filter', { ns: 'common' }),
        }),
      ).toBeEnabled();

      // The same mounted page recovers on Try again, with no reload.
      backend.on(TURNS, answer(MEASURED));
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      await user.click(retry);
      expect(await screen.findByText('claude-code')).toBeInTheDocument();
      // 15 of 19 non-cancelled turns completed.
      expect(screen.getByText('79%')).toBeInTheDocument();
      expect(screen.getByText('12.0s')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(backend.count(TURNS)).toBe(5);
      // The focused Try again went with the alert: its focus lands on the
      // metrics region, not on the page.
      await waitFor(() => expect(turnsRegion()).toHaveFocus());
    });

    it('keeps a focused Try again focused, and busy, while the retry runs and fails again', async () => {
      backend.on(TURNS, () => serviceUnavailable());
      const { user } = renderTurns();
      const alert = await screen.findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });

      // Hold the retry's first attempt so the busy state can be read.
      let release: () => void = () => undefined;
      backend.on(
        TURNS,
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(serviceUnavailable());
          }),
      );
      await user.click(retry);
      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      // While it runs, the failure stays named: no skeleton, no empty period.
      expect(screen.getByRole('alert')).toBe(alert);
      expect(retry).toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByText(t('externalTurns.cards.total'))).toBeNull();
      expect(screen.queryByText(t('externalTurns.byHarness.empty'))).toBeNull();
      expect(retry).toHaveFocus();
      // A busy Try again starts nothing more.
      await user.click(retry);
      expect(backend.count(TURNS)).toBe(5);

      backend.on(TURNS, () => serviceUnavailable());
      release();
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
      expect(backend.count(TURNS)).toBe(8);
      expect(screen.getByRole('alert')).toHaveTextContent(LOAD_FAILED.en);
      expect(
        within(screen.getByRole('alert')).getByRole('button', {
          name: tryAgain(),
        }),
      ).toBe(retry);
      expect(retry).toHaveFocus();
    });

    it.each([7, 30, 90] as const)(
      'retries the read for the selected %s-day period, without changing it',
      async (periodDays) => {
        backend.on(TURNS, () => serviceUnavailable());
        const { user } = renderTurns(periodDays);
        const alert = await screen.findByRole('alert');

        backend.on(TURNS, answer({ ...MEASURED, periodDays }));
        await user.click(
          within(alert).getByRole('button', { name: tryAgain() }),
        );
        await screen.findByText('claude-code');

        // Every attempt, the retry included, asked for the selected period.
        expect(
          new Set(backend.calls.filter((call) => TURNS.test(call))),
        ).toEqual(
          new Set([
            `GET /api/app/sandbox/external-turn-metrics?periodDays=${periodDays}&orgId=org-1`,
          ]),
        );
        expect(backend.count(TURNS)).toBe(5);
        expect(onChangePeriod).not.toHaveBeenCalled();
      },
    );

    it('keeps the figures through a failed refresh and says they may be out of date', async () => {
      backend.on(TURNS, answer(MEASURED));
      const { user } = renderTurns();
      await screen.findByText('claude-code');

      // A background refresh (an event hint, the tab regaining focus) fails.
      backend.on(TURNS, () => serviceUnavailable());
      void client.invalidateQueries();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(REFRESH_FAILED.en);
      expect(screen.getByText('79%')).toBeVisible();
      expect(screen.getByText('claude-code')).toBeVisible();
      expect(screen.queryByText(t('externalTurns.byHarness.empty'))).toBeNull();

      // A retry that answers a quiet period shows it as one, and hands the
      // focus on Try again to the region.
      backend.on(TURNS, answer(NO_TURNS));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(screen.queryByText('claude-code')).not.toBeInTheDocument();
      expect(
        screen.getByText(t('externalTurns.byHarness.empty')),
      ).toBeVisible();
      await waitFor(() => expect(turnsRegion()).toHaveFocus());
    });

    it('keeps a successful period with no turns as zero figures and the empty-period line', async () => {
      backend.on(TURNS, answer(NO_TURNS));
      renderTurns();

      // The line stands in, masked, while the read runs; wait for the answer.
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      const empty = screen.getByText(t('externalTurns.byHarness.empty'));
      expect(empty).toBeVisible();
      expect(empty).not.toHaveAttribute('aria-hidden');
      expect(screen.getByText(t('externalTurns.cards.total'))).toBeVisible();
      expect(screen.getAllByText('0').length).toBeGreaterThan(0);
      expect(screen.getAllByText('—').length).toBe(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(LOAD_FAILED.en)).not.toBeInTheDocument();
    });

    it('keeps the first read quiet: a skeleton, no failure and no empty-period line', async () => {
      let release: () => void = () => undefined;
      backend.on(
        TURNS,
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(Response.json(NO_TURNS));
          }),
      );
      renderTurns();

      expect(
        await screen.findByRole('status', { name: t('externalTurns.title') }),
      ).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('alert')).toBeNull();
      // The empty-period line is an answer: while none has arrived it is a
      // masked placeholder, hidden from assistive technology.
      const placeholder = screen.getByText(t('externalTurns.byHarness.empty'));
      expect(placeholder).toHaveAttribute('data-skeleton-mask', 'box');
      expect(placeholder).toHaveAttribute('aria-hidden', 'true');

      release();
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      const empty = screen.getByText(t('externalTurns.byHarness.empty'));
      expect(empty).not.toHaveAttribute('data-skeleton-mask');
      expect(empty).not.toHaveAttribute('aria-hidden');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(SHIPPED_LOCALES)(
      'names a failed read, a failed refresh and Try again in the reader’s language (%s)',
      async (locale) => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(TURNS, () => serviceUnavailable());
        const { user } = renderTurns();

        const failed = await screen.findByRole('alert');
        expect(failed).toHaveTextContent(LOAD_FAILED[locale]);
        backend.on(TURNS, answer(MEASURED));
        await user.click(
          within(failed).getByRole('button', { name: TRY_AGAIN[locale] }),
        );
        await screen.findByText('claude-code');

        backend.on(TURNS, () => serviceUnavailable());
        void client.invalidateQueries();
        const stale = await screen.findByRole('alert');
        expect(stale).toHaveTextContent(REFRESH_FAILED[locale]);
        expect(
          within(stale).getByRole('button', { name: TRY_AGAIN[locale] }),
        ).toBeInTheDocument();
      },
    );

    it('passes axe audit in its failed state', async () => {
      backend.on(TURNS, () => serviceUnavailable());
      const { container } = renderTurns();
      await screen.findByRole('alert');
      await checkAccessibility(container);
    });
  },
);
