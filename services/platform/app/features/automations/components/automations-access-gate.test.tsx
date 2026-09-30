// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { documentTitle } from '@/lib/utils/seo';
import { render, screen } from '@/tests/utils/render';

import { AutomationsAccessGate } from './automations-access-gate';

// One ability per platform role, built once: a context value constructed in
// JSX would be a fresh object on every render.
const abilities = {
  owner: defineAbilityFor('owner'),
  admin: defineAbilityFor('admin'),
  developer: defineAbilityFor('developer'),
  editor: defineAbilityFor('editor'),
  member: defineAbilityFor('member'),
};
type Role = keyof typeof abilities;

/**
 * Every automation page sits behind this gate, so a bookmark or a typed URL
 * reaches no more than the hidden navigation does: only Owners, Admins and
 * Developers may use Automations.
 */
function gate(role: Role, loading = false) {
  return (
    <AbilityContext.Provider value={abilities[role]}>
      <AbilityLoadingContext.Provider value={loading}>
        <AutomationsAccessGate>
          <p>automation page</p>
        </AutomationsAccessGate>
      </AbilityLoadingContext.Provider>
    </AbilityContext.Provider>
  );
}

function renderGate(role: Role, loading = false) {
  return render(gate(role, loading));
}

const DENIAL = 'Automations are for Owners, Admins and Developers.';

describe('AutomationsAccessGate', () => {
  it.each(['owner', 'admin', 'developer'] as const)(
    'opens the page for the %s role',
    (role) => {
      renderGate(role);
      expect(screen.getByText('automation page')).toBeInTheDocument();
      expect(screen.queryByText(DENIAL)).not.toBeInTheDocument();
    },
  );

  it.each(['editor', 'member'] as const)('denies the %s role', (role) => {
    renderGate(role);
    expect(
      screen.getByRole('heading', { name: 'Access denied' }),
    ).toBeInTheDocument();
    expect(screen.getByText(DENIAL)).toBeInTheDocument();
    expect(screen.queryByText('automation page')).not.toBeInTheDocument();
  });

  it('keeps an author on the page while the role refetches', () => {
    renderGate('developer', true);
    expect(screen.getByText('automation page')).toBeInTheDocument();
  });

  it('shows nothing, not the denial, while a reader role is still resolving', () => {
    const { container } = renderGate('member', true);
    expect(screen.queryByText(DENIAL)).not.toBeInTheDocument();
    expect(screen.queryByText('automation page')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});

// A detail route's `head` names the automation from what its loader read
// when the page opened, and a role lowered while it is open reruns no
// loader: the denial must not leave that name on the browser tab.
describe('AutomationsAccessGate and the browser tab', () => {
  /** What the detail route's head put up for an author. */
  const NAMED = 'Private ledger - Acme';
  const SECTION = documentTitle('automations');

  afterEach(() => {
    document.title = '';
  });

  it('leaves the page its own title for an author', () => {
    document.title = NAMED;
    renderGate('developer');
    expect(document.title).toBe(NAMED);
  });

  it('names the section, not the automation, once the role is lowered', () => {
    document.title = NAMED;
    const { rerender } = renderGate('developer');
    expect(document.title).toBe(NAMED);

    rerender(gate('member'));

    expect(screen.getByText(DENIAL)).toBeInTheDocument();
    expect(document.title).toBe(SECTION);
  });

  it('keeps the title while an author role refetches', () => {
    document.title = NAMED;
    const { rerender } = renderGate('developer');
    rerender(gate('developer', true));
    expect(document.title).toBe(NAMED);
  });

  it('hands the page its title back when the denial goes away', () => {
    document.title = NAMED;
    const { unmount } = renderGate('member');
    expect(document.title).toBe(SECTION);
    unmount();
    expect(document.title).toBe(NAMED);
  });
});
