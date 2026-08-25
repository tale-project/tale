// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import { render, screen, waitFor, within } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/mutations', () => ({
  useDeleteAutomation: () => ({ mutateAsync, isPending: false }),
}));

import { AutomationRowActions } from './automation-row-actions';

async function openDeleteConfirm(
  user: Awaited<ReturnType<typeof render>>['user'],
) {
  await user.click(
    screen.getByRole('button', { name: 'common.actions.openMenu' }),
  );
  await user.click(
    screen.getByRole('menuitem', { name: 'common.actions.delete' }),
  );
}

describe('AutomationRowActions', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue(undefined);
    vi.mocked(toast).mockClear();
  });

  it('opens the delete confirm from the row menu', async () => {
    const { user } = render(
      <AutomationRowActions
        organizationId="org-1"
        name="org/digest"
        displayName="Digest"
      />,
    );

    await openDeleteConfirm(user);

    expect(
      screen.getByRole('heading', { name: 'automations.detail.delete.title' }),
    ).toBeInTheDocument();
  });

  it('deletes the automation after the confirm', async () => {
    const { user } = render(
      <AutomationRowActions
        organizationId="org-1"
        name="org/digest"
        displayName="Digest"
      />,
    );

    await openDeleteConfirm(user);
    await user.click(
      within(
        screen.getByRole('dialog', {
          name: 'automations.detail.delete.title',
        }),
      ).getByRole('button', { name: 'common.actions.delete' }),
    );

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'org/digest',
      });
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'automations.detail.delete.done',
        variant: 'success',
      }),
    );
  });

  it("surfaces the server's refusal when the delete is blocked", async () => {
    mutateAsync.mockRejectedValue(
      new Error(
        'A run of "org/digest" is still running — cancel it (or let it finish) before deleting the automation.',
      ),
    );
    const { user } = render(
      <AutomationRowActions
        organizationId="org-1"
        name="org/digest"
        displayName="Digest"
      />,
    );

    await openDeleteConfirm(user);
    await user.click(
      within(
        screen.getByRole('dialog', {
          name: 'automations.detail.delete.title',
        }),
      ).getByRole('button', { name: 'common.actions.delete' }),
    );

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          title: 'automations.detail.delete.failed',
          description: expect.stringContaining('still running'),
        }),
      );
    });
  });
});
