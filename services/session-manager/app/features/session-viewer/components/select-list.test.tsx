import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import type { SelectMenuInfo } from '../lib/live-state';
import { SelectList } from './select-list';

const option = (
  label: string,
  more: Partial<SelectMenuInfo['options'][number]> = {},
): SelectMenuInfo['options'][number] => ({
  label,
  selected: false,
  disabled: false,
  group: null,
  ...more,
});

const menu: SelectMenuInfo = {
  token: 7,
  x: 200,
  y: 100,
  width: 400,
  height: 40,
  options: [
    option('Choose a country', { selected: true }),
    option('Austria', { group: 'Europe' }),
    option('Germany', { group: 'Europe' }),
    option('France', { group: 'Europe', disabled: true }),
    option('Canada', { group: 'Americas' }),
    option('Mexico', { group: 'Americas' }),
  ],
};

function setup(overrides: Partial<SelectMenuInfo> = {}) {
  const onPick = vi.fn();
  const returnFocus = vi.fn();
  const onOutsideKey = vi.fn();
  const view = renderApp(
    // The page around the list: it must not hear what the list handles.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- listens for what leaks out of the list
    <div onKeyDown={onOutsideKey}>
      <button type="button">Outside</button>
      <SelectList
        menu={{ ...menu, ...overrides }}
        view={{ tab: 1, w: 1000, h: 800 }}
        placement={{ width: 500, height: 400, left: 50, top: 50, scale: 0.5 }}
        screen={{ width: 600, height: 500 }}
        onPick={onPick}
        returnFocus={returnFocus}
      />
    </div>,
  );
  return { ...view, onPick, returnFocus, onOutsideKey };
}

const options = () => screen.getAllByRole('option');
const label = (element: HTMLElement) => element.textContent;

describe('SelectList', () => {
  it('lists the options of the page in groups, as a listbox', () => {
    setup();
    const list = screen.getByRole('listbox', { name: 'Options' });
    expect(within(list).getAllByRole('option').map(label)).toEqual([
      'Choose a country',
      'Austria',
      'Germany',
      'France',
      'Canada',
      'Mexico',
    ]);
    const europe = within(list).getByRole('group', { name: 'Europe' });
    expect(within(europe).getAllByRole('option')).toHaveLength(3);
    const americas = within(list).getByRole('group', { name: 'Americas' });
    expect(within(americas).getAllByRole('option').map(label)).toEqual([
      'Canada',
      'Mexico',
    ]);
  });

  it('marks the option the page has chosen, and the ones that cannot be chosen', () => {
    setup();
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    expect(options()[1]).toHaveAttribute('aria-selected', 'false');
    expect(options()[3]).toBeDisabled();
  });

  it('gives the keyboard to the option the page has chosen', () => {
    setup();
    expect(
      screen.getByRole('option', { name: 'Choose a country' }),
    ).toHaveFocus();
  });

  it('gives the keyboard to the first option that can be chosen when the page has chosen none', () => {
    setup({
      options: [
        option('Closed', { disabled: true }),
        option('One'),
        option('Two'),
      ],
    });
    expect(screen.getByRole('option', { name: 'One' })).toHaveFocus();
  });

  it('is one stop of the tab key: only the active option is in the tab order', () => {
    setup();
    expect(options().map((item) => item.tabIndex)).toEqual([
      0, -1, -1, -1, -1, -1,
    ]);
  });

  it('moves with the arrow keys over the options that can be chosen, round the end', async () => {
    const { user } = setup();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Austria' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    // France cannot be chosen: the keyboard skips it.
    expect(screen.getByRole('option', { name: 'Canada' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(
      screen.getByRole('option', { name: 'Choose a country' }),
    ).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('option', { name: 'Mexico' })).toHaveFocus();
  });

  it('goes to the first and the last option with Home and End', async () => {
    const { user } = setup();
    await user.keyboard('{End}');
    expect(screen.getByRole('option', { name: 'Mexico' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(
      screen.getByRole('option', { name: 'Choose a country' }),
    ).toHaveFocus();
  });

  it('jumps to the option that starts with the letter typed', async () => {
    const { user } = setup();
    await user.keyboard('g');
    expect(screen.getByRole('option', { name: 'Germany' })).toHaveFocus();
  });

  it('narrows the jump down with each letter of a word typed in a row', async () => {
    const { user } = setup();
    // "c" goes to the next option with a "c" (Canada), "ch" on to the one that is "Ch...".
    await user.keyboard('c');
    expect(screen.getByRole('option', { name: 'Canada' })).toHaveFocus();
    await user.keyboard('h');
    expect(
      screen.getByRole('option', { name: 'Choose a country' }),
    ).toHaveFocus();
  });

  it('stays where it is when no option starts with the letters', async () => {
    const { user } = setup();
    await user.keyboard('zz');
    expect(
      screen.getByRole('option', { name: 'Choose a country' }),
    ).toHaveFocus();
  });

  it('goes on to the next option with the same letter when it is typed again', async () => {
    const { user } = setup({
      options: [
        option('Alpha'),
        option('Beta'),
        option('Bravo'),
        option('Bronze'),
      ],
    });
    await user.keyboard('b');
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveFocus();
    await user.keyboard('b');
    expect(screen.getByRole('option', { name: 'Bravo' })).toHaveFocus();
    await user.keyboard('b');
    expect(screen.getByRole('option', { name: 'Bronze' })).toHaveFocus();
    await user.keyboard('b');
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveFocus();
  });

  it('starts a new word once the typing stopped', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      setup({
        options: [option('Cat'), option('Car'), option('Dog'), option('Doe')],
      });
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'd' });
      expect(screen.getByRole('option', { name: 'Dog' })).toHaveFocus();
      vi.advanceTimersByTime(800);
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'c' });
      expect(screen.getByRole('option', { name: 'Cat' })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not take a shortcut for typing', async () => {
    const { user } = setup();
    await user.keyboard('{Control>}g{/Control}');
    expect(
      screen.getByRole('option', { name: 'Choose a country' }),
    ).toHaveFocus();
  });

  it('chooses the option that has the keyboard with Enter, by its place in the list of the page', async () => {
    const { user, onPick, returnFocus } = setup();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledExactlyOnceWith(7, 2);
    expect(returnFocus).toHaveBeenCalledTimes(1);
  });

  it('chooses with the space bar too', async () => {
    const { user, onPick } = setup();
    await user.keyboard('{ArrowDown} ');
    expect(onPick).toHaveBeenCalledExactlyOnceWith(7, 1);
  });

  it('chooses the option that is clicked', async () => {
    const { user, onPick, returnFocus } = setup();
    await user.click(screen.getByRole('option', { name: 'Mexico' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith(7, 5);
    expect(returnFocus).toHaveBeenCalledTimes(1);
  });

  it('chooses nothing when a disabled option is clicked', async () => {
    const { user, onPick } = setup();
    await user.click(screen.getByRole('option', { name: 'France' }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('is dismissed with Escape, which no one else hears', async () => {
    const { user, onPick, returnFocus, onOutsideKey } = setup();
    await user.keyboard('{Escape}');
    expect(onPick).toHaveBeenCalledExactlyOnceWith(7, null);
    expect(returnFocus).toHaveBeenCalledTimes(1);
    expect(onOutsideKey).not.toHaveBeenCalled();
  });

  it('is dismissed with Tab, keeping the keyboard in the page', async () => {
    const { user, onPick, returnFocus } = setup();
    await user.keyboard('{Tab}');
    expect(onPick).toHaveBeenCalledExactlyOnceWith(7, null);
    expect(returnFocus).toHaveBeenCalledTimes(1);
  });

  it('is dismissed by a press anywhere outside it', () => {
    const { onPick, returnFocus } = setup();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith(7, null);
    expect(returnFocus).toHaveBeenCalledTimes(1);
  });

  it('stays while it is pressed itself', () => {
    const { onPick } = setup();
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Austria' }));
    fireEvent.pointerDown(screen.getByRole('listbox'));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('opens over the select of the page, as wide as the select is shown', () => {
    setup();
    const list = screen.getByRole('listbox');
    // The page is shown at half size, 50 px from the left and the top: the
    // select (200, 100, 400 x 40) is at 150, 120 and 200 px wide; the list
    // opens 2 px under it.
    expect(list.style.left).toBe('150px');
    expect(list.style.top).toBe('122px');
    expect(list.style.minWidth).toBe('200px');
  });

  it('has no accessibility violations', async () => {
    const view = setup();
    await checkAccessibility(view);
  });
});
