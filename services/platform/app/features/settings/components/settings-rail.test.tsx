import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

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

// Whether the member may create a personal API key or call the model
// endpoints decides the API group for a role without developer settings; the
// rail reads both through one hook.
const apiAccess = vi.hoisted(() => ({ apiKeys: false, modelApi: false }));
vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({
    useApiSettingsAccess: () => ({
      developer: ability.canEverything,
      apiKeys: ability.canEverything || apiAccess.apiKeys || apiAccess.modelApi,
      modelApi: ability.canEverything || apiAccess.modelApi,
      loading: false,
    }),
  }),
);

describe('SettingsRail', () => {
  beforeEach(() => {
    ability.canEverything = true;
    apiAccess.apiKeys = false;
    apiAccess.modelApi = false;
  });

  describe('accessibility', () => {
    it('passes axe audit with all sections (governance expanded)', async () => {
      const { container } = render(<SettingsRail organizationId="org-1" />);
      await screen.findByRole('link', { name: 'Policies & Limits' });
      await checkAccessibility(container);
    });

    it('passes axe audit without account row', async () => {
      const { container } = render(
        <SettingsRail organizationId="org-1" showAccountTab={false} />,
      );
      await screen.findByRole('link', { name: 'Policies & Limits' });
      await checkAccessibility(container);
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
    expect(
      screen.queryByRole('button', { name: 'API' }),
    ).not.toBeInTheDocument();
  });

  it('opens the API group to a member granted the model endpoints: REST and Models only', async () => {
    ability.canEverything = false;
    apiAccess.modelApi = true;

    const { user } = render(<SettingsRail organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'API' }));
    const nav = within(screen.getByRole('navigation'));
    expect(nav.getByRole('link', { name: 'REST' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/settings/api/rest',
    );
    expect(nav.getByRole('link', { name: 'Models' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/settings/api/models',
    );
    expect(nav.queryByRole('link', { name: 'MCP' })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'WebDAV' })).not.toBeInTheDocument();
  });

  it('opens REST alone to a member granted another competence used with a key', async () => {
    ability.canEverything = false;
    apiAccess.apiKeys = true;

    const { user } = render(<SettingsRail organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'API' }));
    const nav = within(screen.getByRole('navigation'));
    expect(nav.getByRole('link', { name: 'REST' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/settings/api/rest',
    );
    expect(nav.queryByRole('link', { name: 'Models' })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'MCP' })).not.toBeInTheDocument();
  });
});
