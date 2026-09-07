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

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const upsert = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutate: upsert, isPending: false }),
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
        returnToConversation?: { id: string; status: string };
      }) => Record<string, unknown>;
    };
    expect(
      call.state({
        openRoutingRule: true,
        routingAddress: 'billing@acme.test',
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
});
