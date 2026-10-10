import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import { waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  type DeployedTrigger,
  TriggerDeployNotice,
  triggerOffAfterDeploy,
} from './trigger-deploy-notice';

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
  hash?: string;
}

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { createElement, forwardRef } = await import('react');
  return {
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    Link: forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
      { to, params, hash, children, ...rest },
      ref,
    ) {
      const path = Object.entries(params ?? {}).reduce(
        (acc, [key, value]) => acc.replace(`$${key}`, value),
        to ?? '',
      );
      return createElement(
        'a',
        { ref, href: hash === undefined ? path : `${path}#${hash}`, ...rest },
        children,
      );
    }),
  };
});

const toastSpy = vi.fn();
vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
  useToast: () => ({ toast: toastSpy }),
}));

let storedRead: { data?: TriggerView[]; isPending: boolean; isError: boolean };
vi.mock('../hooks/queries', () => ({
  useAutomationTriggers: () => storedRead,
}));

const setTrigger = {
  mutateAsync: vi.fn(),
  isPending: false,
};
vi.mock('../hooks/mutations', () => ({
  useSetAutomationTrigger: () => setTrigger,
}));

/** A stored trigger as the read returns it, off. */
function row(overrides: Partial<TriggerView>): TriggerView {
  return {
    id: 'trigger-1',
    name: 'github-triage-issues',
    kind: 'schedule',
    cron: null,
    repeat: null,
    startDate: null,
    timezone: null,
    catchUp: null,
    input: null,
    event: null,
    hasToken: false,
    enabled: false,
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

const PLACE = {
  organizationId: 'org-1',
  projectId: undefined,
  name: 'github-triage-issues',
};
const OFF: DeployedTrigger = {
  kind: 'schedule',
  enabled: false,
  nextRunAt: null,
  warnings: [],
};

function renderNotice(trigger: DeployedTrigger = OFF, onReview = vi.fn()) {
  const result = render(
    <TriggerDeployNotice place={PLACE} trigger={trigger} onReview={onReview} />,
  );
  return { ...result, onReview };
}

const turnOn = () =>
  screen.getByRole('button', { name: 'Turn on the trigger' });
const notice = () => {
  const frame = screen
    .getByRole('status')
    .closest<HTMLElement>('[tabindex="-1"]');
  if (frame === null) throw new Error('no notice');
  return frame;
};

describe('triggerOffAfterDeploy', () => {
  it('calls for a notice only when the deploy found the trigger off', () => {
    expect(triggerOffAfterDeploy(OFF)).toBe(OFF);
    expect(triggerOffAfterDeploy({ ...OFF, enabled: true })).toBeNull();
    expect(triggerOffAfterDeploy(null)).toBeNull();
    expect(triggerOffAfterDeploy(undefined)).toBeNull();
  });
});

describe('TriggerDeployNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTrigger.isPending = false;
    setTrigger.mutateAsync.mockResolvedValue({});
    storedRead = {
      data: [
        row({
          cron: '0 9 * * 1-5',
          timezone: 'Europe/Zurich',
          catchUp: 'latest',
          input: { owner: 'acme', repo: 'web' },
        }),
      ],
      isPending: false,
      isError: false,
    };
  });

  // Lea deploys the GitHub triage pack: its schedule was created off, so
  // nothing has started yet. One click arms it as it is.
  it('turns on the stored trigger as it is, then says it is on', async () => {
    const { user } = renderNotice();
    expect(
      screen.getByRole('heading', { name: 'Its trigger is off' }),
    ).toBeVisible();
    expect(
      screen.getByText('The schedule starts no runs until you turn it on.'),
    ).toBeVisible();
    await user.click(turnOn());
    // The stored cron goes back byte for byte, with its zone, missed-runs
    // setting and fixed input — only `enabled` changes.
    expect(setTrigger.mutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'github-triage-issues',
      trigger: {
        kind: 'schedule',
        enabled: true,
        cron: '0 9 * * 1-5',
        timezone: 'Europe/Zurich',
        catchUp: 'latest',
        input: { owner: 'acme', repo: 'web' },
      },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The trigger is on.',
    );
    expect(
      screen.queryByRole('button', { name: 'Turn on the trigger' }),
    ).toBeNull();
    expect(screen.queryByText('Its trigger is off')).toBeNull();
    expect(notice().querySelector('[data-slot="alert"]')).toHaveAttribute(
      'data-variant',
      'success',
    );
    // Turn on left the page with the focus; the notice holds it now.
    await waitFor(() => expect(notice()).toHaveFocus());
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('keeps a stored rule’s start date when it turns it on', async () => {
    storedRead.data = [
      row({
        repeat: {
          frequency: 'weekly',
          interval: 2,
          weekdays: [1],
          times: ['08:30'],
        },
        startDate: '2026-09-07',
        timezone: 'Europe/Zurich',
        catchUp: 'skip',
      }),
    ];
    const { user } = renderNotice();
    await user.click(turnOn());
    expect(setTrigger.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          enabled: true,
          repeat: expect.objectContaining({ frequency: 'weekly', interval: 2 }),
          startDate: '2026-09-07',
          catchUp: 'skip',
        }),
      }),
    );
  });

  // When the version would refuse what the trigger sends, arming it from
  // here would only collect skips: the notice sends Lea to the trigger.
  it('sends to the trigger section instead when the version would refuse its runs', async () => {
    const { user, onReview } = renderNotice({
      ...OFF,
      warnings: [
        {
          level: 'warning',
          code: 'TRIGGER_INPUT_MISMATCH',
          message: 'The schedule starts runs without owner.',
        },
      ],
    });
    expect(
      screen.queryByRole('button', { name: 'Turn on the trigger' }),
    ).toBeNull();
    const review = screen.getByRole('link', { name: 'Review the trigger' });
    expect(review).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/github-triage-issues/general#automation-trigger',
    );
    await user.click(review);
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(setTrigger.mutateAsync).not.toHaveBeenCalled();
  });

  it('sends to the trigger section a webhook whose URL was never shown', () => {
    storedRead.data = [row({ kind: 'webhook', hasToken: false })];
    renderNotice({ ...OFF, kind: 'webhook' });
    expect(
      screen.getByText(
        'Requests to its URL start no runs until you turn it on.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Review the trigger' }),
    ).toBeVisible();
  });

  it('turns on a webhook that has its URL', async () => {
    storedRead.data = [row({ kind: 'webhook', hasToken: true })];
    const { user } = renderNotice({ ...OFF, kind: 'webhook' });
    await user.click(turnOn());
    expect(setTrigger.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: { kind: 'webhook', enabled: true } }),
    );
  });

  it('says an event trigger starts nothing until it is on', () => {
    storedRead.data = [row({ kind: 'event', event: 'task.created' })];
    renderNotice({ ...OFF, kind: 'event' });
    expect(
      screen.getByText('Events start no runs until you turn it on.'),
    ).toBeVisible();
  });

  it('says why the store refused, once, beside the action', async () => {
    setTrigger.mutateAsync.mockRejectedValue(
      Object.assign(new Error('refused'), {
        data: {
          code: 'AUTOMATION_TRIGGER_INVALID',
          message: 'The trigger is invalid.',
          issues: [
            { path: 'timezone', code: 'timezone.unknown', message: 'unknown' },
          ],
        },
      }),
    );
    const { user } = renderNotice();
    await user.click(turnOn());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't turn on the trigger: Pick a valid IANA time zone (e.g. Europe/Zurich or UTC).",
    );
    expect(turnOn()).toBeVisible();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('waits for the stored trigger before it can turn it on', async () => {
    storedRead = { data: undefined, isPending: true, isError: false };
    const { user } = renderNotice();
    // Busy, not disabled: it keeps its place in the tab order.
    expect(turnOn()).toHaveAttribute('aria-busy', 'true');
    expect(turnOn()).toHaveAttribute('aria-disabled', 'true');
    await user.click(turnOn());
    expect(setTrigger.mutateAsync).not.toHaveBeenCalled();
  });

  it('says a failed read of the trigger, and cannot turn it on', () => {
    storedRead = { data: undefined, isPending: false, isError: true };
    renderNotice();
    expect(turnOn()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the trigger.",
    );
  });

  it('says it is on when someone turned it on meanwhile', () => {
    storedRead.data = [row({ enabled: true, cron: '0 9 * * *' })];
    renderNotice();
    expect(screen.getByRole('status')).toHaveTextContent('The trigger is on.');
    expect(
      screen.queryByRole('button', { name: 'Turn on the trigger' }),
    ).toBeNull();
  });

  it('has no axe violations', async () => {
    const result = renderNotice();
    await checkAccessibility(result);
  });
});
