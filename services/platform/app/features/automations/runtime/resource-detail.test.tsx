// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundQueryResult } from '../hooks/use-bound-query';
import {
  ResourceDetailProvider,
  useResourceDetail,
  type ResourceDetailTarget,
} from './resource-detail';

// i18n → echo `<ns>.<key>`.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

// Deterministic date formatting — the real hook needs locale providers.
vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: (d: Date, preset?: string) => `dt:${d.getTime()}:${preset}`,
    formatRelative: (d: Date) => `rel:${d.getTime()}`,
  }),
}));

// The dialog's Radix portal/animation stack is irrelevant here — flat divs.
// Pass className through so the layout contract (pinned height + body scroll)
// stays assertable.
vi.mock('@tale/ui/responsive-dialog', () => ({
  ResponsiveDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children?: ReactNode;
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  ResponsiveDialogContent: ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  ResponsiveDialogTitle: ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => <h2 className={className}>{children}</h2>,
}));

// Composed sections → capture the exact props the overlay hands them.
vi.mock('./request-changes-button', () => ({
  RequestChangesButton: () => <div data-testid="request-changes" />,
}));

vi.mock('../registry/connected/bound-button', () => ({
  BoundButton: ({ action }: { action: { labelKey?: string } }) => (
    <button type="button" data-testid="mark-done">
      {action.labelKey}
    </button>
  ),
}));

vi.mock('./task-input-refs', () => ({
  TaskInputRefs: () => <div data-testid="task-input-refs" />,
}));

const subjectRunCalls: Record<string, unknown>[] = [];
vi.mock('../registry/connected/subject-run', () => ({
  SubjectRun: (props: Record<string, unknown>) => {
    subjectRunCalls.push(props);
    return <div data-testid="subject-run" />;
  },
}));

const agentChatCalls: Record<string, unknown>[] = [];
vi.mock('../registry/connected/agent-chat', () => ({
  AgentChat: (props: Record<string, unknown>) => {
    agentChatCalls.push(props);
    return <div data-testid="agent-chat" />;
  },
}));

// The comments section resolves the task itself (user-level read) and mounts
// the shared TaskComments surface — both stubbed: this suite asserts the
// composition, not the tasks feature.
const taskCommentsCalls: Record<string, unknown>[] = [];
vi.mock('../../tasks/components/task-comments', () => ({
  TaskComments: (props: Record<string, unknown>) => {
    taskCommentsCalls.push(props);
    return <div data-testid="task-comments" />;
  },
}));
const useTaskCalls: unknown[] = [];
vi.mock('../../tasks/hooks/queries', () => ({
  useTask: (taskId: unknown) => {
    useTaskCalls.push(taskId);
    return {
      task: {
        _id: taskId,
        organizationId: 'org_1',
        projectId: 'proj_1',
        status: 'in_review',
        title: 'VAT return — SoftInstallQ1',
      },
      canEdit: true,
      canClaim: false,
      canComment: true,
      isLoading: false,
    };
  },
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { userId: 'user_1', isAdmin: false },
  }),
}));

// The comments section subscribes to the subject's latest run to warn the
// composer while it is active; tests flip the status per case.
let latestRunReturn: { data: unknown; isLoading: boolean } = {
  data: null,
  isLoading: false,
};
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => latestRunReturn,
}));

// The chat section is gated on the automation's cast — the runtime context
// supplies `roles`; tests flip it to cover mapped and unmapped automations.
let runtimeRoles: Record<string, string> | undefined = {
  implementer: 'desk/helper',
};
vi.mock('./automation-runtime', () => ({
  useAutomationRuntime: () => ({
    organizationId: 'org_1',
    automationSlug: 'desk',
    roles: runtimeRoles,
  }),
}));

// Frame chrome → title marker + actions + children; states → children.
vi.mock('../registry/block-frame', () => ({
  BlockFrame: ({
    title,
    actions,
    children,
  }: {
    title?: string;
    actions?: ReactNode;
    children?: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      {actions}
      {children}
    </section>
  ),
  BindingStates: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

let activityReturn: BoundQueryResult;
const boundQueryCalls: { path: string; args: unknown }[] = [];
vi.mock('../hooks/use-bound-query', () => ({
  useBoundQuery: (path: string, args: unknown) => {
    boundQueryCalls.push({ path, args });
    return activityReturn;
  },
}));

function bound(over: Partial<BoundQueryResult>): BoundQueryResult {
  return {
    data: undefined,
    isLoading: false,
    error: undefined,
    blocked: false,
    needsConfig: false,
    ...over,
  };
}

/** Opens the overlay for `target` on mount-click — the consumer's API path. */
function Opener({ target }: { target: ResourceDetailTarget }) {
  const { open } = useResourceDetail();
  return (
    <button type="button" onClick={() => open(target)}>
      open-detail
    </button>
  );
}

function openDetail(target: ResourceDetailTarget) {
  render(
    <ResourceDetailProvider>
      <Opener target={target} />
    </ResourceDetailProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'open-detail' }));
}

afterEach(() => {
  subjectRunCalls.length = 0;
  agentChatCalls.length = 0;
  boundQueryCalls.length = 0;
  taskCommentsCalls.length = 0;
  useTaskCalls.length = 0;
  runtimeRoles = { implementer: 'desk/helper' };
  latestRunReturn = { data: null, isLoading: false };
});

describe('ResourceDetail — task subject composition', () => {
  it('composes status/actions → Input → Outcome → Details for a task', () => {
    activityReturn = bound({ data: [] });

    openDetail({ subjectType: 'task', id: 'task123' });

    expect(screen.getByText('tasks.status.in_review')).toBeInTheDocument();
    expect(screen.getByTestId('request-changes')).toBeInTheDocument();
    expect(screen.getByTestId('mark-done')).toBeInTheDocument();

    expect(screen.getByText('automations.detail.input')).toBeInTheDocument();
    expect(screen.getByText('VAT return — SoftInstallQ1')).toBeInTheDocument();
    expect(screen.getByTestId('task-input-refs')).toBeInTheDocument();

    expect(subjectRunCalls).toEqual([
      { subjectType: 'task', subjectId: 'task123' },
    ]);

    expect(screen.getByText('automations.detail.more')).toBeInTheDocument();
    expect(boundQueryCalls).toEqual([
      {
        path: 'tasks/queries:listTaskActivity',
        args: { taskId: 'task123', organizationId: '$orgId' },
      },
    ]);
    // Status bar + comments section each resolve the task.
    expect(useTaskCalls.length).toBeGreaterThanOrEqual(2);
    expect(taskCommentsCalls).toHaveLength(1);
    expect(taskCommentsCalls[0]).toMatchObject({
      taskId: 'task123',
      organizationId: 'org_1',
      projectId: 'proj_1',
      canComment: true,
      currentUserId: 'user_1',
    });

    expect(agentChatCalls).toHaveLength(1);
    expect(agentChatCalls[0]).toMatchObject({
      roleToken: 'implementer',
      subject: { type: 'task', id: 'task123' },
      title: 'automations.detail.discuss',
      placeholder: 'automations.detail.chatPlaceholder',
    });

    expect(screen.getByText('automations.detail.activity')).toBeInTheDocument();
    expect(
      screen.queryByText('automations.detail.run'),
    ).not.toBeInTheDocument();
  });

  it('hides the chat section entirely when the automation maps no implementer role', () => {
    activityReturn = bound({ data: [] });
    runtimeRoles = {};

    openDetail({ subjectType: 'task', id: 'task123' });

    // No AgentChat — not even the "role unavailable" notice; the comments
    // section stays (it is the desk feedback channel, role-independent).
    expect(agentChatCalls).toHaveLength(0);
    expect(taskCommentsCalls).toHaveLength(1);
  });

  it('renders activity rows with localized actions, status transition and time', () => {
    activityReturn = bound({
      data: [
        {
          _id: 'a1',
          action: 'status.changed',
          fromValue: 'todo',
          toValue: 'in_progress',
          createdAt: 1_700_000_000_000,
        },
        { _id: 'a2', action: 'custom.event', createdAt: 1_700_000_100_000 },
      ],
    });

    openDetail({ subjectType: 'task', id: 'task123' });

    // Known action + statuses localize via the tasks namespace…
    expect(
      screen.getByText(
        'tasks.activity.statusChanged: tasks.status.todo → tasks.status.in_progress',
      ),
    ).toBeInTheDocument();
    // …an unknown action degrades to its raw name, never a blank.
    expect(screen.getByText('custom.event')).toBeInTheDocument();
    expect(screen.getByText('rel:1700000000000')).toBeInTheDocument();
  });

  it('shows the shared empty notice when the task has no activity', () => {
    activityReturn = bound({ data: [] });

    openDetail({ subjectType: 'task', id: 'task123' });

    expect(screen.getByText('automations.binding.empty')).toBeInTheDocument();
  });

  it('warns at the comment composer while the subject run is active', () => {
    activityReturn = bound({ data: [] });
    latestRunReturn = {
      data: { executionId: 'exec1', status: 'running', startedAt: 1 },
      isLoading: false,
    };

    openDetail({ subjectType: 'task', id: 'task123' });

    expect(taskCommentsCalls[0]).toMatchObject({
      composerHint: 'automations.detail.commentsDuringRun',
    });
  });

  it('passes no composer hint once the run settled', () => {
    activityReturn = bound({ data: [] });
    latestRunReturn = {
      data: { executionId: 'exec1', status: 'completed', startedAt: 1 },
      isLoading: false,
    };

    openDetail({ subjectType: 'task', id: 'task123' });

    expect(taskCommentsCalls[0]?.composerHint).toBeUndefined();
  });
});

describe('ResourceDetail — non-task subjects keep the run-only body', () => {
  it('renders only SubjectRun for another subject type', () => {
    activityReturn = bound({ data: [] });

    openDetail({ subjectType: 'order', id: 'order9' });

    expect(subjectRunCalls).toEqual([
      { subjectType: 'order', subjectId: 'order9' },
    ]);
    expect(agentChatCalls).toHaveLength(0);
    expect(boundQueryCalls).toHaveLength(0);
    expect(screen.queryByTestId('request-changes')).not.toBeInTheDocument();
    expect(
      screen.queryByText('automations.detail.input'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('automations.detail.more'),
    ).not.toBeInTheDocument();
  });

  it('falls back to the generic localized dialog title', () => {
    activityReturn = bound({ data: [] });

    openDetail({ subjectType: 'order', id: 'order9' });

    expect(
      screen.getByRole('heading', { name: 'automations.detail.title' }),
    ).toBeInTheDocument();
  });
});

describe('ResourceDetail — dialog scroll shell', () => {
  it('pins desktop height and scrolls the body so the last card is not clipped', () => {
    activityReturn = bound({ data: [] });

    openDetail({ subjectType: 'task', id: 'task123' });

    // Overflow on the dialog itself clips BlockFrame border/shadow at the
    // bottom; the body scrollport must own overflow instead (task-modal).
    const content = screen.getByTestId('dialog-content');
    expect(content.className).toMatch(/md:overflow-hidden/);
    expect(content.className).toMatch(/md:h-\[85dvh\]/);
    expect(content.className).toMatch(/md:flex-col/);

    const body = content.querySelector('.mt-4');
    expect(body).not.toBeNull();
    expect(body?.className).toMatch(/md:overflow-y-auto/);
    expect(body?.className).toMatch(/md:min-h-0/);
    expect(body?.className).toMatch(/md:flex-1/);
  });
});
