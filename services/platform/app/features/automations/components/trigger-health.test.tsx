import type {
  TriggerSkipDetail,
  TriggerView,
} from '@tale/shared/schemas/automation-trigger';
import { within } from '@testing-library/dom';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TriggerHealth, type TriggerHealthActions } from './trigger-health';

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
}

// Outside a router a link renders as the path it would open.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { createElement, forwardRef } = await import('react');
  return {
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    Link: forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
      { to, params, children, ...rest },
      ref,
    ) {
      const path = Object.entries(params ?? {}).reduce(
        (acc, [key, value]) => acc.replace(`$${key}`, value),
        to ?? '',
      );
      return createElement('a', { ref, href: path, ...rest }, children);
    }),
  };
});

let runRead: {
  data?: { status: string; stalled?: boolean };
  isPending: boolean;
};

vi.mock('../hooks/queries', () => ({
  useAutomationRun: () => runRead,
}));

/** Monday 2026-10-12, 09:00 in Zurich: the occurrence a skip is about. */
const DUE = Date.UTC(2026, 9, 12, 7, 0);
/** The scan that found it, a minute later. */
const SCANNED = DUE + 60_000;

function row(overrides: Partial<TriggerView>): TriggerView {
  return {
    id: 'trigger-1',
    name: 'github-triage-issues',
    kind: 'schedule',
    cron: null,
    repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
    startDate: '2026-10-01',
    timezone: 'Europe/Zurich',
    catchUp: 'latest',
    input: null,
    event: null,
    hasToken: false,
    enabled: true,
    nextRunAt: null,
    lastFiredAt: null,
    lastRunId: null,
    lastSkippedAt: null,
    lastSkipReason: null,
    lastSkipDetail: null,
    consecutiveFailures: 0,
    lastFailedAt: null,
    lastFailureCode: null,
    lastFailedRunId: null,
    ...overrides,
  };
}

/** A trigger whose last word is a skip, newer than any start. */
function skipped(
  reason: NonNullable<TriggerView['lastSkipReason']>,
  detail: TriggerSkipDetail | null,
  overrides: Partial<TriggerView> = {},
): TriggerView {
  return row({
    lastSkippedAt: SCANNED,
    lastSkipReason: reason,
    lastSkipDetail: detail,
    ...overrides,
  });
}

const actions: TriggerHealthActions = {
  editSchedule: vi.fn(),
  editProjects: vi.fn(),
};

function renderHealth(
  trigger: TriggerView,
  extra: Partial<TriggerHealthActions> = {},
  projectId?: string,
) {
  return render(
    <TriggerHealth
      place={{ organizationId: 'org-1', projectId, name: trigger.name }}
      trigger={trigger}
      actions={{ ...actions, ...extra }}
    />,
  );
}

/** The skip notice: the design system's static Alert. */
function notice(title: string) {
  const banner = screen
    .getByRole('heading', { name: title })
    .closest('[data-slot="alert"]');
  if (!(banner instanceof HTMLElement)) throw new Error(`no notice ${title}`);
  return banner;
}

describe('TriggerHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runRead = { data: undefined, isPending: false };
  });

  describe('the last run', () => {
    it('says a trigger has not started a run yet', () => {
      renderHealth(row({}));
      expect(screen.getByText("Hasn't started a run yet.")).toBeVisible();
    });

    it('names when it last ran, how that run did, and opens it', () => {
      runRead = { data: { status: 'success' }, isPending: false };
      renderHealth(row({ lastFiredAt: DUE, lastRunId: 'run-7' }));
      expect(screen.getByText(/^Last run /)).toBeVisible();
      expect(screen.getByText('Succeeded')).toBeVisible();
      expect(screen.getByRole('link', { name: 'View run' })).toHaveAttribute(
        'href',
        '/dashboard/org-1/automations/github-triage-issues/runs/run-7',
      );
    });

    it('holds the badge’s place while the run is read', () => {
      runRead = { isPending: true };
      const { container } = renderHealth(
        row({ lastFiredAt: DUE, lastRunId: 'run-7' }),
      );
      expect(
        container.querySelector('[aria-hidden="true"].animate-pulse'),
      ).not.toBeNull();
      expect(screen.queryByText('Succeeded')).toBeNull();
    });
  });

  describe('why it last started nothing, one notice per reason', () => {
    it('says no version is deployed, with the runs missed before, and opens the editor', () => {
      renderHealth(
        skipped('not_deployed', {
          reason: 'not_deployed',
          occurrence: DUE,
          missed: {
            count: 3,
            capped: false,
            firstAt: DUE - 3 * 86_400_000,
            lastAt: DUE - 86_400_000,
            policy: 'latest',
          },
        }),
      );
      const banner = notice('Skipped: no version is deployed');
      expect(banner).toHaveAttribute('data-variant', 'info');
      expect(banner).toHaveAttribute('aria-live', 'off');
      expect(banner).toHaveTextContent(
        /^.*It came due on .+, but no version is deployed, so no run started\. Deploy a tested version in the editor\. 3 earlier runs were missed too\./,
      );
      expect(
        within(banner).getByRole('link', { name: 'Open the editor' }),
      ).toHaveAttribute(
        'href',
        '/dashboard/org-1/automations/github-triage-issues/editor',
      );
    });

    it('says an event arrived for an event trigger', () => {
      renderHealth(
        skipped(
          'not_deployed',
          { reason: 'not_deployed', occurrence: DUE },
          { kind: 'event', event: 'task.created', repeat: null },
        ),
      );
      expect(notice('Skipped: no version is deployed')).toHaveTextContent(
        /An event arrived on /,
      );
    });

    it('says the version refused the input, offers the fixed input, and keeps the raw facts under Technical details', async () => {
      const fillMissing = vi.fn();
      const { user } = renderHealth(
        skipped('start_refused', {
          reason: 'start_refused',
          occurrence: DUE,
          code: 'AUTOMATION_INPUT_INVALID',
          version: 3,
          message: 'The run input does not match the automation inputs.',
          issues: [
            { path: 'owner', message: 'Required' },
            { path: 'repo', message: 'Required' },
          ],
        }),
        { fillMissing: { count: 2, run: fillMissing } },
      );
      const banner = notice("Skipped: the run's input was refused");
      expect(banner).toHaveAttribute('data-variant', 'warning');
      expect(banner).toHaveTextContent(
        "but version 3 refused what the trigger sends. Change the automation's inputs, or the trigger's fixed input, so they match.",
      );
      await user.click(
        within(banner).getByRole('button', {
          name: 'Add the 2 missing fields',
        }),
      );
      expect(fillMissing).toHaveBeenCalledTimes(1);

      // Closed until asked for, in the engine's English.
      const details = within(banner)
        .getByText('Technical details')
        .closest('details');
      expect(details).not.toHaveAttribute('open');
      await user.click(within(banner).getByText('Technical details'));
      expect(details).toHaveAttribute('open');
      expect(
        within(banner).getByText('AUTOMATION_INPUT_INVALID'),
      ).toBeVisible();
      expect(within(banner).getByText('owner')).toBeVisible();
      expect(
        within(banner).getByText(
          'The run input does not match the automation inputs.',
        ),
      ).toBeVisible();
    });

    it('says an archived project refused the start, and sends the reader to Projects', async () => {
      const editProjects = vi.fn();
      const { user } = renderHealth(
        skipped('start_refused', {
          reason: 'start_refused',
          occurrence: DUE,
          code: 'PROJECT_ARCHIVED',
          version: null,
          message: 'The project is archived.',
        }),
        { editProjects },
      );
      const banner = notice("Skipped: its project can't start runs");
      expect(banner).toHaveTextContent(
        'but its project is archived, so no run started.',
      );
      await user.click(
        within(banner).getByRole('button', { name: 'Edit the projects' }),
      );
      expect(editProjects).toHaveBeenCalledTimes(1);
    });

    it('says a project that no longer allows the automation refused it', () => {
      renderHealth(
        skipped('start_refused', {
          reason: 'start_refused',
          occurrence: DUE,
          code: 'AUTOMATION_PROJECT_FORBIDDEN',
          version: null,
          message: 'Not bound.',
        }),
      );
      expect(notice("Skipped: its project can't start runs")).toHaveTextContent(
        'its project is missing or no longer allows this automation',
      );
    });

    it('says the run could not start for any other refusal, the code under Technical details', () => {
      renderHealth(
        skipped('start_refused', {
          reason: 'start_refused',
          occurrence: DUE,
          code: 'AUTOMATION_VERSION_NOT_DEPLOYED',
          version: null,
          message: 'Version 4 is not deployed.',
        }),
      );
      const banner = notice("Skipped: the run couldn't start");
      expect(banner).toHaveTextContent('The technical details say why.');
      expect(
        within(banner).getByRole('link', { name: 'Open the editor' }),
      ).toBeVisible();
    });

    it('says the schedule could not be read, and hands focus to it', async () => {
      const editSchedule = vi.fn();
      const { user } = renderHealth(
        skipped('unusable_cron', {
          reason: 'unusable_cron',
          message: 'Unknown time zone "Mars/Olympus".',
        }),
        { editSchedule },
      );
      const banner = notice("Skipped: the schedule can't be read");
      expect(banner).toHaveAttribute('data-variant', 'destructive');
      await user.click(
        within(banner).getByRole('button', { name: 'Edit the schedule' }),
      );
      expect(editSchedule).toHaveBeenCalledTimes(1);
    });

    it('counts the runs missed while Tale was down, and what became of them', () => {
      renderHealth(
        skipped(
          'missed_occurrences',
          {
            reason: 'missed_occurrences',
            missed: {
              count: 2,
              capped: false,
              firstAt: DUE - 7_200_000,
              lastAt: DUE - 3_600_000,
              policy: 'skip',
            },
            firedLatest: false,
          },
          { catchUp: 'skip' },
        ),
      );
      const banner = notice('2 runs were missed');
      expect(banner).toHaveTextContent(
        /Runs were due between .+ and .+ while Tale was unavailable\. They were skipped, as set under Missed runs\./,
      );
    });

    it('says more than a thousand when the count stopped', () => {
      renderHealth(
        skipped('missed_occurrences', {
          reason: 'missed_occurrences',
          missed: {
            count: 1000,
            capped: true,
            firstAt: DUE - 86_400_000,
            lastAt: DUE,
            policy: 'latest',
          },
          firedLatest: true,
        }),
      );
      expect(notice('More than 1,000 runs were missed')).toHaveTextContent(
        'The latest one started when Tale was back.',
      );
    });

    it('stays silent once the trigger started a run after the skip', () => {
      renderHealth(
        skipped(
          'not_deployed',
          { reason: 'not_deployed', occurrence: DUE },
          { lastFiredAt: SCANNED + 86_400_000 },
        ),
      );
      expect(screen.queryByRole('heading')).toBeNull();
    });

    it('leaves a pause to the failure notice', () => {
      renderHealth(
        row({
          enabled: false,
          lastSkippedAt: SCANNED,
          lastSkipReason: 'paused_after_failures',
          consecutiveFailures: 5,
        }),
      );
      expect(
        screen.getByRole('heading', { name: 'Paused after repeated failures' }),
      ).toBeVisible();
      expect(screen.getAllByRole('heading')).toHaveLength(1);
    });
  });

  it('has no axe violations with a notice and its details', async () => {
    const result = renderHealth(
      skipped('start_refused', {
        reason: 'start_refused',
        occurrence: DUE,
        code: 'AUTOMATION_INPUT_INVALID',
        version: 3,
        message: 'Refused.',
        issues: [{ path: 'owner', message: 'Required' }],
      }),
    );
    await checkAccessibility(result);
  });
});
