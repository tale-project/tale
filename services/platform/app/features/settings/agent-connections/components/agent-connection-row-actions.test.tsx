import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { AgentConnection } from '../types';
import { AgentConnectionRowActions } from './agent-connection-row-actions';

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../hooks/mutations', () => ({
  useDisconnectAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const connection: AgentConnection = {
  id: 'conn-1',
  userId: 'ada',
  clientName: 'Claude Code',
  provenance: 'metadata_document',
  clientHost: 'claude.ai',
  scopes: ['tale:mcp'],
  createdAt: Date.UTC(2026, 9, 1),
  updatedAt: Date.UTC(2026, 9, 1),
  lastUsedAt: null,
  revokedAt: null,
  revokeReason: null,
  personName: 'Ada Lovelace',
  personEmail: 'ada@example.test',
};

function renderActions(overrides: Partial<AgentConnection> = {}) {
  return render(
    <AgentConnectionRowActions
      connection={{ ...connection, ...overrides }}
      organizationId="org-1"
      viewerUserId="ada"
    />,
  );
}

describe('AgentConnectionRowActions [AGCONN-R24]', () => {
  it('names the menu after its agent, so a list of them can be told apart', () => {
    renderActions();
    expect(
      screen.getByRole('button', { name: 'Actions for Claude Code' }),
    ).toBeInTheDocument();
  });

  it('offers Disconnect, which asks before it does anything', async () => {
    const { user } = renderActions();
    await user.click(
      screen.getByRole('button', { name: 'Actions for Claude Code' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
    expect(
      await screen.findByRole('dialog', {
        name: 'Disconnect Claude Code?',
      }),
    ).toBeInTheDocument();
  });

  it('offers nothing for an agent that is already disconnected', () => {
    renderActions({ revokedAt: Date.UTC(2026, 9, 12), revokeReason: 'user' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('passes an accessibility audit', async () => {
    const { container } = renderActions();
    await checkAccessibility(container);
  });
});
