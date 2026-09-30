// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
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
function renderGate(role: Role, loading = false) {
  return render(
    <AbilityContext.Provider value={abilities[role]}>
      <AbilityLoadingContext.Provider value={loading}>
        <AutomationsAccessGate>
          <p>automation page</p>
        </AutomationsAccessGate>
      </AbilityLoadingContext.Provider>
    </AbilityContext.Provider>,
  );
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
