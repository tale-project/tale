import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Checkbox } from './checkbox';
import { Label } from './label';

describe('Checkbox', () => {
  describe('accessibility', () => {
    it('passes axe audit with an aria-label', async () => {
      const { container } = render(<Checkbox aria-label="Accept terms" />);
      await checkAccessibility(container);
    });

    it('passes axe audit when paired with a Label', async () => {
      const { container } = render(
        <div className="flex items-center gap-2">
          <Checkbox id="terms" />
          <Label htmlFor="terms">Accept terms</Label>
        </div>,
      );
      await checkAccessibility(container);
    });
  });

  describe('disabledReason', () => {
    it('keeps native disabled when no reason is given', () => {
      render(<Checkbox aria-label="Accept terms" disabled />);
      expect(screen.getByRole('checkbox')).toBeDisabled();
    });

    it('soft-disables (aria-disabled, focusable) with a reason', () => {
      render(
        <Checkbox
          aria-label="Accept terms"
          disabled
          disabledReason="Read the terms first"
        />,
      );
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).not.toBeDisabled();
      expect(checkbox).toHaveAttribute('aria-disabled', 'true');
      expectFocusable(checkbox);
    });

    it('surfaces the reason as a tooltip on focus', async () => {
      const { user } = render(
        <Checkbox
          aria-label="Accept terms"
          disabled
          disabledReason="Read the terms first"
        />,
      );
      await user.tab();
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('Read the terms first');
    });

    it('does not toggle a soft-disabled checkbox on click or Space', async () => {
      const onCheckedChange = vi.fn();
      const { user } = render(
        <Checkbox
          aria-label="Accept terms"
          disabled
          disabledReason="Read the terms first"
          onCheckedChange={onCheckedChange}
        />,
      );
      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);
      checkbox.focus();
      await user.keyboard(' ');
      expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it('passes axe audit for a soft-disabled checkbox', async () => {
      const { container } = render(
        <Checkbox
          aria-label="Accept terms"
          disabled
          disabledReason="Read the terms first"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
