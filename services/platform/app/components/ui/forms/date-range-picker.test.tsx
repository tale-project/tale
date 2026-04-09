import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

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
});
