import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { ThemeProvider } from '../../theme/theme-provider';
import { ThemeSwitcher } from './theme-switcher';

import '../../globals.css';

afterEach(() => {
  cleanup();
  localStorage.removeItem('tale-theme');
  document.documentElement.classList.remove('dark');
  document.documentElement.style.removeProperty('color-scheme');
});

describe('ThemeSwitcher selection surface (real layout)', () => {
  it('opens upward when the menu and trigger gap cannot fit below', async () => {
    const { container } = render(
      <ThemeProvider>
        <div style={{ position: 'fixed', right: 20, bottom: 146 }}>
          <ThemeSwitcher />
        </div>
      </ThemeProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Switch theme' });
    const fixture = container.querySelector('div');
    if (!fixture) throw new Error('Missing theme placement fixture');
    const initialSpace =
      window.innerHeight - trigger.getBoundingClientRect().bottom;
    fixture.style.transform = `translateY(${initialSpace - 146}px)`;
    expect(window.innerHeight - trigger.getBoundingClientRect().bottom).toBe(
      146,
    );
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Switch theme' });
    expect(menu.getBoundingClientRect().bottom).toBeLessThan(
      trigger.getBoundingClientRect().top,
    );
    expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      window.innerHeight,
    );
  });

  it('selects the focused choice after a quick arrow press', async () => {
    render(
      <ThemeProvider>
        <ThemeSwitcher variant="segmented" />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'System' }));
    await userEvent.keyboard('{ArrowLeft}');
    await expect
      .poll(() =>
        screen
          .getByRole('radio', { name: 'Dark' })
          .getAttribute('aria-checked'),
      )
      .toBe('true');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
  });

  it.each([44, 52])(
    'keeps the selected surface on the selected %ipx touch target',
    async (size) => {
      render(
        <ThemeProvider>
          <div className="theme-switcher-resized" style={{ width: 240 }}>
            <style>{`.theme-switcher-resized button { min-width: ${size}px; min-height: ${size}px; }`}</style>
            <ThemeSwitcher variant="segmented" />
          </div>
        </ThemeProvider>,
      );
      const group = screen.getByRole('radiogroup', { name: 'Switch theme' });
      for (const name of ['Dark', 'Light', 'System']) {
        const radio = screen.getByRole('radio', { name });
        await userEvent.click(radio);
        expect(radio).toHaveAttribute('aria-checked', 'true');
        const bounds = radio.getBoundingClientRect();
        expect(bounds.width).toBeGreaterThanOrEqual(size);
        expect(bounds.height).toBeGreaterThanOrEqual(size);
        // The old 26px floating marker moved 29px per option even when footer
        // buttons grew to 44px, so Dark visibly highlighted the Light icon.
        // The selected surface must belong to the whole selected hit target.
        await expect
          .poll(() => getComputedStyle(radio).backgroundColor)
          .not.toBe('rgba(0, 0, 0, 0)');
        expect(getComputedStyle(radio).backgroundColor).not.toBe(
          getComputedStyle(group).backgroundColor,
        );
        expect(bounds.right).toBeLessThanOrEqual(
          group.getBoundingClientRect().right,
        );
      }
      expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth);
    },
  );
});
