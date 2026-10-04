import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeedbackMetricsPage } from '@/app/features/analytics/feedback/feedback-metrics-page';
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

import { UsageMetricsPage } from './usage-metrics-page';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3641: a usage read that failed showed zero requests, tokens and active
// users — the same page an organization with no usage gets. The whole read
// lane runs for real here — `useBackendQuery`, the adapter row,
// `backendFetch` and the read retry policy (four attempts for a fault) —
// against a closed synthetic transport, so the same mounted page can be
// watched failing and recovering.

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
// The breakdown tables read the org id from the router.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const USAGE = /^GET \/api\/app\/governance\/usage-metrics\?/;
const FEEDBACK_STATS = /^GET \/api\/app\/feedback\/stats\?/;
const FEEDBACK_RECENT = /^GET \/api\/app\/feedback\/recent\?/;

function usageAnswer(summary: {
  totalRequests: number;
  totalTokens: number;
  totalCostCents: number;
  activeUsers: number;
}) {
  return () =>
    Response.json({
      summary: { ...summary, capped: false },
      series: [],
      topAgents: [],
      topModels: [],
      topVoiceModels: [],
      users: [],
    });
}

const MEASURED = usageAnswer({
  totalRequests: 4321,
  totalTokens: 98765,
  totalCostCents: 789,
  activeUsers: 7,
});
const NO_USAGE = usageAnswer({
  totalRequests: 0,
  totalTokens: 0,
  totalCostCents: 0,
  activeUsers: 0,
});

/** The alert's own sentence in each shipped locale — the catalog entries
 * the alert must read, pinned here so a missing translation fails. */
const LOAD_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't load usage metrics.",
  de: 'Nutzungs-Metriken konnten nicht geladen werden.',
  fr: "Impossible de charger les métriques d'utilisation.",
};
const TRY_AGAIN: Record<ShippedLocale, string> = {
  en: 'Try again',
  de: 'Erneut versuchen',
  fr: 'Réessayer',
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/settings/metrics/usage',
  );
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderUsage() {
  return render(
    <QueryClientProvider client={client}>
      <UsageMetricsPage organizationId="org-1" />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'analytics' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const usageRegion = () =>
  screen.getByRole('region', { name: t('usage.title') });

describe('UsageMetricsPage when its read fails', { timeout: 30_000 }, () => {
  it('shows a failed read as a failure with Try again, never as zero usage, and recovers in place', async () => {
    backend.on(USAGE, () => serviceUnavailable());
    const { user } = renderUsage();

    const alert = await screen.findByRole('alert');
    // The policy's four attempts, then the failure — not a dashboard.
    expect(backend.count(USAGE)).toBe(4);
    expect(alert).toHaveTextContent(t('usage.errors.loadFailed'));
    // No figure was read, so none is shown: not a zero card, not an empty
    // table claiming there is no usage.
    expect(screen.queryByText(t('usage.cards.totalRequests'))).toBeNull();
    expect(screen.queryByText(t('usage.cards.activeUsers'))).toBeNull();
    expect(screen.queryByText(t('usage.empty.title'))).toBeNull();
    // The page and its controls stay: the heading, and the Filter that
    // holds the period, granularity and metric.
    expect(
      screen.getByRole('heading', { name: t('usage.title') }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: i18n.t('labels.filter', { ns: 'common' }),
      }),
    ).toBeEnabled();

    // The same mounted page recovers on Try again, with no reload.
    backend.on(USAGE, MEASURED);
    const retry = within(alert).getByRole('button', { name: tryAgain() });
    await user.click(retry);
    expect(await screen.findByText('4,321')).toBeInTheDocument();
    expect(screen.getByText(t('usage.cards.totalRequests'))).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(backend.count(USAGE)).toBe(5);
    // The focused Try again went with the alert: its focus lands on the
    // usage region, not on the page.
    await waitFor(() => expect(usageRegion()).toHaveFocus());
  });

  it('keeps a focused Try again focused, and busy, while the retry runs and fails again', async () => {
    backend.on(USAGE, () => serviceUnavailable());
    const { user } = renderUsage();
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: tryAgain() });

    // Hold the retry's first attempt so the busy state can be read.
    let release: () => void = () => undefined;
    backend.on(
      USAGE,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(serviceUnavailable());
        }),
    );
    await user.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    // While it runs, the failure stays named: no skeleton, no zero.
    expect(screen.getByRole('alert')).toBe(alert);
    expect(screen.queryByText(t('usage.cards.totalRequests'))).toBeNull();
    expect(retry).toHaveFocus();

    backend.on(USAGE, () => serviceUnavailable());
    release();
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      t('usage.errors.loadFailed'),
    );
    expect(retry).toHaveFocus();
  });

  it('keeps measured zero usage for an organization that has none', async () => {
    backend.on(USAGE, NO_USAGE);
    renderUsage();

    expect(
      await screen.findByText(t('usage.cards.totalRequests')),
    ).toBeVisible();
    expect(screen.getByText(t('usage.cards.activeUsers'))).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.queryByText(t('usage.errors.loadFailed')),
    ).not.toBeInTheDocument();
  });

  it('keeps the figures through a failed refresh and says they may be out of date', async () => {
    backend.on(USAGE, MEASURED);
    const { user } = renderUsage();
    await screen.findByText('4,321');

    // A background refresh (the tab regaining focus) fails.
    backend.on(USAGE, () => serviceUnavailable());
    void client.invalidateQueries();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('usage.errors.refreshFailed'));
    expect(screen.getByText('4,321')).toBeVisible();

    backend.on(USAGE, NO_USAGE);
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('4,321')).not.toBeInTheDocument();
  });

  it.each(SHIPPED_LOCALES)(
    'names the failure and Try again in the reader’s language (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      backend.on(USAGE, () => serviceUnavailable());
      renderUsage();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(LOAD_FAILED[locale]);
      expect(
        within(alert).getByRole('button', { name: TRY_AGAIN[locale] }),
      ).toBeInTheDocument();
    },
  );

  it('passes axe audit in its failed state', async () => {
    backend.on(USAGE, () => serviceUnavailable());
    const { container } = renderUsage();
    await screen.findByRole('alert');
    await checkAccessibility(container);
  });
});

// The control the report compares against: Feedback, under the same failed
// read, already names it.
describe('FeedbackMetricsPage when its read fails', { timeout: 30_000 }, () => {
  it('shows its load-failed alert, not empty feedback metrics', async () => {
    window.history.replaceState(
      {},
      '',
      '/dashboard/org-1/settings/metrics/feedback',
    );
    backend.on(FEEDBACK_STATS, () => serviceUnavailable());
    backend.on(FEEDBACK_RECENT, () =>
      Response.json({ page: [], isDone: true, continueCursor: '' }),
    );
    render(
      <QueryClientProvider client={client}>
        <FeedbackMetricsPage
          organizationId="org-1"
          period="7"
          kind="all"
          withCommentOnly={false}
          onChangePeriod={vi.fn()}
          onChangeKind={vi.fn()}
          onToggleCommentOnly={vi.fn()}
          onSelectAgent={vi.fn()}
          onSelectModel={vi.fn()}
          onClearFilters={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const alert = await screen.findByRole('alert');
    expect(backend.count(FEEDBACK_STATS)).toBe(4);
    expect(alert).toHaveTextContent(t('feedback.errors.loadFailed'));
  });
});
