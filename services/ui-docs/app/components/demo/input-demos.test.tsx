import { TooltipProvider } from '@tale/ui/tooltip';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

import InputCopyableField from '../../demos/input/copyable-field';
import InputSecret from '../../demos/input/secret';

/**
 * The Input page teaches what masking is: visual only, unless the field is a
 * real password input. Its examples must be what the page says they are, so a
 * change of an example cannot leave the words behind.
 */

// The app shell owns the tooltip provider; a demo is rendered inside it.
function renderDemo(demo: ReactElement) {
  return render(<TooltipProvider>{demo}</TooltipProvider>);
}

describe('the secret example of the Input page', () => {
  it('draws a single-line secret as a real password input a screen reader does not speak', () => {
    renderDemo(<InputSecret />);
    const card = screen.getByLabelText('Card number');
    expect(card).toHaveAttribute('type', 'password');
    expect(card).toHaveAttribute('autocomplete', 'off');
    // The hints that keep password managers away from a secret that is no
    // account password.
    for (const hint of [
      'data-1p-ignore',
      'data-lpignore',
      'data-form-type',
      'data-bwignore',
    ]) {
      expect(card).toHaveAttribute(hint);
    }
    expect(card).toHaveAccessibleDescription(/does not speak the value/);
  });

  it('draws several lines masked on screen only, and says a screen reader reads them', () => {
    renderDemo(<InputSecret />);
    const codes = screen.getByLabelText('Recovery codes');
    expect(codes.tagName).toBe('TEXTAREA');
    expect(codes).toHaveAccessibleDescription(/still reads every line/);
  });

  it('shows and hides each value, and copies it', async () => {
    const user = userEvent.setup();
    renderDemo(<InputSecret />);
    const card = screen.getByLabelText('Card number');
    await user.click(screen.getByRole('button', { name: 'Show card number' }));
    expect(card).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide card number' }));
    expect(card).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Copy card number' }));
    expect(await navigator.clipboard.readText()).toBe('0000 1111 2222 3333');
    expect(
      screen
        .getAllByRole('status')
        .some((status) => status.textContent === 'Card number copied'),
    ).toBe(true);
    // Copying did not show it.
    expect(card).toHaveAttribute('type', 'password');
  });

  it('passes an accessibility audit, masked and shown', async () => {
    const user = userEvent.setup();
    const { container } = renderDemo(<InputSecret />);
    await checkAccessibility(container);
    await user.click(screen.getByRole('button', { name: 'Show card number' }));
    await user.click(
      screen.getByRole('button', { name: 'Show recovery codes' }),
    );
    await checkAccessibility(container);
  });
});

describe('the CopyableField example of the Input page', () => {
  const TOKEN = 'sample-token-not-a-real-secret';

  it('keeps the masked value off the page until it is shown, and shows a note whole', async () => {
    const user = userEvent.setup();
    renderDemo(<InputCopyableField />);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(screen.getByText('proj_northwind_4821')).toBeInTheDocument();
    expect(
      screen.getByText(/The password is on the fridge\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show access token' }));
    expect(screen.getByText(TOKEN)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide access token' }));
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('passes an accessibility audit, masked and shown', async () => {
    const user = userEvent.setup();
    const { container } = renderDemo(<InputCopyableField />);
    await checkAccessibility(container);
    await user.click(screen.getByRole('button', { name: 'Show access token' }));
    await checkAccessibility(container);
  });
});
