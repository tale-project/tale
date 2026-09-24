import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

/**
 * The account page's "Your role" section: the Members page that lists roles
 * is admin-only, so this is where an editor or member learns their own role.
 * Read-only, with the Members door offered to admins only.
 */
const state = vi.hoisted(() => ({
  role: undefined as string | undefined,
  canManage: false,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.canManage }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: state.role ? { status: 'ok', role: state.role } : undefined,
  }),
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

import { RoleSection } from './role-section';

describe('RoleSection', () => {
  it('names the member’s own role and what a role decides', () => {
    state.role = 'editor';
    state.canManage = false;
    render(<RoleSection />);
    expect(
      screen.getByRole('heading', { name: 'Your role' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your role decides what you can do/),
    ).toBeInTheDocument();
    // The localized role name, never the raw `editor` key.
    expect(screen.getByText('Editor')).toBeInTheDocument();
    // A non-admin cannot open Members: no door to it.
    expect(
      screen.queryByRole('link', { name: 'Manage members' }),
    ).not.toBeInTheDocument();
  });

  it('offers the Members door to an admin, aimed at this organization', () => {
    state.role = 'admin';
    state.canManage = true;
    render(<RoleSection />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Manage members' }),
    ).toHaveAttribute('href', '/dashboard/org-1/settings/members');
  });

  it('shows no badge while the membership loads', () => {
    state.role = undefined;
    state.canManage = false;
    render(<RoleSection />);
    expect(screen.queryByText('Member')).not.toBeInTheDocument();
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
  });
});
