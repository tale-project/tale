import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

/**
 * The account page's "Your teams" section: the one place a member learns
 * which teams they are in and what that opens. Read-only — a team is an
 * audience label, never something to switch into — with the roster door
 * offered to admins only.
 */
const state = vi.hoisted(() => ({
  teams: undefined as
    | { id: string; name: string; memberCount: number; createdAt: number }[]
    | undefined,
  isLoading: false,
  canManage: false,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.canManage }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: state.teams, isLoading: state.isLoading }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params: { id: string };
  }) => <a href={to.replace('$id', params.id)}>{children}</a>,
}));

import { TeamsSection } from './teams-section';

describe('TeamsSection', () => {
  it('names the member’s teams and what a team decides', () => {
    state.teams = [
      { id: 't-1', name: 'Engineering', memberCount: 4, createdAt: 0 },
      { id: 't-2', name: 'Design', memberCount: 2, createdAt: 0 },
    ];
    state.canManage = false;
    render(<TeamsSection />);
    expect(
      screen.getByRole('heading', { name: 'Your teams' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Teams decide which team documents/),
    ).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    // A member does not manage rosters: no door to Settings › Teams.
    expect(
      screen.queryByRole('link', { name: 'Manage teams' }),
    ).not.toBeInTheDocument();
  });

  it('says what an empty membership means instead of showing nothing', () => {
    state.teams = [];
    render(<TeamsSection />);
    expect(screen.getByText(/You are not in any team yet/)).toBeInTheDocument();
  });

  it('offers the roster door to an admin, aimed at this organization', () => {
    state.teams = [];
    state.canManage = true;
    render(<TeamsSection />);
    expect(screen.getByRole('link', { name: 'Manage teams' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/settings/teams',
    );
  });

  it('shows neither list nor empty state while the teams load', () => {
    state.teams = undefined;
    state.isLoading = true;
    render(<TeamsSection />);
    expect(
      screen.queryByText(/You are not in any team yet/),
    ).not.toBeInTheDocument();
    state.isLoading = false;
  });
});
