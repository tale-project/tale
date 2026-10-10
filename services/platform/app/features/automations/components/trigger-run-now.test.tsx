import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import { within } from '@testing-library/dom';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor } from '@/tests/utils/render';

import { TriggerRunNow } from './trigger-run-now';

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
}

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

const mockStartRun = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useStartAutomationRun: () => ({
    mutateAsync: mockStartRun,
    isPending: false,
  }),
}));

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
    input: { owner: 'acme', repo: 'tale' },
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

const PLACE = {
  organizationId: 'org-1',
  projectId: 'proj-1',
  name: 'github-triage-issues',
};

function renderRunNow(
  stored: TriggerView | null,
  options: { deployedVersion?: number; dirty?: boolean } = {},
) {
  return render(
    <TriggerRunNow
      place={PLACE}
      stored={stored}
      deployedVersion={
        'deployedVersion' in options ? options.deployedVersion : 3
      }
      inputsSchema={undefined}
      dirty={options.dirty ?? false}
      scopeText="This run operates in the Document desk project — its task and document tools act there."
    />,
  );
}

const runNowButton = () => screen.getByRole('button', { name: 'Run now' });

describe('TriggerRunNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartRun.mockResolvedValue({ runId: 'run-9', version: 3 });
  });

  it('waits for a deployed version, and says so', async () => {
    renderRunNow(row({}), { deployedVersion: undefined });
    expect(runNowButton()).toHaveAttribute('aria-disabled', 'true');
    act(() => runNowButton().focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /^Deploy a version first/,
    );
  });

  it('waits for the trigger’s edits to be saved, and says so', async () => {
    renderRunNow(row({}), { dirty: true });
    expect(runNowButton()).toHaveAttribute('aria-disabled', 'true');
    act(() => runNowButton().focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Save your trigger changes first.',
    );
  });

  // Ada runs her nightly triage once, now, as the schedule would: version 3,
  // the stored fixed input under the schedule's own fields, and no project
  // named — the store infers the sole installation, as for the trigger.
  it('asks first for a schedule, showing the input and where it acts, then starts the live version', async () => {
    const { user } = renderRunNow(row({}));
    await user.click(runNowButton());
    const dialog = screen.getByRole('dialog', { name: 'Run live?' });
    expect(dialog).toHaveTextContent(
      /Runs version 3 for real with the input below/,
    );
    expect(dialog).toHaveTextContent(/in the Document desk project/);
    expect(within(dialog).getByText(/"owner": "acme"/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }));

    await waitFor(() => expect(mockStartRun).toHaveBeenCalledTimes(1));
    const [args] = mockStartRun.mock.calls[0] ?? [];
    expect(args).toEqual({
      organizationId: 'org-1',
      name: 'github-triage-issues',
      mode: 'live',
      version: 3,
      input: {
        owner: 'acme',
        repo: 'tale',
        trigger: 'schedule',
        firedAt: expect.any(Number),
      },
    });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Run started.');
    expect(
      within(status).getByRole('link', { name: 'View run' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj-1/automations/github-triage-issues/runs/run-9',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says why a refused start started nothing, in the store’s words', async () => {
    mockStartRun.mockRejectedValue(
      Object.assign(new Error('refused'), {
        data: {
          code: 'AUTOMATION_INPUT_INVALID',
          message: 'The run input is missing owner.',
        },
      }),
    );
    const { user } = renderRunNow(row({}));
    await user.click(runNowButton());
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "Couldn't start the run: The run input is missing owner.",
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens a webhook’s sample in the run dialog, to edit before it starts', async () => {
    const { user } = renderRunNow(
      row({ kind: 'webhook', repeat: null, timezone: null, input: null }),
    );
    await user.click(runNowButton());
    const dialog = screen.getByRole('dialog');
    const field = within(dialog).getByRole('textbox', {
      name: 'Run input (JSON)',
    });
    expect(JSON.parse((field as HTMLTextAreaElement).value)).toEqual({
      trigger: 'webhook',
      payload: { example: true },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Run live' }));
    await waitFor(() =>
      expect(mockStartRun).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'live',
          version: 3,
          input: { trigger: 'webhook', payload: { example: true } },
        }),
      ),
    );
  });

  it('keeps a refusal beside the input the run dialog sent', async () => {
    mockStartRun.mockRejectedValue(
      Object.assign(new Error('refused'), {
        data: { code: 'AUTOMATION_INPUT_INVALID', message: 'No payload.' },
      }),
    );
    const { user } = renderRunNow(
      row({
        kind: 'event',
        event: 'task.created',
        repeat: null,
        timezone: null,
        input: null,
      }),
    );
    await user.click(runNowButton());
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Run live' }));
    expect(await within(dialog).findByText('No payload.')).toBeVisible();
    expect(screen.queryByText(/^Couldn't start the run/)).toBeNull();
  });
});
