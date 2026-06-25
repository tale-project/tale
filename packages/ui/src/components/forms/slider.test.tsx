import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Slider } from './slider';

describe('Slider', () => {
  describe('accessibility', () => {
    it('passes axe audit with an accessible name', async () => {
      const { container } = render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={() => {}}
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('disabledReason', () => {
    it('keeps native disabled when no reason is given', () => {
      render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={() => {}}
          disabled
        />,
      );
      expect(screen.getByRole('slider')).toBeDisabled();
    });

    it('soft-disables (aria-disabled, focusable) with a reason', () => {
      render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={() => {}}
          disabled
          disabledReason="Enable advanced mode first"
        />,
      );
      const slider = screen.getByRole('slider');
      expect(slider).not.toBeDisabled();
      expect(slider).toHaveAttribute('aria-disabled', 'true');
      expectFocusable(slider);
    });

    it('surfaces the reason as a tooltip on focus', async () => {
      const { user } = render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={() => {}}
          disabled
          disabledReason="Enable advanced mode first"
        />,
      );
      await user.tab();
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('Enable advanced mode first');
    });

    it('does not change value via arrow keys while soft-disabled', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={onChange}
          disabled
          disabledReason="Enable advanced mode first"
        />,
      );
      const slider = screen.getByRole('slider');
      slider.focus();
      await user.keyboard('{ArrowRight}{ArrowLeft}');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('is readOnly while soft-disabled (freezes the value, no React warning)', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={() => {}}
          disabled
          disabledReason="Enable advanced mode first"
        />,
      );
      const slider = screen.getByRole('slider');
      expect(slider).toHaveAttribute('readonly');
      // A controlled `value` without `onChange` (swallowed while soft-disabled)
      // would make React log a console error — `readOnly` must silence it.
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('ignores the reason while enabled', () => {
      render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={() => {}}
          disabledReason="Enable advanced mode first"
        />,
      );
      expect(screen.getByRole('slider')).not.toHaveAttribute('aria-disabled');
    });

    it('passes axe audit for a soft-disabled slider', async () => {
      const { container } = render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={() => {}}
          disabled
          disabledReason="Enable advanced mode first"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
