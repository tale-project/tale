// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

interface MockAgent {
  name: string;
  displayName: string;
  folder?: string;
}

const mockAgents: { current: MockAgent[] } = { current: [] };
const mockInstalls: {
  current: { agentSlug: string; enabled: boolean }[];
} = { current: [] };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ preloadRoute: vi.fn() }),
  useParams: () => ({ id: 'test-org-id' }),
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => <a href={to}>{children}</a>,
  useLocation: () => ({ pathname: '/dashboard/test-org/agents' }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/app/hooks/use-team-filter', () => ({
  useTeamFilter: () => ({ teams: [], selectedTeamId: undefined }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: undefined, isLoaded: true }),
}));

vi.mock('../hooks/queries', () => ({
  useListAgents: () => ({ agents: mockAgents.current, isLoading: false }),
  useAgentInstallations: () => ({
    data: mockInstalls.current,
    isLoading: false,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteAgent: () => ({ mutateAsync: vi.fn() }),
  useDuplicateAgent: () => ({ mutateAsync: vi.fn() }),
  useInstallCatalogAgent: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('./agents-action-menu', () => ({
  AgentsActionMenu: () => <div data-testid="agents-action-menu" />,
}));

import { AgentsTable } from './agents-table';

function setAgents(agents: MockAgent[]) {
  mockAgents.current = agents;
  mockInstalls.current = agents.map((a) => ({
    agentSlug: a.name,
    enabled: true,
  }));
}

describe('AgentsTable', () => {
  beforeEach(() => {
    setAgents([
      { name: 'assistant', displayName: 'Assistant', folder: 'chat' },
      { name: 'researcher', displayName: 'Researcher', folder: 'chat' },
    ]);
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AgentsTable organizationId="test-org-id" />,
      );
      await checkAccessibility(container);
    });

    it('gives the table an sr-only caption (#1980)', () => {
      const { container } = render(
        <AgentsTable organizationId="test-org-id" />,
      );
      const caption = container.querySelector('caption');
      expect(caption).not.toBeNull();
      expect(caption).toHaveTextContent('Installed agents');
    });
  });

  describe('folder rows (#2348)', () => {
    // Regression for #2348: a folder row aggregates its member agents, so the
    // footer must count agents (the entity the label names), never the folder
    // row itself ("Showing all 1 agents" for one folder holding two agents).
    it('counts agents, not folder rows, in the footer', () => {
      render(<AgentsTable organizationId="test-org-id" />);

      expect(screen.getByText('Showing all 2 agents')).toBeInTheDocument();
      expect(
        screen.queryByText('Showing all 1 agents'),
      ).not.toBeInTheDocument();
    });

    // Regression for #2348: the Name cell showed the raw lowercase path
    // segment ("chat") while the catalog shows the localized folder label.
    it('shows the localized folder label, not the raw segment', () => {
      render(<AgentsTable organizationId="test-org-id" />);

      expect(screen.getByText('Chat')).toBeInTheDocument();
      expect(screen.queryByText('chat')).not.toBeInTheDocument();
    });

    it('counts every row when nothing is grouped', () => {
      setAgents([
        { name: 'alpha', displayName: 'Alpha' },
        { name: 'beta', displayName: 'Beta' },
      ]);

      render(<AgentsTable organizationId="test-org-id" />);

      expect(screen.getByText('Showing all 2 agents')).toBeInTheDocument();
    });
  });
});
