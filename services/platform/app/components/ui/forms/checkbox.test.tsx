import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  describe('rendering', () => {
    it('renders checkbox', () => {
      render(<Checkbox />);
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('renders with label', () => {
      render(<Checkbox label="Accept terms" />);
      expect(screen.getByLabelText('Accept terms')).toBeInTheDocument();
    });

    it('renders required indicator', () => {
      render(<Checkbox label="Terms" required />);
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('renders checked state', () => {
      render(<Checkbox checked />);
      expect(screen.getByRole('checkbox')).toHaveAttribute(
        'data-state',
        'checked',
      );
    });

    it('renders indeterminate state', () => {
      render(<Checkbox checked="indeterminate" />);
      expect(screen.getByRole('checkbox')).toHaveAttribute(
        'data-state',
        'indeterminate',
      );
    });
  });

  describe('interactions', () => {
    it('calls onCheckedChange when clicked', async () => {
      const handleChange = vi.fn();
      const { user } = render(<Checkbox onCheckedChange={handleChange} />);

      await user.click(screen.getByRole('checkbox'));
      expect(handleChange).toHaveBeenCalledWith(true);
    });

    it('toggles state on click', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Checkbox checked={false} onCheckedChange={handleChange} />,
      );

      await user.click(screen.getByRole('checkbox'));
      expect(handleChange).toHaveBeenCalledWith(true);
    });

    it('clicking label toggles checkbox', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Checkbox label="Accept" onCheckedChange={handleChange} />,
      );

      await user.click(screen.getByText('Accept'));
      expect(handleChange).toHaveBeenCalled();
    });

    it('does not call onCheckedChange when disabled', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Checkbox onCheckedChange={handleChange} disabled />,
      );

      await user.click(screen.getByRole('checkbox'));
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('responds to keyboard Space', async () => {
      const handleChange = vi.fn();
      const { user } = render(<Checkbox onCheckedChange={handleChange} />);

      const checkbox = screen.getByRole('checkbox');
      checkbox.focus();
      await user.keyboard(' ');
      expect(handleChange).toHaveBeenCalledWith(true);
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Checkbox label="Accept terms" />);
      await checkAccessibility(container);
    });

    it('passes axe audit without label', async () => {
      const { container } = render(<Checkbox aria-label="Accept terms" />);
      await checkAccessibility(container);
    });

    it('is focusable', () => {
      render(<Checkbox label="Accept" />);
      const checkbox = screen.getByRole('checkbox');
      expectFocusable(checkbox);
    });

    it('icon has aria-hidden', () => {
      render(<Checkbox checked label="Test" />);
      const checkbox = screen.getByRole('checkbox');
      const svg = checkbox.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('styling', () => {
    it('has transition classes', () => {
      render(<Checkbox />);
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox.className).toContain('transition-');
    });

    it('applies custom className', () => {
      render(<Checkbox className="custom-class" />);
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toHaveClass('custom-class');
    });
  });
});
