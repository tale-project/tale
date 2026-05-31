import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

vi.mock('convex/react', () => ({
  useAction: () => vi.fn(),
}));

vi.mock('../hooks/use-mcp-servers', () => ({
  useMcpServers: () => ({
    data: [],
    refetch: vi.fn(),
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    mcp_servers: {
      public_mutations: {
        create: 'create',
      },
    },
  },
}));

const { McpServers } = await import('./mcp-servers');

const noop = vi.fn();

describe('McpServers', () => {
  // The page title and "Add MCP server" trigger now live in the route's
  // `SettingsPage` header; this component renders the server grid + add sheet.
  it('renders empty state when no servers', () => {
    render(
      <McpServers
        organizationId="org_1"
        addDialogOpen={false}
        onAddDialogOpenChange={noop}
      />,
    );
    expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
  });

  it('renders the add-server sheet when open', () => {
    render(
      <McpServers
        organizationId="org_1"
        addDialogOpen
        onAddDialogOpenChange={noop}
      />,
    );
    expect(
      screen.getByRole('button', { name: /save server/i }),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with empty state', async () => {
      const { container } = render(
        <McpServers
          organizationId="org_1"
          addDialogOpen={false}
          onAddDialogOpenChange={noop}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
