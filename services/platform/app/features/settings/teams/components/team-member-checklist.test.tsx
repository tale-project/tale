import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

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

/** The multi-select renders its options inside a popover, opened via the trigger. */
async function openDropdown(user: ReturnType<typeof render>['user']) {
  await user.click(screen.getByRole('combobox'));
}

/** Find the listbox option whose accessible name contains `name`. */
function optionFor(name: string): HTMLElement {
  return screen.getByRole('option', { name: new RegExp(name, 'i') });
}

const LAST_MEMBER_HINT = /A team must keep at least one member/i;

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

  it('disables only the sole selected member and shows the hint when enforced', async () => {
    setMembers(MEMBERS);
    const { user } = render(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set(['user-1'])}
        onToggleMember={vi.fn()}
        enforceMinimumOne
      />,
    );

    // The constraint is surfaced as a persistent hint (not a silent refusal).
    expect(screen.getByText(LAST_MEMBER_HINT)).toBeInTheDocument();

    await openDropdown(user);
    // The only remaining member cannot be unchecked.
    expect(optionFor('Alice')).toHaveAttribute('aria-disabled', 'true');
    // Unselected members stay toggleable so members can still be added.
    expect(optionFor('Bob')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('does not disable any option when more than one member is selected', async () => {
    setMembers(MEMBERS);
    const { user } = render(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set(['user-1', 'user-2'])}
        onToggleMember={vi.fn()}
        enforceMinimumOne
      />,
    );

    expect(screen.queryByText(LAST_MEMBER_HINT)).not.toBeInTheDocument();

    await openDropdown(user);
    expect(optionFor('Alice')).not.toHaveAttribute('aria-disabled', 'true');
    expect(optionFor('Bob')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('never enforces the minimum-one constraint in create mode (default)', async () => {
    setMembers(MEMBERS);
    // Create flow: 0 selected is valid (current user is auto-added) and the sole
    // selected member must stay uncheckable so the user can return to 0.
    const { user, rerender } = render(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set()}
        onToggleMember={vi.fn()}
      />,
    );

    // With nothing selected, no misleading "delete the team instead" hint.
    expect(screen.queryByText(LAST_MEMBER_HINT)).not.toBeInTheDocument();

    // With exactly one selected, its option stays toggleable (not disabled) and
    // the hint is still absent.
    rerender(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set(['user-1'])}
        onToggleMember={vi.fn()}
      />,
    );

    expect(screen.queryByText(LAST_MEMBER_HINT)).not.toBeInTheDocument();
    await openDropdown(user);
    expect(optionFor('Alice')).not.toHaveAttribute('aria-disabled', 'true');
    expect(optionFor('Bob')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('toggles a member when an enabled option is clicked', async () => {
    setMembers(MEMBERS);
    const onToggleMember = vi.fn();
    const { user } = render(
      <TeamMemberChecklist
        organizationId="org-1"
        selectedMemberIds={new Set(['user-1'])}
        onToggleMember={onToggleMember}
      />,
    );

    await openDropdown(user);
    await user.click(optionFor('Bob'));
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
