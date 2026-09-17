import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import { RequestDetailDrawer } from './request-detail-drawer';

const state = vi.hoisted(() => ({
  userId: 'second-admin',
  status: 'pending',
  effectiveAt: undefined as number | undefined,
}));
const decide = vi.hoisted(() => vi.fn());
const cancel = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { userId: state.userId } }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ cannot: () => false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: decide, isPending: false }),
}));
vi.mock('@tale/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./hooks/queries', () => ({
  useGetErasureRequest: () => ({
    data: {
      request: {
        _id: 'request-a',
        status: state.status,
        approvalId: 'approval-a',
        effectiveAt: state.effectiveAt,
        targetUserId: 'subject-a',
        targetUserName: 'Test subject',
        requestedBy: 'filer',
        requestedByName: 'First admin',
        requestedAt: 0,
        slaDeadlineAt: Date.now() + 86400000,
        reason: 'Synthetic request',
      },
      auditEntries: [],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('./hooks/mutations', () => ({
  useCancelErasureRequest: () => ({ mutateAsync: cancel, isPending: false }),
  useExtendErasureDeadline: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryErasureRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.userId = 'second-admin';
  state.status = 'pending';
  state.effectiveAt = undefined;
  decide.mockResolvedValue(null);
  cancel.mockResolvedValue(null);
});
const show = () =>
  render(
    <RequestDetailDrawer
      organizationId="org-a"
      requestId="request-a"
      open
      onClose={vi.fn()}
    />,
  );

describe('DSAR receipt decisions', () => {
  it.each([
    ['Approve request', 'executing'],
    ['Reject request', 'rejected'],
  ])(
    'allows a second admin to confirm %s through the existing approval door',
    async (label, status) => {
      const { user } = show();
      await user.click(screen.getByRole('button', { name: label }));
      const dialog = screen.getByRole('dialog', { name: label });
      expect(decide).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: label }));
      expect(decide).toHaveBeenCalledWith({ approvalId: 'approval-a', status });
    },
  );

  it('keeps self-approval disabled while letting the filer cancel a pending request', async () => {
    state.userId = 'filer';
    const { user } = show();
    expect(
      screen.getByRole('button', { name: 'Approve request' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    const reason = screen.getByRole('textbox');
    await user.type(reason, 'The synthetic request is withdrawn.');
    const dialogs = screen.getAllByRole('dialog');
    const dialog = dialogs.at(-1)!;
    await user.click(
      within(dialog).getByRole('button', { name: 'Cancel request' }),
    );
    expect(cancel).toHaveBeenCalledWith({
      requestId: 'request-a',
      cancellationReason: 'The synthetic request is withdrawn.',
    });
  });

  it('does not offer decisions or extension once the request is cancelled', () => {
    state.status = 'cancelled';
    show();
    expect(
      screen.queryByRole('button', { name: 'Approve request' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reject request' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel request' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Extend deadline' }),
    ).not.toBeInTheDocument();
  });
});
