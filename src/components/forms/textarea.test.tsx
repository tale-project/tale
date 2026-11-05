import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { Skeletonize } from '../feedback/skeleton-context';
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

    it('renders optional indicator', () => {
      render(<Textarea label="Description" required={false} />);
      expect(screen.getByText(/optional/i)).toBeInTheDocument();
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

    // A settings row renders the field's help beside it and points the field
    // at it; that must join the field's own error, never replace it.
    it('merges a caller aria-describedby with its own error', () => {
      render(
        <>
          <p id="row-help">Shown to teammates.</p>
          <Textarea
            aria-label="Summary"
            aria-describedby="row-help"
            errorMessage="Too long"
          />
        </>,
      );
      const textarea = screen.getByRole('textbox', { name: 'Summary' });
      expect(textarea).toHaveAccessibleDescription(
        'Too long Shown to teammates.',
      );
    });
  });

  describe('counter', () => {
    it('counts the value against the max in the UI language’s format', () => {
      render(
        <Textarea
          aria-label="Notes"
          counterMax={20_000}
          defaultValue={'d'.repeat(1_234)}
        />,
      );
      expect(screen.getByText('1,234 / 20,000')).toBeInTheDocument();
    });

    it('groups the digits the German way for a German UI', async () => {
      const de = createInstance();
      await de.init({ lng: 'de', resources: {} });
      render(
        <I18nextProvider i18n={de}>
          <Textarea
            aria-label="Notizen"
            counterMax={20_000}
            readOnly
            value=""
          />
        </I18nextProvider>,
      );
      expect(screen.getByText('0 / 20.000')).toBeInTheDocument();
    });

    // A caller that saves the value trimmed counts it trimmed: the raw
    // length overstated how much was left to delete past the cap.
    it('shows the length the caller measured instead of the raw one', () => {
      render(
        <Textarea
          aria-label="Notes"
          counterMax={10}
          counterValue={11}
          readOnly
          value={`  ${'d'.repeat(11)}\n\n`}
        />,
      );
      const counter = screen.getByText('11 / 10');
      expect(counter).toHaveClass('text-destructive');
    });

    // The count describes the field, read when it takes focus, and is no
    // live region: a running length there was announced on every keystroke.
    it('describes the field without announcing each keystroke', () => {
      render(
        <Textarea
          aria-label="Notes"
          counterMax={200}
          errorMessage="Too long"
          readOnly
          value="abc"
        />,
      );
      const counter = screen.getByText('3 / 200');
      expect(
        screen.getByRole('textbox', { name: 'Notes' }),
      ).toHaveAccessibleDescription('Too long 3 / 200');
      expect(counter).not.toHaveAttribute('role');
      expect(counter).not.toHaveAttribute('aria-live');
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
  describe('secret text', () => {
    // A private key, a recovery phrase, a hidden note: several lines that are
    // masked until shown and copied without being shown, with the same two
    // buttons a masked Input carries, inside the field's corner.
    it('is plain text unless it is sensitive', () => {
      render(<Textarea label="Note" defaultValue="open" />);
      expect(
        screen.queryByRole('button', { name: /show|copy/i }),
      ).not.toBeInTheDocument();
    });

    it('offers to show the text, and says what it does now', async () => {
      const { user } = render(
        <Textarea label="Private key" sensitive defaultValue="line one" />,
      );
      const toggle = screen.getByRole('button', { name: 'Show value' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await user.click(toggle);
      expect(
        screen.getByRole('button', { name: 'Hide value' }),
      ).toHaveAttribute('aria-pressed', 'true');
      // Showing the text does not change it.
      expect(screen.getByLabelText('Private key')).toHaveValue('line one');
    });

    it('is no password for the browser: no autofill, no save prompt', () => {
      render(<Textarea label="Private key" sensitive />);
      const field = screen.getByLabelText('Private key');
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field).toHaveAttribute('data-1p-ignore');
      expect(field).toHaveAttribute('data-lpignore', 'true');
    });

    // Text drawn as dots is still text to the browser: it would spell-check the
    // secret (enhanced spell checking sends it to a server), capitalise it and
    // correct it. A secret asks for none of it.
    it('keeps the browser from spell-checking, capitalising or correcting it', () => {
      render(<Textarea label="Private key" sensitive />);
      const field = screen.getByLabelText('Private key');
      expect(field).toHaveAttribute('spellcheck', 'false');
      expect(field).toHaveAttribute('autocapitalize', 'off');
      expect(field).toHaveAttribute('autocorrect', 'off');
    });

    it('lets the caller decide, as it does for every other attribute', () => {
      render(
        <Textarea
          label="Private key"
          sensitive
          spellCheck
          autoCapitalize="words"
          autoCorrect="on"
        />,
      );
      const field = screen.getByLabelText('Private key');
      expect(field).toHaveAttribute('spellcheck', 'true');
      expect(field).toHaveAttribute('autocapitalize', 'words');
      expect(field).toHaveAttribute('autocorrect', 'on');
    });

    it('leaves plain text as it was', () => {
      render(<Textarea label="Note" />);
      const field = screen.getByLabelText('Note');
      for (const name of ['spellcheck', 'autocapitalize', 'autocorrect']) {
        expect(field).not.toHaveAttribute(name);
      }
    });

    it('can be left without the toggle', () => {
      render(<Textarea label="Private key" sensitive passwordToggle={false} />);
      expect(
        screen.queryByRole('button', { name: /show/i }),
      ).not.toBeInTheDocument();
    });

    it('names the toggle for what it shows when asked to', async () => {
      const { user } = render(
        <Textarea
          label="Recovery phrase"
          sensitive
          revealLabels={{
            show: 'Show Recovery phrase',
            hide: 'Hide Recovery phrase',
          }}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'Show Recovery phrase' }),
      );
      expect(
        screen.getByRole('button', { name: 'Hide Recovery phrase' }),
      ).toBeInTheDocument();
    });

    it('keeps the caller style', () => {
      render(<Textarea label="Key" sensitive style={{ color: 'red' }} />);
      expect(screen.getByLabelText('Key').style.color).toBe('red');
    });

    it('copies all its lines, shown or not, and says it did', async () => {
      const { user } = render(
        <Textarea
          label="Private key"
          sensitive
          copyable
          copyLabel="Copy Private key"
          copiedLabel="Private key copied"
          defaultValue={'line one\nline two'}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'Copy Private key' }),
      );
      expect(await navigator.clipboard.readText()).toBe('line one\nline two');
      expect(screen.getByRole('status')).toHaveTextContent(
        'Private key copied',
      );
      expect(
        screen.getByRole('button', { name: 'Show value' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('copies plain text too, when it is copyable', async () => {
      const { user } = render(
        <Textarea label="Note" copyable defaultValue="a note" />,
      );
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await navigator.clipboard.readText()).toBe('a note');
    });

    it('copies nothing from an empty field', async () => {
      const { user } = render(<Textarea label="Note" copyable />);
      const write = vi.spyOn(navigator.clipboard, 'writeText');
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(write).not.toHaveBeenCalled();
    });

    it('keeps its text clear of the buttons and its counter under the field', () => {
      render(
        <Textarea
          label="Key"
          sensitive
          copyable
          counterMax={100}
          defaultValue="x"
        />,
      );
      const field = screen.getByLabelText('Key');
      expect(field).toHaveClass('pr-16');
      expect(screen.getByText('1 / 100')).toBeInTheDocument();
      const copy = screen.getByRole('button', { name: 'Copy' });
      expect(field.parentElement).toContainElement(copy);
    });

    it('reads in this order: the text, then copy, then show', async () => {
      const { user } = render(<Textarea label="Key" sensitive copyable />);
      screen.getByLabelText('Key').focus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Copy' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Show value' })).toHaveFocus();
    });

    it('passes axe audit with both buttons, masked and shown', async () => {
      const { container, user } = render(
        <Textarea
          label="Private key"
          sensitive
          copyable
          copyLabel="Copy Private key"
          revealLabels={{ show: 'Show Private key', hide: 'Hide Private key' }}
          defaultValue="abc"
        />,
      );
      await checkAccessibility(container);
      await user.click(
        screen.getByRole('button', { name: 'Show Private key' }),
      );
      await checkAccessibility(container);
    });

    // What was shown while the text was masked is not shown again when the
    // mask returns: the reveal belongs to the masking that gave it.
    it('asks to show the text again after it stopped being sensitive', async () => {
      const { user, rerender } = render(
        <Textarea label="Key" sensitive defaultValue="k-1" />,
      );
      await user.click(screen.getByRole('button', { name: 'Show value' }));
      expect(
        screen.getByRole('button', { name: 'Hide value' }),
      ).toHaveAttribute('aria-pressed', 'true');

      rerender(<Textarea label="Key" sensitive={false} defaultValue="k-1" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();

      rerender(<Textarea label="Key" sensitive defaultValue="k-1" />);
      expect(
        screen.getByRole('button', { name: 'Show value' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('masks shown text for good once its toggle is taken away', async () => {
      const { user, rerender } = render(
        <Textarea label="Key" sensitive defaultValue="k-1" />,
      );
      await user.click(screen.getByRole('button', { name: 'Show value' }));
      rerender(
        <Textarea
          label="Key"
          sensitive
          passwordToggle={false}
          defaultValue="k-1"
        />,
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      // The toggle comes back hidden, not as it was left.
      rerender(<Textarea label="Key" sensitive defaultValue="k-1" />);
      expect(
        screen.getByRole('button', { name: 'Show value' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('keeps what the person chose while the masking stays', async () => {
      const { user, rerender } = render(
        <Textarea label="Key" sensitive defaultValue="k-1" />,
      );
      await user.click(screen.getByRole('button', { name: 'Show value' }));
      rerender(
        <Textarea
          label="Key"
          sensitive
          defaultValue="k-1"
          errorMessage="Nope."
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Hide value' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    // The buttons are controls of the field: while a Skeletonize around it is
    // loading they are masked with it, as an Input's and a CopyableField's are.
    it('takes its buttons out of reach while a Skeletonize around it loads', () => {
      const field = (loading: boolean) => (
        <Skeletonize loading={loading}>
          <Textarea label="Key" sensitive copyable defaultValue="abc" />
        </Skeletonize>
      );
      const { container, rerender } = render(field(true));
      const buttons = Array.from(container.querySelectorAll('button'));
      expect(buttons).toHaveLength(2);
      for (const button of buttons) {
        expect(button.closest('[inert]')).not.toBeNull();
        expect(button.closest('[aria-hidden="true"]')).not.toBeNull();
      }
      expect(screen.queryAllByRole('button')).toHaveLength(0);

      rerender(field(false));
      for (const button of buttons) {
        expect(button.closest('[inert]')).toBeNull();
        expect(button.closest('[aria-hidden="true"]')).toBeNull();
      }
      expect(screen.getAllByRole('button')).toHaveLength(2);
    });
  });
});
