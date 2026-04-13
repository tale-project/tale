import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { McpServerCard } from '../mcp-server-card';
import type { McpServerListItem } from '../types';

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
    discoveredTools: [{ name: 'tool1', description: 'Test tool' }],
    ...overrides,
  };
}

describe('McpServerCard', () => {
  it('renders server display name', () => {
    render(
      <McpServerCard
        server={makeServer()}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Test Server')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(
      <McpServerCard
        server={makeServer()}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('A test MCP server')).toBeInTheDocument();
  });

  it('renders tool count', () => {
    render(
      <McpServerCard
        server={makeServer()}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('1 tool')).toBeInTheDocument();
  });

  it('renders plural tools count', () => {
    render(
      <McpServerCard
        server={makeServer({
          discoveredTools: [
            { name: 'tool1', description: 'A' },
            { name: 'tool2', description: 'B' },
          ],
        })}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('2 tools')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const { user } = render(
      <McpServerCard
        server={makeServer()}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders active status badge', () => {
    render(
      <McpServerCard
        server={makeServer({ status: 'active' })}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('renders inactive status badge', () => {
    render(
      <McpServerCard
        server={makeServer({ status: 'inactive' })}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('renders error status badge', () => {
    render(
      <McpServerCard
        server={makeServer({ status: 'error' })}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit for active server', async () => {
      const { container } = render(
        <McpServerCard
          server={makeServer()}
          onClick={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit for inactive server', async () => {
      const { container } = render(
        <McpServerCard
          server={makeServer({ status: 'inactive' })}
          onClick={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit for error state', async () => {
      const { container } = render(
        <McpServerCard
          server={makeServer({ status: 'error' })}
          onClick={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
