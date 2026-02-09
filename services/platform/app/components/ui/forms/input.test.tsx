import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/test/utils/a11y';
import { render, screen, waitFor } from '@/test/utils/render';

import { Input } from './input';

describe('Input', () => {
  describe('rendering', () => {
    it('renders with default props', () => {
      render(<Input placeholder="Enter text" />);
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    });

    it('renders with label', () => {
      render(<Input label="Email" />);
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    it('renders required indicator', () => {
      render(<Input label="Email" required />);
      const label = screen.getByText('Email');
      expect(label.parentElement).toHaveTextContent('*');
    });

    it('renders error message', () => {
      render(<Input label="Email" errorMessage="Invalid email" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email');
    });
  });

  describe('sizes', () => {
    it.each(['default', 'sm', 'lg'] as const)('renders %s size', (size) => {
      render(<Input size={size} placeholder="Test" />);
      expect(screen.getByPlaceholderText('Test')).toBeInTheDocument();
    });
  });

  describe('password input', () => {
    it('renders password input with toggle', () => {
      render(<Input type="password" label="Password" />);
      const input = screen.getByLabelText('Password');
      expect(input).toHaveAttribute('type', 'password');
      expect(
        screen.getByRole('button', { name: /show password/i }),
      ).toBeInTheDocument();
    });

    it('toggles password visibility', async () => {
      const { user } = render(<Input type="password" label="Password" />);
      const input = screen.getByLabelText('Password');
      const toggle = screen.getByRole('button', { name: /show password/i });

      expect(input).toHaveAttribute('type', 'password');

      await user.click(toggle);
      expect(input).toHaveAttribute('type', 'text');
      expect(
        screen.getByRole('button', { name: /hide password/i }),
      ).toBeInTheDocument();

      await user.click(toggle);
      expect(input).toHaveAttribute('type', 'password');
    });

    it('password toggle has aria-pressed', async () => {
      const { user } = render(<Input type="password" label="Password" />);
      const toggle = screen.getByRole('button', { name: /show password/i });

      expect(toggle).toHaveAttribute('aria-pressed', 'false');

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('interactions', () => {
    it('calls onChange when typing', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Input placeholder="Type here" onChange={handleChange} />,
      );

      await user.type(screen.getByPlaceholderText('Type here'), 'hello');
      expect(handleChange).toHaveBeenCalled();
    });

    it('does not allow input when disabled', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Input placeholder="Type here" disabled onChange={handleChange} />,
      );

      const input = screen.getByPlaceholderText('Type here');
      await user.type(input, 'hello');
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Input label="Email" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with error', async () => {
      const { container } = render(
        <Input label="Email" errorMessage="Invalid email" />,
      );
      await checkAccessibility(container);
    });

    it('is focusable', () => {
      render(<Input label="Email" />);
      const input = screen.getByLabelText('Email');
      expectFocusable(input);
    });

    it('has aria-invalid when error', () => {
      render(<Input label="Email" errorMessage="Invalid" />);
      const input = screen.getByLabelText('Email');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('has aria-describedby linked to error', () => {
      render(<Input label="Email" id="email" errorMessage="Invalid" />);
      const input = screen.getByLabelText('Email');
      const error = screen.getByRole('alert');
      expect(input).toHaveAttribute('aria-describedby', error.id);
    });

    it('error message has role alert', () => {
      render(<Input label="Email" errorMessage="Invalid email" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('label is associated with input', () => {
      render(<Input label="Email" id="email-input" />);
      const input = screen.getByLabelText('Email');
      expect(input).toHaveAttribute('id', 'email-input');
    });
  });

  describe('error animation', () => {
    it('has transition classes', () => {
      render(<Input label="Email" />);
      const input = screen.getByLabelText('Email');
      expect(input.className).toContain('transition-');
    });

    it('applies shake class on error', async () => {
      const { rerender } = render(<Input label="Email" />);
      const input = screen.getByLabelText('Email');

      expect(input).not.toHaveClass('animate-shake');

      rerender(<Input label="Email" errorMessage="Invalid" />);

      await waitFor(() => {
        expect(screen.getByLabelText('Email')).toHaveClass('animate-shake');
      });
    });
  });

  describe('autocomplete', () => {
    it('sets autocomplete for password', () => {
      render(<Input type="password" label="Password" />);
      const input = screen.getByLabelText('Password');
      expect(input).toHaveAttribute('autocomplete', 'current-password');
    });

    it('allows custom autocomplete', () => {
      render(
        <Input type="password" label="Password" autoComplete="new-password" />,
      );
      const input = screen.getByLabelText('Password');
      expect(input).toHaveAttribute('autocomplete', 'new-password');
    });
  });
});
