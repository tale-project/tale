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
vi.mock('@tale/ui/responsive-dialog', () => ({
  ResponsiveDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children?: ReactNode;
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  ResponsiveDialogContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  ResponsiveDialogTitle: ({ children }: { children?: ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

// Composed sections → capture the exact props the overlay hands them.
const detailPanelCalls: Record<string, unknown>[] = [];
vi.mock('../registry/connected/detail-panel', () => ({
  DetailPanel: (props: Record<string, unknown>) => {
    detailPanelCalls.push(props);
    return <div data-testid="detail-panel" />;
  },
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

// Frame chrome → title marker + children; states → children (happy path).
vi.mock('../registry/block-frame', () => ({
  BlockFrame: ({
    title,
    children,
  }: {
    title?: string;
    children?: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
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
  detailPanelCalls.length = 0;
  subjectRunCalls.length = 0;
  agentChatCalls.length = 0;
  boundQueryCalls.length = 0;
});

describe('ResourceDetail — task subject composition', () => {
  it('composes DetailPanel + SubjectRun + activity + AgentChat for a task', () => {
    activityReturn = bound({ data: [] });

    openDetail({ subjectType: 'task', id: 'task123' });

    // Fields section binds getTask on the overlay's id (org via sentinel) and
    // reads through the result's `task.` envelope.
    expect(detailPanelCalls).toHaveLength(1);
    expect(detailPanelCalls[0]?.query).toEqual({
      path: 'tasks/queries:getTask',
      args: { taskId: 'task123', organizationId: '$orgId' },
    });
    const fields = detailPanelCalls[0]?.fields as { field: string }[];
    expect(fields.map((f) => f.field)).toEqual([
      'task.title',
      'task.number',
      'task.status',
      'task.priority',
      'task.externalUrl',
    ]);

    // The run section keeps the existing SubjectRun, unchanged.
    expect(subjectRunCalls).toEqual([
      { subjectType: 'task', subjectId: 'task123' },
    ]);

    // Activity binds the platform activity query through the automation allowlist.
    expect(boundQueryCalls).toEqual([
      {
        path: 'tasks/queries:listTaskActivity',
        args: { taskId: 'task123', organizationId: '$orgId' },
      },
    ]);

    // The chat rides the automation's implementer role on the shared task thread.
    expect(agentChatCalls).toHaveLength(1);
    expect(agentChatCalls[0]).toMatchObject({
      roleToken: 'implementer',
      subject: { type: 'task', id: 'task123' },
      title: 'automations.detail.discuss',
      placeholder: 'automations.detail.chatPlaceholder',
    });

    // Section labels are platform i18n strings (the per-bundle label catalog
    // is retired for this overlay — see the component header).
    expect(screen.getByText('automations.detail.run')).toBeInTheDocument();
    expect(screen.getByText('automations.detail.activity')).toBeInTheDocument();
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
});

describe('ResourceDetail — non-task subjects keep the run-only body', () => {
  it('renders only SubjectRun for another subject type', () => {
    activityReturn = bound({ data: [] });

    openDetail({ subjectType: 'order', id: 'order9' });

    expect(subjectRunCalls).toEqual([
      { subjectType: 'order', subjectId: 'order9' },
    ]);
    expect(detailPanelCalls).toHaveLength(0);
    expect(agentChatCalls).toHaveLength(0);
    expect(boundQueryCalls).toHaveLength(0);
  });

  it('falls back to the generic localized dialog title', () => {
    activityReturn = bound({ data: [] });

    openDetail({ subjectType: 'order', id: 'order9' });

    expect(
      screen.getByRole('heading', { name: 'automations.detail.title' }),
    ).toBeInTheDocument();
  });
});
