import { afterEach, describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ThemeProvider } from '../../theme/theme-provider';
import { ThemeSwitcher } from './theme-switcher';

afterEach(() => {
  localStorage.removeItem('tale-theme');
  document.documentElement.classList.remove('dark');
  document.documentElement.style.removeProperty('color-scheme');
});

describe('ThemeSwitcher', () => {
  it('selects and persists light, dark and system without confusing preference with resolved theme', async () => {
    const { user, container } = render(
      <ThemeProvider>
        <ThemeSwitcher variant="segmented" />
      </ThemeProvider>,
    );
    const choices = within(
      screen.getByRole('radiogroup', { name: 'Switch theme' }),
    );
    expect(choices.getByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(choices.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('tale-theme')).toBe('dark');
    await user.click(choices.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('tale-theme')).toBe('light');
    await user.click(choices.getByRole('radio', { name: 'System' }));
    expect(choices.getByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(choices.getByRole('radio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(localStorage.getItem('tale-theme')).toBe('system');
    await checkAccessibility(container);
  });

  it('uses one tab stop with wrapping arrow selection and releases focus on Tab', async () => {
    const { user } = render(
      <ThemeProvider>
        <button type="button">Before</button>
        <ThemeSwitcher variant="segmented" />
        <button type="button">After</button>
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    await user.keyboard('{ArrowLeft}');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('keeps the menu active state and returns focus after selection or Escape', async () => {
    const { user, container } = render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Switch theme' });
    await user.click(trigger);
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus();
    await user.keyboard('{Home}{ArrowDown}{Enter}');
    expect(document.documentElement).toHaveClass('dark');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await checkAccessibility(container);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
