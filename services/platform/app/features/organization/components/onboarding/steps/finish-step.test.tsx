import { Wizard } from '@tale/ui/wizard/wizard';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

const h = vi.hoisted(() => ({
  access: undefined as { mayConnect: boolean } | undefined,
  connections: [] as { clientName: string }[],
}));

vi.mock('@/app/features/settings/agent-connections/hooks/queries', () => ({
  useAgentConnectionAccess: () => ({ data: h.access }),
  useAgentConnections: () => ({
    data: { connections: h.connections, canSeeEveryone: false },
  }),
}));
// The guided setup has its own suites; here it only has to open and close.
vi.mock('@/app/features/coding-agent/components/connect-agent-dialog', () => ({
  ConnectAgentDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Connect a coding agent">
        <button type="button" onClick={() => onOpenChange(false)}>
          Done
        </button>
      </div>
    ) : null,
}));

import { FinishStep } from './finish-step';

beforeEach(() => {
  h.access = undefined;
  h.connections = [];
});

const fmt = (current: number, total: number, label: string) =>
  `Step ${current} of ${total}: ${label}`;

function renderFinish(
  onFinishTo?: (t: 'providers' | 'agents' | 'members') => void,
  providerConnected?: boolean,
  organizationId?: string,
) {
  return render(
    <Wizard
      steps={[{ id: 'finish', label: 'Finish' }]}
      onFinish={() => {}}
      formatProgress={fmt}
    >
      <FinishStep
        onFinishTo={onFinishTo}
        providerConnected={providerConnected}
        organizationId={organizationId}
      />
    </Wizard>,
  );
}

describe('FinishStep CTAs', () => {
  it('each CTA marks-and-routes via onFinishTo with its target', async () => {
    const onFinishTo = vi.fn();
    const { user } = renderFinish(onFinishTo);

    await user.click(
      screen.getByRole('button', { name: 'Connect a provider' }),
    );
    expect(onFinishTo).toHaveBeenCalledWith('providers');

    await user.click(screen.getByRole('button', { name: 'Invite teammates' }));
    expect(onFinishTo).toHaveBeenCalledWith('members');
  });

  it('disables the CTAs when no handler is provided', () => {
    renderFinish(undefined);
    expect(
      screen.getByRole('button', { name: 'Connect a provider' }),
    ).toBeDisabled();
  });

  it('renders the provider row as done (no CTA) when one is connected', () => {
    renderFinish(vi.fn(), true);
    // The pending "Connect a provider" CTA is replaced by a done marker...
    expect(
      screen.queryByRole('button', { name: 'Connect a provider' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('AI provider connected.')).toBeInTheDocument();
    // ...while the other next-step CTAs still render.
    expect(
      screen.getByRole('button', { name: 'Invite teammates' }),
    ).toBeInTheDocument();
  });
});

/**
 * The workspace is made by the time this step shows, so it is also the moment
 * to connect a coding agent: the guided setup opens where the person is, and
 * the wizard is still there when the agent has signed in.
 */
describe('FinishStep coding agent row', () => {
  const connectButton = () =>
    screen.queryByRole('button', { name: 'Connect an agent' });

  it('offers the guided setup in place, without finishing the wizard', async () => {
    h.access = { mayConnect: true };
    const onFinishTo = vi.fn();
    const { user } = renderFinish(onFinishTo, false, 'org-1');

    expect(
      screen.getByText(
        'Connect your coding agent to build and fix automations.',
      ),
    ).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Connect an agent' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(button);
    const dialog = await screen.findByRole('dialog', {
      name: 'Connect a coding agent',
    });
    // Onboarding is not marked complete, and nothing was navigated to.
    expect(onFinishTo).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(dialog).not.toBeInTheDocument();
  });

  it('makes no promise it cannot keep: no row while access is unknown or refused', () => {
    h.access = undefined;
    const { unmount } = renderFinish(vi.fn(), false, 'org-1');
    expect(connectButton()).not.toBeInTheDocument();
    unmount();

    h.access = { mayConnect: false };
    renderFinish(vi.fn(), false, 'org-1');
    expect(connectButton()).not.toBeInTheDocument();
    // The other next steps stand as before.
    expect(
      screen.getByRole('button', { name: 'Invite teammates' }),
    ).toBeInTheDocument();
  });

  it('has no row without a workspace to connect to', () => {
    h.access = { mayConnect: true };
    renderFinish(vi.fn(), false, undefined);
    expect(connectButton()).not.toBeInTheDocument();
  });

  it('turns to done, naming the agent, once one is connected', () => {
    h.access = { mayConnect: true };
    h.connections = [{ clientName: 'Claude Code' }];
    renderFinish(vi.fn(), false, 'org-1');
    expect(
      screen.getByText('Coding agent connected: Claude Code.'),
    ).toBeInTheDocument();
    expect(connectButton()).not.toBeInTheDocument();
  });

  it('still shows an agent that is connected when sign-in was switched off since', () => {
    h.access = { mayConnect: false };
    h.connections = [{ clientName: 'Codex' }];
    renderFinish(vi.fn(), false, 'org-1');
    expect(
      screen.getByText('Coding agent connected: Codex.'),
    ).toBeInTheDocument();
  });
});
