import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import type { McpServerListItem } from '../types';

vi.mock('convex/react', () => ({
  useAction: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    mcp_servers: {
      actions: {
        testConnection: 'testConnection',
      },
      public_mutations: {
        update: 'update',
        remove: 'remove',
        updateStatus: 'updateStatus',
      },
    },
  },
}));

const { McpServerPanel } = await import('../mcp-server-panel');

function makeServer(
  overrides: Partial<McpServerListItem> = {},
): McpServerListItem {
  return {
    _id: 'server_1',
    _creationTime: 1700000000000,
    organizationId: 'org_1',
    name: 'test-server',
    displayName: 'Test Server',
    description: 'A test MCP server',
    transportType: 'streamable_http',
    url: 'https://example.com/mcp',
    authType: 'none',
    status: 'active',
    discoveredTools: [
      { name: 'search', description: 'Search documents' },
      { name: 'create', description: 'Create items', requiresApproval: true },
    ],
    ...overrides,
  };
}

describe('McpServerPanel', () => {
  it('renders server display name', () => {
    render(
      <McpServerPanel
        open
        onOpenChange={vi.fn()}
        server={makeServer()}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    const elements = screen.getAllByText('Test Server');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders discovered tools', () => {
    render(
      <McpServerPanel
        open
        onOpenChange={vi.fn()}
        server={makeServer()}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('create')).toBeInTheDocument();
  });

  it('renders requires approval badge', () => {
    render(
      <McpServerPanel
        open
        onOpenChange={vi.fn()}
        server={makeServer()}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText('Requires approval')).toBeInTheDocument();
  });

  it('renders test connection button', () => {
    render(
      <McpServerPanel
        open
        onOpenChange={vi.fn()}
        server={makeServer()}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /test connection/i }),
    ).toBeInTheDocument();
  });

  it('renders no tools message when empty', () => {
    render(
      <McpServerPanel
        open
        onOpenChange={vi.fn()}
        server={makeServer({ discoveredTools: [] })}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText(/no tools discovered/i)).toBeInTheDocument();
  });

  it('renders server URL', () => {
    render(
      <McpServerPanel
        open
        onOpenChange={vi.fn()}
        server={makeServer()}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText('https://example.com/mcp')).toBeInTheDocument();
  });

  it('renders actions menu with edit and delete', () => {
    render(
      <McpServerPanel
        open
        onOpenChange={vi.fn()}
        server={makeServer()}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /actions menu/i }),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit for active server', async () => {
      const { container } = render(
        <McpServerPanel
          open
          onOpenChange={vi.fn()}
          server={makeServer()}
          onDeleted={vi.fn()}
          onUpdated={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit for error state server', async () => {
      const { container } = render(
        <McpServerPanel
          open
          onOpenChange={vi.fn()}
          server={makeServer({
            status: 'error',
            lastError: 'Connection refused',
          })}
          onDeleted={vi.fn()}
          onUpdated={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
