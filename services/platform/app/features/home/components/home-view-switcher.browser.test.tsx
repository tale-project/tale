import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, render, screen } from '@/tests/utils/render';

import type { HomeView } from '../lib/home-items';
import { HomeViewSwitcher } from './home-view-switcher';

import '@/app/globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

function Switcher() {
  const [view, setView] = useState<HomeView>('all');
  return (
    <div className="bg-background w-70 p-3">
      <HomeViewSwitcher
        value={view}
        onChange={setView}
        options={[
          { view: 'all', attention: 0 },
          { view: 'chats', attention: 0 },
          { view: 'tasks', attention: 2 },
          { view: 'inbox', attention: 0 },
        ]}
      />
    </div>
  );
}

describe.each(['light', 'dark'])('Home view switcher (%s)', (theme) => {
  it('keeps selected and inactive labels readable on the pill track', async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(<Switcher />);
    const result = await axe.run(container, { runOnly: ['color-contrast'] });
    expect(result.violations).toEqual([]);
    expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
      true,
    );
  });

  it('moves selection and focus together and wraps at both ends', async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { user } = render(<Switcher />);
    const options = screen.getAllByRole('radio');
    options[0]?.focus();
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(options[3]);
    expect(options[3]?.getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(options[2]);
    expect(options[2]?.getAttribute('aria-checked')).toBe('true');
    expect(options.filter((option) => option.tabIndex === 0)).toHaveLength(1);
  });
});
