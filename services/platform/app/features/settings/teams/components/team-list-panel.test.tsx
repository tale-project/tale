import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { render, screen } from '@/tests/utils/render';

import { TeamListPanel } from './team-list-panel';

// TanStack Link → a plain <a> so the panel renders without a router. The gear is
// an IconButton(asChild) that slots the Link, so Radix merges the button's
// `aria-label` and our `onClick` onto the Link's props — spread `...rest` onto
// the anchor so both survive. Navigation is prevented (jsdom can't navigate)
// while our onClick still fires.
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/dashboard/org-123/chat',
  Link: React.forwardRef<
    HTMLAnchorElement,
    React.ComponentProps<'a'> & { to: string; params?: Record<string, string> }
  >(({ to, params: _params, children, onClick, ...rest }, ref) => (
    <a
      ref={ref}
      href={to}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  )),
}));

// Map the namespace-relative keys the panel reads to their en.json values.
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) =>
      (
        ({
          'teamFilter.label': 'Team',
          'teamFilter.allTeams': 'All',
          'teamFilter.manageTeams': 'Manage teams',
          'teams.createTeam': 'Create team',
          'teams.description': 'Teams scope access to agents and resources.',
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

// The create dialog pulls in Convex mutations; the header (unit under test)
// doesn't need it.
vi.mock('./team-create-dialog', () => ({
  TeamCreateDialog: () => null,
}));

const TEAMS = [
  { id: 'team-1', name: 'Design' },
  { id: 'team-2', name: 'Engineering' },
];

// Built once at module scope — an inline `defineAbilityFor(...)` as the context
// value trips jsx-no-constructed-context-values (and re-renders every test).
const ADMIN_ABILITY = defineAbilityFor('admin'); // 'all' → can read orgSettings
const MEMBER_ABILITY = defineAbilityFor('member'); // cannot read orgSettings

function renderPanel(
  ability: ReturnType<typeof defineAbilityFor>,
  props?: Partial<React.ComponentProps<typeof TeamListPanel>>,
) {
  return render(
    <AbilityContext.Provider value={ability}>
      <TeamListPanel
        organizationId="org-123"
        teams={TEAMS}
        selectedTeamId={null}
        onSelectTeam={vi.fn()}
        {...props}
      />
    </AbilityContext.Provider>,
  );
}

describe('TeamListPanel — manage-teams gear', () => {
  it('shows a gear linking to team settings for a user who can read org settings', () => {
    renderPanel(ADMIN_ABILITY);

    const gear = screen.getByRole('link', { name: 'Manage teams' });
    expect(gear).toBeInTheDocument();
    expect(gear).toHaveAttribute('href', '/dashboard/$id/settings/teams');
  });

  it('closes the surrounding menu (onManageTeams) when the gear is activated', async () => {
    const onManageTeams = vi.fn();
    const { user } = renderPanel(ADMIN_ABILITY, { onManageTeams });

    await user.click(screen.getByRole('link', { name: 'Manage teams' }));

    expect(onManageTeams).toHaveBeenCalledTimes(1);
  });

  it('hides the gear from a member who cannot read org settings', () => {
    renderPanel(MEMBER_ABILITY);

    expect(
      screen.queryByRole('link', { name: 'Manage teams' }),
    ).not.toBeInTheDocument();
    // The team list itself still renders for everyone.
    expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument();
  });

  it('omits the gear when the header is hidden (mobile inline picker)', () => {
    renderPanel(ADMIN_ABILITY, { hideHeader: true });

    expect(
      screen.queryByRole('link', { name: 'Manage teams' }),
    ).not.toBeInTheDocument();
  });
});
