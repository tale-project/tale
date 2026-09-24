import { describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { ConversationRoutingPolicyEditor } from './conversation-routing-policy-editor';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => navigate,
    Link: ({
      children,
      to,
      params,
      search,
      className,
    }: {
      children: React.ReactNode;
      to: string;
      params?: { id: string; status?: string };
      search?: { conversation?: string };
      className?: string;
    }) => {
      const qs = search?.conversation
        ? `?conversation=${search.conversation}`
        : '';
      const status = params?.status ? `/${params.status}` : '';
      return (
        <a
          href={`${to}${status}${qs}`}
          data-org={params?.id}
          className={className}
        >
          {children}
        </a>
      );
    },
  };
});

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const upsert = vi.fn();
const upsertAsync = vi.fn(async (_args: unknown) => undefined);
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutate: upsert,
    mutateAsync: upsertAsync,
    isPending: false,
  }),
}));

const MAILBOXES = [
  {
    id: 'cred-general',
    connectorSlug: 'imap-smtp',
    name: 'General Support',
    status: 'active',
    config: { fromAddress: 'hello@support.test' },
  },
  {
    id: 'cred-slack',
    connectorSlug: 'slack',
    name: 'Team chat',
    status: 'active',
  },
];
vi.mock('@/app/features/conversations/hooks/queries', () => ({
  EMAIL_PROVIDER_SLUGS: new Set(['gmail', 'outlook', 'imap-smtp']),
  useMailboxes: () => ({ mailboxes: MAILBOXES }),
}));
const API_SOURCES = { data: ['helpdesk'] };
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => API_SOURCES,
}));

// The pickers reduced to their options, so a test can pick one (the real
// component opens a popover).
vi.mock('@tale/ui/searchable-select', () => ({
  SearchableSelect: ({
    options = [],
    onValueChange,
    'aria-label': ariaLabel,
  }: {
    options?: { value: string; label: string; isSectionHeader?: boolean }[];
    onValueChange?: (value: string) => void;
    'aria-label'?: string;
  }) => (
    <div role="group" aria-label={ariaLabel}>
      {options
        .filter((option) => option.isSectionHeader !== true)
        .map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={false}
            data-testid={`option-${option.value}`}
            onClick={() => onValueChange?.(option.value)}
          >
            {option.label}
          </button>
        ))}
    </div>
  ),
}));

const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { enabled: true, rules: [] as unknown[] } as Record<
      string,
      unknown
    > | null,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

const STABLE_MEMBERS = { members: [{ userId: 'u1', displayName: 'Alice' }] };
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => STABLE_MEMBERS,
}));

const STABLE_TEAMS = { teams: [{ id: 't1', name: 'Finance' }] };
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => STABLE_TEAMS,
}));

const { ability } = vi.hoisted(() => ({
  ability: { cannot: (): boolean => false },
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ability,
}));

describe('ConversationRoutingPolicyEditor', () => {
  it('renders the empty state + Add rule action when there are no rules', () => {
    state.isLoading = false;
    state.config = { enabled: true, rules: [] };
    render(<ConversationRoutingPolicyEditor organizationId="org-1" />);
    expect(
      screen.getByRole('button', { name: /add rule/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no routing rules/i)).toBeInTheDocument();
  });

  it('renders a rule row with its address and resolved team/person target', () => {
    state.isLoading = false;
    state.config = {
      rules: [{ address: 'billing@acme.test', teamId: 't1', userId: 'u1' }],
    };
    render(<ConversationRoutingPolicyEditor organizationId="org-1" />);
    expect(screen.getByText('billing@acme.test')).toBeInTheDocument();
    expect(screen.getByText('Finance · Alice')).toBeInTheDocument();
  });

  it('disables the Add rule action for a member without orgSettings write', () => {
    ability.cannot = () => true;
    state.config = { enabled: true, rules: [] };
    render(<ConversationRoutingPolicyEditor organizationId="org-1" />);
    expect(screen.getByRole('button', { name: /add rule/i })).toBeDisabled();
    ability.cannot = () => false;
  });

  it('opens Add rule prefilled from a handoff and keeps the return target', async () => {
    navigate.mockClear();
    state.isLoading = false;
    state.config = { enabled: true, rules: [] };
    render(
      <ConversationRoutingPolicyEditor
        organizationId="org-1"
        openAddRule
        initialAddress="billing@acme.test"
        returnToConversation={{ id: 'conv-1', status: 'open' }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('billing@acme.test')).toBeInTheDocument();
    expect(
      screen.getByText(/these rules live here under conversation routing/i),
    ).toBeInTheDocument();
    // Back link sits under the dialog (aria-hidden while modal is open).
    expect(
      screen.getByText('Back to conversation', { selector: 'a' }),
    ).toBeInTheDocument();

    const call = navigate.mock.calls[0]?.[0] as {
      state: (prev: {
        openRoutingRule?: boolean;
        routingAddress?: string;
        routingArrivesOn?: string;
        returnToConversation?: { id: string; status: string };
      }) => Record<string, unknown>;
    };
    expect(
      call.state({
        openRoutingRule: true,
        routingAddress: 'billing@acme.test',
        routingArrivesOn: 'mailbox:cred-general',
        returnToConversation: { id: 'conv-1', status: 'open' },
      }),
    ).toEqual({
      returnToConversation: { id: 'conv-1', status: 'open' },
    });
  });

  it('shows Back to conversation when a return target is present', () => {
    state.isLoading = false;
    state.config = { enabled: true, rules: [] };
    render(
      <ConversationRoutingPolicyEditor
        organizationId="org-1"
        returnToConversation={{ id: 'conv-9', status: 'closed' }}
      />,
    );

    const back = screen.getByRole('link', { name: /back to conversation/i });
    expect(back).toBeInTheDocument();
  });

  /**
   * Rules can match where a conversation arrived — one mailbox, one API app —
   * not only the address. Those live in `sourceRules`, which the editor must
   * write and must never drop.
   */
  describe('where a conversation arrives', () => {
    it('saves a rule for one mailbox, with no address, into sourceRules', async () => {
      upsert.mockClear();
      state.isLoading = false;
      state.config = {
        enabled: true,
        rules: [{ address: 'billing@acme.test', teamId: 't1' }],
      };
      const { user } = render(
        <ConversationRoutingPolicyEditor organizationId="org-1" />,
      );

      await user.click(screen.getByRole('button', { name: /add rule/i }));
      await user.click(screen.getByTestId('option-mailbox:cred-general'));
      await user.click(screen.getByTestId('option-team:t1'));
      await user.click(screen.getByRole('button', { name: 'Save rule' }));

      expect(upsert.mock.calls[0]?.[0]).toMatchObject({
        policyType: 'conversation_routing',
        config: {
          enabled: true,
          rules: [{ address: 'billing@acme.test', teamId: 't1' }],
          sourceRules: [{ mailbox: 'cred-general', teamId: 't1' }],
        },
      });
    });

    it('lists email mailboxes and API apps as arrival points', async () => {
      state.isLoading = false;
      state.config = { enabled: true, rules: [] };
      const { user } = render(
        <ConversationRoutingPolicyEditor organizationId="org-1" />,
      );

      await user.click(screen.getByRole('button', { name: /add rule/i }));
      expect(screen.getByTestId('option-any')).toHaveTextContent('Any mailbox');
      expect(
        screen.getByTestId('option-mailbox:cred-general'),
      ).toHaveTextContent('General Support');
      expect(screen.getByTestId('option-api:helpdesk')).toHaveTextContent(
        'API: helpdesk',
      );
      // A credential on a connector that is not a mailbox is no arrival point.
      expect(
        screen.queryByTestId('option-mailbox:cred-slack'),
      ).not.toBeInTheDocument();
    });

    it('asks no address for an API app, and saves it by source', async () => {
      upsert.mockClear();
      state.isLoading = false;
      state.config = { enabled: true, rules: [] };
      const { user } = render(
        <ConversationRoutingPolicyEditor organizationId="org-1" />,
      );

      await user.click(screen.getByRole('button', { name: /add rule/i }));
      expect(screen.getByLabelText('Sent to')).toBeInTheDocument();
      await user.click(screen.getByTestId('option-api:helpdesk'));
      expect(screen.queryByLabelText('Sent to')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('option-team:t1'));
      await user.click(screen.getByRole('button', { name: 'Save rule' }));

      expect(upsert.mock.calls[0]?.[0]).toMatchObject({
        config: {
          rules: [],
          sourceRules: [{ apiSource: 'helpdesk', teamId: 't1' }],
        },
      });
    });

    it('needs an address for any mailbox, and refuses a duplicate', async () => {
      state.isLoading = false;
      state.config = {
        enabled: true,
        rules: [{ address: 'billing@acme.test', teamId: 't1' }],
      };
      const { user } = render(
        <ConversationRoutingPolicyEditor organizationId="org-1" />,
      );

      await user.click(screen.getByRole('button', { name: /add rule/i }));
      await user.click(screen.getByTestId('option-team:t1'));
      const save = screen.getByRole('button', { name: 'Save rule' });
      expect(save).toBeDisabled();

      await user.type(screen.getByLabelText('Sent to'), 'Billing@acme.test');
      expect(save).toBeDisabled();
      expect(
        screen.getByText('A rule for this mailbox and address already exists'),
      ).toBeInTheDocument();

      // The same address on one mailbox is a different rule.
      await user.click(screen.getByTestId('option-mailbox:cred-general'));
      expect(save).toBeEnabled();
    });

    it('keeps sourceRules when the section is switched off', async () => {
      upsertAsync.mockClear();
      state.isLoading = false;
      state.config = {
        enabled: true,
        rules: [],
        sourceRules: [{ apiSource: 'helpdesk', teamId: 't1' }],
      };
      const { user } = render(
        <ConversationRoutingPolicyEditor organizationId="org-1" />,
      );

      await user.click(
        screen.getByRole('switch', { name: 'Conversation routing' }),
      );

      await waitFor(() => expect(upsertAsync).toHaveBeenCalled());
      expect(upsertAsync.mock.calls[0]?.[0]).toMatchObject({
        config: {
          enabled: false,
          sourceRules: [{ apiSource: 'helpdesk', teamId: 't1' }],
        },
      });
    });

    it('names each row by where it applies, and a removed mailbox as such', () => {
      state.isLoading = false;
      state.config = {
        enabled: true,
        rules: [{ address: 'billing@acme.test', teamId: 't1' }],
        sourceRules: [
          { mailbox: 'cred-general', teamId: 't1' },
          { mailbox: 'cred-gone', userId: 'u1' },
          { apiSource: 'helpdesk', teamId: 't1' },
        ],
      };
      render(<ConversationRoutingPolicyEditor organizationId="org-1" />);

      const rows = screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent);
      expect(rows).toEqual([
        expect.stringContaining('Any mailbox'),
        expect.stringContaining('General Support'),
        expect.stringContaining('Removed mailbox'),
        expect.stringContaining('API: helpdesk'),
      ]);
      expect(rows[1]).toContain('Any address');
    });
  });
});
