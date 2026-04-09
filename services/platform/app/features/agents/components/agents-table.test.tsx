// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
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
  useListAgents: () => ({ agents: [], isLoading: false }),
}));

vi.mock('../hooks/use-agents-table-config', () => ({
  useAgentsTableConfig: () => ({
    columns: [],
    searchPlaceholder: 'Search agents',
    stickyLayout: undefined,
    pageSize: 10,
  }),
}));

vi.mock('./agents-action-menu', () => ({
  AgentsActionMenu: () => <div data-testid="agents-action-menu" />,
}));

import { AgentsTable } from './agents-table';

describe('AgentsTable', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AgentsTable organizationId="test-org-id" />,
      );
      await checkAccessibility(container);
    });
  });
});
