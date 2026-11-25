import { afterEach, describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { CopyableField, CopyableText } from './copyable-field';

// A test that mocks console.error or the clipboard hands the next one the real
// ones back.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CopyableField', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CopyableField value="abc-123" label="API Key" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit without label using aria-label', async () => {
      const { container } = render(
        <CopyableField value="abc-123" label="Key" />,
      );
      await checkAccessibility(container);
    });

    it('copy button has an accessible name', () => {
      render(<CopyableField value="abc-123" label="Key" />);
      const button = screen.getByRole('button');
      expect(button).toHaveAccessibleName(/Key.*abc-123/);
    });

    it('renders the value as text', () => {
      render(<CopyableField value="abc-123" label="Key" />);
      expect(screen.getByText('abc-123')).toBeInTheDocument();
    });
  });
});

describe('CopyableField of a secret', () => {
  // A value that is kept off the page until shown: dots stand for it, whatever
  // its length, and copying never shows it. The two buttons sit inside the
  // pill, as the pill of a plain value is itself the copy button.
  const PASSWORD = 'correct horse battery staple';

  it('shows dots for a masked value, and puts it nowhere in the page', () => {
    render(<CopyableField masked label="Password" value={PASSWORD} />);
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(PASSWORD);
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByText('••••••••')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the value on request and takes it off the page again', async () => {
    const { user } = render(
      <CopyableField masked label="Password" value={PASSWORD} />,
    );
    const toggle = screen.getByRole('button', { name: 'Show value' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.getByText(PASSWORD)).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide value' }));
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('names its buttons for what they do to this value when asked to', async () => {
    const { user } = render(
      <CopyableField
        masked
        label="Password"
        value={PASSWORD}
        revealLabels={{ show: 'Show Password', hide: 'Hide Password' }}
        copyAriaLabel="Copy Password"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(
      screen.getByRole('button', { name: 'Hide Password' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy Password' }),
    ).toBeInTheDocument();
  });

  it('copies the value without showing it, and says it did', async () => {
    const { user } = render(
      <CopyableField
        masked
        label="Password"
        value={PASSWORD}
        copiedLabel="Password copied"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(PASSWORD);
    expect(screen.getByRole('status')).toHaveTextContent('Password copied');
    expect(document.body.innerHTML).not.toContain(PASSWORD);
    expect(screen.getByRole('button', { name: 'Show value' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('says "Copied" unless told otherwise', async () => {
    const { user } = render(<CopyableField masked value="abc" />);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('does not say it copied when the browser refused', async () => {
    const { user } = render(<CopyableField masked value="abc" />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('denied'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('leaves console.error as it found it after the refused copy', () => {
    // The refused copy above silences it for its own sake; no later test may
    // inherit the silence.
    expect(vi.isMockFunction(console.error)).toBe(false);
  });

  // What was shown while the value was masked is not shown again when the mask
  // returns: the reveal belongs to the masking that gave it. (With `wrap` the
  // same pill stays mounted while `masked` flips, so its state would survive.)
  it('hides a value again when it is masked again, after it stopped being masked', async () => {
    const { user, rerender } = render(
      <CopyableField masked wrap label="Token" value="tok-secret" />,
    );
    await user.click(screen.getByRole('button', { name: 'Show value' }));
    expect(screen.getByText('tok-secret')).toBeInTheDocument();

    rerender(
      <CopyableField masked={false} wrap label="Token" value="tok-secret" />,
    );
    expect(
      screen.queryByRole('button', { name: /show value|hide value/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('tok-secret')).toBeInTheDocument();

    rerender(<CopyableField masked wrap label="Token" value="tok-secret" />);
    expect(screen.queryByText('tok-secret')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('tok-secret');
    expect(screen.getByRole('button', { name: 'Show value' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('keeps what the person chose while the value stays masked', async () => {
    const { user, rerender } = render(
      <CopyableField masked wrap label="Token" value="tok-secret" />,
    );
    await user.click(screen.getByRole('button', { name: 'Show value' }));
    rerender(
      <CopyableField
        masked
        wrap
        label="Token"
        description="Used by the CLI."
        value="tok-secret"
      />,
    );
    expect(screen.getByText('tok-secret')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide value' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('is a group named by its label, described by its description', () => {
    render(
      <CopyableField
        masked
        label="Password"
        description="Used to sign in."
        value={PASSWORD}
      />,
    );
    const group = screen.getByRole('group', { name: 'Password' });
    expect(group).toHaveAccessibleDescription('Used to sign in.');
    expect(group).toContainElement(
      screen.getByRole('button', { name: 'Show value' }),
    );
  });

  it('has the copy button and the eye after the value, in the order a masked Input has them', async () => {
    const { user } = render(<CopyableField masked label="Key" value="abc" />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Show value' })).toHaveFocus();
  });

  it('shows a value of several lines with its lines, and copies them all', async () => {
    const lines = 'Network: Studio-5G\nGuests use the guest network.';
    const { user } = render(
      <CopyableField wrap label="Note" value={lines} mono={false} />,
    );
    const text = screen.getByText(/Network: Studio-5G/);
    expect(text.textContent).toBe(lines);
    expect(text).toHaveClass('whitespace-pre-wrap');
    expect(text).not.toHaveClass('truncate');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(lines);
  });

  it('shows a long value whole, wrapped, with a copy button named for it', async () => {
    const long = 'Rex the dog from the street I grew up on, near the old mill';
    const { user } = render(
      <CopyableField
        wrap
        label="Security answer"
        value={long}
        copyAriaLabel="Copy Security answer"
        copiedLabel="Security answer copied"
      />,
    );
    expect(screen.getByText(long)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Copy Security answer' }),
    );
    expect(await navigator.clipboard.readText()).toBe(long);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Security answer copied',
    );
    // The pill is not a button named by what it holds.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it("says what the dots stand for in the caller's words", () => {
    render(<CopyableField masked value="abc" hiddenLabel="Not shown" />);
    expect(screen.getByText('Not shown')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('does not name its copy button by the lines it holds', () => {
    render(<CopyableField wrap label="Note" value={'one\ntwo\nthree'} />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('keeps the pill of a plain value a single button, as it was', () => {
    render(<CopyableField label="Key" value="abc-123" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button')).toHaveAccessibleName(/Key.*abc-123/);
  });

  it('passes axe audit masked, shown, and with several lines', async () => {
    const { container, user } = render(
      <>
        <CopyableField masked label="Password" value={PASSWORD} />
        <CopyableField wrap label="Note" value={'a\nb'} />
      </>,
    );
    await checkAccessibility(container);
    await user.click(screen.getByRole('button', { name: 'Show value' }));
    await checkAccessibility(container);
  });
});

describe('CopyableText', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<CopyableText value="some-id-123" />);
      await checkAccessibility(container);
    });

    it('copy button has aria-label', () => {
      render(<CopyableText value="some-id-123" />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label');
    });
  });
});
