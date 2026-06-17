import { Skeletonize } from '@tale/ui/skeleton-context';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { DatePickerWithRange } from './date-range-picker';

// The react-datepicker CustomInput renders buttons without accessible names
// that are internal to the third-party component. Disable that specific rule.
const a11yOptions = {
  rules: { 'button-name': { enabled: false } },
};

describe('DatePickerWithRange', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<DatePickerWithRange onChange={vi.fn()} />);
      await checkAccessibility(container, a11yOptions);
    });

    it('passes axe audit with label and description', async () => {
      const { container } = render(
        <DatePickerWithRange
          onChange={vi.fn()}
          label="Date range"
          description="Select a start and end date"
        />,
      );
      await checkAccessibility(container, a11yOptions);
    });

    it('passes axe audit with error message', async () => {
      const { container } = render(
        <DatePickerWithRange
          onChange={vi.fn()}
          label="Date range"
          errorMessage="Please select a date range"
        />,
      );
      await checkAccessibility(container, a11yOptions);
    });
  });

  describe('skeleton mode', () => {
    it('masks the picker trigger while loading', () => {
      render(
        <Skeletonize loading>
          <DatePickerWithRange onChange={vi.fn()} label="Date range" />
        </Skeletonize>,
      );
      // The react-datepicker trigger buttons are replaced by the mask.
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      // The static label stays real.
      expect(screen.getByText('Date range')).toBeInTheDocument();
    });

    it('renders the real picker trigger when not loading', () => {
      render(
        <Skeletonize loading={false}>
          <DatePickerWithRange onChange={vi.fn()} label="Date range" />
        </Skeletonize>,
      );
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });
  });
});
