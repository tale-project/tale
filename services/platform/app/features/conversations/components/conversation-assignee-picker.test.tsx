// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

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
      {
        userId: 'user-2',
        displayName: 'Grace Hopper',
        email: 'grace@example.com',
      },
    ],
  }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({
    teams: [{ id: 'team-1', name: 'Support' }],
  }),
}));

const mutations = vi.hoisted(() => ({
  assignUser: vi.fn(),
  assignTeam: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useAssignConversation: () => ({ mutate: mutations.assignUser }),
  useAssignConversationTeam: () => ({ mutate: mutations.assignTeam }),
}));

vi.mock('@tale/ui/use-toast', () => ({
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
    state,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    hash?: string;
    params?: { id: string };
    state?: {
      openRoutingRule?: boolean;
      routingAddress?: string;
      returnToConversation?: { id: string; status: string };
    };
    onClick?: () => void;
    className?: string;
  }) => (
    <a
      href={`${to}${hash ? `#${hash}` : ''}`}
      data-org={params?.id}
      data-state={state ? JSON.stringify(state) : undefined}
      className={className}
      onClick={onClick}
    >
      {children}
    </a>
  ),
}));

interface StubOption {
  value: string;
  label: string;
  selected?: boolean;
  isSectionHeader?: boolean;
}

vi.mock('@tale/ui/searchable-select', () => ({
  SearchableSelect: ({
    trigger,
    footer,
    options = [],
    optionAction,
    onValueChange,
  }: {
    trigger: React.ReactNode;
    footer?: React.ReactNode;
    options?: StubOption[];
    optionAction?: (option: StubOption) => React.ReactNode;
    onValueChange?: (value: string) => void;
  }) => (
    <div data-testid="assign-select">
      <div data-testid="assign-trigger">{trigger}</div>
      {options
        .filter((option) => option.isSectionHeader !== true)
        .map((option) => (
          <button
            key={option.value}
            type="button"
            // `role="option"` mirrors the real component, and keeps the
            // footer's `getByRole('button')` queries unambiguous.
            role="option"
            aria-selected={option.selected === true}
            data-testid={`option-${option.value}`}
            data-selected={String(option.selected)}
            onClick={() => onValueChange?.(option.value)}
          >
            {option.label}
            {optionAction?.(option)}
          </button>
        ))}
      {footer ? <div data-testid="assign-footer">{footer}</div> : null}
    </div>
  ),
}));

import { ConversationAssigneePicker } from './conversation-assignee-picker';

function makeConversation(
  overrides: {
    assigneeUserId?: string;
    assigneeTeamId?: string;
    direction?: 'inbound' | 'outbound';
    metadata?: Record<string, unknown>;
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
  beforeEach(() => {
    mutations.assignUser.mockClear();
    mutations.assignTeam.mockClear();
  });

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
    const trigger = within(screen.getByTestId('assign-trigger'));
    expect(trigger.getByText('Support')).toBeInTheDocument();
    expect(trigger.getAllByText('Ada Lovelace').length).toBeGreaterThanOrEqual(
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
    expect(
      within(screen.getByTestId('assign-trigger')).getByText('Support'),
    ).toBeInTheDocument();
  });

  it('shows only the person avatar when only a person is assigned', () => {
    render(
      <ConversationAssigneePicker
        conversation={makeConversation({ assigneeUserId: 'user-1' })}
        organizationId="org-1"
      />,
    );

    expect(screen.queryByTestId('assign-dual-stack')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('assign-trigger')).getByTestId('avatar-user-1'),
    ).toBeInTheDocument();
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
    expect(link).toHaveAttribute(
      'data-state',
      JSON.stringify({
        openRoutingRule: true,
        returnToConversation: { id: 'conv-1', status: 'open' },
      }),
    );
  });

  it('passes the inbound mailbox address via location state, not the URL', () => {
    render(
      <ConversationAssigneePicker
        conversation={makeConversation({
          direction: 'inbound',
          metadata: { to: [{ address: 'billing@acme.test' }] },
        })}
        organizationId="org-1"
      />,
    );

    const link = screen.getByRole('link', { name: /auto assign/i });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/$id/settings/governance/policies-limits#conversation-routing',
    );
    expect(link.getAttribute('href')).not.toContain('routingAddress');
    expect(link).toHaveAttribute(
      'data-state',
      JSON.stringify({
        openRoutingRule: true,
        routingAddress: 'billing@acme.test',
        returnToConversation: { id: 'conv-1', status: 'open' },
      }),
    );
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

  describe('re-picking the current row', () => {
    it('clears the person when the assigned person is picked again', async () => {
      const { user } = render(
        <ConversationAssigneePicker
          conversation={makeConversation({ assigneeUserId: 'user-1' })}
          organizationId="org-1"
        />,
      );

      await user.click(screen.getByTestId('option-user:user-1'));

      expect(mutations.assignUser).toHaveBeenCalledWith(
        { conversationId: 'conv-1', assigneeUserId: undefined },
        expect.anything(),
      );
    });

    it('assigns instead when a different person is picked', async () => {
      const { user } = render(
        <ConversationAssigneePicker
          conversation={makeConversation({ assigneeUserId: 'user-1' })}
          organizationId="org-1"
        />,
      );

      await user.click(screen.getByTestId('option-user:user-2'));

      expect(mutations.assignUser).toHaveBeenCalledWith(
        { conversationId: 'conv-1', assigneeUserId: 'user-2' },
        expect.anything(),
      );
    });

    it('clears the team queue when the assigned team is picked again', async () => {
      const { user } = render(
        <ConversationAssigneePicker
          conversation={makeConversation({ assigneeTeamId: 'team-1' })}
          organizationId="org-1"
        />,
      );

      await user.click(screen.getByTestId('option-team:team-1'));

      expect(mutations.assignTeam).toHaveBeenCalledWith(
        { conversationId: 'conv-1', assigneeTeamId: undefined },
        expect.anything(),
      );
    });

    // The two stamps are independent: releasing a personal claim must leave the
    // conversation in its team queue, or it drops to admin-only triage.
    it('leaves the team queue alone when the person is cleared', async () => {
      const { user } = render(
        <ConversationAssigneePicker
          conversation={makeConversation({
            assigneeUserId: 'user-1',
            assigneeTeamId: 'team-1',
          })}
          organizationId="org-1"
        />,
      );

      await user.click(screen.getByTestId('option-user:user-1'));

      expect(mutations.assignUser).toHaveBeenCalledTimes(1);
      expect(mutations.assignTeam).not.toHaveBeenCalled();
    });

    it('leaves the person alone when the team queue is cleared', async () => {
      const { user } = render(
        <ConversationAssigneePicker
          conversation={makeConversation({
            assigneeUserId: 'user-1',
            assigneeTeamId: 'team-1',
          })}
          organizationId="org-1"
        />,
      );

      await user.click(screen.getByTestId('option-team:team-1'));

      expect(mutations.assignTeam).toHaveBeenCalledTimes(1);
      expect(mutations.assignUser).not.toHaveBeenCalled();
    });
  });

  describe('selected state', () => {
    it('marks the assigned person and team, and nothing else', () => {
      render(
        <ConversationAssigneePicker
          conversation={makeConversation({
            assigneeUserId: 'user-1',
            assigneeTeamId: 'team-1',
          })}
          organizationId="org-1"
        />,
      );

      expect(screen.getByTestId('option-user:user-1')).toHaveAttribute(
        'data-selected',
        'true',
      );
      expect(screen.getByTestId('option-team:team-1')).toHaveAttribute(
        'data-selected',
        'true',
      );
      expect(screen.getByTestId('option-user:user-2')).toHaveAttribute(
        'data-selected',
        'false',
      );
    });

    it('marks nothing when the conversation is unassigned', () => {
      render(
        <ConversationAssigneePicker
          conversation={makeConversation()}
          organizationId="org-1"
        />,
      );

      for (const id of ['option-user:user-1', 'option-team:team-1']) {
        expect(screen.getByTestId(id)).toHaveAttribute(
          'data-selected',
          'false',
        );
      }
    });

    // The gesture is invisible, so it must at least be announced.
    it('tells assistive technology that the assigned row clears it', () => {
      render(
        <ConversationAssigneePicker
          conversation={makeConversation({ assigneeUserId: 'user-1' })}
          organizationId="org-1"
        />,
      );

      expect(screen.getByTestId('option-user:user-1').textContent).toContain(
        'Choose again to unassign',
      );
      expect(
        screen.getByTestId('option-user:user-2').textContent,
      ).not.toContain('Choose again to unassign');
    });
  });
});
