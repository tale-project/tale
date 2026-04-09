import { vi, describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { TableDateCell, TableTimestampCell } from './table-date-cell';

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

describe('TableDateCell', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <TableDateCell date={new Date('2025-01-01')} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with null date', async () => {
      const { container } = render(<TableDateCell date={null} />);
      await checkAccessibility(container);
    });

    it('has title for tooltip on hover', () => {
      render(<TableDateCell date={new Date('2025-01-01')} />);
      const span = screen.getByText('Jan 1, 2025');
      expect(span).toHaveAttribute('title');
    });
  });
});

describe('TableTimestampCell', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <TableTimestampCell timestamp={1704067200000} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with null timestamp', async () => {
      const { container } = render(<TableTimestampCell timestamp={null} />);
      await checkAccessibility(container);
    });
  });
});
