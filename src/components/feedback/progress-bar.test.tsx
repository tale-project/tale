import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ProgressBar } from './progress-bar';

function renderProgressBar(props?: Partial<Parameters<typeof ProgressBar>[0]>) {
  return render(
    <ProgressBar
      value={25}
      max={100}
      label="Indexed pages"
      tooltipContent="25 % - 25 of 100 pages"
      {...props}
    />,
  );
}

function getPercentageText() {
  const group = screen.getByRole('group');
  const span = group.querySelector('span');
  return span?.textContent;
}

describe('ProgressBar', () => {
  describe('rendering', () => {
    it('renders the progress bar', () => {
      renderProgressBar();
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('renders the percentage in the UI language’s own format', () => {
      renderProgressBar({ value: 75, max: 100 });
      expect(getPercentageText()).toBe('75%');
    });

    it('spaces the sign the German way for a German UI', async () => {
      const de = createInstance();
      await de.init({ lng: 'de', resources: {} });
      render(
        <I18nextProvider i18n={de}>
          <ProgressBar
            value={75}
            max={100}
            label="Indexed pages"
            tooltipContent={null}
          />
        </I18nextProvider>,
      );
      expect(getPercentageText()).toBe(
        new Intl.NumberFormat('de', { style: 'percent' }).format(0.75),
      );
      expect(getPercentageText()).not.toBe('75%');
    });

    it('renders a group wrapper', () => {
      renderProgressBar();
      expect(screen.getByRole('group')).toBeInTheDocument();
    });

    it('shows visual progress', () => {
      const { container } = renderProgressBar({ value: 50, max: 100 });
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveStyle({ transform: 'translateX(-50%)' });
    });
  });

  describe('percentage calculation', () => {
    it('calculates percentage correctly', () => {
      renderProgressBar({ value: 50, max: 200 });
      expect(getPercentageText()).toBe('25%');
    });

    it('rounds percentage to nearest integer', () => {
      renderProgressBar({ value: 1, max: 3 });
      expect(getPercentageText()).toBe('33%');
    });

    it('clamps percentage at 100', () => {
      renderProgressBar({ value: 150, max: 100 });
      expect(getPercentageText()).toBe('100%');
    });

    it('handles 0 max gracefully', () => {
      renderProgressBar({ value: 0, max: 0 });
      expect(getPercentageText()).toBe('0%');
    });

    it('shows 0% when value is 0', () => {
      renderProgressBar({ value: 0, max: 50 });
      expect(getPercentageText()).toBe('0%');
    });

    it('shows 100% when value equals max', () => {
      renderProgressBar({ value: 50, max: 50 });
      expect(getPercentageText()).toBe('100%');
    });
  });

  describe('progress element', () => {
    it('passes value to progress', () => {
      renderProgressBar({ value: 30, max: 100 });
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '30',
      );
    });

    it('passes max to progress', () => {
      renderProgressBar({ value: 30, max: 200 });
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuemax',
        '200',
      );
    });

    it('has aria-valuemin', () => {
      renderProgressBar({ value: 50, max: 100 });
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuemin',
        '0',
      );
    });

    it('handles 0 value visual', () => {
      const { container } = renderProgressBar({ value: 0, max: 100 });
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveStyle({ transform: 'translateX(-100%)' });
    });

    it('handles 100 value visual', () => {
      const { container } = renderProgressBar({ value: 100, max: 100 });
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveStyle({ transform: 'translateX(-0%)' });
    });

    it('handles custom max visual', () => {
      const { container } = renderProgressBar({ value: 3, max: 5 });
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveStyle({ transform: 'translateX(-40%)' });
    });

    it('applies green indicator when complete', () => {
      const { container } = renderProgressBar({ value: 100, max: 100 });
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveClass('bg-green-500');
    });

    it('does not apply green indicator when incomplete', () => {
      const { container } = renderProgressBar({ value: 50, max: 100 });
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).not.toHaveClass('bg-green-500');
    });

    it('indicator has aria-hidden', () => {
      const { container } = renderProgressBar();
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toBeInTheDocument();
    });

    it('has transition classes', () => {
      const { container } = renderProgressBar();
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator?.className).toContain('transition-');
    });
  });

  describe('tooltip', () => {
    it('shows tooltip on hover', async () => {
      const { user } = renderProgressBar();
      const group = screen.getByRole('group');
      await user.hover(group);
      expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = renderProgressBar();
      await checkAccessibility(container);
    });

    it('has accessible group label', () => {
      renderProgressBar({ label: 'Custom label' });
      expect(screen.getByRole('group')).toHaveAttribute(
        'aria-label',
        'Custom label',
      );
    });

    it('forwards label to progressbar', () => {
      renderProgressBar({ label: 'Indexed pages' });
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-label',
        'Indexed pages',
      );
    });
  });

  describe('value text', () => {
    it("prints the caller's own figure instead of the percentage", () => {
      renderProgressBar({ value: 40, max: 100, valueText: '5 days' });
      expect(getPercentageText()).toBe('5 days');
    });

    it('prints nothing when the caller keeps its figure outside the bar', () => {
      renderProgressBar({ value: 40, max: 100, valueText: null });
      expect(screen.getByRole('group').querySelector('span')).toBeNull();
    });

    it('still passes an axe audit with no figure beside it', async () => {
      const { container } = renderProgressBar({ valueText: null });
      await checkAccessibility(container);
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      renderProgressBar({ className: 'custom-class' });
      expect(screen.getByRole('group')).toHaveClass('custom-class');
    });

    it('applies custom indicatorClassName', () => {
      const { container } = renderProgressBar({
        value: 50,
        max: 100,
        indicatorClassName: 'bg-orange-500',
      });
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveClass('bg-orange-500');
    });
  });
});
