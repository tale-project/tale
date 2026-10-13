import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloneElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { AppError } from '@/lib/shared/errors/app-error';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

import deUiMessages from '../../../../../../packages/ui/src/i18n/messages/de.yml';
import enUiMessages from '../../../../../../packages/ui/src/i18n/messages/en.yml';
import frUiMessages from '../../../../../../packages/ui/src/i18n/messages/fr.yml';
import { TaskAgentRunEntry } from './task-agent-run-entry';

const { locale } = vi.hoisted(() => ({
  locale: { value: 'en' as 'en' | 'de' | 'fr' },
}));

const catalogs = { en: enMessages, de: deMessages, fr: frMessages };

/** An Admin's rights: the ones that may raise the limit of agent workers. */
const ADMIN = defineAbilityFor('admin');
const uiCatalogs = { en: enUiMessages, de: deUiMessages, fr: frUiMessages };

/** A `tasks` key read from the active locale's catalog by its dotted path. */
function tasksMessage(key: string): string | undefined {
  let node: unknown = catalogs[locale.value].tasks;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'agentRun.runReadFailed') {
        return catalogs[locale.value].tasks.agentRun.runReadFailed;
      }
      if (key === 'actions.tryAgain') {
        return uiCatalogs[locale.value].common.actions.tryAgain;
      }
      if (key === 'agentRun.start') return 'Start agent';
      if (key === 'agentRun.retry') return 'Retry';
      if (key === 'agentRun.previousRun')
        return `Previous run by ${String(values?.name)}`;
      if (key === 'agentRun.status.running') return 'Working';
      if (key === 'agentRun.status.settled') return 'Finished';
      if (key === 'agentRun.status.queued') return 'Queued';
      if (
        key.startsWith('agentRun.waiting.') ||
        key.startsWith('agentRun.waitingWhy.') ||
        key === 'agentRun.manageWorkers'
      ) {
        return tasksMessage(key) ?? key;
      }
      if (key === 'agentRun.autoRetrying') {
        return `Auto-retry ${String(values?.n)} of ${String(values?.max)}`;
      }
      if (key === 'agentRun.resumedAfterTokenRefresh') {
        return 'Resumed after a token refresh';
      }
      if (key === 'agentRun.retry') return 'Retry';
      if (key === 'agentRun.start') return 'Start agent';
      if (key === 'agentRun.status.failed') return 'Failed';
      if (key === 'agentRun.agentMissing') {
        return 'The assigned agent no longer exists.';
      }
      if (key === 'agentRun.noAgentAssignee') {
        return 'No agent is assigned to this task.';
      }
      if (key === 'agentRun.notStarted')
        return 'The agent run could not start.';
      return key;
    },
  }),
}));

const { startRun, cancelRun, toast } = vi.hoisted(() => ({
  startRun: vi.fn(),
  cancelRun: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useStartTaskAgentRun: () => ({ mutateAsync: startRun }),
  useCancelTaskAgentRun: () => ({ mutateAsync: cancelRun }),
}));

vi.mock('@tale/ui/use-toast', () => ({ toast }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params: { id: string };
  }) => (
    <a href={to.replace('$id', params.id)} {...rest}>
      {children}
    </a>
  ),
}));

// The strip's one read: the task's latest run. What a run did is read in the
// activity thread (`task-timeline.test.tsx`).
const { state, refetchRun } = vi.hoisted(() => ({
  state: {
    run: undefined as unknown,
    runIsError: false,
    runIsFetching: false,
  },
  refetchRun: vi.fn(),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: state.run,
    isError: state.runIsError,
    isFetching: state.runIsFetching,
    error: state.runIsError ? new Error('503') : undefined,
    refetch: refetchRun,
  }),
}));

const taskId = 'task-1' as string;

function settledRun() {
  return {
    _id: 'run-1' as string,
    status: 'settled',
    agentId: 'agent-1',
    agentName: 'Alice',
    harness: 'claude-code',
    model: 'deepseek/deepseek-v4-flash',
    startedAt: 1,
    settledAt: 2,
  };
}

describe('TaskAgentRunEntry', () => {
  beforeEach(() => {
    startRun.mockReset().mockResolvedValue({ started: true });
    vi.mocked(toast).mockClear();
    refetchRun.mockReset().mockResolvedValue(undefined);
    state.runIsError = false;
    state.runIsFetching = false;
    locale.value = 'en';
  });

  it.each(['en', 'de', 'fr'] as const)(
    'keeps a failed latest-run read visible and recovers in %s',
    async (language) => {
      locale.value = language;
      state.run = undefined;
      state.runIsError = true;
      const user = userEvent.setup();
      const entry = (
        <TaskAgentRunEntry
          organizationId="org-1"
          taskId={taskId}
          assigneeId="agent-1"
          canEdit
        />
      );
      const { rerender } = render(entry);
      expect(screen.getByRole('alert')).toHaveTextContent(
        catalogs[language].tasks.agentRun.runReadFailed,
      );
      expect(screen.queryByText('503')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Start agent' })).toBeNull();
      await user.click(
        screen.getByRole('button', {
          name: uiCatalogs[language].common.actions.tryAgain,
        }),
      );
      expect(refetchRun).toHaveBeenCalledOnce();
      expect(startRun).not.toHaveBeenCalled();
      state.runIsFetching = true;
      rerender(cloneElement(entry));
      expect(screen.queryByRole('alert')).toBeNull();
      state.runIsFetching = false;
      rerender(cloneElement(entry));
      expect(
        screen.getByRole('button', {
          name: uiCatalogs[language].common.actions.tryAgain,
        }),
      ).toHaveFocus();
      await user.click(
        screen.getByRole('button', {
          name: uiCatalogs[language].common.actions.tryAgain,
        }),
      );
      expect(refetchRun).toHaveBeenCalledTimes(2);
      state.runIsError = false;
      state.run = null;
      rerender(cloneElement(entry));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('button', { name: 'Start agent' })).toBeEnabled();
      state.run = settledRun();
      rerender(cloneElement(entry));
      expect(screen.getByText('Finished')).toBeInTheDocument();
    },
  );

  it('offers read recovery to a viewer without run permissions', () => {
    state.run = undefined;
    state.runIsError = true;
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit={false}
        assigneeLive={false}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('preserves cached run controls after a background read failure', () => {
    state.run = settledRun();
    state.runIsError = true;
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Finished')).toBeInTheDocument();
  });

  it("shows the run's state as text, not as a control, beside its verbs", () => {
    state.run = { ...settledRun(), status: 'failed', error: 'boom' };
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Failed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('keeps an initial latest-run read quiet while loading', () => {
    state.run = undefined;
    state.runIsFetching = true;
    const { container } = render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['TASK_AUTOMATION_DISABLED', 'TASK_AUTOMATION_UNAVAILABLE'])(
    'explains %s when a new run is refused',
    async (code) => {
      state.run = null;
      startRun.mockRejectedValue({ data: { code } });
      const user = userEvent.setup();
      render(
        <TaskAgentRunEntry
          organizationId="org-1"
          taskId={taskId}
          assigneeId="agent-2"
          canEdit
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Start agent' }));
      expect(toast).toHaveBeenCalledWith({
        title:
          code === 'TASK_AUTOMATION_DISABLED'
            ? 'agentRun.automationDisabled'
            : 'agentRun.automationUnavailable',
        variant: 'destructive',
      });
      expect(screen.getByRole('button', { name: 'Start agent' })).toBeEnabled();
    },
  );
  // A refused cancel said the run "could not start"; it names the cancel.
  it('says the run could not be cancelled when a cancel is refused', async () => {
    state.run = { ...settledRun(), status: 'running', settledAt: undefined };
    cancelRun.mockRejectedValueOnce(
      new AppError({ code: 'RUN_ALREADY_SETTLED', message: 'The run ended.' }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );
    await user.click(screen.getByRole('button', { name: 'agentRun.cancel' }));
    expect(toast).toHaveBeenCalledWith({
      title: 'agentRun.cancelFailed',
      description: 'The run ended.',
      variant: 'destructive',
    });
  });

  it.each(['settled', 'failed', 'cancelled'])(
    'offers Start, not Retry, after reassigning a task with a %s run',
    async (status) => {
      const user = userEvent.setup();
      state.run = { ...settledRun(), status };
      render(
        <TaskAgentRunEntry
          organizationId="org-1"
          taskId={taskId}
          assigneeId="agent-2"
          canEdit
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Start agent' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Previous run by Alice')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Start agent' }));
      expect(startRun).toHaveBeenCalledWith({ taskId });
    },
  );

  it('says a run waiting for a worker waits for one, why, and that Stop withdraws it', () => {
    // "Queued" reads as "about to start"; a run waiting for one of the
    // organization's agent workers can sit a while — the strip says what it
    // waits on and why.
    state.run = {
      ...settledRun(),
      status: 'queued',
      settledAt: undefined,
      waitingForCapacity: true,
      waitingReason: 'org_limit',
    };
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );
    expect(screen.getByText('Waiting for a worker')).toBeInTheDocument();
    expect(
      screen.getByText(
        "All of your organization's agent workers are busy. The run starts on its own when one is free.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
    // A waiting run is live: whoever may stop it can withdraw it.
    expect(
      screen.getByRole('button', { name: 'agentRun.cancel' }),
    ).toBeInTheDocument();
    // The limit is not this reader's to raise.
    expect(
      screen.queryByRole('link', { name: 'Manage agent workers' }),
    ).toBeNull();
  });

  it('sends an Owner or Admin to the workers limit when every worker is busy', () => {
    state.run = {
      ...settledRun(),
      status: 'queued',
      settledAt: undefined,
      waitingForCapacity: true,
      waitingReason: 'org_limit',
    };
    const { rerender } = render(
      <AbilityContext.Provider value={ADMIN}>
        <TaskAgentRunEntry
          organizationId="org-1"
          taskId={taskId}
          assigneeId="agent-1"
          canEdit
        />
      </AbilityContext.Provider>,
    );
    expect(
      screen.getByRole('link', { name: 'Manage agent workers' }),
    ).toHaveAttribute('href', '/dashboard/org-1/settings/sandboxes');

    // A wait the limit does not cause offers no way to raise it.
    state.run = { ...(state.run as object), waitingReason: 'host' };
    rerender(
      <AbilityContext.Provider value={ADMIN}>
        <TaskAgentRunEntry
          organizationId="org-1"
          taskId={taskId}
          assigneeId="agent-1"
          canEdit
        />
      </AbilityContext.Provider>,
    );
    expect(screen.getByText('Waiting for room')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Manage agent workers' }),
    ).toBeNull();
  });

  it.each([
    ['host', 'Waiting for room', /sandbox host is full/],
    ['destroy_pending', 'Waiting for a workspace', /deleting the workspace/],
    ['exec_limit', 'Waiting for its sandbox', /finishing an earlier process/],
    [undefined, 'Waiting for a worker', /as soon as there is room for it/],
  ] as const)(
    'words a wait for %s as its own short state and sentence',
    (reason, label, why) => {
      state.run = {
        ...settledRun(),
        status: 'queued',
        settledAt: undefined,
        waitingForCapacity: true,
        ...(reason !== undefined ? { waitingReason: reason } : {}),
      };
      render(
        <TaskAgentRunEntry
          organizationId="org-1"
          taskId={taskId}
          assigneeId="agent-1"
          canEdit
        />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(why)).toBeInTheDocument();
    },
  );

  it.each(['de', 'fr'] as const)(
    'words a wait for a worker in %s from its own catalog',
    (language) => {
      locale.value = language;
      state.run = {
        ...settledRun(),
        status: 'queued',
        settledAt: undefined,
        waitingForCapacity: true,
        waitingReason: 'org_limit',
      };
      render(
        <TaskAgentRunEntry
          organizationId="org-1"
          taskId={taskId}
          assigneeId="agent-1"
          canEdit
        />,
      );
      expect(
        screen.getByText(catalogs[language].tasks.agentRun.waiting.org_limit),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          catalogs[language].tasks.agentRun.waitingWhy.org_limit,
        ),
      ).toBeInTheDocument();
    },
  );

  it('labels a live machine-kicked retry with its streak position', () => {
    // The user watched the run fail; without the caption the platform's own
    // retry is indistinguishable from their Retry click.
    state.run = {
      ...settledRun(),
      status: 'running',
      settledAt: undefined,
      trigger: 'auto_retry',
      autoRetryAttempt: 2,
      autoRetryMax: 3,
    };
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );
    expect(screen.getByText('Auto-retry 2 of 3')).toBeInTheDocument();
  });

  it('says a live resume after a token refresh is one, spending no attempt', () => {
    // The broker refreshed the account under a run that had spent no retry:
    // "Auto-retry 1 of 3" would claim an attempt the budget never spent.
    state.run = {
      ...settledRun(),
      status: 'running',
      settledAt: undefined,
      trigger: 'auto_retry',
      autoRetryAttempt: 0,
      autoRetryMax: 3,
    };
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );
    expect(
      screen.getByText('Resumed after a token refresh'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Auto-retry/)).not.toBeInTheDocument();
  });

  it('drops the retry caption once the run stops', () => {
    // A terminal auto_retry row reads exactly like today's Failed strip —
    // the caption narrates the machine WORKING, not history.
    state.run = {
      ...settledRun(),
      status: 'failed',
      error: 'API Error: Request rejected (429)',
      trigger: 'auto_retry',
      autoRetryAttempt: 3,
      autoRetryMax: 3,
    };
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );
    expect(screen.queryByText(/Auto-retry/)).not.toBeInTheDocument();
    // The harness's own words are not the strip's to lead with: they sit in
    // the run's row of the activity.
    expect(
      screen.queryByText('API Error: Request rejected (429)'),
    ).not.toBeInTheDocument();
  });

  it('says beside Start that assigning an agent does not start it', () => {
    state.run = null;
    const { rerender } = render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );
    expect(screen.getByRole('button', { name: 'Start agent' })).toBeVisible();
    expect(screen.getByText('agentRun.notStartedYet')).toBeVisible();

    // Someone who cannot start it is told nothing they cannot act on.
    rerender(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit={false}
      />,
    );
    expect(screen.queryByText('agentRun.notStartedYet')).toBeNull();
  });
});

// A deleted agent's task: its runs stay readable, but Start/Retry would only
// kick a run for an agent that cannot exist, and a refusal names its reason.
describe('TaskAgentRunEntry — who may stop a live run', () => {
  const liveRun = () => ({
    ...settledRun(),
    status: 'running',
    settledAt: undefined,
    startedBy: 'u-member',
  });

  it('offers Stop to the person who started it on a task no longer theirs', async () => {
    cancelRun.mockReset().mockResolvedValue(null);
    state.run = liveRun();
    const canStopRun = vi.fn(
      (startedBy: string | undefined) => startedBy === 'u-member',
    );
    const user = userEvent.setup();
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit={false}
        canStopRun={canStopRun}
      />,
    );
    // Reading it is not working it: no Start or Retry.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'agentRun.cancel' }));
    expect(canStopRun).toHaveBeenCalledWith('u-member');
    expect(cancelRun).toHaveBeenCalledWith({ taskId });
  });

  it('offers no Stop to someone who neither works the task nor started the run', () => {
    state.run = liveRun();
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit={false}
        canStopRun={() => false}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'agentRun.cancel' }),
    ).toBeNull();
  });
});

describe('TaskAgentRunEntry with a missing agent', () => {
  it('withholds Retry (and Start) when the assignee is no longer a live agent', () => {
    state.run = { ...settledRun(), status: 'failed', error: 'boom' };
    const { rerender } = render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
        assigneeLive={false}
      />,
    );
    expect(screen.getByText('Failed')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    state.run = null;
    rerender(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
        assigneeLive={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Start agent' })).toBeNull();
  });

  it('names the reason a start was refused instead of the generic line', async () => {
    const user = userEvent.setup();
    state.run = { ...settledRun(), status: 'failed', error: 'boom' };
    startRun.mockReset();
    toast.mockReset();
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        assigneeId="agent-1"
        canEdit
      />,
    );

    startRun.mockResolvedValueOnce({ started: false, reason: 'agent_missing' });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(toast).toHaveBeenLastCalledWith({
      title: 'The assigned agent no longer exists.',
      variant: 'destructive',
    });

    startRun.mockResolvedValueOnce({
      started: false,
      reason: 'no_agent_assignee',
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(toast).toHaveBeenLastCalledWith({
      title: 'No agent is assigned to this task.',
      variant: 'destructive',
    });

    startRun.mockResolvedValueOnce({ started: false, reason: 'capacity' });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(toast).toHaveBeenLastCalledWith({
      title: 'The agent run could not start.',
      variant: 'destructive',
    });
  });
});
