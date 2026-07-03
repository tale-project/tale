import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { TeamMemberChecklist } from './team-member-checklist';

const mockUseMembers = vi.fn();

vi.mock('../../organization/hooks/queries', () => ({
  useMembers: (organizationId: string) => mockUseMembers(organizationId),
}));

const MEMBERS = [
  { userId: 'user-1', displayName: 'Alice', email: 'alice@example.com' },
  { userId: 'user-2', displayName: 'Bob', email: 'bob@example.com' },
];

function setMembers(members: typeof MEMBERS, isLoading = false) {
  mockUseMembers.mockReturnValue({ members, isLoading });
}

/** Find the checkbox control rendered inside the label that shows `name`. */
function checkboxFor(name: string): HTMLElement {
  const label = screen.getByText(name).closest('label');
  if (!label) throw new Error(`No label found for ${name}`);
  return within(label).getByRole('checkbox');
}

describe('TeamMemberChecklist', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      setMembers(MEMBERS);
      const { container } = render(
        <TeamMemberChecklist
          organizationId="org-1"
          selectedMemberIds={new Set(['user-1'])}
          onToggleMember={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });

  it('disables only the sole selected member and shows the hint when enforced', () => {
    setMembers(MEMBERS);
    render(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set(['user-1'])}
        onToggleMember={vi.fn()}
        enforceMinimumOne
      />,
    );

    // The only remaining member cannot be unchecked.
    expect(checkboxFor('Alice')).toBeDisabled();
    // Unselected members stay toggleable so members can still be added.
    expect(checkboxFor('Bob')).not.toBeDisabled();

    // The constraint is surfaced as a persistent hint (not a silent refusal).
    expect(
      screen.getByText(/A team must keep at least one member/i),
    ).toBeInTheDocument();
  });

  it('does not disable any checkbox when more than one member is selected', () => {
    setMembers(MEMBERS);
    render(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set(['user-1', 'user-2'])}
        onToggleMember={vi.fn()}
        enforceMinimumOne
      />,
    );

    expect(checkboxFor('Alice')).not.toBeDisabled();
    expect(checkboxFor('Bob')).not.toBeDisabled();
    expect(
      screen.queryByText(/A team must keep at least one member/i),
    ).not.toBeInTheDocument();
  });

  it('never enforces the minimum-one constraint in create mode (default)', () => {
    setMembers(MEMBERS);
    // Create flow: 0 selected is valid (current user is auto-added) and the
    // sole selected member must stay uncheckable so the user can return to 0.
    const { rerender } = render(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set()}
        onToggleMember={vi.fn()}
      />,
    );

    // With nothing selected, no misleading "delete the team instead" hint.
    expect(
      screen.queryByText(/A team must keep at least one member/i),
    ).not.toBeInTheDocument();

    // With exactly one selected, its checkbox stays toggleable (not disabled)
    // and the hint is still absent.
    rerender(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set(['user-1'])}
        onToggleMember={vi.fn()}
      />,
    );

    expect(checkboxFor('Alice')).not.toBeDisabled();
    expect(checkboxFor('Bob')).not.toBeDisabled();
    expect(
      screen.queryByText(/A team must keep at least one member/i),
    ).not.toBeInTheDocument();
  });

  it('toggles a member when an enabled checkbox is clicked', async () => {
    setMembers(MEMBERS);
    const onToggleMember = vi.fn();
    const { user } = render(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set(['user-1'])}
        onToggleMember={onToggleMember}
      />,
    );

    await user.click(checkboxFor('Bob'));
    expect(onToggleMember).toHaveBeenCalledWith('user-2');
  });

  it('renders a loading state while members are fetching', () => {
    setMembers([], true);
    render(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set()}
        onToggleMember={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
