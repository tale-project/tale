import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type { AgentConnection } from '../types';
import { AgentConnectionsTable } from './agent-connections-table';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../hooks/mutations', () => ({
  useDisconnectAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function connection(overrides: Partial<AgentConnection> = {}): AgentConnection {
  return {
    id: 'conn-1',
    userId: 'ada',
    clientName: 'Claude Code',
    provenance: 'metadata_document',
    clientHost: 'claude.ai',
    scopes: ['tale:mcp', 'tale:automations.write'],
    createdAt: Date.UTC(2026, 9, 1, 12),
    lastUsedAt: null,
    revokedAt: null,
    revokeReason: null,
    personName: 'Ada Lovelace',
    personEmail: 'ada@example.test',
    ...overrides,
  };
}

function table(props: Partial<Parameters<typeof AgentConnectionsTable>[0]>) {
  return (
    <AgentConnectionsTable
      connections={[connection()]}
      organizationId="org-1"
      viewerUserId="ada"
      everyone={false}
      onConnect={() => {}}
      {...props}
    />
  );
}

/** The coding agents a person sees, one row each. */
describe('AgentConnectionsTable [AGCONN-R24]', () => {
  it('shows each agent with where it is from, what it may do and when it connected', () => {
    render(
      table({
        connections: [
          connection({ lastUsedAt: Date.now() - 3 * 60 * 60 * 1000 }),
          connection({
            id: 'conn-2',
            clientName: 'Totally Claude',
            provenance: 'registered',
            clientHost: null,
            scopes: ['tale:mcp'],
          }),
        ],
      }),
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText('Claude Code')).toBeInTheDocument();
    expect(first.getByText('claude.ai')).toBeInTheDocument();
    expect(first.getByText('Edit automations')).toBeInTheDocument();
    expect(first.getByText('3 hours ago')).toBeInTheDocument();
    const second = within(rows[1] as HTMLElement);
    expect(second.getByText('Totally Claude')).toBeInTheDocument();
    expect(second.getByText('Unverified')).toBeInTheDocument();
    // An agent that never called says so.
    expect(second.getByText('Never')).toBeInTheDocument();
  });

  it('adds the person only where more than one person’s agents are listed', () => {
    const { rerender } = render(table({}));
    expect(
      screen.queryByRole('columnheader', { name: 'Person' }),
    ).not.toBeInTheDocument();

    rerender(
      table({
        everyone: true,
        connections: [
          connection(),
          connection({
            id: 'conn-2',
            userId: 'mia',
            personName: 'Mia Keller',
            personEmail: 'mia@example.test',
          }),
        ],
      }),
    );
    expect(
      screen.getByRole('columnheader', { name: 'Person' }),
    ).toBeInTheDocument();
    // The viewer's own agent reads as theirs; another's names its person.
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Mia Keller')).toBeInTheDocument();
    expect(screen.getByText('mia@example.test')).toBeInTheDocument();
  });

  it('offers Disconnect for a live agent and nothing for one that ended', () => {
    render(
      table({
        connections: [
          connection(),
          connection({
            id: 'conn-2',
            clientName: 'Cursor',
            revokedAt: Date.UTC(2026, 9, 12),
            revokeReason: 'admin',
          }),
        ],
      }),
    );
    expect(
      screen.getByRole('button', { name: 'Actions for Claude Code' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Actions for Cursor' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/^Disconnected .* · by an Admin$/)).toBeVisible();
  });

  it('shows the empty state once the list is known empty, with the way to connect', () => {
    render(table({ connections: [] }));
    expect(
      screen.getByRole('heading', { name: 'No coding agents connected' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^Connect Claude Code, Codex, Cursor or another agent/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Connect a coding agent' }),
    ).toBeInTheDocument();
  });

  it('offers no way to connect to someone who may not connect one', () => {
    render(table({ connections: [], onConnect: undefined }));
    expect(
      screen.getByRole('heading', { name: 'No coding agents connected' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect a coding agent' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the way to connect in the toolbar once there are agents, and it connects', async () => {
    const onConnect = vi.fn();
    const { user } = render(table({ onConnect }));
    await user.click(
      screen.getByRole('button', { name: 'Connect a coding agent' }),
    );
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it('shows neither the empty state nor the way to connect while the list loads', () => {
    render(table({ connections: undefined }));
    expect(
      screen.queryByRole('heading', { name: 'No coding agents connected' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect a coding agent' }),
    ).not.toBeInTheDocument();
  });

  it('offers retry after a failed first read, never the empty state', async () => {
    const retry = vi.fn();
    const { user } = render(
      table({
        connections: undefined,
        error: new Error('The list is unavailable'),
        onRetry: retry,
      }),
    );
    expect(
      screen.queryByRole('heading', { name: 'No coding agents connected' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the rows when a refresh fails', () => {
    render(table({ error: new Error('Refresh failed'), onRetry: vi.fn() }));
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('puts what the owner or admin chooses by in the toolbar', () => {
    render(table({ filters: <button type="button">Everyone</button> }));
    expect(screen.getByRole('button', { name: 'Everyone' })).toBeVisible();
  });

  it('names the table for assistive technology and passes an audit', async () => {
    const { container } = render(
      table({
        everyone: true,
        connections: [
          connection({ lastUsedAt: Date.now() - 60 * 1000 }),
          connection({
            id: 'conn-2',
            provenance: 'registered',
            clientHost: null,
            scopes: ['tale:mcp', 'tale:settings.write'],
          }),
        ],
      }),
    );
    expect(
      screen.getByRole('table', { name: 'Connected coding agents' }),
    ).toBeInTheDocument();
    await checkAccessibility(container);
  });
});
