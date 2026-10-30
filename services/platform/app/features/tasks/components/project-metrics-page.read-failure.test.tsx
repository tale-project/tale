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

import { ProjectMetricsPage } from './project-metrics-page';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #4588: a project metrics read that failed showed the project as idle —
// "0" completed, "—" for the cycle time and "No data" on every chart, the
// page a project with no activity gets. The whole read lane runs for real
// here — `useBackendQuery`, the adapter row, `backendFetch` and the read
// retry policy (four attempts for a fault) — against a closed synthetic
// transport, so the same mounted page can be watched failing and
// recovering.

type ProjectMetricsDay =
  ReturnsOf<'tasks/queries:getProjectTaskMetrics'>['daily'][number];

const METRICS = /^GET \/api\/app\/tasks\/metrics\/by-project\/project-1\?/;

function day(
  dateKey: string,
  activity: Partial<ProjectMetricsDay> = {},
): ProjectMetricsDay {
  return {
    dateKey,
    tasksCreated: 0,
    tasksCompleted: 0,
    tasksCancelled: 0,
    cycleTimeSumMs: 0,
    cycleTimeCount: 0,
    leadTimeSumMs: 0,
    leadTimeCount: 0,
    statusCountsEod: { backlog: 0, todo: 0, in_progress: 0, in_review: 0 },
    wipEod: 0,
    overdueEod: 0,
    staleEod: 0,
    agentCompleted: 0,
    humanCompleted: 0,
    agentRunsStarted: 0,
    agentRunsFailed: 0,
    totalCostCents: 0,
    reviewsPassed: 0,
    reviewsChangesRequested: 0,
    escalations: 0,
    capped: false,
    ...activity,
  };
}

function answer(daily: ProjectMetricsDay[]) {
  return () => Response.json({ daily, previousDaily: [] });
}

/** A busy project: 17 tasks completed over two days, 12 of them by agents. */
const BUSY = answer([
  day('2026-10-28', {
    tasksCreated: 6,
    tasksCompleted: 8,
    agentCompleted: 6,
    humanCompleted: 2,
    cycleTimeSumMs: 8 * 3_600_000,
    cycleTimeCount: 8,
    statusCountsEod: { backlog: 4, todo: 3, in_progress: 2, in_review: 1 },
    agentRunsStarted: 10,
    totalCostCents: 450,
  }),
  day('2026-10-29', {
    tasksCreated: 5,
    tasksCompleted: 9,
    agentCompleted: 6,
    humanCompleted: 3,
    cycleTimeSumMs: 9 * 3_600_000,
    cycleTimeCount: 9,
    statusCountsEod: { backlog: 3, todo: 2, in_progress: 2, in_review: 0 },
    agentRunsStarted: 8,
    agentRunsFailed: 1,
    totalCostCents: 320,
  }),
]);
/** A project with no activity in the period: the page the failure mimicked. */
const IDLE = answer([day('2026-10-28'), day('2026-10-29')]);

/** The alert's own sentences in each shipped locale — the catalog entries
 * the alert must read, pinned here so a missing translation fails. */
const LOAD_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't load project metrics.",
  de: 'Die Projekt-Metriken konnten nicht geladen werden.',
  fr: 'Impossible de charger les métriques du projet.',
};
const REFRESH_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't refresh project metrics. The figures shown may be out of date.",
  de: 'Die Projekt-Metriken konnten nicht aktualisiert werden. Die angezeigten Zahlen sind möglicherweise veraltet.',
  fr: "Impossible d'actualiser les métriques du projet. Les chiffres affichés peuvent être obsolètes.",
};
const TRY_AGAIN: Record<ShippedLocale, string> = {
  en: 'Try again',
  de: 'Erneut versuchen',
  fr: 'Réessayer',
};

/** The host's project picker (Settings → Metrics → Projects), stood in. */
const PROJECT_PICKER = 'Synthetic project picker';

let backend: SyntheticBackend;
let client: QueryClient;
const onChangePeriod = vi.fn();

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/settings/metrics/projects?project=project-1',
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

function renderMetrics(periodDays: 7 | 30 | 90 = 30) {
  return render(
    <QueryClientProvider client={client}>
      <ProjectMetricsPage
        organizationId="org-1"
        projectId="project-1"
        periodDays={periodDays}
        onChangePeriod={onChangePeriod}
        scopeControl={<button type="button">{PROJECT_PICKER}</button>}
      />
    </QueryClientProvider>,
  );
}

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'tasks', ...options });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const metricsRegion = () =>
  screen.getByRole('region', { name: t('metrics.title') });
const busyDetail = () => t('metrics.completedDetail', { agent: 12, human: 5 });

describe('ProjectMetricsPage when its read fails', { timeout: 30_000 }, () => {
  it('shows a failed read as a failure with Try again, never as an idle project, and recovers in place', async () => {
    backend.on(METRICS, () => serviceUnavailable());
    const { user } = renderMetrics();

    const alert = await screen.findByRole('alert');
    // The policy's four attempts, then the failure — not an idle project.
    expect(backend.count(METRICS)).toBe(4);
    expect(alert).toHaveTextContent(LOAD_FAILED.en);
    // No figure was read, so none is shown: no zero completions, no dash
    // for the cycle time, no chart saying nothing happened.
    expect(screen.queryByText(t('metrics.completed', { days: 30 }))).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByText(t('metrics.noData'))).toBeNull();
    expect(screen.queryByText(t('metrics.noThroughputDescription'))).toBeNull();
    expect(screen.queryByText(t('metrics.noCostDescription'))).toBeNull();
    // The page and its controls stay: the heading, the project picker and
    // the Filter that holds the period.
    expect(
      screen.getByRole('heading', { name: t('metrics.title') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PROJECT_PICKER })).toBeEnabled();
    expect(
      screen.getByRole('button', {
        name: i18n.t('labels.filter', { ns: 'common' }),
      }),
    ).toBeEnabled();

    // The same mounted page recovers on Try again, with no reload.
    backend.on(METRICS, BUSY);
    const retry = within(alert).getByRole('button', { name: tryAgain() });
    await user.click(retry);
    expect(await screen.findByText(busyDetail())).toBeVisible();
    expect(screen.getByText('17')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(backend.count(METRICS)).toBe(5);
    // The focused Try again went with the alert: its focus lands on the
    // metrics region, not on the page.
    await waitFor(() => expect(metricsRegion()).toHaveFocus());
  });

  it('keeps a focused Try again focused, and busy, while the retry runs and fails again', async () => {
    backend.on(METRICS, () => serviceUnavailable());
    const { user } = renderMetrics();
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: tryAgain() });

    // Hold the retry's first attempt so the busy state can be read.
    let release: () => void = () => undefined;
    backend.on(
      METRICS,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(serviceUnavailable());
        }),
    );
    await user.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    // While it runs, the failure stays named: no skeleton over it, and no
    // idle figures.
    expect(screen.getByRole('alert')).toBe(alert);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(t('metrics.noData'))).toBeNull();
    expect(retry).toHaveFocus();

    backend.on(METRICS, () => serviceUnavailable());
    release();
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('alert')).toHaveTextContent(LOAD_FAILED.en);
    expect(retry).toHaveFocus();
  });

  it('says why the read failed when it knows: the connection was lost', async () => {
    backend.on(METRICS, () => {
      throw new TypeError('Failed to fetch');
    });
    renderMetrics();

    const alert = await screen.findByRole('alert');
    expect(backend.count(METRICS)).toBe(4);
    expect(alert).toHaveTextContent(LOAD_FAILED.en);
    expect(alert).toHaveTextContent(
      i18n.t('errors.connectionLost', { ns: 'common' }),
    );
    expect(screen.queryByText(t('metrics.noData'))).toBeNull();
  });

  it.each([7, 30, 90] as const)(
    'retries the read for the selected project and %s-day period, without changing either',
    async (periodDays) => {
      backend.on(METRICS, () => serviceUnavailable());
      const { user } = renderMetrics(periodDays);
      const alert = await screen.findByRole('alert');

      backend.on(METRICS, BUSY);
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      await screen.findByText(busyDetail());

      // Every attempt, the retry included, asked for the same project and
      // period.
      expect(
        new Set(backend.calls.filter((call) => METRICS.test(call))),
      ).toEqual(
        new Set([
          `GET /api/app/tasks/metrics/by-project/project-1?periodDays=${periodDays}&orgId=org-1`,
        ]),
      );
      expect(backend.count(METRICS)).toBe(5);
      expect(onChangePeriod).not.toHaveBeenCalled();
    },
  );

  it('keeps the figures through a failed refresh and says they may be out of date', async () => {
    backend.on(METRICS, BUSY);
    const { user } = renderMetrics();
    await screen.findByText(busyDetail());

    // A background refresh (a task hint, the tab regaining focus) fails.
    backend.on(METRICS, () => serviceUnavailable());
    void client.invalidateQueries();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(REFRESH_FAILED.en);
    expect(alert).not.toHaveTextContent(LOAD_FAILED.en);
    expect(screen.getByText(busyDetail())).toBeVisible();
    expect(screen.getByText('17')).toBeVisible();
    expect(screen.queryByText(t('metrics.noData'))).toBeNull();

    // A retry that answers an idle period shows it as one, and hands the
    // focus on Try again to the region.
    backend.on(METRICS, IDLE);
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(busyDetail())).not.toBeInTheDocument();
    expect(screen.getAllByText(t('metrics.noData'))).toHaveLength(5);
    await waitFor(() => expect(metricsRegion()).toHaveFocus());
  });

  it('keeps a project with no activity in the period as zero figures and No data', async () => {
    backend.on(METRICS, IDLE);
    renderMetrics();

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(
      screen.getByText(t('metrics.completed', { days: 30 })),
    ).toBeVisible();
    expect(
      screen.getByText(t('metrics.completedDetail', { agent: 0, human: 0 })),
    ).toBeVisible();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Every chart says it has nothing to show, and why.
    expect(screen.getAllByText(t('metrics.noData'))).toHaveLength(5);
    expect(
      screen.getByText(t('metrics.noThroughputDescription')),
    ).toBeVisible();
    expect(screen.getByText(t('metrics.noCostDescription'))).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(LOAD_FAILED.en)).not.toBeInTheDocument();
  });

  it('keeps the first read quiet: a skeleton, no failure and no empty charts', async () => {
    let release: () => void = () => undefined;
    backend.on(
      METRICS,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(BUSY());
        }),
    );
    renderMetrics();

    expect(
      await screen.findByRole('status', { name: t('metrics.title') }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(t('metrics.noData'))).toBeNull();

    release();
    expect(await screen.findByText(busyDetail())).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(SHIPPED_LOCALES)(
    'names a failed read and a failed refresh, and Try again, in the reader’s language (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      backend.on(METRICS, () => serviceUnavailable());
      const { user } = renderMetrics();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(LOAD_FAILED[locale]);
      backend.on(METRICS, BUSY);
      await user.click(
        within(alert).getByRole('button', { name: TRY_AGAIN[locale] }),
      );
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

      backend.on(METRICS, () => serviceUnavailable());
      void client.invalidateQueries();
      const refresh = await screen.findByRole('alert');
      expect(refresh).toHaveTextContent(REFRESH_FAILED[locale]);
      expect(
        within(refresh).getByRole('button', { name: TRY_AGAIN[locale] }),
      ).toBeInTheDocument();
    },
  );

  it('passes axe audit in its failed state', async () => {
    backend.on(METRICS, () => serviceUnavailable());
    const { container } = renderMetrics();
    await screen.findByRole('alert');
    await checkAccessibility(container);
  });
});
