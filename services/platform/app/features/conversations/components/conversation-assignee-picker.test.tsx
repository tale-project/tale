// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberLookupTarget } from '@/app/features/settings/organization/hooks/member-lookup';
import type { StandInMember } from '@/tests/utils/member-lookup-stand-in';
import { render, screen, within } from '@/tests/utils/render';

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { role: 'admin' },
  }),
}));

const memberReads = vi.hoisted(() => ({
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
  ] as StandInMember[],
  /** Whom the member lookup was asked for. */
  asked: new Array<MemberLookupTarget>(),
  /** What each render searched the people for. */
  searches: new Array<{ query: string; access?: string; enabled?: boolean }>(),
  /** The people the search found, unless a test says otherwise. */
  found: undefined as StandInMember[] | undefined,
  more: false,
  unavailable: false,
}));

// The options are the people found, here as if the picker were open; the
// trigger's assignee comes from the member lookup.
vi.mock('@/app/features/settings/organization/hooks/member-search', () => ({
  useMemberSearch: (
    _organizationId: string,
    query: string,
    options: { access?: string; enabled?: boolean },
  ) => {
    memberReads.searches.push({ query, ...options });
    return {
      members: memberReads.found ?? memberReads.members,
      more: memberReads.more,
      searching: false,
      unavailable: memberReads.unavailable,
    };
  },
}));
vi.mock('@/app/features/settings/organization/hooks/member-lookup', async () =>
  (await import('@/tests/utils/member-lookup-stand-in')).memberLookupStandIn(
    () => memberReads.members,
    memberReads.asked,
  ),
);

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

vi.mock('@tale/ui/searchable-select', async () => {
  const { useState } = await import('react');
  return {
    SearchableSelect: function StubSelect({
      trigger,
      footer,
      options = [],
      optionAction,
      onValueChange,
      onOpenChange,
      onSearchChange,
      filterFn,
    }: {
      trigger: React.ReactNode;
      footer?: React.ReactNode;
      options?: StubOption[];
      optionAction?: (option: StubOption) => React.ReactNode;
      onValueChange?: (value: string) => void;
      onOpenChange?: (open: boolean) => void;
      onSearchChange?: (query: string) => void;
      filterFn?: (option: StubOption, query: string) => boolean;
    }) {
      // The real component owns the text and filters the rows with it.
      const [typed, setTyped] = useState('');
      return (
        <div data-testid="assign-select">
          <div data-testid="assign-trigger">{trigger}</div>
          <button type="button" onClick={() => onOpenChange?.(true)}>
            Open the picker
          </button>
          <input
            aria-label="Search people and teams"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              onSearchChange?.(event.target.value);
            }}
          />
          {options
            .filter((option) => option.isSectionHeader !== true)
            .filter((option) => filterFn?.(option, typed) ?? true)
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
      );
    },
  };
});

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
    memberReads.asked.length = 0;
    memberReads.searches.length = 0;
    memberReads.found = undefined;
    memberReads.more = false;
    memberReads.unavailable = false;
  });

  it('looks up the assignee alone, and searches the people once opened', async () => {
    const { user } = render(
      <ConversationAssigneePicker
        conversation={makeConversation({ assigneeUserId: 'user-2' })}
        organizationId="org-1"
      />,
    );

    expect(
      within(screen.getByTestId('assign-trigger')).getAllByText('Grace Hopper')
        .length,
    ).toBeGreaterThan(0);
    expect(
      new Set(memberReads.asked.map((ask) => JSON.stringify(ask))),
    ).toEqual(new Set([JSON.stringify({ userId: 'user-2' })]));
    // A thread that is only read searches nobody.
    expect(memberReads.searches.map((search) => search.enabled)).not.toContain(
      true,
    );

    await user.click(screen.getByRole('button', { name: 'Open the picker' }));

    // Only who may take a conversation: no disabled member.
    expect(memberReads.searches.at(-1)).toEqual({
      query: '',
      access: 'read',
      enabled: true,
    });

    await user.type(
      screen.getByRole('textbox', { name: 'Search people and teams' }),
      'gr',
    );

    expect(memberReads.searches.at(-1)).toEqual({
      query: 'gr',
      access: 'read',
      enabled: true,
    });
  });

  it('finds a person by name or email, and a team by its name', async () => {
    const { user } = render(
      <ConversationAssigneePicker
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );
    const box = screen.getByRole('textbox', {
      name: 'Search people and teams',
    });

    await user.type(box, 'grace@');
    expect(screen.getByTestId('option-user:user-2')).toBeInTheDocument();
    expect(screen.queryByTestId('option-user:user-1')).toBeNull();
    expect(screen.queryByTestId('option-team:team-1')).toBeNull();

    await user.clear(box);
    await user.type(box, 'supp');
    expect(screen.getByTestId('option-team:team-1')).toBeInTheDocument();
    expect(screen.queryByTestId('option-user:user-2')).toBeNull();
  });

  it('keeps the assignee offered and marked when the page found does not hold them', () => {
    memberReads.found = [memberReads.members[0]!];
    render(
      <ConversationAssigneePicker
        conversation={makeConversation({ assigneeUserId: 'user-2' })}
        organizationId="org-1"
      />,
    );

    expect(screen.getByTestId('option-user:user-2')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('option-user:user-1')).toBeInTheDocument();
  });

  it('offers no disabled assignee, and still clears them', async () => {
    const before = memberReads.members;
    memberReads.members = [
      ...before,
      {
        userId: 'user-3',
        displayName: 'Former Colleague',
        email: 'former@example.com',
        role: 'disabled' as const,
      },
    ];
    memberReads.found = before;
    try {
      const { user } = render(
        <ConversationAssigneePicker
          conversation={makeConversation({ assigneeUserId: 'user-3' })}
          organizationId="org-1"
        />,
      );

      expect(screen.queryByTestId('option-user:user-3')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Unassign' }));
      expect(mutations.assignUser).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        assigneeUserId: null,
      });
    } finally {
      memberReads.members = before;
    }
  });

  it.each([
    ['more', 'More people match — keep typing to narrow the list.'],
    [
      'unavailable',
      "People couldn't be searched — try again, or reload the page if it keeps happening.",
    ],
  ] as const)('says when the search found %s', (state, note) => {
    memberReads[state] = true;
    render(
      <ConversationAssigneePicker
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(
      within(screen.getByTestId('assign-footer')).getByText(note),
    ).toBeInTheDocument();
  });

  it('shows a dual stack when both team and person are assigned (a narrow header keeps both)', () => {
    render(
      <ConversationAssigneePicker
        conversation={makeConversation({
          assigneeUserId: 'user-1',
          assigneeTeamId: 'team-1',
        })}
        organizationId="org-1"
      />,
    );

    // The narrow header's stack encodes both dimensions — do not drop the team
    // when a person is set; the labels wait for a wide header.
    const stack = screen.getByTestId('assign-dual-stack');
    expect(stack).toHaveClass('@3xl/thread-header:hidden');
    expect(stack.querySelector('svg')).toBeInTheDocument();
    expect(
      stack.querySelector('[data-testid="avatar-user-1"]'),
    ).toBeInTheDocument();

    // A wide header still lists both labelled chips.
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

      expect(mutations.assignUser).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        assigneeUserId: null,
      });
    });

    it('assigns instead when a different person is picked', async () => {
      const { user } = render(
        <ConversationAssigneePicker
          conversation={makeConversation({ assigneeUserId: 'user-1' })}
          organizationId="org-1"
        />,
      );

      await user.click(screen.getByTestId('option-user:user-2'));

      expect(mutations.assignUser).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        assigneeUserId: 'user-2',
      });
    });

    it('clears the team queue when the assigned team is picked again', async () => {
      const { user } = render(
        <ConversationAssigneePicker
          conversation={makeConversation({ assigneeTeamId: 'team-1' })}
          organizationId="org-1"
        />,
      );

      await user.click(screen.getByTestId('option-team:team-1'));

      expect(mutations.assignTeam).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        assigneeTeamId: null,
      });
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

    // `null` is the clear the assignment doors take; `undefined` went over
    // the wire as `null` too, but nothing said so and the door refused it.
    it.each([
      ['Unassign', 'assignUser', { assigneeUserId: null }],
      ['Remove team', 'assignTeam', { assigneeTeamId: null }],
    ] as const)(
      'clears one dimension with null from the footer’s %s',
      async (label, mutation, cleared) => {
        const { user } = render(
          <ConversationAssigneePicker
            conversation={makeConversation({
              assigneeUserId: 'user-1',
              assigneeTeamId: 'team-1',
            })}
            organizationId="org-1"
          />,
        );

        await user.click(screen.getByRole('button', { name: label }));

        expect(mutations[mutation]).toHaveBeenCalledTimes(1);
        expect(mutations[mutation]).toHaveBeenCalledWith({
          conversationId: 'conv-1',
          ...cleared,
        });
        expect(
          mutations[mutation === 'assignUser' ? 'assignTeam' : 'assignUser'],
        ).not.toHaveBeenCalled();
      },
    );

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
