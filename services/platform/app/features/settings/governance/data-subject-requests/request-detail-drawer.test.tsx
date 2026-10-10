import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import { RequestDetailDrawer } from './request-detail-drawer';

const state = vi.hoisted(() => ({
  userId: 'second-admin',
  status: 'pending',
  effectiveAt: undefined as number | undefined,
  errorMessage: undefined as string | undefined,
  wfExecutionsErased: undefined as number | undefined,
  perCategorySnapshot: undefined as Record<string, unknown> | undefined,
  holdBlock: undefined as
    | { orgHeld: boolean; userCustodianHeld: boolean; active: boolean }
    | undefined,
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
// The hold panel deep-links to the legal-hold page; there is no router here.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      'aria-label'?: string;
      className?: string;
    }) => (
      <a href="/legal-hold" aria-label={props['aria-label']}>
        {children}
      </a>
    ),
  };
});
vi.mock('./hooks/queries', () => ({
  useGetErasureRequest: () => ({
    data: {
      request: {
        _id: 'request-a',
        status: state.status,
        approvalId: 'approval-a',
        effectiveAt: state.effectiveAt,
        errorMessage:
          state.status === 'blocked' ? 'org_hold' : state.errorMessage,
        perCategorySnapshot: state.perCategorySnapshot,
        wfExecutionsErased: state.wfExecutionsErased,
        holdBlock: state.holdBlock,
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
  state.errorMessage = undefined;
  state.wfExecutionsErased = undefined;
  state.perCategorySnapshot = undefined;
  state.holdBlock = undefined;
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
  it('explains a preserved legacy run without calling it erased or a legal hold', async () => {
    state.status = 'partial';
    state.errorMessage = 'legacy_automation_hold';
    state.wfExecutionsErased = 1;
    state.perCategorySnapshot = {
      automationRuns: { rows: 1, skippedByHold: 2 },
    };
    const { user } = show();
    expect(
      screen.getByText('Automation runs erased').parentElement,
    ).toHaveTextContent('Automation runs erased1');
    expect(
      screen.getByText(/earlier external actions have not been verified/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('legacy_automation_hold'),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByText('Full breakdown across all data categories'),
    );
    expect(
      screen.getByText('1 erased · 2 skipped by hold'),
    ).toBeInTheDocument();
  });
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

describe('DSAR receipt hold block', () => {
  it('tells the admin the approval policy was captured at filing', () => {
    show();
    expect(
      screen.getByText(
        /approval requirement was captured when the request was filed/,
      ),
    ).toBeInTheDocument();
  });

  it('names the hold that still covers the subject and offers Retry', () => {
    state.status = 'blocked';
    state.holdBlock = { orgHeld: true, userCustodianHeld: false, active: true };
    show();
    expect(
      screen.getByText(/An organization-wide hold is preserving/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says the hold was released instead of claiming an active hold', () => {
    state.status = 'blocked';
    state.holdBlock = {
      orgHeld: false,
      userCustodianHeld: false,
      active: false,
    };
    show();
    expect(
      screen.getByText(
        'The hold was released — choose Retry to continue the erasure.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/An active legal hold is preserving/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
