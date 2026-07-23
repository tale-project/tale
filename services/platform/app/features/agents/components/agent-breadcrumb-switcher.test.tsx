import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AgentBreadcrumbSwitcher } from './agent-breadcrumb-switcher';

const mockNavigate = vi.fn();
const mockLocation = {
  pathname: '/dashboard/org-1/agents/issue-triager/instructions',
  search: {} as Record<string, unknown>,
};

let agentsFixture: unknown[] = [];

vi.mock('@/app/features/agents/hooks/queries', () => ({
  useListAgents: () => ({ agents: agentsFixture, isLoading: false }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('@tale/ui/i18n/locale-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/i18n/locale-provider')>()),
  useLocale: () => ({ locale: 'en' }),
}));

describe('AgentBreadcrumbSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.pathname =
      '/dashboard/org-1/agents/issue-triager/instructions';
    mockLocation.search = {};
    agentsFixture = [
      {
        name: 'issue-triager',
        displayName: 'Issue triager',
        uiConfigurable: true,
      },
      {
        name: 'coder',
        displayName: 'Coder',
        uiConfigurable: true,
      },
    ];
  });

  it('opens a menu of sibling agents from the current name', async () => {
    const { user } = render(
      <AgentBreadcrumbSwitcher
        organizationId="org-1"
        agentId="issue-triager"
        displayName="Issue triager"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch agent, current: issue triager/i,
      }),
    );

    expect(
      screen.getByRole('menuitem', { name: 'Issue triager' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Coder' })).toBeInTheDocument();
  });

  it('navigates to the selected agent while keeping the current tab', async () => {
    const { user } = render(
      <AgentBreadcrumbSwitcher
        organizationId="org-1"
        agentId="issue-triager"
        displayName="Issue triager"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch agent, current: issue triager/i,
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Coder' }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/agents/coder/instructions',
      search: {},
    });
  });

  it('does not navigate when the current agent is chosen again', async () => {
    const { user } = render(
      <AgentBreadcrumbSwitcher
        organizationId="org-1"
        agentId="issue-triager"
        displayName="Issue triager"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch agent, current: issue triager/i,
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Issue triager' }));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders a plain name when the agent list is empty', () => {
    agentsFixture = [];
    render(
      <AgentBreadcrumbSwitcher
        organizationId="org-1"
        agentId="issue-triager"
        displayName="Issue triager"
      />,
    );

    expect(
      screen.queryByRole('button', { name: /switch agent/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Issue triager')).toBeInTheDocument();
  });

  it('passes an axe audit with the menu open', async () => {
    const { user, container } = render(
      <AgentBreadcrumbSwitcher
        organizationId="org-1"
        agentId="issue-triager"
        displayName="Issue triager"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch agent, current: issue triager/i,
      }),
    );
    await checkAccessibility(container);
  });
});
