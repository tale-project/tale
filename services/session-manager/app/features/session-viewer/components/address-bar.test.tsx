import { act, fireEvent, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import { AddressBar, TYPED_ADDRESS_MS } from './address-bar';

function setup(props: Partial<React.ComponentProps<typeof AddressBar>> = {}) {
  const handlers = {
    onNavigate: vi.fn(),
    onSubmit: vi.fn(),
    onLeave: vi.fn(),
  };
  const inputRef = createRef<HTMLInputElement>();
  const element = (next: Partial<React.ComponentProps<typeof AddressBar>>) => (
    <AddressBar
      activeUrl="https://shop.example.com/cart"
      disabled={false}
      inputRef={inputRef}
      {...handlers}
      {...props}
      {...next}
    >
      <button type="button">Secrets</button>
    </AddressBar>
  );
  const view = renderApp(element({}));
  return {
    ...view,
    ...handlers,
    inputRef,
    show: (next: Partial<React.ComponentProps<typeof AddressBar>>) =>
      view.rerender(element(next)),
  };
}

const address = () =>
  screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' });

afterEach(() => {
  vi.useRealTimers();
});

describe('AddressBar', () => {
  it('shows the address of the tab, with buttons for back, forward and reload, and what sits at its end', () => {
    setup();
    expect(address()).toHaveValue('https://shop.example.com/cart');
    for (const name of [
      'Go to previous page',
      'Go to next page',
      'Reload page',
      'Secrets',
    ]) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
  });

  it('names the buttons of the page after what they do, not as the "Back" of the app around them', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('asks the page to go back, forward and to reload', async () => {
    const { user, onNavigate } = setup();
    await user.click(
      screen.getByRole('button', { name: 'Go to previous page' }),
    );
    await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    await user.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(onNavigate.mock.calls).toEqual([['back'], ['forward'], ['reload']]);
  });

  it('shows what to type in a tab that has no address yet', () => {
    setup({ activeUrl: undefined });
    expect(address()).toHaveValue('');
    expect(address()).toHaveAttribute(
      'placeholder',
      'Search or enter an address',
    );
  });

  it('selects the address when it takes the keyboard, so that typing replaces it', async () => {
    const { user } = setup();
    await user.click(address());
    expect(address().selectionStart).toBe(0);
    expect(address().selectionEnd).toBe('https://shop.example.com/cart'.length);
  });

  it('sends what was entered, trimmed, and gives the keyboard back to the page', async () => {
    const { user, onSubmit, onLeave } = setup();
    await user.click(address());
    await user.keyboard('  cute cats  {Enter}');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('cute cats');
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty entry', async () => {
    const { user, onSubmit, onLeave } = setup();
    await user.click(address());
    await user.keyboard('{Backspace}   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('keeps what was entered in the bar until the page it opens arrives', async () => {
    const { user, show } = setup();
    await user.click(address());
    await user.keyboard('cute cats{Enter}');
    expect(address()).toHaveValue('cute cats');
    // Another tab event with the same address: nothing arrived yet.
    show({ activeUrl: 'https://shop.example.com/cart' });
    expect(address()).toHaveValue('cute cats');
    // The page arrives.
    show({ activeUrl: 'https://search.example.com/?q=cute+cats' });
    expect(address()).toHaveValue('https://search.example.com/?q=cute+cats');
  });

  it('does not bring back what was entered when the tab returns to its old address', async () => {
    const { user, show } = setup();
    await user.click(address());
    await user.keyboard('cute cats{Enter}');
    show({ activeUrl: 'https://other.example.com/' });
    show({ activeUrl: 'https://shop.example.com/cart' });
    expect(address()).toHaveValue('https://shop.example.com/cart');
  });

  it('shows the address of the tab again once the entry has waited long enough', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setup();
    fireEvent.focus(address());
    fireEvent.change(address(), { target: { value: 'cute cats' } });
    fireEvent.submit(address());
    expect(address()).toHaveValue('cute cats');
    act(() => {
      vi.advanceTimersByTime(TYPED_ADDRESS_MS - 1);
    });
    expect(address()).toHaveValue('cute cats');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(address()).toHaveValue('https://shop.example.com/cart');
  });

  it('does not change what is being typed when the tab goes somewhere else', async () => {
    const { user, show } = setup();
    await user.click(address());
    await user.keyboard('abc');
    show({ activeUrl: 'https://other.example.com/' });
    // The selected address was replaced by what was typed.
    expect(address()).toHaveValue('abc');
  });

  it('shows the address of the tab again when the keyboard goes elsewhere', async () => {
    const { user, show } = setup();
    await user.click(address());
    await user.keyboard('abc');
    await user.tab();
    expect(address()).toHaveValue('https://shop.example.com/cart');
    show({ activeUrl: 'https://other.example.com/' });
    expect(address()).toHaveValue('https://other.example.com/');
  });

  it('gives up with Escape: the address of the tab is back and the keyboard goes to the page', async () => {
    const { user, onLeave, onSubmit } = setup();
    await user.click(address());
    await user.keyboard('abc{Escape}');
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    // The page takes the keyboard: the bar loses it.
    fireEvent.blur(address());
    expect(address()).toHaveValue('https://shop.example.com/cart');
  });

  it('is off while the connection is not live', () => {
    setup({ disabled: true });
    expect(address()).toBeDisabled();
    for (const name of [
      'Go to previous page',
      'Go to next page',
      'Reload page',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('can be given the keyboard from outside, through its ref', () => {
    const { inputRef } = setup();
    act(() => inputRef.current?.focus());
    expect(address()).toHaveFocus();
  });

  it('shows the shortcut that gets here from the page, for the eyes only', () => {
    setup();
    expect(screen.getByText('Ctrl+L')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the key of a Mac as a Mac names it', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    setup();
    expect(screen.getByText('⌘ L')).toBeInTheDocument();
  });

  it('does not say that the field has the shortcut: it only works while the page has the keyboard', () => {
    setup();
    expect(address()).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('has no accessibility violations', async () => {
    const view = setup();
    await checkAccessibility(view);
  });
});
