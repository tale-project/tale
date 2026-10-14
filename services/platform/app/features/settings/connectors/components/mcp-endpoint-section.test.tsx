import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { MCP_TOOL_GROUPS, MCP_TOOLS, type McpToolGroup } from '@/lib/mcp/tools';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { McpEndpointSection } from './mcp-endpoint-section';

/**
 * Component coverage for the API → MCP settings section: the endpoint URL
 * renders from the deployment site URL, and the tool inventory renders as
 * one row per group — every advertised tool exactly once, under the row of
 * its own group. Which tool belongs to which group is pinned against the docs
 * in `lib/mcp/tools.test.ts`; this suite guards the rendering.
 */

// The deployment URL comes from `useSiteUrl`, which needs the app-level
// SiteUrlProvider the shared test render does not mount — stub the hook.
vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.example.com',
}));

// The auth hint links to the REST API keys page; a plain anchor is enough
// here — routing is not this suite's concern.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// The tenant-header row and the example request read the organization's slug
// through `useOrganization`; the shared render mounts no QueryClient, so the
// hook answers as a settled query.
const organizationQuery = {
  data: { slug: 'northlight' } as { slug?: string } | undefined,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganization: () => organizationQuery,
}));

// Whether a coding agent may sign in and this person may connect one is the
// access hook's answer; the page says so only then.
const agentAccess = { connectAgents: false };

vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({
    useApiSettingsAccess: () => ({ connectAgents: agentAccess.connectAgents }),
  }),
);

const t = i18n.getFixedT('en', 'settings');

const GROUP_HEADINGS: Record<McpToolGroup, string> = {
  authoring: 'Authoring',
  management: 'Run & trigger management',
  discovery: 'Discovery',
  settings: 'Settings',
  capability: 'Capabilities & knowledge',
};

describe('McpEndpointSection', () => {
  it('renders the deployment MCP endpoint URL', () => {
    render(<McpEndpointSection organizationId="org-1" />);

    expect(
      screen.getByText('https://tale.example.com/api/v1/mcp'),
    ).toBeInTheDocument();
  });

  it('sends everyone to a REST API key while coding agents may not sign in', () => {
    agentAccess.connectAgents = false;

    render(<McpEndpointSection organizationId="org-1" />);

    expect(
      screen.getByText(/Authenticate with a REST API key as a bearer token/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'REST API keys.' }),
    ).toHaveAttribute('href', '/dashboard/$id/settings/api/rest');
    expect(screen.queryByText(/signs itself in/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Connected agents.' }),
    ).not.toBeInTheDocument();
  });

  it('says a coding agent signs itself in, and where to end it, once agents may sign in', () => {
    agentAccess.connectAgents = true;

    render(<McpEndpointSection organizationId="org-1" />);

    // The agent's own sign-in comes first, with its page; the key is for
    // scripts and the clients that cannot sign in.
    expect(
      screen.getByText(/A coding agent that supports it signs itself in/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Connected agents.' }),
    ).toHaveAttribute('href', '/dashboard/$id/settings/api/agents');
    expect(
      screen.getByText(
        /Scripts and other clients authenticate with a REST API key/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/^Authenticate with a REST API key/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'REST API keys.' }),
    ).toHaveAttribute('href', '/dashboard/$id/settings/api/rest');

    agentAccess.connectAgents = false;
  });

  it('shows the organization slug and bakes it into the example request', () => {
    render(<McpEndpointSection organizationId="org-1" />);

    // A multi-organization key must send the slug on every request, so the
    // page shows it on its own row and the copied example already carries it.
    expect(screen.getByText('northlight')).toBeInTheDocument();
    expect(
      screen.getByText(/-H 'X-Organization-Slug: northlight'/),
    ).toBeInTheDocument();
  });

  it('surfaces organization read failures and retries without a runnable example', async () => {
    organizationQuery.data = undefined;
    organizationQuery.isError = true;
    organizationQuery.refetch.mockResolvedValue({});

    const { user } = render(<McpEndpointSection organizationId="org-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The organization details could not be loaded',
    );
    expect(
      screen.queryByText(/X-Organization-Slug: <org-slug>/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Try it')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(organizationQuery.refetch).toHaveBeenCalledOnce();

    organizationQuery.data = { slug: 'northlight' };
    organizationQuery.isError = false;
  });

  it('does not invent a runnable example for a healthy organization without a slug', () => {
    organizationQuery.data = {};
    organizationQuery.isError = false;

    render(<McpEndpointSection organizationId="org-1" />);

    expect(screen.queryByText(/X-Organization-Slug:/)).not.toBeInTheDocument();

    organizationQuery.data = { slug: 'northlight' };
  });

  it('renders the tool inventory in the documented groups', async () => {
    const { container } = render(<McpEndpointSection organizationId="org-1" />);

    for (const group of MCP_TOOL_GROUPS) {
      // Each list is named by its group's row, so a screen reader says
      // which group a tool is in.
      const list = screen.getByRole('list', { name: GROUP_HEADINGS[group] });
      expect(list).toHaveAccessibleDescription(
        t(`mcpEndpoint.tools.${group}.description`),
      );

      const names = within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent);
      expect(names).toEqual(
        MCP_TOOLS.filter((tool) => tool.group === group).map(
          (tool) => tool.name,
        ),
      );
    }

    // Grouping must not duplicate or drop a tool across rows.
    expect(screen.getAllByRole('listitem')).toHaveLength(MCP_TOOLS.length);

    await checkAccessibility(container);
  });
});
