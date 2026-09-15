import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { SettingsRail } from './settings-rail';

const ability = vi.hoisted(() => ({ canEverything: true }));

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef(
    (
      props: {
        to: string;
        children: React.ReactNode;
        className?: string;
        'aria-current'?: string;
        'aria-expanded'?: boolean;
      },
      ref: React.Ref<HTMLAnchorElement>,
    ) => (
      <a
        ref={ref}
        href={props.to}
        className={props.className}
        aria-current={props['aria-current'] as never}
        aria-expanded={props['aria-expanded']}
      >
        {props.children}
      </a>
    ),
  ),
  useRouterState: () => '/dashboard/org-1/settings/governance/policies-limits',
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => ability.canEverything,
    cannot: () => !ability.canEverything,
  }),
}));

describe('SettingsRail', () => {
  beforeEach(() => {
    ability.canEverything = true;
  });

  describe('accessibility', () => {
    it('passes axe audit with all sections (governance expanded)', async () => {
      const { container } = render(<SettingsRail organizationId="org-1" />);
      await waitFor(() => checkAccessibility(container));
    });

    it('passes axe audit without account row', async () => {
      const { container } = render(
        <SettingsRail organizationId="org-1" showAccountTab={false} />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });

  it('shows a plain member their own pages, usage included, and nothing gated', () => {
    ability.canEverything = false;

    render(<SettingsRail organizationId="org-1" />);

    const links = within(screen.getByRole('navigation')).getAllByRole('link');
    expect(
      links.map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Account', '/dashboard/org-1/settings/account'],
      ['Preferences', '/dashboard/org-1/settings/personalization'],
      ['Notifications', '/dashboard/org-1/settings/notifications'],
      ['Usage', '/dashboard/org-1/settings/usage'],
      ['Skills', '/dashboard/org-1/settings/skills'],
    ]);
  });
});
