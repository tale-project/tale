import { describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen } from '@/tests/utils/render';

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
    }
  | undefined = {};

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('../hooks/queries', () => ({
  useNotificationPreferences: () => ({ data: prefsFixture, isLoading: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useSetNotificationPreferences: () => ({
    mutateAsync: mockSave,
    isPending: false,
  }),
}));

describe('NotificationPreferencesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prefsFixture = {};
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
});
