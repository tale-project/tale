import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { Input } from './input';
import { useForm } from './use-form';

describe('Input', () => {
  describe('rendering', () => {
    it('renders with default props', () => {
      render(<Input placeholder="Enter text" />);
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    });

    it('uses text-base so mobile browsers do not zoom on focus', () => {
      render(<Input placeholder="Enter text" />);
      // iOS Safari zooms focused inputs under 16px; text-base is 1rem (16px).
      expect(screen.getByPlaceholderText('Enter text').className).toContain(
        'text-base',
      );
    });

    it('renders with label', () => {
      render(<Input label="Email" />);
      expect(
        screen.getByLabelText('Email', { exact: false }),
      ).toBeInTheDocument();
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

  describe('variants', () => {
    it.each(['default', 'unstyled', 'readOnly'] as const)(
      'renders %s variant',
      (variant) => {
        render(<Input variant={variant} placeholder="Test" />);
        expect(screen.getByPlaceholderText('Test')).toBeInTheDocument();
      },
    );
  });

  describe('wideControl', () => {
    it('forwards to the field shell so the caller owns the control width', () => {
      const { container } = render(<Input aria-label="Search" wideControl />);

      // Straight through to `FieldShell`: the control fills the frame instead
      // of the settings 20rem column (the shell's own suite covers what the
      // classes then do).
      const column = container.firstElementChild?.querySelector('div');
      expect(column).toHaveClass('in-data-[field-layout=row]:sm:w-full');
    });
  });

  describe('read-only display variant', () => {
    // Display-only values must read as text — borderless and transparent — yet
    // keep the field footprint (same `h-9` + padding box as an editable input)
    // so toggling editable ↔ read-only causes no layout shift (#1942).
    it('auto-selects the borderless variant for a native readOnly input', () => {
      render(<Input label="Plan" readOnly defaultValue="Enterprise" />);
      const input = screen.getByLabelText('Plan', { exact: false });
      expect(input).toHaveClass('bg-transparent');
      expect(input).toHaveClass('h-9');
      expect(input).toHaveClass('px-3');
      // No visible ring/border chrome on the resting field.
      expect(input.className).not.toContain('--color-border-input');
    });

    it('keeps the editable field footprint (h-9 + horizontal padding)', () => {
      render(<Input label="Email" defaultValue="a@b.com" />);
      const input = screen.getByLabelText('Email', { exact: false });
      expect(input).toHaveClass('h-9');
      expect(input).toHaveClass('px-3');
    });

    it('lets an explicit variant override the readOnly default', () => {
      render(
        <Input
          label="Plan"
          readOnly
          variant="default"
          defaultValue="Enterprise"
        />,
      );
      const input = screen.getByLabelText('Plan', { exact: false });
      expect(input.className).toContain('--color-border-input');
    });

    it('still forwards the readOnly attribute to the input', () => {
      render(<Input label="Plan" readOnly defaultValue="Enterprise" />);
      const input = screen.getByLabelText('Plan', { exact: false });
      expect(input).toHaveAttribute('readonly');
    });

    // The password/sensitive path is a separate render branch (it adds the eye
    // toggle); the borderless variant must still resolve there so a read-only
    // secret reads as text yet keeps the toggle.
    it('applies the borderless variant on the password/toggle render path', () => {
      render(
        <Input
          label="API key"
          type="password"
          readOnly
          defaultValue="sk-secret"
        />,
      );
      const input = screen.getByLabelText('API key', { exact: false });
      expect(input).toHaveClass('bg-transparent');
      expect(input).toHaveClass('h-9');
      expect(input).toHaveAttribute('readonly');
      expect(input.className).not.toContain('--color-border-input');
      // The reveal toggle still renders alongside the read-only field.
      expect(
        screen.getByRole('button', { name: /show password/i }),
      ).toBeInTheDocument();
    });
  });

  describe('password input', () => {
    // A genuine account-password field opts into the password manager with an
    // explicit autoComplete; this keeps the real `type="password"` ↔ `"text"`
    // toggle (the `sensitive` carve-out below covers credential fields that
    // must NOT trigger the password manager).
    it('renders password input with toggle', () => {
      render(
        <Input
          type="password"
          label="Password"
          autoComplete="current-password"
        />,
      );
      const input = screen.getByLabelText(/^Password\b/);
      expect(input).toHaveAttribute('type', 'password');
      expect(
        screen.getByRole('button', { name: /show password/i }),
      ).toBeInTheDocument();
    });

    it('toggles password visibility', async () => {
      const { user } = render(
        <Input
          type="password"
          label="Password"
          autoComplete="current-password"
        />,
      );
      const input = screen.getByLabelText(/^Password\b/);
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

    it('preserves caller style prop on password input', async () => {
      const { user } = render(
        <Input type="password" label="Password" style={{ color: 'red' }} />,
      );
      const input = screen.getByLabelText(/^Password\b/);
      const toggle = screen.getByRole('button', { name: /show password/i });

      expect(input.style.color).toBe('red');
      await user.click(toggle);
      expect(input.style.color).toBe('red');
    });
  });

  describe('sensitive fields', () => {
    // Sensitive secrets (API keys, tokens) must NOT trip the browser's
    // saved-password dropdown, so they render as `type="text"` (masked via CSS
    // `-webkit-text-security`, which jsdom can't observe) rather than a real
    // `type="password"`. We assert the observable contract: the `type="text"`
    // carve-out, the password-manager opt-out attrs, and the reveal toggle.
    it('renders an explicit sensitive field as text, not type=password', () => {
      render(<Input sensitive label="API key" />);
      const input = screen.getByLabelText(/^API key\b/);
      expect(input).toHaveAttribute('type', 'text');
    });

    it('treats a bare password field (no autoComplete) as sensitive', () => {
      render(<Input type="password" label="Secret" />);
      const input = screen.getByLabelText(/^Secret\b/);
      // Rendered as text (CSS-masked), not a real password field — this is what
      // dodges Chrome's saved-password dropdown.
      expect(input).toHaveAttribute('type', 'text');
    });

    it('exposes a reveal toggle on a sensitive field', async () => {
      const { user } = render(<Input sensitive label="API key" />);
      const toggle = screen.getByRole('button', { name: /show password/i });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });

    it('opts out of password managers on sensitive fields', () => {
      render(<Input sensitive label="API key" />);
      const input = screen.getByLabelText(/^API key\b/);
      expect(input).toHaveAttribute('autocomplete', 'off');
      expect(input).toHaveAttribute('data-1p-ignore');
      expect(input).toHaveAttribute('data-lpignore', 'true');
      expect(input).toHaveAttribute('data-form-type', 'other');
      expect(input).toHaveAttribute('data-bwignore', 'true');
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
      const input = screen.getByLabelText('Email', { exact: false });
      expectFocusable(input);
    });

    it('has aria-invalid when error', () => {
      render(<Input label="Email" errorMessage="Invalid" />);
      const input = screen.getByLabelText('Email', { exact: false });
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('has aria-describedby linked to error', () => {
      render(<Input label="Email" id="email" errorMessage="Invalid" />);
      const input = screen.getByLabelText('Email', { exact: false });
      const error = screen.getByRole('alert');
      expect(input).toHaveAttribute('aria-describedby', error.id);
    });

    it('error message has role alert', () => {
      render(<Input label="Email" errorMessage="Invalid email" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('label is associated with input', () => {
      render(<Input label="Email" id="email-input" />);
      const input = screen.getByLabelText('Email', { exact: false });
      expect(input).toHaveAttribute('id', 'email-input');
    });

    it('passes axe audit for password with toggle visible', async () => {
      const { container, user } = render(
        <Input type="password" label="Password" />,
      );
      const toggle = screen.getByRole('button', { name: /show password/i });
      await user.click(toggle);
      await checkAccessibility(container);
    });
  });

  describe('border visibility', () => {
    // Regression test for #1478: the resting field edge was barely visible in
    // light mode. The input ring must use the stronger --color-border-input
    // token rather than the faint generic border.
    it('uses the input border token for its ring', () => {
      render(<Input label="Email" />);
      const input = screen.getByLabelText('Email', { exact: false });
      expect(input.className).toContain('--color-border-input');
    });
  });

  describe('error animation', () => {
    it('has transition classes', () => {
      render(<Input label="Email" />);
      const input = screen.getByLabelText('Email', { exact: false });
      expect(input.className).toContain('transition-');
    });

    it('applies shake class on error', async () => {
      const { rerender } = render(<Input label="Email" />);
      const input = screen.getByLabelText('Email', { exact: false });

      expect(input).not.toHaveClass('animate-shake');

      rerender(<Input label="Email" errorMessage="Invalid" />);

      await waitFor(() => {
        expect(screen.getByLabelText('Email', { exact: false })).toHaveClass(
          'animate-shake',
        );
      });
    });
  });

  describe('autocomplete', () => {
    it('sets autocomplete for password', () => {
      render(<Input type="password" label="Password" />);
      const input = screen.getByLabelText(/^Password\b/);
      expect(input).toHaveAttribute('autocomplete', 'off');
    });

    it('allows custom autocomplete', () => {
      render(
        <Input type="password" label="Password" autoComplete="new-password" />,
      );
      const input = screen.getByLabelText(/^Password\b/);
      expect(input).toHaveAttribute('autocomplete', 'new-password');
    });
  });

  describe('react hook form connector', () => {
    function PasswordForm() {
      const { register } = useForm({
        defaultValues: { password: 'secret123' },
      });
      return (
        <Input
          type="password"
          label="Password"
          autoComplete="current-password"
          {...register('password')}
        />
      );
    }

    it('toggles visibility on pre-filled field', async () => {
      const { user } = render(<PasswordForm />);
      const input = screen.getByLabelText(/^Password\b/);
      const toggle = screen.getByRole('button', { name: /show password/i });

      expect(input).toHaveAttribute('type', 'password');
      expect(input).toHaveValue('secret123');

      await user.click(toggle);
      expect(input).toHaveAttribute('type', 'text');
      expect(input).toHaveValue('secret123');
    });

    it('toggles back to masked after revealing', async () => {
      const { user } = render(<PasswordForm />);
      const input = screen.getByLabelText(/^Password\b/);
      const toggle = screen.getByRole('button', { name: /show password/i });

      await user.click(toggle);
      expect(input).toHaveAttribute('type', 'text');

      await user.click(toggle);
      expect(input).toHaveAttribute('type', 'password');
    });
  });

  describe('fixed addons', () => {
    it('renders a fixed prefix inside the field and keeps the value editable', async () => {
      const { user } = render(
        <Input label="Variable" prefix="TALE_PROVIDER_KEY_" />,
      );

      expect(screen.getByText('TALE_PROVIDER_KEY_')).toBeInTheDocument();
      const input = screen.getByLabelText('Variable');
      await user.type(input, 'OPENAI');
      // The prefix is display-only chrome — the value carries only the typed
      // suffix; callers compose the full name on submit.
      expect(input).toHaveValue('OPENAI');
    });

    it('renders prefix and suffix around the same field', () => {
      render(<Input label="Bounded" prefix="pre-" suffix="-post" />);

      expect(screen.getByText('pre-')).toBeInTheDocument();
      expect(screen.getByText('-post')).toBeInTheDocument();
      expect(screen.getByLabelText('Bounded')).toBeInTheDocument();
    });
  });
});
