import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MCP_TOOL_GROUPS, MCP_TOOLS, type McpToolGroup } from '@/lib/mcp/tools';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { McpEndpointSection } from './mcp-endpoint-section';

/**
 * Component coverage for the API → MCP settings section: the endpoint URL
 * renders from the deployment site URL, and the tool inventory renders as
 * three grouped rows — every advertised tool exactly once, under the row of
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

const GROUP_HEADINGS: Record<McpToolGroup, string> = {
  authoring: 'Authoring',
  management: 'Run & trigger management',
  capability: 'Capabilities & knowledge',
};

describe('McpEndpointSection', () => {
  it('renders the deployment MCP endpoint URL', () => {
    render(<McpEndpointSection organizationId="org-1" />);

    expect(
      screen.getByText('https://tale.example.com/api/v1/mcp'),
    ).toBeInTheDocument();
  });

  it('renders the tool inventory in the three documented groups', async () => {
    const { container } = render(<McpEndpointSection organizationId="org-1" />);

    for (const group of MCP_TOOL_GROUPS) {
      const row = screen
        .getByText(GROUP_HEADINGS[group])
        .closest('[aria-labelledby]');
      expect(row).not.toBeNull();

      const names = within(row as HTMLElement)
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

    await waitFor(() => checkAccessibility(container));
  });
});
