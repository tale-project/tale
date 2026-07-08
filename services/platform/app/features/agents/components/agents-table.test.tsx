// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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

const { listHolder } = vi.hoisted(() => ({
  listHolder: {
    agents: [] as unknown[],
    installs: [] as { agentSlug: string; enabled: boolean }[],
  },
}));

vi.mock('../hooks/queries', () => ({
  useListAgents: () => ({ agents: listHolder.agents, isLoading: false }),
  useAgentInstallations: () => ({
    data: listHolder.installs,
    isLoading: false,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteAgent: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/use-agents-table-config', () => ({
  useAgentsTableConfig: () => ({
    // One minimal column that surfaces the folder/agent identity AND the
    // folder `[Automation]` marker the container computes — what the folder-map
    // tests below assert on.
    columns: [
      {
        id: 'name',
        header: 'Name',
        cell: ({
          row,
        }: {
          row: {
            original:
              | { type: 'folder'; name: string; automationSlug?: string }
              | { type: 'agent'; displayName: string };
          };
        }) =>
          row.original.type === 'folder'
            ? `folder:${row.original.name}${row.original.automationSlug ? ` [automation:${row.original.automationSlug}]` : ''}`
            : `agent:${row.original.displayName}`,
      },
    ],
    searchPlaceholder: 'Search agents',
    stickyLayout: undefined,
    pageSize: 10,
  }),
}));

vi.mock('./agents-action-menu', () => ({
  AgentsActionMenu: () => <div data-testid="agents-action-menu" />,
}));

import { AgentsTable } from './agents-table';

function agent(
  name: string,
  folder: string,
  automationSlug?: string,
): Record<string, unknown> {
  return {
    name,
    slug: name,
    displayName: name,
    folder,
    ...(automationSlug !== undefined ? { automationSlug } : {}),
  };
}

function seedAgents(rows: Record<string, unknown>[]) {
  listHolder.agents = rows;
  listHolder.installs = rows.map((r) => ({
    agentSlug: String(r.name),
    enabled: true,
  }));
}

describe('AgentsTable', () => {
  beforeEach(() => {
    listHolder.agents = [];
    listHolder.installs = [];
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
      expect(caption).toHaveTextContent('settings.agents.tableCaption');
    });
  });

  describe('folder [Automation] marker (folder-path map, not automationSlug set)', () => {
    it("marks a folder that holds only one automation's agents", () => {
      // Display folder == app slug (the fallback case).
      seedAgents([
        agent('issue-desk/desk-implementer', 'issue-desk', 'issue-desk'),
      ]);
      const { container } = render(
        <AgentsTable organizationId="test-org-id" />,
      );
      expect(container).toHaveTextContent(
        'folder:issue-desk [automation:issue-desk]',
      );
    });

    it('does NOT mark a shared parent folder that mixes global and app agents', () => {
      // The app declares folder `github/issues`; a global agent lives in
      // `github`. The top-level `github` folder must stay an ordinary folder.
      seedAgents([
        agent('github/reviewer', 'github'),
        agent('issue-desk/desk-implementer', 'github/issues', 'issue-desk'),
      ]);
      const { container } = render(
        <AgentsTable organizationId="test-org-id" />,
      );
      expect(container).toHaveTextContent('folder:github');
      expect(container).not.toHaveTextContent('[automation:');
    });

    it('marks the nested app folder when drilled into the shared parent', () => {
      seedAgents([
        agent('github/reviewer', 'github'),
        agent('issue-desk/desk-implementer', 'github/issues', 'issue-desk'),
      ]);
      const { container } = render(
        <AgentsTable organizationId="test-org-id" currentFolder="github" />,
      );
      // Inside `github`: the app subfolder is marked, the global agent isn't.
      expect(container).toHaveTextContent(
        'folder:issues [automation:issue-desk]',
      );
      expect(container).toHaveTextContent('agent:github/reviewer');
    });

    it('does not mark a folder whose path merely matches an app folder but holds a global agent too', () => {
      seedAgents([
        agent('ops/helper', 'ops'),
        agent('deskbot/runner', 'ops', 'deskbot'),
      ]);
      const { container } = render(
        <AgentsTable organizationId="test-org-id" />,
      );
      expect(container).toHaveTextContent('folder:ops');
      expect(container).not.toHaveTextContent('[automation:');
    });
  });
});
