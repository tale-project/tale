import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  lapsedSessionRefusal,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen } from '@/tests/utils/render';

import { ChatHealthMetricsPage } from './chat-health-metrics-page';

// Pure, prop-driven render assertion (mirrors the usage metrics page test).
// The page owns TWO queries (chat health + guardrail stats), so the mock
// branches on the called function's name to serve each its fixture.
const fixtures = vi.hoisted(() => ({
  health: {
    summary: {
      totalTurns: 25,
      errorCount: 4,
      errorRate: 0.16,
      blockedCount: 1,
      blockedRate: 0.04,
      tokens: { input: 1000, output: 400, total: 1400 },
      capped: false,
      hasAnyData: true,
    },
    series: [{ dateKey: '2026-07-23', turns: 25, errors: 4, blocked: 1 }],
    byModel: [{ provider: 'openai', model: 'gpt-4o', count: 20 }],
    byAgent: [
      { agentSlug: 'helper', count: 15 },
      { agentSlug: '__unattributed__', count: 10 },
    ],
    errorsByType: [
      { key: 'rate_limited', count: 2 },
      { key: 'budget_exceeded', count: 1 },
      { key: 'thread_busy', count: 1 },
    ],
    recentErrors: [
      {
        at: Date.now(),
        type: 'rate_limited',
        model: 'gpt-4o',
        agentSlug: 'helper',
      },
    ],
  },
  /** What the chat-health read rejected with, when a test makes it fail. */
  healthError: undefined as unknown,
  guardrailsError: undefined as unknown,
  refetchGuardrails: vi.fn(),
  refetchHealth: vi.fn(),
  guardrails: {
    byKind: [
      { key: 'detected', count: 6 },
      { key: 'blocked', count: 2 },
    ],
    byFilter: [{ key: 'pii', count: 8 }],
    byDirection: [{ key: 'input', count: 8 }],
    byCategory: [{ key: 'email', count: 5 }],
    series: [{ dateKey: '2026-07-23', detected: 6, blocked: 2, errors: 0 }],
    capped: false,
  },
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string) =>
    name.includes('getGuardrailStats')
      ? {
          data: fixtures.guardrailsError ? undefined : fixtures.guardrails,
          isLoading: false,
          error: fixtures.guardrailsError,
          refetch: fixtures.refetchGuardrails,
        }
      : fixtures.healthError === undefined
        ? {
            data: fixtures.health,
            isLoading: false,
            refetch: fixtures.refetchHealth,
          }
        : { data: undefined, isLoading: false, error: fixtures.healthError },
}));

describe('ChatHealthMetricsPage', () => {
  it('renders the title, period control, cards, breakdowns, and guardrail stats', () => {
    render(
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="7"
        onChangePeriod={() => undefined}
      />,
    );

    // Page title + period control (its presence proves the page rendered past
    // its skeleton and its empty/error branches).
    expect(
      screen.getByRole('heading', { name: 'Chat health' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();

    // Summary card labels/values from surviving i18n keys.
    expect(screen.getByText('Assistant turns')).toBeInTheDocument();
    expect(screen.getByText('Error rate')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('16%')).toBeInTheDocument();

    // Model/agent breakdown rows (both also appear in the recent-errors list).
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0);
    expect(screen.getAllByText('helper').length).toBeGreaterThan(0);
    expect(screen.getByText('Unattributed')).toBeInTheDocument();

    // Errors section: classified type labels + the recent-errors list.
    // Every `CHAT_ERROR_CODES` entry needs its own
    // `chatHealth.errorType.<code>` label; the platform's own buckets
    // (`budget_exceeded`, `thread_busy`) shipped without one and printed
    // the raw key here.
    expect(screen.getAllByText('Rate limited').length).toBeGreaterThan(0);
    expect(screen.getByText('Usage limit reached')).toBeInTheDocument();
    expect(screen.getByText('Chat busy')).toBeInTheDocument();
    expect(screen.getByText('Recent errors')).toBeInTheDocument();

    // Guardrails section: kind/filter labels reuse the guardrails-overview
    // vocabulary from the governance namespace ('Detected' also appears in
    // the guardrail chart legend).
    expect(screen.getAllByText('Detected').length).toBeGreaterThan(0);
    expect(screen.getByText('PII')).toBeInTheDocument();
  });

  // The page rests on the last 7 days; showing that window is not a filter
  // the user set, so the Filter button carries no active dot until another
  // window is picked.
  it('marks the filter active only away from its resting 7-day window', () => {
    const { container, unmount } = render(
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="7"
        onChangePeriod={() => undefined}
      />,
    );
    expect(
      container.querySelector('[data-slot="active-filter-dot"]'),
    ).toBeNull();
    unmount();

    const other = render(
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="30"
        onChangePeriod={() => undefined}
      />,
    );
    expect(
      other.container.querySelector('[data-slot="active-filter-dot"]'),
    ).not.toBeNull();
  });

  it('passes axe audit in its loaded state', async () => {
    const { container } = render(
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="7"
        onChangePeriod={() => undefined}
      />,
    );
    await checkAccessibility(container);
  });
});

// The refusal's own `message` is its serialized payload; the error Alert used
// to show `{"code":"UNAUTHORIZED",…}` under its title.
describe('ChatHealthMetricsPage after a lapsed session', () => {
  afterEach(async () => {
    // Unmount first: the app shell still applying the saved language would
    // otherwise switch it back after the reset.
    cleanup();
    fixtures.healthError = undefined;
    await forgetSavedLocale();
  });

  it.each(SHIPPED_LOCALES)(
    'shows the session sentence instead of the serialized refusal (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      fixtures.healthError = await lapsedSessionRefusal().catch(
        (refusal: unknown) => refusal,
      );

      render(
        <ChatHealthMetricsPage
          organizationId="org-1"
          period="7"
          onChangePeriod={() => undefined}
        />,
      );

      expect(
        screen.getByText(
          i18n.t('chatHealth.errors.loadFailed', { ns: 'analytics' }),
        ),
      ).toBeVisible();
      expect(screen.getByText(SESSION_ENDED[locale])).toBeVisible();
      expect(screen.queryByText(/"code"/)).not.toBeInTheDocument();
    },
  );
});

describe('ChatHealthMetricsPage guardrail read failures', () => {
  const health = structuredClone(fixtures.health);
  const guardrails = structuredClone(fixtures.guardrails);

  beforeEach(() => {
    fixtures.health = structuredClone(health);
    fixtures.guardrails = structuredClone(guardrails);
    fixtures.healthError = undefined;
    fixtures.guardrailsError = undefined;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    cleanup();
    fixtures.health = structuredClone(health);
    fixtures.guardrails = structuredClone(guardrails);
    fixtures.healthError = undefined;
    fixtures.guardrailsError = undefined;
    await forgetSavedLocale();
  });

  function page() {
    return (
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="7"
        onChangePeriod={() => undefined}
      />
    );
  }

  it.each(SHIPPED_LOCALES)(
    'retains chat data and offers a localized guardrail retry (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      fixtures.guardrailsError = await lapsedSessionRefusal().catch(
        (refusal: unknown) => refusal,
      );
      render(page());
      expect(
        screen.getByText(
          i18n.t('chatHealth.errors.guardrailsLoadFailed', { ns: 'analytics' }),
          { exact: false },
        ),
      ).toBeVisible();
      expect(
        screen.getByText(SESSION_ENDED[locale], { exact: false }),
      ).toBeVisible();
      expect(screen.getByText('25')).toBeVisible();
      expect(
        screen.getByRole('button', {
          name: i18n.t('actions.tryAgain', { ns: 'common' }),
        }),
      ).toBeVisible();
      expect(screen.queryByText(/"code"/)).not.toBeInTheDocument();
    },
  );

  it('keeps the guardrail failure and Retry alongside the no-chat-data panel', () => {
    fixtures.health.summary.hasAnyData = false;
    fixtures.health.summary.totalTurns = 0;
    fixtures.guardrailsError = new Error('Guardrail read unavailable');
    render(page());
    expect(
      screen.getByText(i18n.t('chatHealth.empty.title', { ns: 'analytics' })),
    ).toBeVisible();
    expect(screen.getByText(/Guardrail read unavailable/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.queryByText('Assistant turns')).not.toBeInTheDocument();
  });

  it.each([true, false])(
    'Retry refetches only guardrails and recovery clears the failure (has chat data: %s)',
    async (hasAnyData) => {
      fixtures.health.summary.hasAnyData = hasAnyData;
      fixtures.guardrailsError = new Error('Guardrail read unavailable');
      const { user, rerender } = render(page());
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(fixtures.refetchGuardrails).toHaveBeenCalledExactlyOnceWith();
      expect(fixtures.refetchHealth).not.toHaveBeenCalled();
      fixtures.guardrailsError = undefined;
      rerender(page());
      expect(
        screen.queryByText(/Guardrail read unavailable/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
    },
  );

  it('treats a successful zero-events read as empty without a failure or Retry', () => {
    fixtures.guardrails = {
      byKind: [],
      byFilter: [],
      byDirection: [],
      byCategory: [],
      series: [],
      capped: false,
    };
    const { rerender } = render(page());
    expect(
      screen.getByText(
        i18n.t('chatHealth.guardrails.chart.noData', { ns: 'analytics' }),
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    fixtures.health.summary.hasAnyData = false;
    fixtures.health.summary.totalTurns = 0;
    rerender(page());
    expect(
      screen.getByText(i18n.t('chatHealth.empty.title', { ns: 'analytics' })),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('preserves the full chat-health failure instead of showing partial metrics', () => {
    fixtures.healthError = new Error('Chat health unavailable');
    fixtures.guardrailsError = new Error('Guardrail read unavailable');
    render(page());
    expect(
      screen.getByText(
        i18n.t('chatHealth.errors.loadFailed', { ns: 'analytics' }),
      ),
    ).toBeVisible();
    expect(screen.getByText('Chat health unavailable')).toBeVisible();
    expect(
      screen.queryByText(/Guardrail read unavailable/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Assistant turns')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });
});
