import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { SelectableRow } from './selectable-row';

describe('SelectableRow', () => {
  describe('rendering', () => {
    it('renders as a button', () => {
      render(<SelectableRow>Row content</SelectableRow>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders children', () => {
      render(<SelectableRow>Row content</SelectableRow>);
      expect(screen.getByText('Row content')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(<SelectableRow className="custom-class">Row</SelectableRow>);
      expect(screen.getByRole('button')).toHaveClass('custom-class');
    });
  });

  describe('selected state', () => {
    it('applies ring styling when selected', () => {
      render(<SelectableRow selected>Row</SelectableRow>);
      expect(screen.getByRole('button')).toHaveClass('ring-2');
    });

    it('does not apply ring styling when not selected', () => {
      render(<SelectableRow selected={false}>Row</SelectableRow>);
      expect(screen.getByRole('button')).not.toHaveClass('ring-2');
    });

    it('does not apply ring styling by default', () => {
      render(<SelectableRow>Row</SelectableRow>);
      expect(screen.getByRole('button')).not.toHaveClass('ring-2');
    });
  });

  describe('interactions', () => {
    it('fires onClick when clicked', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <SelectableRow onClick={handleClick}>Row</SelectableRow>,
      );
      await user.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <SelectableRow>Selectable row item</SelectableRow>,
      );
      await checkAccessibility(container);
    });
  });
});
