// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { documentTitle } from '@/lib/utils/seo';
import { render, screen } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Outlet: () => <p>automation page</p>,
}));

const { Route: OrgAutomationsRoute } = await import('./route');
const { Route: ProjectAutomationsRoute } =
  await import('../projects/$projectId/automations/route');

// One ability per platform role, built once: a context value constructed in
// JSX would be a fresh object on every render.
const abilities = {
  developer: defineAbilityFor('developer'),
  editor: defineAbilityFor('editor'),
  member: defineAbilityFor('member'),
};

/**
 * Every automation page, organization and project scope alike, renders
 * through one of these two layouts — so a typed URL or a bookmark reaches
 * the page only for Owners, Admins and Developers.
 */
describe.each([
  ['organization', OrgAutomationsRoute],
  ['project', ProjectAutomationsRoute],
])('the %s automations layout', (_scope, route) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- createFileRoute is mocked to return the config
  const Layout = (route as unknown as { component: () => React.ReactElement })
    .component;

  function layoutAs(role: keyof typeof abilities, loading = false) {
    return (
      <AbilityContext.Provider value={abilities[role]}>
        <AbilityLoadingContext.Provider value={loading}>
          <Layout />
        </AbilityLoadingContext.Provider>
      </AbilityContext.Provider>
    );
  }

  function renderAs(role: keyof typeof abilities) {
    return render(layoutAs(role));
  }

  it('opens the page for a developer', () => {
    renderAs('developer');
    expect(screen.getByText('automation page')).toBeInTheDocument();
  });

  afterEach(() => {
    document.title = '';
  });

  it.each(['editor', 'member'] as const)('denies the %s role', (role) => {
    document.title = 'Private ledger - Acme';
    renderAs(role);
    expect(
      screen.getByText('Automations are for Owners, Admins and Developers.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('automation page')).not.toBeInTheDocument();
    // The tab names the section, never the automation behind the denial.
    expect(document.title).toBe(documentTitle('automations'));
  });

  // Lowered while the page is open, then a membership refetch fails: the
  // Member data stays but counts as loading, so the page is held empty.
  it('keeps the section title from a lowered role through a failed refetch', () => {
    document.title = 'Private ledger - Acme';
    const { rerender } = render(layoutAs('developer'));
    expect(document.title).toBe('Private ledger - Acme');

    rerender(layoutAs('member'));
    rerender(layoutAs('member', true));

    expect(screen.queryByText('automation page')).not.toBeInTheDocument();
    expect(document.title).toBe(documentTitle('automations'));
  });

  it('keeps an author on the page, and its title, while the role refetches', () => {
    document.title = 'Private ledger - Acme';
    const { rerender } = render(layoutAs('developer'));
    rerender(layoutAs('developer', true));

    expect(screen.getByText('automation page')).toBeInTheDocument();
    expect(document.title).toBe('Private ledger - Acme');
  });
});
