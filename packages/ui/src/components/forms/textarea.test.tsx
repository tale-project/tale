import { describe, it, expect } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Textarea } from './textarea';

describe('Textarea', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Textarea aria-label="Bio" />);
      await checkAccessibility(container);
    });
  });

  describe('disabledReason', () => {
    it('keeps native disabled when no reason is given', () => {
      render(<Textarea aria-label="Bio" disabled />);
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
      // Native `disabled` already conveys the state; no redundant aria-disabled.
      expect(textarea).not.toHaveAttribute('aria-disabled');
    });

    it('soft-disables (aria-disabled, focusable, readOnly) with a reason', () => {
      render(
        <Textarea aria-label="Bio" disabled disabledReason="Unlock first" />,
      );
      const textarea = screen.getByRole('textbox');
      expect(textarea).not.toBeDisabled();
      expect(textarea).toHaveAttribute('aria-disabled', 'true');
      expect(textarea).toHaveAttribute('readonly');
      expectFocusable(textarea);
    });

    it('surfaces the reason as a tooltip on focus', async () => {
      const { user } = render(
        <Textarea aria-label="Bio" disabled disabledReason="Unlock first" />,
      );
      await user.tab();
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('Unlock first');
    });

    it('ignores the reason while enabled', () => {
      render(<Textarea aria-label="Bio" disabledReason="Unlock first" />);
      expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-disabled');
    });

    it('passes axe audit for a soft-disabled textarea', async () => {
      const { container } = render(
        <Textarea aria-label="Bio" disabled disabledReason="Unlock first" />,
      );
      await checkAccessibility(container);
    });
  });

  describe('border visibility', () => {
    // Regression test for #1478: textareas shared the faint light-mode border
    // with inputs and must likewise use the stronger --color-border-input token.
    it('uses the input-specific border token, not the faint base border', () => {
      const { container } = render(<Textarea aria-label="Notes" />);
      const textarea = container.querySelector('textarea');
      expect(textarea?.className).toContain('--color-border-input');
      expect(textarea?.className).not.toContain('--color-border-base');
    });
  });
});
