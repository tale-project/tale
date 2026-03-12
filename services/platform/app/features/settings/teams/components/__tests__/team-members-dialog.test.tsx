// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAddMutateAsync = vi.fn();
const mockRemoveMutateAsync = vi.fn();
const mockToast = vi.fn();

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('../../../organization/hooks/queries', () => ({
  useMembers: () => ({ members: mockOrgMembers }),
}));

vi.mock('../../hooks/mutations', () => ({
  useAddTeamMember: () => ({
    mutateAsync: mockAddMutateAsync,
    isPending: false,
  }),
  useRemoveTeamMember: () => ({
    mutateAsync: mockRemoveMutateAsync,
    isPending: false,
  }),
}));

let mockTeamMembers: Array<{
  _id: string;
  teamId: string;
  userId: string;
  role: string;
  joinedAt: number;
  displayName?: string;
  email?: string;
}> | null = null;
let mockIsLoadingTeamMembers = false;

vi.mock('../../hooks/queries', () => ({
  useTeamMembers: () => ({
    teamMembers: mockTeamMembers,
    isLoading: mockIsLoadingTeamMembers,
  }),
}));

let mockOrgMembers: Array<{
  userId: string;
  displayName?: string;
  email?: string;
}> | null = null;

import { TeamMembersDialog } from '../team-members-dialog';

describe('TeamMembersDialog', () => {
  const team = { id: 'team_1', name: 'Engineering' };

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    team: team as never,
    organizationId: 'org_1',
  };

  beforeEach(() => {
    mockOrgMembers = [
      { userId: 'u_1', displayName: 'Alice', email: 'alice@example.com' },
      { userId: 'u_2', displayName: 'Bob', email: 'bob@example.com' },
      { userId: 'u_3', displayName: 'Charlie', email: 'charlie@example.com' },
    ];
    mockTeamMembers = [
      {
        _id: 'tm_1',
        teamId: 'team_1',
        userId: 'u_1',
        role: 'member',
        joinedAt: 1000,
        displayName: 'Alice',
        email: 'alice@example.com',
      },
      {
        _id: 'tm_2',
        teamId: 'team_1',
        userId: 'u_2',
        role: 'member',
        joinedAt: 2000,
        displayName: 'Bob',
        email: 'bob@example.com',
      },
    ];
    mockIsLoadingTeamMembers = false;
    mockAddMutateAsync.mockResolvedValue(undefined);
    mockRemoveMutateAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders team members list', () => {
    render(<TeamMembersDialog {...defaultProps} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders nothing when not open', () => {
    render(<TeamMembersDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockIsLoadingTeamMembers = true;
    mockTeamMembers = null;
    render(<TeamMembersDialog {...defaultProps} />);
    expect(screen.getByText('common.actions.loading')).toBeInTheDocument();
  });

  it('shows empty state when no team members', () => {
    mockTeamMembers = [];
    render(<TeamMembersDialog {...defaultProps} />);
    expect(
      screen.getByText('settings.teams.noTeamMembers'),
    ).toBeInTheDocument();
  });

  it('shows remove button for each member when multiple members exist', () => {
    render(<TeamMembersDialog {...defaultProps} />);
    const removeButtons = screen.getAllByRole('button', {
      name: 'settings.teams.removeMember',
    });
    expect(removeButtons).toHaveLength(2);
    removeButtons.forEach((btn) => {
      expect(btn).toBeEnabled();
    });
  });

  it('disables remove button when only one member remains', () => {
    mockTeamMembers = [
      {
        _id: 'tm_1',
        teamId: 'team_1',
        userId: 'u_1',
        role: 'member',
        joinedAt: 1000,
        displayName: 'Alice',
        email: 'alice@example.com',
      },
    ];
    render(<TeamMembersDialog {...defaultProps} />);
    const removeButton = screen.getByRole('button', {
      name: 'settings.teams.removeMember',
    });
    expect(removeButton).toBeDisabled();
    expect(removeButton).toHaveAttribute(
      'title',
      'settings.teams.cannotRemoveLastMember',
    );
  });

  it('calls removeTeamMember.mutateAsync with correct args on remove click', async () => {
    const user = userEvent.setup();
    render(<TeamMembersDialog {...defaultProps} />);
    const removeButtons = screen.getAllByRole('button', {
      name: 'settings.teams.removeMember',
    });

    await user.click(removeButtons[0]);

    expect(mockRemoveMutateAsync).toHaveBeenCalledWith({
      teamMemberId: 'tm_1',
      organizationId: 'org_1',
    });
  });

  it('shows success toast on successful removal', async () => {
    const user = userEvent.setup();
    render(<TeamMembersDialog {...defaultProps} />);
    const removeButtons = screen.getAllByRole('button', {
      name: 'settings.teams.removeMember',
    });

    await user.click(removeButtons[0]);

    expect(mockToast).toHaveBeenCalledWith({
      title: 'settings.teams.memberRemoved',
      variant: 'success',
    });
  });

  it('shows error toast on failed removal', async () => {
    mockRemoveMutateAsync.mockRejectedValue(new Error('fail'));
    const user = userEvent.setup();
    render(<TeamMembersDialog {...defaultProps} />);
    const removeButtons = screen.getAllByRole('button', {
      name: 'settings.teams.removeMember',
    });

    await user.click(removeButtons[0]);

    expect(mockToast).toHaveBeenCalledWith({
      title: 'settings.teams.memberRemoveFailed',
      variant: 'destructive',
    });
  });

  it('shows available org members excluding existing team members', () => {
    render(<TeamMembersDialog {...defaultProps} />);
    // u_1 and u_2 are already team members, only u_3 (Charlie) should be available
    // The select component renders options, so Charlie should appear somewhere
    // The "no members to add" message should NOT be shown
    expect(
      screen.queryByText('settings.teams.noMembersToAdd'),
    ).not.toBeInTheDocument();
  });

  it('shows no members to add when all org members are in team', () => {
    mockTeamMembers = [
      {
        _id: 'tm_1',
        teamId: 'team_1',
        userId: 'u_1',
        role: 'member',
        joinedAt: 1000,
      },
      {
        _id: 'tm_2',
        teamId: 'team_1',
        userId: 'u_2',
        role: 'member',
        joinedAt: 2000,
      },
      {
        _id: 'tm_3',
        teamId: 'team_1',
        userId: 'u_3',
        role: 'member',
        joinedAt: 3000,
      },
    ];
    render(<TeamMembersDialog {...defaultProps} />);
    expect(
      screen.getByText('settings.teams.noMembersToAdd'),
    ).toBeInTheDocument();
  });

  it('disables add button when no member is selected', () => {
    render(<TeamMembersDialog {...defaultProps} />);
    const addButton = screen.getByRole('button', {
      name: /settings\.teams\.addMember/,
    });
    expect(addButton).toBeDisabled();
  });

  it('closes dialog when close button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<TeamMembersDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.click(screen.getByText('common.actions.close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('displays email as fallback when no distinct display name', () => {
    mockTeamMembers = [
      {
        _id: 'tm_1',
        teamId: 'team_1',
        userId: 'u_4',
        role: 'member',
        joinedAt: 1000,
      },
      {
        _id: 'tm_2',
        teamId: 'team_1',
        userId: 'u_5',
        role: 'member',
        joinedAt: 2000,
      },
    ];
    // Org members with email only (no displayName)
    mockOrgMembers = [
      { userId: 'u_4', email: 'dave@example.com' },
      { userId: 'u_5', email: 'eve@example.com' },
    ];
    render(<TeamMembersDialog {...defaultProps} />);
    expect(screen.getByText('dave@example.com')).toBeInTheDocument();
    expect(screen.getByText('eve@example.com')).toBeInTheDocument();
  });
});
