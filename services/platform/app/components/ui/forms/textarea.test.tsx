import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils/render';
import { checkAccessibility, expectFocusable } from '@/test/utils/a11y';
import { Textarea } from './textarea';

describe('Textarea', () => {
  describe('rendering', () => {
    it('renders with placeholder', () => {
      render(<Textarea placeholder="Enter text" />);
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    });

    it('renders with label', () => {
      render(<Textarea label="Description" />);
      expect(screen.getByLabelText('Description')).toBeInTheDocument();
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
        <Textarea placeholder="Type here" onChange={handleChange} />
      );

      await user.type(screen.getByPlaceholderText('Type here'), 'hello');
      expect(handleChange).toHaveBeenCalled();
    });

    it('does not allow input when disabled', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Textarea placeholder="Type here" disabled onChange={handleChange} />
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
        <Textarea label="Description" errorMessage="Required" />
      );
      await checkAccessibility(container);
    });

    it('is focusable', () => {
      render(<Textarea label="Description" />);
      const textarea = screen.getByLabelText('Description');
      expectFocusable(textarea);
    });

    it('has aria-invalid when error', () => {
      render(<Textarea label="Message" errorMessage="Invalid" />);
      const textarea = screen.getByLabelText('Message');
      expect(textarea).toHaveAttribute('aria-invalid', 'true');
    });

    it('has aria-describedby linked to error', () => {
      render(
        <Textarea label="Message" id="msg" errorMessage="Invalid" />
      );
      const textarea = screen.getByLabelText('Message');
      const error = screen.getByRole('alert');
      expect(textarea).toHaveAttribute('aria-describedby', error.id);
    });

    it('error message has role alert', () => {
      render(<Textarea label="Message" errorMessage="Invalid" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('error animation', () => {
    it('has transition classes', () => {
      render(<Textarea label="Message" />);
      const textarea = screen.getByLabelText('Message');
      expect(textarea.className).toContain('transition-');
    });

    it('applies shake class on error', async () => {
      const { rerender } = render(<Textarea label="Message" />);
      const textarea = screen.getByLabelText('Message');

      expect(textarea).not.toHaveClass('animate-shake');

      rerender(<Textarea label="Message" errorMessage="Invalid" />);

      await waitFor(() => {
        expect(screen.getByLabelText('Message')).toHaveClass('animate-shake');
      });
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      render(<Textarea label="Message" className="custom-class" />);
      const textarea = screen.getByLabelText('Message');
      expect(textarea).toHaveClass('custom-class');
    });

    it('applies error styling', () => {
      render(<Textarea label="Message" errorMessage="Error" />);
      const textarea = screen.getByLabelText('Message');
      expect(textarea.className).toContain('border-destructive');
    });
  });
});
