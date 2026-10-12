import { Edit, Trash2 } from 'lucide-react';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { IconButton } from './icon-button';

describe('IconButton', () => {
  describe('rendering', () => {
    it('renders with required aria-label', () => {
      render(<IconButton icon={Edit} aria-label="Edit item" />);
      expect(
        screen.getByRole('button', { name: /edit item/i }),
      ).toBeInTheDocument();
    });

    it('renders the icon', () => {
      render(<IconButton icon={Edit} aria-label="Edit" />);
      const button = screen.getByRole('button');
      expect(button.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('variants', () => {
    it.each([
      'primary',
      'destructive',
      'success',
      'secondary',
      'ghost',
    ] as const)('renders %s variant', (variant) => {
      render(<IconButton icon={Edit} aria-label="Edit" variant={variant} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  describe('icon sizes', () => {
    it.each([3, 4, 5, 6] as const)('renders icon size %s', (iconSize) => {
      render(<IconButton icon={Edit} aria-label="Edit" iconSize={iconSize} />);
      const button = screen.getByRole('button');
      const svg = button.querySelector('svg');
      expect(svg).toHaveClass(`size-${iconSize}`);
    });
  });

  describe('interactions', () => {
    it('calls onClick when clicked', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <IconButton icon={Edit} aria-label="Edit" onClick={handleClick} />,
      );

      await user.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick when disabled', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <IconButton
          icon={Edit}
          aria-label="Edit"
          onClick={handleClick}
          disabled
        />,
      );

      await user.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('responds to keyboard Enter', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <IconButton icon={Edit} aria-label="Edit" onClick={handleClick} />,
      );

      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('responds to keyboard Space', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <IconButton icon={Edit} aria-label="Edit" onClick={handleClick} />,
      );

      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('disabledReason', () => {
    it('soft-disables and surfaces the reason on focus', async () => {
      const { user } = render(
        <IconButton
          icon={Trash2}
          aria-label="Delete"
          disabled
          disabledReason="You can only delete your own rows"
        />,
      );
      const button = screen.getByRole('button');
      // Kept focusable so the reason reaches keyboard users.
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      await user.tab();
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('You can only delete your own rows');
    });

    it('keeps native disabled when no reason is given', () => {
      render(<IconButton icon={Trash2} aria-label="Delete" disabled />);
      // Native `disabled` (inert, out of the tab order); no soft-disable.
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('keeps native disabled when the reason is empty/whitespace', () => {
      render(
        <IconButton
          icon={Trash2}
          aria-label="Delete"
          disabled
          disabledReason="   "
        />,
      );
      // A blank reason explains nothing, so the control must fall back to a
      // native disable rather than become inert-but-focusable with no tooltip.
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('blocks activation on click, Space, and Enter while soft-disabled', async () => {
      const handleClick = vi.fn();
      const { user } = render(
        <IconButton
          icon={Trash2}
          aria-label="Delete"
          disabled
          disabledReason="You can only delete your own rows"
          onClick={handleClick}
        />,
      );
      const button = screen.getByRole('button');
      await user.click(button);
      button.focus();
      await user.keyboard(' ');
      await user.keyboard('{Enter}');
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('describes the focused soft-disabled icon button via aria-describedby', async () => {
      const { user } = render(
        <IconButton
          icon={Trash2}
          aria-label="Delete"
          disabled
          disabledReason="You can only delete your own rows"
        />,
      );
      await user.tab();
      const button = screen.getByRole('button');
      const describedBy = button.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const description = describedBy
        ? document.getElementById(describedBy)
        : null;
      expect(description).toHaveTextContent(
        'You can only delete your own rows',
      );
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <IconButton icon={Edit} aria-label="Edit item" />,
      );
      await checkAccessibility(container);
    });

    it('is focusable', () => {
      render(<IconButton icon={Edit} aria-label="Edit" />);
      const button = screen.getByRole('button');
      expectFocusable(button);
    });

    it('icon has aria-hidden', () => {
      render(<IconButton icon={Edit} aria-label="Edit" />);
      const button = screen.getByRole('button');
      const svg = button.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });

    it('disabled button has disabled attribute', () => {
      render(<IconButton icon={Edit} aria-label="Edit" disabled />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('disabled');
    });

    it('announces via aria-label not icon content', () => {
      render(<IconButton icon={Trash2} aria-label="Delete this row" />);
      const button = screen.getByRole('button', { name: /delete this row/i });
      expect(button).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      render(
        <IconButton icon={Edit} aria-label="Edit" className="custom-class" />,
      );
      const button = screen.getByRole('button');
      expect(button).toHaveClass('custom-class');
    });

    it('applies custom iconClassName', () => {
      render(
        <IconButton
          icon={Edit}
          aria-label="Edit"
          iconClassName="text-destructive"
        />,
      );
      const button = screen.getByRole('button');
      const svg = button.querySelector('svg');
      expect(svg).toHaveClass('text-destructive');
    });

    it('ghost variant has muted icon color by default', () => {
      render(<IconButton icon={Edit} aria-label="Edit" variant="ghost" />);
      const button = screen.getByRole('button');
      const svg = button.querySelector('svg');
      expect(svg).toHaveClass('text-muted-foreground');
    });
  });
});
