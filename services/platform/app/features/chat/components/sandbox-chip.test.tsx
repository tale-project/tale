import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Pre-thread staging: before the thread exists the pill must stay clickable
// and edit the layout context's staged workdir (useSendMessage applies it to
// the thread the first send creates) — a regression here silently demotes the
// pill to a status display and the FIRST turn loses its working directory.

const mockSetPendingSandboxWorkdir = vi.fn();
let mockPendingSandboxWorkdir = '';

vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    selectedAgent: { name: 'claude-code', displayName: 'Claude Code' },
    pendingSandboxWorkdir: mockPendingSandboxWorkdir,
    setPendingSandboxWorkdir: mockSetPendingSandboxWorkdir,
  }),
}));

vi.mock('../hooks/queries', () => ({
  useChatAgents: () => ({
    agents: [{ name: 'claude-code', primaryBehavior: 'external-agent' }],
  }),
  useThreadSandboxState: () => undefined,
  useSessionProgress: () => undefined,
}));

vi.mock('../hooks/use-thread-agent-lock', () => ({
  useThreadAgentLock: () => ({ lockedAgent: undefined }),
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: undefined }),
}));

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { SandboxChip } from './sandbox-chip';

describe('SandboxChip — pre-thread workdir staging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPendingSandboxWorkdir = '';
  });

  it('opens the settings popover before the thread exists', async () => {
    const { user } = render(
      <SandboxChip threadId={undefined} organizationId="org_1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Sandbox' }));

    expect(screen.getByText('Sandbox settings')).toBeInTheDocument();
  });

  it('saving pre-thread stages the workdir in the layout context', async () => {
    const { user } = render(
      <SandboxChip threadId={undefined} organizationId="org_1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Sandbox' }));
    await user.type(screen.getByLabelText('Working directory'), 'tale');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockSetPendingSandboxWorkdir).toHaveBeenCalledWith('tale');
  });

  it('prefills the popover with the already-staged value', async () => {
    mockPendingSandboxWorkdir = 'tale';
    const { user } = render(
      <SandboxChip threadId={undefined} organizationId="org_1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Sandbox' }));

    expect(screen.getByLabelText('Working directory')).toHaveValue('tale');
  });

  it('rejects an invalid staged path with an inline error', async () => {
    const { user } = render(
      <SandboxChip threadId={undefined} organizationId="org_1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Sandbox' }));
    await user.type(screen.getByLabelText('Working directory'), '../escape');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(mockSetPendingSandboxWorkdir).not.toHaveBeenCalled();
  });

  it('Save stays disabled until the draft differs from the saved value', async () => {
    mockPendingSandboxWorkdir = 'tale';
    const { user } = render(
      <SandboxChip threadId={undefined} organizationId="org_1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Sandbox' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.type(screen.getByLabelText('Working directory'), '2');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('mid-turn (disabled) the pill is informational, not a button', () => {
    render(
      <SandboxChip threadId={undefined} organizationId="org_1" disabled />,
    );

    expect(
      screen.queryByRole('button', { name: 'Sandbox' }),
    ).not.toBeInTheDocument();
  });
});
