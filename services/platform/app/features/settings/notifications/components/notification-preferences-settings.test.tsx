import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { act, render, screen } from '@/tests/utils/render';

import { NotificationPreferencesSettings } from './notification-preferences-settings';

// Regression coverage for issue #2651: the page's own copy promises "Review
// requests always stay on — they are safety signals", but the toggle sat
// among the regular rows with no special-casing, so a user could switch it
// off (and the OFF state persisted). The fix locks the control on instead of
// letting the UI contradict its own promise.

const mockSave = vi.fn();

let prefsFixture:
  | {
      taskReview?: boolean;
      mention?: boolean;
      automationAlerts?: boolean;
    }
  | undefined = {};

const viewer = vi.hoisted(() => ({ role: 'member' }));

vi.mock('@/app/hooks/use-ability', async () => {
  const { defineAbilityFor } = await import('@/lib/permissions/ability');
  return { useAbility: () => defineAbilityFor(viewer.role) };
});

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('../hooks/queries', () => ({
  useNotificationPreferences: () => ({ data: prefsFixture, isLoading: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useSetNotificationPreferences: () => {
    const [isPending, setIsPending] = useState(false);
    return {
      mutateAsync: async (args: Record<string, string | boolean>) => {
        setIsPending(true);
        try {
          await mockSave(args);
        } finally {
          setIsPending(false);
        }
      },
      isPending,
    };
  },
}));

describe('NotificationPreferencesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSave.mockReset();
    prefsFixture = {};
    viewer.role = 'member';
  });

  describe('Keyboard focus during saving (#3819)', () => {
    it.each([
      ['Task assigned to me', 'taskAssigned', 'Task status changed'],
      ['Mentions', 'mention', 'Start and due dates'],
      ['Email me actionable alerts', 'actionableEmail', 'Task assigned to me'],
    ])(
      'keeps %s focused and preserves Tab order while saving',
      async (label, key, nextLabel) => {
        const { promise, resolve } = Promise.withResolvers<void>();
        mockSave.mockReturnValueOnce(promise);
        const { user } = render(<NotificationPreferencesSettings />);
        const toggle = screen.getByRole('switch', { name: label });

        toggle.focus();
        await user.keyboard(' ');

        expect(mockSave).toHaveBeenCalledWith({
          organizationId: 'org-1',
          [key]: false,
        });
        expect(toggle).toHaveAttribute('aria-busy', 'true');
        expect(toggle).not.toBeDisabled();
        expect(toggle).toHaveFocus();
        await user.keyboard(' ');
        expect(mockSave).toHaveBeenCalledTimes(1);
        await user.tab();
        const nextToggle = screen.getByRole('switch', { name: nextLabel });
        expect(nextToggle).toHaveFocus();
        await user.keyboard(' ');
        await user.click(nextToggle);
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(
          screen.getByRole('switch', { name: 'Review requests' }),
        ).toBeDisabled();

        await act(async () => resolve());
        expect(nextToggle).toHaveFocus();
        expect(toggle).toHaveAttribute('aria-busy', 'false');
        await user.keyboard(' ');
        expect(mockSave).toHaveBeenCalledTimes(2);
      },
    );

    it.each(['success', 'failure'])(
      'keeps focus on the changed switch after save %s and allows retry',
      async (outcome) => {
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        mockSave.mockReturnValueOnce(promise);
        const { user, rerender } = render(<NotificationPreferencesSettings />);
        const toggle = screen.getByRole('switch', { name: 'Mentions' });

        toggle.focus();
        await user.keyboard(' ');
        expect(toggle).not.toBeDisabled();
        expect(toggle).toHaveFocus();

        await act(async () => {
          if (outcome === 'success') {
            prefsFixture = { mention: false };
            resolve();
          } else {
            reject(new Error('Save failed'));
          }
        });
        rerender(<NotificationPreferencesSettings />);

        expect(toggle).toHaveFocus();
        expect(toggle).toHaveAttribute('aria-busy', 'false');
        expect(toggle).toHaveAttribute(
          'aria-checked',
          String(outcome === 'failure'),
        );
        await user.keyboard(' ');
        expect(mockSave).toHaveBeenLastCalledWith({
          organizationId: 'org-1',
          mention: outcome === 'success',
        });
        expect(mockSave).toHaveBeenCalledTimes(2);
      },
    );
  });

  describe('Review requests lock (#2651)', () => {
    it('renders the Review requests switch checked and disabled even when the stored preference is off', () => {
      prefsFixture = { taskReview: false };

      render(<NotificationPreferencesSettings />);

      const reviewSwitch = screen.getByRole('switch', {
        name: 'Review requests',
      });
      expect(reviewSwitch).toBeChecked();
      expect(reviewSwitch).toBeDisabled();
      expect(
        screen.getByText(/Always on — it's a safety signal\./),
      ).toBeInTheDocument();
    });

    it('never sends a taskReview mutation when the locked switch is clicked', async () => {
      prefsFixture = { taskReview: false };

      const { user } = render(<NotificationPreferencesSettings />);

      await user.click(screen.getByRole('switch', { name: 'Review requests' }));

      expect(mockSave).not.toHaveBeenCalled();
    });

    it('leaves an ordinary toggle (e.g. Mentions) freely switchable', async () => {
      prefsFixture = { mention: true };

      const { user } = render(<NotificationPreferencesSettings />);

      const mentionSwitch = screen.getByRole('switch', { name: 'Mentions' });
      expect(mentionSwitch).not.toBeDisabled();

      await user.click(mentionSwitch);

      expect(mockSave).toHaveBeenCalledWith({
        organizationId: 'org-1',
        mention: false,
      });
    });
  });

  // Only owners and admins are told when a schedule pauses itself after
  // repeated failures (`automation_failed`), so only they get its switch.
  describe('Automation alerts', () => {
    it.each(['owner', 'admin'])(
      'offers the switch to an %s and saves it',
      async (role) => {
        viewer.role = role;
        prefsFixture = {};

        const { user } = render(<NotificationPreferencesSettings />);

        const alerts = screen.getByRole('switch', {
          name: 'Automation alerts',
        });
        expect(alerts).toBeChecked();
        await user.click(alerts);

        expect(mockSave).toHaveBeenCalledWith({
          organizationId: 'org-1',
          automationAlerts: false,
        });
      },
    );

    it.each(['member', 'editor', 'developer'])(
      'does not offer it to a %s, who never receives those alerts',
      (role) => {
        viewer.role = role;

        render(<NotificationPreferencesSettings />);

        expect(
          screen.queryByRole('switch', { name: 'Automation alerts' }),
        ).toBeNull();
        expect(
          screen.getByRole('switch', { name: 'Mentions' }),
        ).toBeInTheDocument();
      },
    );
  });
});
