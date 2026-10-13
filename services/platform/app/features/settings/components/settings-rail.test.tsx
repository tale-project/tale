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

// Whether the member may create a personal API key, call the model endpoints
// or connect a coding agent decides the API group for a role without
// developer settings; the rail reads all three through one hook.
const apiAccess = vi.hoisted(() => ({
  apiKeys: false,
  modelApi: false,
  agents: false,
}));
vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({
    useApiSettingsAccess: () => ({
      developer: ability.canEverything,
      apiKeys: ability.canEverything || apiAccess.apiKeys || apiAccess.modelApi,
      modelApi: ability.canEverything || apiAccess.modelApi,
      agents: apiAccess.agents,
      loading: false,
    }),
  }),
);

describe('SettingsRail', () => {
  beforeEach(() => {
    ability.canEverything = true;
    apiAccess.apiKeys = false;
    apiAccess.modelApi = false;
    apiAccess.agents = false;
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

  it('lists the API pages of a developer role in order, Connected agents beside MCP', async () => {
    apiAccess.agents = true;
    const { user } = render(<SettingsRail organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'API' }));
    const hrefs = within(screen.getByRole('navigation'))
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.includes('/settings/api/'));
    expect(hrefs).toEqual([
      '/dashboard/org-1/settings/api/rest',
      '/dashboard/org-1/settings/api/models',
      '/dashboard/org-1/settings/api/mcp',
      '/dashboard/org-1/settings/api/agents',
      '/dashboard/org-1/settings/api/webdav',
    ]);
    expect(
      within(screen.getByRole('navigation')).getByRole('link', {
        name: 'Connected agents',
      }),
    ).toBeInTheDocument();
  });

  it('leaves Connected agents out of a developer role’s API pages while agents may not sign in [AGCONN-R23]', async () => {
    apiAccess.agents = false;
    const { user } = render(<SettingsRail organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'API' }));
    const hrefs = within(screen.getByRole('navigation'))
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.includes('/settings/api/'));
    expect(hrefs).toEqual([
      '/dashboard/org-1/settings/api/rest',
      '/dashboard/org-1/settings/api/models',
      '/dashboard/org-1/settings/api/mcp',
      '/dashboard/org-1/settings/api/webdav',
    ]);
  });

  it('opens Connected agents alone to a member who may connect a coding agent or holds one [AGCONN-R23]', async () => {
    ability.canEverything = false;
    apiAccess.agents = true;

    const { user } = render(<SettingsRail organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'API' }));
    const nav = within(screen.getByRole('navigation'));
    expect(nav.getByRole('link', { name: 'Connected agents' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/settings/api/agents',
    );
    expect(nav.queryByRole('link', { name: 'REST' })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'Models' })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'MCP' })).not.toBeInTheDocument();
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
