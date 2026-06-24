import { describe, it, expect } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Input } from './input';

describe('Input', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Input aria-label="Email" type="email" />);
      await checkAccessibility(container);
    });
  });

  describe('disabledReason', () => {
    it('keeps native disabled when no reason is given', () => {
      render(<Input aria-label="Email" disabled />);
      const input = screen.getByRole('textbox');
      expect(input).toBeDisabled();
    });

    it('soft-disables (aria-disabled, focusable, readOnly) with a reason', () => {
      render(
        <Input aria-label="Email" disabled disabledReason="Verify first" />,
      );
      const input = screen.getByRole('textbox');
      // Not natively disabled, so it stays focusable and emits events…
      expect(input).not.toBeDisabled();
      // …but is announced as disabled and can't be edited.
      expect(input).toHaveAttribute('aria-disabled', 'true');
      expect(input).toHaveAttribute('readonly');
      expectFocusable(input);
    });

    it('surfaces the reason as a tooltip on focus', async () => {
      const { user } = render(
        <Input aria-label="Email" disabled disabledReason="Verify first" />,
      );
      await user.tab();
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('Verify first');
    });

    it('ignores the reason while enabled', () => {
      render(<Input aria-label="Email" disabledReason="Verify first" />);
      const input = screen.getByRole('textbox');
      expect(input).not.toBeDisabled();
      expect(input).not.toHaveAttribute('aria-disabled');
    });

    it('passes axe audit for a soft-disabled input', async () => {
      const { container } = render(
        <Input aria-label="Email" disabled disabledReason="Verify first" />,
      );
      await checkAccessibility(container);
    });
  });

  describe('border visibility', () => {
    // Regression test for #1478: in light mode the field edge was barely
    // visible because inputs used the faint incidental --color-border-base
    // (#e5e7eb on a white surface). They must use the stronger, input-specific
    // --color-border-input token instead.
    it('uses the input-specific border token, not the faint base border', () => {
      const { container } = render(<Input aria-label="Name" />);
      const input = container.querySelector('input');
      expect(input?.className).toContain('--color-border-input');
      expect(input?.className).not.toContain('--color-border-base');
    });
  });
});
