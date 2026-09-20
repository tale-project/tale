import { fireEvent } from '@testing-library/react';
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
      const slider = screen.getByRole('slider');
      expect(slider).toBeDisabled();
      // Native `disabled` already conveys the state; no redundant aria-disabled.
      expect(slider).not.toHaveAttribute('aria-disabled');
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

    it.each(['Home', 'End', 'PageUp', 'PageDown'])(
      'does not change value via %s while soft-disabled',
      (key) => {
        const onChange = vi.fn();
        render(
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
        // The key handler must `preventDefault` so the browser never moves the
        // thumb — a cancelled event reports `false` from `fireEvent`.
        const notCancelled = fireEvent.keyDown(slider, { key });
        expect(notCancelled).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
      },
    );

    it('blocks pointer drag while soft-disabled', () => {
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
      // Drag is the slider's primary interaction; the `onPointerDown` guard must
      // `preventDefault` so the browser never starts a drag.
      const notCancelled = fireEvent.pointerDown(slider);
      expect(notCancelled).toBe(false);
    });

    it('keeps native disabled when the reason is empty/whitespace', () => {
      render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={() => {}}
          disabled
          disabledReason="   "
        />,
      );
      const slider = screen.getByRole('slider');
      // A blank reason explains nothing, so the control must fall back to a
      // native disable rather than become inert-but-focusable with no tooltip.
      expect(slider).toBeDisabled();
      expect(slider).not.toHaveAttribute('aria-disabled');
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
