import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/utils/render';
import { checkAccessibility, expectFocusable } from '@/test/utils/a11y';
import { Switch } from './switch';

describe('Switch', () => {
  describe('rendering', () => {
    it('renders switch', () => {
      render(<Switch />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders with label', () => {
      render(<Switch label="Enable feature" />);
      expect(screen.getByLabelText('Enable feature')).toBeInTheDocument();
    });

    it('renders required indicator', () => {
      render(<Switch label="Feature" required />);
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('renders checked state', () => {
      render(<Switch checked />);
      expect(screen.getByRole('switch')).toHaveAttribute(
        'data-state',
        'checked'
      );
    });

    it('renders unchecked state', () => {
      render(<Switch checked={false} />);
      expect(screen.getByRole('switch')).toHaveAttribute(
        'data-state',
        'unchecked'
      );
    });
  });

  describe('interactions', () => {
    it('calls onCheckedChange when clicked', async () => {
      const handleChange = vi.fn();
      const { user } = render(<Switch onCheckedChange={handleChange} />);

      await user.click(screen.getByRole('switch'));
      expect(handleChange).toHaveBeenCalledWith(true);
    });

    it('clicking label toggles switch', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Switch label="Enable" onCheckedChange={handleChange} />
      );

      await user.click(screen.getByText('Enable'));
      expect(handleChange).toHaveBeenCalled();
    });

    it('does not call onCheckedChange when disabled', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Switch onCheckedChange={handleChange} disabled />
      );

      await user.click(screen.getByRole('switch'));
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('responds to keyboard Space', async () => {
      const handleChange = vi.fn();
      const { user } = render(<Switch onCheckedChange={handleChange} />);

      const switchEl = screen.getByRole('switch');
      switchEl.focus();
      await user.keyboard(' ');
      expect(handleChange).toHaveBeenCalledWith(true);
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Switch label="Enable feature" />);
      await checkAccessibility(container);
    });

    it('passes axe audit without label', async () => {
      const { container } = render(<Switch aria-label="Enable feature" />);
      await checkAccessibility(container);
    });

    it('is focusable', () => {
      render(<Switch label="Enable" />);
      const switchEl = screen.getByRole('switch');
      expectFocusable(switchEl);
    });

    it('has correct aria-checked when checked', () => {
      render(<Switch checked />);
      expect(screen.getByRole('switch')).toHaveAttribute(
        'aria-checked',
        'true'
      );
    });

    it('has correct aria-checked when unchecked', () => {
      render(<Switch checked={false} />);
      expect(screen.getByRole('switch')).toHaveAttribute(
        'aria-checked',
        'false'
      );
    });
  });

  describe('styling', () => {
    it('has transition classes', () => {
      render(<Switch />);
      const switchEl = screen.getByRole('switch');
      expect(switchEl.className).toContain('transition-');
    });

    it('applies custom className', () => {
      render(<Switch className="custom-class" />);
      const switchEl = screen.getByRole('switch');
      expect(switchEl).toHaveClass('custom-class');
    });
  });
});
