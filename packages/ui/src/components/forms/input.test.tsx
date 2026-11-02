import { createRef } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { Input } from './input';
import { useForm } from './use-form';

// A test that mocks console.error or the clipboard hands the next one the real
// ones back.
afterEach(() => {
  vi.restoreAllMocks();
});

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

    it('drops to the 14px UI size from md up, like Select and Textarea', () => {
      render(<Input placeholder="Enter text" />);
      expect(screen.getByPlaceholderText('Enter text').className).toContain(
        'md:text-sm',
      );
    });

    it('renders with label', () => {
      render(<Input label="Email" />);
      expect(
        screen.getByLabelText('Email', { exact: false }),
      ).toBeInTheDocument();
    });

    it('renders optional indicator', () => {
      render(<Input label="Email" required={false} />);
      expect(screen.getByText(/optional/i)).toBeInTheDocument();
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
      expect(column).toHaveClass('@xl/field-layout:flex-1');
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

    // A text input drawn as dots is still a text input to the browser: it
    // would spell-check the secret (and, with enhanced spell checking, send it
    // off), capitalise it and correct it. A real password field gets none of
    // that, so a sensitive one asks for none of it either.
    it.each([
      ['an explicit sensitive field', <Input key="a" sensitive label="Key" />],
      ['a bare password field', <Input key="b" type="password" label="Key" />],
    ])(
      'keeps the browser from spell-checking, capitalising or correcting %s',
      (_name, field) => {
        render(field);
        const input = screen.getByLabelText(/^Key\b/);
        expect(input).toHaveAttribute('spellcheck', 'false');
        expect(input).toHaveAttribute('autocapitalize', 'off');
        expect(input).toHaveAttribute('autocorrect', 'off');
      },
    );

    it('keeps them on while the field is revealed, with its copy button too', async () => {
      const { user } = render(<Input sensitive copyable label="Key" />);
      await user.click(screen.getByRole('button', { name: 'Show password' }));
      const input = screen.getByLabelText(/^Key\b/);
      expect(input).toHaveAttribute('spellcheck', 'false');
      expect(input).toHaveAttribute('autocapitalize', 'off');
      expect(input).toHaveAttribute('autocorrect', 'off');
    });

    it('lets the caller decide, as it does for every other attribute', () => {
      render(
        <Input
          sensitive
          label="Key"
          spellCheck
          autoCapitalize="words"
          autoCorrect="on"
        />,
      );
      const input = screen.getByLabelText(/^Key\b/);
      expect(input).toHaveAttribute('spellcheck', 'true');
      expect(input).toHaveAttribute('autocapitalize', 'words');
      expect(input).toHaveAttribute('autocorrect', 'on');
    });

    it('leaves a plain field and an account password field as they were', () => {
      const { unmount } = render(<Input label="Name" />);
      const plain = screen.getByLabelText('Name');
      for (const name of ['spellcheck', 'autocapitalize', 'autocorrect']) {
        expect(plain).not.toHaveAttribute(name);
      }
      unmount();

      render(
        <Input
          type="password"
          label="Password"
          autoComplete="current-password"
        />,
      );
      const account = screen.getByLabelText('Password');
      expect(account).toHaveAttribute('type', 'password');
      for (const name of ['spellcheck', 'autocapitalize', 'autocorrect']) {
        expect(account).not.toHaveAttribute(name);
      }
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

  describe('disabled visual', () => {
    // Design-system Input/Text Disabled (`xZ0I9`): `$surface-disabled` fill
    // and muted text. An opacity wash on the whole control is the wrong recipe.
    it('fills the bordered field instead of dimming it', () => {
      render(
        <Input aria-label="Domain" disabled defaultValue="docs.example.com" />,
      );
      const input = screen.getByRole('textbox');
      expect(input.className).toContain('--color-bg-elevated');
      expect(input.className).toContain('--color-fg-subtle');
      expect(input.className).not.toContain('disabled:opacity-50');
    });

    it('uses the same fill when soft-disabled with a reason', () => {
      render(
        <Input
          aria-label="Domain"
          disabled
          disabledReason="Locked for this plan"
          defaultValue="docs.example.com"
        />,
      );
      const input = screen.getByRole('textbox');
      expect(input.className).toContain(
        'aria-disabled:bg-[color:var(--color-bg-elevated)]',
      );
      expect(input.className).not.toContain('aria-disabled:opacity-50');
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
  describe('copy and reveal inside the field', () => {
    // A secret value in a form (a card number, a token): masked, shown on
    // request, copied without being shown. Both controls sit INSIDE the
    // field's border, so every field of a form ends on the same edge.
    it('has no copy button unless asked', () => {
      render(<Input label="Website" defaultValue="https://shop.example" />);
      expect(
        screen.queryByRole('button', { name: /copy/i }),
      ).not.toBeInTheDocument();
    });

    it('copies what the field holds, with a button named "Copy" by default', async () => {
      const { user } = render(
        <Input label="Website" copyable defaultValue="https://shop.example" />,
      );
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await navigator.clipboard.readText()).toBe('https://shop.example');
    });

    it('names the button for what it copies when asked to', async () => {
      render(
        <Input label="Card number" copyable copyLabel="Copy Card number" />,
      );
      expect(
        screen.getByRole('button', { name: 'Copy Card number' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Copy' }),
      ).not.toBeInTheDocument();
    });

    it('copies a typed value, and a controlled one', async () => {
      const { user, rerender } = render(<Input label="Token" copyable />);
      await user.type(screen.getByLabelText('Token'), 'abc 123');
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await navigator.clipboard.readText()).toBe('abc 123');

      rerender(
        <Input
          label="Token"
          copyable
          value="from the parent"
          onChange={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await navigator.clipboard.readText()).toBe('from the parent');
    });

    it('copies the value a form library registered, as typed', async () => {
      function Registered() {
        const { register } = useForm({ defaultValues: { token: 'tok-1' } });
        return <Input label="Token" copyable {...register('token')} />;
      }
      const { user } = render(<Registered />);
      await user.type(screen.getByLabelText('Token'), '2');
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await navigator.clipboard.readText()).toBe('tok-12');
    });

    it('copies a masked value without showing it', async () => {
      const { user } = render(
        <Input
          label="Password"
          type="password"
          sensitive
          copyable
          defaultValue="hunter2"
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await navigator.clipboard.readText()).toBe('hunter2');
      expect(
        screen.getByRole('button', { name: 'Show password' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('copies nothing from an empty field', async () => {
      const { user } = render(<Input label="Token" copyable />);
      const write = vi.spyOn(navigator.clipboard, 'writeText');
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(write).not.toHaveBeenCalled();
    });

    it('says it copied, to everyone, in words the caller can choose', async () => {
      const { user, rerender } = render(
        <Input label="Token" copyable defaultValue="abc" />,
      );
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(screen.getByRole('status')).toHaveTextContent('Copied');

      rerender(
        <Input
          label="Token"
          copyable
          copiedLabel="Token copied"
          defaultValue="abc"
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(screen.getByRole('status')).toHaveTextContent('Token copied');
    });

    it('does not say it copied when the browser refused', async () => {
      const { user } = render(
        <Input label="Token" copyable defaultValue="abc" />,
      );
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
        new Error('denied'),
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('sits beside the reveal toggle: copy first, then show, after the value', async () => {
      const { user } = render(
        <Input label="Password" type="password" sensitive copyable />,
      );
      const field = screen.getByLabelText('Password');
      const copy = screen.getByRole('button', { name: 'Copy' });
      const show = screen.getByRole('button', { name: 'Show password' });
      field.focus();
      await user.tab();
      expect(copy).toHaveFocus();
      await user.tab();
      expect(show).toHaveFocus();
      // Both are drawn inside the field's own box, and the text keeps clear of them.
      expect(copy.parentElement).toBe(show.parentElement);
      expect(field.parentElement).toContainElement(copy);
      expect(field).toHaveClass('pr-16');
    });

    it('keeps the room the reveal toggle alone had, and gives a lone copy button the same', () => {
      const { rerender } = render(
        <Input label="Password" type="password" sensitive />,
      );
      expect(screen.getByLabelText('Password')).toHaveClass('pr-10');
      rerender(<Input label="Website" copyable />);
      expect(screen.getByLabelText('Website')).toHaveClass('pr-10');
    });

    it('works on a read-only field', async () => {
      const { user } = render(
        <Input label="Plan" readOnly copyable defaultValue="Enterprise" />,
      );
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await navigator.clipboard.readText()).toBe('Enterprise');
    });

    it('is not combined with a fixed prefix or suffix', () => {
      render(<Input label="Domain" suffix="@acme.com" copyable />);
      expect(screen.getByText('@acme.com')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Copy' }),
      ).not.toBeInTheDocument();
    });

    // The toggle's frame takes the place of the addon's: beside it a prefix or
    // suffix is not drawn (it never was), and the copy button works.
    it('works on a masked field, whose toggle takes the place of a fixed prefix or suffix', async () => {
      const { user } = render(
        <Input
          label="Key"
          type="password"
          sensitive
          copyable
          prefix="TALE_"
          suffix="@acme.com"
          defaultValue="abc"
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await navigator.clipboard.readText()).toBe('abc');
      expect(screen.queryByText('TALE_')).not.toBeInTheDocument();
      expect(screen.queryByText('@acme.com')).not.toBeInTheDocument();
    });

    it('names the reveal toggle for what it reveals when asked to', async () => {
      const { user } = render(
        <Input
          label="Card number"
          type="password"
          sensitive
          revealLabels={{ show: 'Show Card number', hide: 'Hide Card number' }}
        />,
      );
      expect(
        screen.queryByRole('button', { name: /password/i }),
      ).not.toBeInTheDocument();
      const toggle = screen.getByRole('button', { name: 'Show Card number' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await user.click(toggle);
      expect(
        screen.getByRole('button', { name: 'Hide Card number' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    it('passes axe audit with both controls, masked and shown', async () => {
      const { container, user } = render(
        <Input
          label="Password"
          type="password"
          sensitive
          copyable
          copyLabel="Copy Password"
          revealLabels={{ show: 'Show Password', hide: 'Hide Password' }}
          defaultValue="hunter2"
        />,
      );
      await checkAccessibility(container);
      await user.click(screen.getByRole('button', { name: 'Show Password' }));
      await checkAccessibility(container);
    });

    it('leaves console.error as it found it after the refused copy', () => {
      // The refused copy above silences it for its own sake; no later test may
      // inherit the silence.
      expect(vi.isMockFunction(console.error)).toBe(false);
    });
  });

  describe('the ref of the field', () => {
    // React 19 lets a callback ref return a cleanup, and then calls it instead
    // of calling the ref with null. The field must hand its element to the
    // caller's ref as it is, in every frame it can be drawn in, or that cleanup
    // never runs.
    const frames = [
      ['a plain field', {}],
      ['a masked field with its toggle', { type: 'password' as const }],
      ['a field with a copy button', { copyable: true }],
      ['a field with a fixed addon', { prefix: 'TALE_' }],
    ] as const;

    it.each(frames)(
      'gives %s to a callback ref that returns a cleanup, and runs that cleanup once on unmount',
      (_name, props) => {
        const calls: Array<HTMLInputElement | null> = [];
        const cleanup = vi.fn();
        const ref = (node: HTMLInputElement | null) => {
          calls.push(node);
          return node === null ? undefined : cleanup;
        };
        const { unmount } = render(
          <Input label="Token" ref={ref} {...props} />,
        );
        expect(calls).toHaveLength(1);
        expect(calls[0]).toBe(screen.getByLabelText(/^Token\b/));
        unmount();
        expect(cleanup).toHaveBeenCalledTimes(1);
        // Never called with null: the cleanup stands in for that call.
        expect(calls).toHaveLength(1);
      },
    );

    it.each(frames)(
      'gives %s to an object ref, and takes it back',
      (_name, props) => {
        const ref = createRef<HTMLInputElement>();
        const { unmount } = render(
          <Input label="Token" ref={ref} {...props} />,
        );
        expect(ref.current).toBe(screen.getByLabelText(/^Token\b/));
        unmount();
        expect(ref.current).toBeNull();
      },
    );

    it('still copies what a form library registered through that ref', async () => {
      function Registered() {
        const { register } = useForm({ defaultValues: { token: 'tok-1' } });
        return <Input label="Token" copyable {...register('token')} />;
      }
      const { user } = render(<Registered />);
      await user.type(screen.getByLabelText('Token'), '2');
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await navigator.clipboard.readText()).toBe('tok-12');
    });
  });

  describe('masking that goes and comes back', () => {
    // What was shown while a field was masked is not shown again when the mask
    // returns: the reveal belongs to the masking that gave it.
    it('masks a real password field again after it was a plain text field', async () => {
      const { user, rerender } = render(
        <Input
          label="Pw"
          type="password"
          autoComplete="off"
          defaultValue="secret"
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Show password' }));
      expect(screen.getByLabelText('Pw')).toHaveAttribute('type', 'text');

      rerender(
        <Input
          label="Pw"
          type="text"
          autoComplete="off"
          defaultValue="secret"
        />,
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();

      rerender(
        <Input
          label="Pw"
          type="password"
          autoComplete="off"
          defaultValue="secret"
        />,
      );
      expect(screen.getByLabelText('Pw')).toHaveAttribute('type', 'password');
      expect(
        screen.getByRole('button', { name: 'Show password' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('asks to show a sensitive value again after it stopped being sensitive', async () => {
      const { user, rerender } = render(
        <Input label="Key" sensitive defaultValue="k-1" />,
      );
      await user.click(screen.getByRole('button', { name: 'Show password' }));
      expect(
        screen.getByRole('button', { name: 'Hide password' }),
      ).toHaveAttribute('aria-pressed', 'true');

      rerender(<Input label="Key" sensitive={false} defaultValue="k-1" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();

      rerender(<Input label="Key" sensitive defaultValue="k-1" />);
      expect(
        screen.getByRole('button', { name: 'Show password' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('masks a shown value for good once its toggle is taken away', async () => {
      const { user, rerender } = render(
        <Input
          label="Pw"
          type="password"
          autoComplete="off"
          defaultValue="secret"
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Show password' }));
      expect(screen.getByLabelText('Pw')).toHaveAttribute('type', 'text');

      rerender(
        <Input
          label="Pw"
          type="password"
          autoComplete="off"
          passwordToggle={false}
          defaultValue="secret"
        />,
      );
      expect(screen.getByLabelText('Pw')).toHaveAttribute('type', 'password');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('keeps what the person chose while the masking stays', async () => {
      const { user, rerender } = render(
        <Input label="Key" sensitive defaultValue="k-1" />,
      );
      await user.click(screen.getByRole('button', { name: 'Show password' }));
      rerender(
        <Input label="Key" sensitive defaultValue="k-1" errorMessage="Nope." />,
      );
      expect(
        screen.getByRole('button', { name: 'Hide password' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });
  });
});
