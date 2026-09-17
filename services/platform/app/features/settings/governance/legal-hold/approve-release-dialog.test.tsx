import { afterEach, expect, it, vi } from 'vitest';

import { act, cleanup, fireEvent, render, screen } from '@/tests/utils/render';

import { ApproveReleaseDialog } from './approve-release-dialog';

const approve = vi.hoisted(() => vi.fn());
vi.mock('../hooks/mutations', () => ({
  useApproveLegalHoldRelease: () => ({
    mutateAsync: approve,
    isPending: false,
  }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('counts down and shows a new refusal after the wait expires', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  approve
    .mockRejectedValueOnce({
      data: { code: 'APPROVAL_TOO_SOON', remainingMs: 2000 },
    })
    .mockRejectedValueOnce({ data: { code: 'REQUESTER_NO_LONGER_ADMIN' } });
  render(
    <ApproveReleaseDialog
      open
      onOpenChange={vi.fn()}
      currentUserId="second-admin"
      request={{
        _id: 'release-a',
        requestedBy: 'requester',
        requestedByName: 'First admin',
        requestedAt: Date.now(),
        reason: 'Synthetic release request',
      }}
    />,
  );
  const button = screen.getByRole('button', { name: 'Approve' });
  await act(async () => {
    fireEvent.click(button);
  });
  expect(screen.getByText('Approval is allowed in 2s.')).toBeInTheDocument();
  expect(button).toBeDisabled();
  await act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText('Approval is allowed in 1s.')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByText(/Approval is allowed in/)).not.toBeInTheDocument();
  expect(button).toBeEnabled();
  await act(async () => {
    fireEvent.click(button);
  });
  expect(approve).toHaveBeenCalledTimes(2);
  expect(
    screen.getByText(/The original requester is no longer an admin/),
  ).toBeInTheDocument();
});
