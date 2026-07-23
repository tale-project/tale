import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { AutomationSummary } from '../hooks/use-automations';
import type { AutomationInstallState } from '../hooks/use-install-state';
import { AutomationBreadcrumbSwitcher } from './automation-breadcrumb-switcher';

const mockNavigate = vi.fn();
const mockLocation = {
  search: { tab: 'configuration' } as Record<string, unknown>,
};
const mockAbility = { can: vi.fn(() => true) };

let automationsFixture: AutomationSummary[] = [];
let installBySlugFixture = new Map<string, AutomationInstallState>();

vi.mock('../hooks/use-automations', () => ({
  useAutomations: () => ({
    automations: automationsFixture,
    isLoading: false,
  }),
}));

vi.mock('../hooks/use-install-state', () => ({
  useAutomationInstallStates: () => ({
    bySlug: installBySlugFixture,
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => mockAbility,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

function summary(
  partial: Pick<AutomationSummary, 'slug' | 'name'> &
    Partial<AutomationSummary>,
): AutomationSummary {
  return {
    description: '',
    scope: 'org',
    kind: 'automation',
    workflows: [],
    agents: [],
    skills: [],
    functions: [],
    requiredIntegrations: [],
    views: [],
    ...partial,
  };
}

function installed(slug: string): AutomationInstallState {
  return {
    automationSlug: slug,
    status: 'active',
    installedAt: 1,
    blockedIntegrations: [],
  };
}

describe('AutomationBreadcrumbSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAbility.can.mockReturnValue(true);
    mockLocation.search = { tab: 'configuration' };
    automationsFixture = [
      summary({
        slug: 'vat-return-desk',
        name: 'VAT return desk',
        workflows: ['vat'],
      }),
      summary({
        slug: 'gmail/sync-emails',
        name: 'Gmail sync',
        workflows: ['sync'],
      }),
      summary({
        slug: 'inbox-only',
        name: 'Inbox only',
        workflows: [],
      }),
      summary({
        slug: 'not-installed-yet',
        name: 'Not installed yet',
      }),
      summary({
        slug: 'email/inbox',
        name: 'Email inbox',
        kind: 'bundle',
        members: ['gmail/sync-emails'],
      }),
    ];
    installBySlugFixture = new Map([
      ['vat-return-desk', installed('vat-return-desk')],
      ['gmail/sync-emails', installed('gmail/sync-emails')],
      ['inbox-only', installed('inbox-only')],
    ]);
  });

  it('lists only installed automations (no catalog-only or bundles)', async () => {
    const { user } = render(
      <AutomationBreadcrumbSwitcher
        organizationId="org-1"
        automationSlug="vat-return-desk"
        displayName="VAT return desk"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch automation, current: vat return desk/i,
      }),
    );

    expect(
      screen.getByRole('option', { name: 'VAT return desk' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Gmail sync' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Not installed yet' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Email inbox' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a portable ?tab= when switching', async () => {
    const { user } = render(
      <AutomationBreadcrumbSwitcher
        organizationId="org-1"
        automationSlug="vat-return-desk"
        displayName="VAT return desk"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch automation, current: vat return desk/i,
      }),
    );
    await user.click(screen.getByRole('option', { name: 'Gmail sync' }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/automations/gmail__sync-emails',
      search: { tab: 'configuration' },
    });
  });

  it('drops ?tab=editor when the target has no workflow tabs', async () => {
    mockLocation.search = { tab: 'editor' };
    const { user } = render(
      <AutomationBreadcrumbSwitcher
        organizationId="org-1"
        automationSlug="vat-return-desk"
        displayName="VAT return desk"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch automation, current: vat return desk/i,
      }),
    );
    await user.click(screen.getByRole('option', { name: 'Inbox only' }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/automations/inbox-only',
      search: {},
    });
  });

  it('keeps project-scoped navigation when projectId is set', async () => {
    const { user } = render(
      <AutomationBreadcrumbSwitcher
        organizationId="org-1"
        automationSlug="vat-return-desk"
        displayName="VAT return desk"
        projectId="proj-1"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch automation, current: vat return desk/i,
      }),
    );
    await user.click(screen.getByRole('option', { name: 'Gmail sync' }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/projects/proj-1/automations/gmail__sync-emails',
      search: { tab: 'configuration' },
    });
  });

  it('does not navigate when the current automation is chosen again', async () => {
    const { user } = render(
      <AutomationBreadcrumbSwitcher
        organizationId="org-1"
        automationSlug="vat-return-desk"
        displayName="VAT return desk"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch automation, current: vat return desk/i,
      }),
    );
    await user.click(screen.getByRole('option', { name: 'VAT return desk' }));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders a plain name when nothing is installed', () => {
    automationsFixture = [];
    installBySlugFixture = new Map();
    render(
      <AutomationBreadcrumbSwitcher
        organizationId="org-1"
        automationSlug="vat-return-desk"
        displayName="VAT return desk"
      />,
    );

    expect(
      screen.queryByRole('button', { name: /switch automation/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('VAT return desk')).toBeInTheDocument();
  });

  it('passes an axe audit with the menu open', async () => {
    const { user, container } = render(
      <AutomationBreadcrumbSwitcher
        organizationId="org-1"
        automationSlug="vat-return-desk"
        displayName="VAT return desk"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch automation, current: vat return desk/i,
      }),
    );
    await checkAccessibility(container);
  });
});
