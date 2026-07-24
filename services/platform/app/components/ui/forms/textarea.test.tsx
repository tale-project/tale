import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { Textarea } from './textarea';

describe('Textarea', () => {
  describe('rendering', () => {
    it('renders with placeholder', () => {
      render(<Textarea placeholder="Enter text" />);
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    });

    it('uses text-base so mobile browsers do not zoom on focus', () => {
      render(<Textarea placeholder="Enter text" />);
      // iOS Safari zooms focused textareas under 16px; text-base is 1rem (16px).
      expect(screen.getByPlaceholderText('Enter text').className).toContain(
        'text-base',
      );
    });

    it('renders with label', () => {
      render(<Textarea label="Description" />);
      expect(
        screen.getByLabelText('Description', { exact: false }),
      ).toBeInTheDocument();
    });

    it('renders required indicator', () => {
      render(<Textarea label="Description" required />);
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('renders error message', () => {
      render(<Textarea label="Message" errorMessage="Required field" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Required field');
    });
  });

  describe('interactions', () => {
    it('calls onChange when typing', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Textarea placeholder="Type here" onChange={handleChange} />,
      );

      await user.type(screen.getByPlaceholderText('Type here'), 'hello');
      expect(handleChange).toHaveBeenCalled();
    });

    it('does not allow input when disabled', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Textarea placeholder="Type here" disabled onChange={handleChange} />,
      );

      const textarea = screen.getByPlaceholderText('Type here');
      await user.type(textarea, 'hello');
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Textarea label="Description" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with error', async () => {
      const { container } = render(
        <Textarea label="Description" errorMessage="Required" />,
      );
      await checkAccessibility(container);
    });

    it('is focusable', () => {
      render(<Textarea label="Description" />);
      const textarea = screen.getByLabelText('Description', { exact: false });
      expectFocusable(textarea);
    });

    it('has aria-invalid when error', () => {
      render(<Textarea label="Message" errorMessage="Invalid" />);
      const textarea = screen.getByLabelText('Message', { exact: false });
      expect(textarea).toHaveAttribute('aria-invalid', 'true');
    });

    it('has aria-describedby linked to error', () => {
      render(<Textarea label="Message" id="msg" errorMessage="Invalid" />);
      const textarea = screen.getByLabelText('Message', { exact: false });
      const error = screen.getByRole('alert');
      expect(textarea).toHaveAttribute('aria-describedby', error.id);
    });

    it('error message has role alert', () => {
      render(<Textarea label="Message" errorMessage="Invalid" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('border visibility', () => {
    // Regression test for #1478: the resting field edge was barely visible in
    // light mode. The textarea border must use the stronger --color-border-input
    // token rather than the faint generic border.
    it('uses the input border token', () => {
      render(<Textarea label="Message" />);
      const textarea = screen.getByLabelText('Message', { exact: false });
      expect(textarea.className).toContain('--color-border-input');
    });
  });

  describe('error animation', () => {
    it('has transition classes', () => {
      render(<Textarea label="Message" />);
      const textarea = screen.getByLabelText('Message', { exact: false });
      expect(textarea.className).toContain('transition-');
    });

    it('applies shake class on error', async () => {
      const { rerender } = render(<Textarea label="Message" />);
      const textarea = screen.getByLabelText('Message', { exact: false });

      expect(textarea).not.toHaveClass('animate-shake');

      rerender(<Textarea label="Message" errorMessage="Invalid" />);

      await waitFor(() => {
        expect(screen.getByLabelText('Message', { exact: false })).toHaveClass(
          'animate-shake',
        );
      });
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      render(<Textarea label="Message" className="custom-class" />);
      const textarea = screen.getByLabelText('Message', { exact: false });
      expect(textarea).toHaveClass('custom-class');
    });

    it('applies error styling', () => {
      render(<Textarea label="Message" errorMessage="Error" />);
      const textarea = screen.getByLabelText('Message', { exact: false });
      expect(textarea.className).toContain('border-destructive');
    });
  });
});
