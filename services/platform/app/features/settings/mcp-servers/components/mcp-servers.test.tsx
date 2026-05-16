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

describe('McpServers', () => {
  it('renders title', () => {
    render(<McpServers organizationId="org_1" />);
    expect(screen.getByText('MCP Servers')).toBeInTheDocument();
  });

  it('renders add button', () => {
    render(<McpServers organizationId="org_1" />);
    expect(
      screen.getByRole('button', { name: /add mcp server/i }),
    ).toBeInTheDocument();
  });

  it('renders empty state when no servers', () => {
    render(<McpServers organizationId="org_1" />);
    expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with empty state', async () => {
      const { container } = render(<McpServers organizationId="org_1" />);
      await checkAccessibility(container);
    });
  });
});
