import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { AgentConnection, AgentConnectionsView } from '../types';
import { AgentConnectionsSection } from './agent-connections-section';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  developer: true,
  connectAgents: true,
  member: undefined as
    | undefined
    | { status: 'ok'; userId: string; isAdmin: boolean },
}));

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
vi.mock('../hooks/queries', () => ({ useAgentConnections: h.list }));
vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({
    useApiSettingsAccess: () => ({
      developer: h.developer,
      connectAgents: h.connectAgents,
    }),
  }),
);
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: h.member }),
}));
// The dialog has a suite of its own; here only that the page opens it.
vi.mock('@/app/features/coding-agent/components/connect-agent-dialog', () => ({
  ConnectAgentDialog: ({
    open,
    organizationId,
  }: {
    open: boolean;
    organizationId: string;
  }) =>
    open ? (
      <div role="dialog" aria-label="Connect a coding agent">
        the setup for {organizationId}
      </div>
    ) : null,
}));

function connection(overrides: Partial<AgentConnection> = {}): AgentConnection {
  return {
    id: 'conn-1',
    userId: 'ada',
    clientName: 'Claude Code',
    provenance: 'metadata_document',
    clientHost: 'claude.ai',
    scopes: ['tale:mcp'],
    createdAt: Date.UTC(2026, 9, 1, 12),
    lastUsedAt: null,
    revokedAt: null,
    revokeReason: null,
    personName: 'Ada Lovelace',
    personEmail: 'ada@example.test',
    ...overrides,
  };
}

const MIA = connection({
  id: 'conn-2',
  userId: 'mia',
  clientName: 'Cursor',
  personName: 'Mia Keller',
  personEmail: 'mia@example.test',
});
const ENDED = connection({
  id: 'conn-3',
  userId: 'mia',
  clientName: 'Codex',
  revokedAt: Date.UTC(2026, 9, 12),
  revokeReason: 'membership_ended',
});

/** The answer of the list for the view asked: own, everyone's, with the ended. */
function answer(view: AgentConnectionsView) {
  const rows =
    view.scope === 'mine'
      ? [connection()]
      : [connection(), MIA, ...(view.ended ? [ENDED] : [])];
  return {
    data: { connections: rows, canSeeEveryone: true },
    error: null,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.developer = true;
  h.connectAgents = true;
  h.member = { status: 'ok', userId: 'ada', isAdmin: false };
  h.list.mockImplementation((_org: string, view: AgentConnectionsView) =>
    answer(view),
  );
});

function lastView(): AgentConnectionsView {
  return h.list.mock.lastCall?.[1] as AgentConnectionsView;
}

describe('AgentConnectionsSection [AGCONN-R24]', () => {
  it('shows a person their own agents under a title that says what they are', () => {
    render(<AgentConnectionsSection organizationId="org-1" />);
    expect(
      screen.getByRole('heading', { name: 'Connected agents' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Coding agents that signed in to Tale as you. Each works in this organization with the access you gave it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(h.list).toHaveBeenCalledWith('org-1', {
      scope: 'mine',
      ended: false,
    });
  });

  it('gives a person who is not an owner or admin no choice of whose agents to see', () => {
    render(<AgentConnectionsSection organizationId="org-1" />);
    expect(
      screen.queryByRole('radiogroup', { name: 'Agents to show' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Show disconnected' }),
    ).not.toBeInTheDocument();
  });

  it('asks for nobody’s but their own from a person whose role it has not read yet', () => {
    h.member = undefined;
    render(<AgentConnectionsSection organizationId="org-1" />);
    expect(lastView()).toEqual({ scope: 'mine', ended: false });
    expect(
      screen.queryByRole('radiogroup', { name: 'Agents to show' }),
    ).not.toBeInTheDocument();
  });

  it('lets an owner or admin choose between their own and everyone’s', async () => {
    h.member = { status: 'ok', userId: 'ada', isAdmin: true };
    const { user } = render(<AgentConnectionsSection organizationId="org-1" />);
    const group = screen.getByRole('radiogroup', { name: 'Agents to show' });
    expect(group).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Person' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Everyone' }));
    expect(lastView()).toEqual({ scope: 'everyone', ended: false });
    expect(
      screen.getByText('Coding agents members connected to this organization.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Person' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText('Mia Keller')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(lastView()).toEqual({ scope: 'mine', ended: false });
    expect(
      screen.queryByRole('columnheader', { name: 'Person' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Cursor')).not.toBeInTheDocument();
  });

  it('goes back to the person’s own agents when they stop being an owner or admin', async () => {
    h.member = { status: 'ok', userId: 'ada', isAdmin: true };
    const { user, rerender } = render(
      <AgentConnectionsSection organizationId="org-1" />,
    );
    await user.click(screen.getByRole('radio', { name: 'Everyone' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Show disconnected' }),
    );
    expect(lastView()).toEqual({ scope: 'everyone', ended: true });

    // Their role changed while the page was open: what they chose goes with it.
    h.member = { status: 'ok', userId: 'ada', isAdmin: false };
    rerender(<AgentConnectionsSection organizationId="org-1" />);
    expect(lastView()).toEqual({ scope: 'mine', ended: false });
    expect(
      screen.queryByRole('radiogroup', { name: 'Agents to show' }),
    ).not.toBeInTheDocument();
  });

  it('lets an owner or admin see the disconnected ones too, with when and why', async () => {
    h.member = { status: 'ok', userId: 'ada', isAdmin: true };
    const { user } = render(<AgentConnectionsSection organizationId="org-1" />);
    await user.click(screen.getByRole('radio', { name: 'Everyone' }));
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('checkbox', { name: 'Show disconnected' }),
    );
    expect(lastView()).toEqual({ scope: 'everyone', ended: true });
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(
      screen.getByText(/^Disconnected .*2026.* · membership ended$/),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('checkbox', { name: 'Show disconnected' }),
    );
    expect(lastView()).toEqual({ scope: 'everyone', ended: false });
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
  });

  it('keeps what an owner or admin chose while they switch between the views', async () => {
    h.member = { status: 'ok', userId: 'ada', isAdmin: true };
    const { user } = render(<AgentConnectionsSection organizationId="org-1" />);
    await user.click(
      screen.getByRole('checkbox', { name: 'Show disconnected' }),
    );
    await user.click(screen.getByRole('radio', { name: 'Everyone' }));
    expect(lastView()).toEqual({ scope: 'everyone', ended: true });
    await user.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(lastView()).toEqual({ scope: 'mine', ended: true });
  });

  it('opens the setup for whoever may connect an agent here', async () => {
    h.developer = false;
    const { user } = render(<AgentConnectionsSection organizationId="org-1" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Connect a coding agent' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'Connect a coding agent' }),
    ).toHaveTextContent('the setup for org-1');
  });

  it('offers no way to connect while the deployment does not let agents sign in', () => {
    h.connectAgents = false;
    render(<AgentConnectionsSection organizationId="org-1" />);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect a coding agent' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers a member who holds agents but may not connect one nothing to open', () => {
    h.developer = false;
    h.connectAgents = false;
    render(<AgentConnectionsSection organizationId="org-1" />);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect a coding agent' }),
    ).not.toBeInTheDocument();
  });

  it('offers retry when the list cannot be read', async () => {
    const refetch = vi.fn();
    h.list.mockReturnValue({
      data: undefined,
      error: new Error('unavailable'),
      refetch,
    });
    const { user } = render(<AgentConnectionsSection organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('passes an accessibility audit as an owner or admin', async () => {
    h.member = { status: 'ok', userId: 'ada', isAdmin: true };
    const { container, user } = render(
      <AgentConnectionsSection organizationId="org-1" />,
    );
    await user.click(screen.getByRole('radio', { name: 'Everyone' }));
    await checkAccessibility(container);
  });
});
