import { describe, expect, it, vi, beforeEach } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { AgentConnection } from '../types';
import { DisconnectAgentDialog } from './disconnect-agent-dialog';

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  mutateAsync: vi.fn(),
  pending: false,
}));

vi.mock('@tale/ui/use-toast', () => ({ toast: h.toast }));
vi.mock('../hooks/mutations', () => ({
  useDisconnectAgent: () => ({
    mutateAsync: h.mutateAsync,
    isPending: h.pending,
  }),
}));

const connection: AgentConnection = {
  id: 'conn-1',
  userId: 'ada',
  clientName: 'Claude Code',
  provenance: 'metadata_document',
  clientHost: 'claude.ai',
  scopes: ['tale:mcp'],
  createdAt: Date.UTC(2026, 9, 1),
  lastUsedAt: null,
  revokedAt: null,
  revokeReason: null,
  personName: 'Ada Lovelace',
  personEmail: 'ada@example.test',
};

function renderDialog(viewerUserId: string, onOpenChange = vi.fn()) {
  const view = render(
    <DisconnectAgentDialog
      open
      onOpenChange={onOpenChange}
      connection={connection}
      organizationId="org-1"
      viewerUserId={viewerUserId}
    />,
  );
  return { ...view, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.pending = false;
  h.mutateAsync.mockResolvedValue({ ok: true, id: 'conn-1' });
});

/** Asking before an agent is cut off, and saying what that does. */
describe('DisconnectAgentDialog [AGCONN-R24]', () => {
  it('asks about the agent by name and says it loses access at once, and can be connected again', () => {
    renderDialog('ada');
    expect(
      screen.getByRole('dialog', { name: 'Disconnect Claude Code?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Claude Code loses access to this organization at once. You can connect it again later.',
      ),
    ).toBeInTheDocument();
  });

  it('names whose agent it is when an owner or admin disconnects another person’s', () => {
    renderDialog('olav');
    expect(
      screen.getByText(
        'Claude Code of Ada Lovelace loses access to this organization at once. Ada Lovelace can connect it again.',
      ),
    ).toBeInTheDocument();
  });

  it('names the person by their address when the account has no name', () => {
    render(
      <DisconnectAgentDialog
        open
        onOpenChange={vi.fn()}
        connection={{ ...connection, personName: null }}
        organizationId="org-1"
        viewerUserId="olav"
      />,
    );
    expect(
      screen.getByText(/^Claude Code of ada@example\.test loses access/),
    ).toBeInTheDocument();
  });

  it('disconnects the agent, says so and closes', async () => {
    const { user, onOpenChange } = renderDialog('ada');
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(h.mutateAsync).toHaveBeenCalledWith(connection);
    expect(h.toast).toHaveBeenCalledWith({ title: 'Claude Code disconnected' });
  });

  it('keeps the dialog open and says why when the agent could not be disconnected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.mutateAsync.mockRejectedValue(
      new BackendApiError(
        404,
        'Agent connection not found.',
        'AGENT_CONNECTION_NOT_FOUND',
      ),
    );
    const { user, onOpenChange } = renderDialog('ada');
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.toast).toHaveBeenCalledWith({
      title: 'Claude Code could not be disconnected. Try again.',
      description: 'Agent connection not found.',
      variant: 'destructive',
    });
    // Still there to try again: the agent is still connected.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'Disconnect Claude Code?' }),
    ).toBeInTheDocument();
  });

  it('asks the server once while a disconnect is under way', async () => {
    h.pending = true;
    const { user } = renderDialog('ada');
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it('closes without disconnecting on Cancel', async () => {
    const { user, onOpenChange } = renderDialog('ada');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it('passes an accessibility audit', async () => {
    const { baseElement } = renderDialog('ada');
    await checkAccessibility(baseElement);
  });
});
