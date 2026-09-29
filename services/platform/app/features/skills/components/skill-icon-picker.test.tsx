/**
 * The icon picker has one focus model (#3754): the search box keeps focus
 * and owns the grid through `aria-activedescendant`. Its options are not Tab
 * stops, and every way to activate one — a pointer click, a key on an
 * option assistive technology focused, Enter in the search box — picks it
 * through the same action.
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SkillIconPicker } from './skill-icon-picker';

function renderPicker(value?: string) {
  const onChange = vi.fn();
  const utils = render(<SkillIconPicker value={value} onChange={onChange} />);
  return { ...utils, onChange };
}

async function openPicker(user: ReturnType<typeof renderPicker>['user']) {
  await user.click(screen.getByRole('button', { name: 'Change icon' }));
  return screen.findByRole('listbox', { name: 'Icon' });
}

describe('SkillIconPicker', () => {
  it('keeps every option out of the Tab order', async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);
    const search = screen.getByRole('combobox', { name: 'Search icons' });
    expect(search).toHaveFocus();

    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    expect(options.filter((option) => option.tabIndex >= 0)).toEqual([]);

    await user.tab();
    expect(document.activeElement?.getAttribute('role')).not.toBe('option');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('picks the clicked icon once and closes', async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);
    const option = screen.getAllByRole('option')[3];
    const name = option.getAttribute('aria-label');

    await user.click(option);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(`lucide:${name}`);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it.each(['{Enter}', ' '])(
    'picks an option focused by assistive technology on %s',
    async (key) => {
      const { user, onChange } = renderPicker('lucide:rocket');
      await openPicker(user);

      screen.getByRole('option', { name: 'No icon' }).focus();
      await user.keyboard(key);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(undefined);
    },
  );

  it('picks the highlighted icon with the arrows and Enter, and hands focus back', async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);
    const second = screen.getAllByRole('option')[2];

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(
      screen.getByRole('combobox', { name: 'Search icons' }),
    ).toHaveAttribute('aria-activedescendant', second.id);
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith(
      `lucide:${second.getAttribute('aria-label')}`,
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change icon' })).toHaveFocus();
  });

  it('scrolls the highlighted option into view as the arrows move it', async () => {
    const { user } = renderPicker();
    await openPicker(user);
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    try {
      await user.keyboard('{ArrowDown}{ArrowDown}');

      const highlighted = document.getElementById(
        screen
          .getByRole('combobox', { name: 'Search icons' })
          .getAttribute('aria-activedescendant') ?? '',
      );
      expect(highlighted).not.toBeNull();
      expect(scrolled.mock.contexts.at(-1)).toBe(highlighted);
      expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest' });
    } finally {
      scrolled.mockRestore();
    }
  });

  it('clears the icon from the leading cell with Enter', async () => {
    const { user, onChange } = renderPicker('lucide:rocket');
    await openPicker(user);

    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
