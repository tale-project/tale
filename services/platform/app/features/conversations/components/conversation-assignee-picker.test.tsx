// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { role: 'admin' },
  }),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [
      {
        userId: 'user-1',
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
      },
    ],
  }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({
    teams: [{ id: 'team-1', name: 'Support' }],
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useAssignConversation: () => ({ mutate: vi.fn() }),
  useAssignConversationTeam: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/features/tasks/components/assignee-avatar', () => ({
  AssigneeAvatar: ({
    name,
    assigneeId,
  }: {
    name?: string;
    assigneeId?: string;
  }) => <span data-testid={`avatar-${assigneeId}`}>{name ?? assigneeId}</span>,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    hash,
    params,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    hash?: string;
    params?: { id: string };
    onClick?: () => void;
    className?: string;
  }) => (
    <a
      href={`${to}${hash ? `#${hash}` : ''}`}
      data-org={params?.id}
      className={className}
      onClick={onClick}
    >
      {children}
    </a>
  ),
}));

vi.mock('@/app/components/ui/forms/searchable-select', () => ({
  SearchableSelect: ({
    trigger,
    footer,
  }: {
    trigger: React.ReactNode;
    footer?: React.ReactNode;
  }) => (
    <div data-testid="assign-select">
      {trigger}
      {footer ? <div data-testid="assign-footer">{footer}</div> : null}
    </div>
  ),
}));

import { ConversationAssigneePicker } from './conversation-assignee-picker';

function makeConversation(
  overrides: {
    assigneeUserId?: string;
    assigneeTeamId?: string;
  } = {},
) {
  return {
    _id: 'conv-1',
    id: 'conv-1',
    organizationId: 'org-1',
    ...overrides,
  } as Parameters<typeof ConversationAssigneePicker>[0]['conversation'];
}

describe('ConversationAssigneePicker', () => {
  it('shows a dual stack when both team and person are assigned (mobile keeps both)', () => {
    render(
      <ConversationAssigneePicker
        conversation={makeConversation({
          assigneeUserId: 'user-1',
          assigneeTeamId: 'team-1',
        })}
        organizationId="org-1"
      />,
    );

    // Mobile stack encodes both dimensions — do not drop team when person is set.
    const stack = screen.getByTestId('assign-dual-stack');
    expect(stack).toHaveClass('md:hidden');
    expect(stack.querySelector('svg')).toBeInTheDocument();
    expect(
      stack.querySelector('[data-testid="avatar-user-1"]'),
    ).toBeInTheDocument();

    // Desktop still lists both labelled chips.
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('shows only the team glyph when only the team queue is set', () => {
    render(
      <ConversationAssigneePicker
        conversation={makeConversation({ assigneeTeamId: 'team-1' })}
        organizationId="org-1"
      />,
    );

    expect(screen.queryByTestId('assign-dual-stack')).not.toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
  });

  it('shows only the person avatar when only a person is assigned', () => {
    render(
      <ConversationAssigneePicker
        conversation={makeConversation({ assigneeUserId: 'user-1' })}
        organizationId="org-1"
      />,
    );

    expect(screen.queryByTestId('assign-dual-stack')).not.toBeInTheDocument();
    expect(screen.getByTestId('avatar-user-1')).toBeInTheDocument();
  });

  it('always shows Auto assign linking to conversation routing settings', () => {
    render(
      <ConversationAssigneePicker
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    const link = screen.getByRole('link', { name: /auto assign/i });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/$id/settings/governance/policies-limits#conversation-routing',
    );
    expect(link).toHaveAttribute('data-org', 'org-1');
  });

  it('shows Unassign and Auto assign together when a person is assigned', () => {
    render(
      <ConversationAssigneePicker
        conversation={makeConversation({ assigneeUserId: 'user-1' })}
        organizationId="org-1"
      />,
    );

    expect(screen.getByTestId('assign-footer')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /unassign/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /auto assign/i }),
    ).toBeInTheDocument();
  });
});
