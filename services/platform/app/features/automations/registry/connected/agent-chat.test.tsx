// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentChat, agentChatBlock } from './agent-chat';

// Stable references only — a fresh object per render from a mocked query hook
// re-render-loops the tree (see the project memory on UI test perf).
const { useConvexQueryMock } = vi.hoisted(() => ({
  useConvexQueryMock: vi.fn(),
}));

// The embed is exercised by its own tests; here it's a marker that echoes the
// props the block wired up.
vi.mock('@/app/features/chat/components/embedded-chat', () => ({
  EmbeddedChat: (props: {
    agentSlug: string;
    threadId?: string | null;
    additionalContext?: Record<string, string>;
    placeholder?: string;
  }) => (
    <div
      data-testid="embedded-chat"
      data-agent={props.agentSlug}
      data-thread={props.threadId ?? ''}
      data-context={JSON.stringify(props.additionalContext ?? null)}
      data-placeholder={props.placeholder ?? ''}
    />
  ),
}));

let threadQuery: { data: { threadId: string } | null | undefined };
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: useConvexQueryMock,
}));

const mutation = { mutateAsync: vi.fn() };
vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => mutation,
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    threads: {
      get_or_create_automation_thread: {
        getAutomationThread: 'getAutomationThread',
        getOrCreateAutomationThread: 'getOrCreateAutomationThread',
      },
    },
  },
}));

interface RuntimeShape {
  organizationId: string;
  projectId?: string;
  automationSlug: string;
  allowlist: unknown[];
  roles?: Record<string, string>;
  config: Record<string, unknown>;
}
let runtime: RuntimeShape;
vi.mock('../../runtime/automation-runtime', () => ({
  useAutomationRuntime: () => runtime,
}));

let viewState: { state: Record<string, unknown> } | null;
vi.mock('../../runtime/view-state', () => ({
  useOptionalViewState: () => viewState,
}));

function setUp({
  roles,
  state,
  query,
}: {
  roles?: Record<string, string>;
  state?: Record<string, unknown> | null;
  query?: { threadId: string } | null | undefined;
} = {}) {
  runtime = {
    organizationId: 'org-1',
    automationSlug: 'issue-desk',
    allowlist: [],
    ...(roles !== undefined && { roles }),
    config: {},
  };
  viewState = state === null ? null : { state: state ?? {} };
  threadQuery = { data: query };
  useConvexQueryMock.mockImplementation(() => threadQuery);
}

describe('AgentChat', () => {
  it('resolves the role to the manifest agent and mounts the embed on the install-scoped thread', () => {
    setUp({
      roles: { implementer: 'issue-desk-implementer' },
      query: { threadId: 'th-1' },
    });
    render(<AgentChat title="Discuss" roleToken="implementer" />);

    const embed = screen.getByTestId('embedded-chat');
    expect(embed).toHaveAttribute('data-agent', 'issue-desk-implementer');
    expect(embed).toHaveAttribute('data-thread', 'th-1');
    // No subject → the ONE install-scoped thread ('automation', <automationSlug>).
    expect(useConvexQueryMock).toHaveBeenCalledWith('getAutomationThread', {
      organizationId: 'org-1',
      automationSlug: 'issue-desk',
      subjectType: 'automation',
      subjectId: 'issue-desk',
    });
    const context = JSON.parse(embed.getAttribute('data-context') ?? 'null');
    expect(context).toEqual({
      subject_type: 'automation',
      subject_id: 'issue-desk',
    });
  });

  it('degrades to a framed notice when the role is unmapped or roles are absent', () => {
    // Roles map missing entirely (an automation published before the roles plumbing).
    setUp({ query: null });
    const { unmount } = render(
      <AgentChat title="Discuss" roleToken="implementer" />,
    );
    expect(screen.getByText('chat.roleUnavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('embedded-chat')).not.toBeInTheDocument();
    unmount();

    // Roles present but the token is not in the cast.
    setUp({ roles: { reviewer: 'issue-desk-reviewer' }, query: null });
    render(<AgentChat title="Discuss" roleToken="implementer" />);
    expect(screen.getByText('chat.roleUnavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('embedded-chat')).not.toBeInTheDocument();
  });

  it('awaits selection while a $state-bound subject id is unset, then keys the per-subject thread', () => {
    setUp({
      roles: { implementer: 'impl-agent' },
      state: {},
      query: undefined,
    });
    const { rerender } = render(
      <AgentChat
        roleToken="implementer"
        subject={{ type: 'task', id: '$state.taskId' }}
      />,
    );
    expect(screen.getByText('binding.awaitingSelection')).toBeInTheDocument();
    expect(screen.queryByTestId('embedded-chat')).not.toBeInTheDocument();

    // A sibling block writes the selection: the id resolves and the query
    // keys on the (org, automation, 'task', <id>) triplet.
    setUp({
      roles: { implementer: 'impl-agent' },
      state: { taskId: 'task-42' },
      query: null,
    });
    rerender(
      <AgentChat
        roleToken="implementer"
        subject={{ type: 'task', id: '$state.taskId' }}
      />,
    );
    expect(useConvexQueryMock).toHaveBeenLastCalledWith('getAutomationThread', {
      organizationId: 'org-1',
      automationSlug: 'issue-desk',
      subjectType: 'task',
      subjectId: 'task-42',
    });
    expect(screen.getByTestId('embedded-chat')).toHaveAttribute(
      'data-thread',
      '',
    );
  });

  it('reads idField from a host-passed item and resolves the context template over it', () => {
    setUp({
      roles: { implementer: 'impl-agent' },
      state: null, // composing hosts render outside a view-state provider
      query: { threadId: 'th-task' },
    });
    render(
      <AgentChat
        roleToken="implementer"
        subject={{ type: 'task', idField: 'id' }}
        contextTemplate="$tpl:Issue #{number}"
        item={{ id: 'task-9', number: 7 }}
      />,
    );

    const embed = screen.getByTestId('embedded-chat');
    const context = JSON.parse(embed.getAttribute('data-context') ?? 'null');
    expect(context).toEqual({
      subject_type: 'task',
      subject_id: 'task-9',
      subject_context: 'Issue #7',
    });
  });

  it('shows the loading skeleton while the thread resolve is in flight', () => {
    setUp({
      roles: { implementer: 'impl-agent' },
      query: undefined, // getAutomationThread still loading
    });
    render(<AgentChat roleToken="implementer" />);
    expect(screen.queryByTestId('embedded-chat')).not.toBeInTheDocument();
    expect(
      screen.queryByText('binding.awaitingSelection'),
    ).not.toBeInTheDocument();
  });

  it('block render guards an unauthored role', () => {
    setUp({ roles: {}, query: null });
    const { container } = render(<>{agentChatBlock.render({})}</>);
    expect(container).toBeEmptyDOMElement();
  });
});
