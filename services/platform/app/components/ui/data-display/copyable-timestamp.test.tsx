import { vi, describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { CopyableTimestamp } from './copyable-timestamp';

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: () => 'Jan 1, 2025',
    formatDateSmart: () => 'Today',
    formatDateHeader: () => 'Today',
    formatRelative: () => '2 min ago',
    locale: 'en',
    timezone: 'UTC',
    timezoneShort: 'UTC',
  }),
}));

describe('CopyableTimestamp', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CopyableTimestamp date={new Date('2025-01-01')} />,
      );
      await checkAccessibility(container);
    });

    it('copy button has aria-label', () => {
      render(<CopyableTimestamp date={new Date('2025-01-01')} />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label');
    });

    it('has live region for copy status', () => {
      render(<CopyableTimestamp date={new Date('2025-01-01')} />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
    });

    it('passes axe audit with null date', async () => {
      const { container } = render(<CopyableTimestamp date={null} />);
      await checkAccessibility(container);
    });
  });
});
