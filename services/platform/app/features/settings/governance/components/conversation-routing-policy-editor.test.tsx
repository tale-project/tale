import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ConversationRoutingPolicyEditor } from './conversation-routing-policy-editor';

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
});
