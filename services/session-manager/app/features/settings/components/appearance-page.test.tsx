import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { installSettingsApi } from '@/tests/utils/settings-api';
import { renderSettings } from '@/tests/utils/settings-router';

const THEME_KEY = 'tale-theme';

beforeEach(() => {
  installSettingsApi();
});

afterEach(async () => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  await i18n.changeLanguage('en');
});

async function openAppearance(viewport: 'desktop' | 'phone' = 'desktop') {
  const view = renderSettings({ at: '/settings/appearance', viewport });
  await screen.findByRole('heading', {
    level: 1,
    name: /Appearance|Darstellung/,
  });
  return view;
}

const theme = () => screen.getByRole('radiogroup', { name: 'Switch theme' });
const option = (name: string) => within(theme()).getByRole('radio', { name });
const isDark = () => document.documentElement.classList.contains('dark');

describe('Appearance page: theme', () => {
  it('says in one line that these preferences belong to this device and apply at once', async () => {
    await openAppearance();

    expect(
      screen.getByRole('heading', { level: 2, name: 'This device' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'These preferences are saved on this device and apply at once.',
      ),
    ).toBeInTheDocument();
  });

  it('offers Light, Dark and System, following the system until one is chosen', async () => {
    await openAppearance();

    expect(
      within(theme())
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-label')),
    ).toEqual(['System', 'Light', 'Dark']);
    expect(option('System')).toBeChecked();
  });

  it('switches to dark at once, remembers it and leaves nothing to save', async () => {
    const { user } = await openAppearance();
    expect(isDark()).toBe(false);

    await user.click(option('Dark'));

    expect(option('Dark')).toBeChecked();
    await waitFor(() => expect(isDark()).toBe(true));
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    // No Save and Discard on a page whose choices apply as they are made.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  });

  it('switches back to light, and to the system’s choice', async () => {
    const { user } = await openAppearance();
    await user.click(option('Dark'));
    await waitFor(() => expect(isDark()).toBe(true));

    await user.click(option('Light'));
    await waitFor(() => expect(isDark()).toBe(false));
    expect(localStorage.getItem(THEME_KEY)).toBe('light');

    await user.click(option('System'));
    expect(option('System')).toBeChecked();
    expect(localStorage.getItem(THEME_KEY)).toBe('system');
  });

  it('shows the theme the browser remembered', async () => {
    localStorage.setItem(THEME_KEY, 'dark');
    await openAppearance();
    expect(option('Dark')).toBeChecked();
    await waitFor(() => expect(isDark()).toBe(true));
  });

  it('is operated with the arrow keys', async () => {
    const { user } = await openAppearance();
    option('System').focus();

    await user.keyboard('{ArrowRight}');
    expect(option('Light')).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(option('Dark')).toBeChecked();
    await waitFor(() => expect(isDark()).toBe(true));
  });
});

describe('Appearance page: language', () => {
  it('names the language the page shows, with English, German and French to choose from', async () => {
    const { user } = await openAppearance();

    const trigger = screen.getByRole('button', {
      name: 'Switch language: English',
    });
    await user.click(trigger);

    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent?.trim()),
    ).toEqual(['English', 'Deutsch', 'Français']);
  });

  it('switches the whole page to German at once and remembers it', async () => {
    const { user } = await openAppearance();

    await user.click(
      screen.getByRole('button', { name: 'Switch language: English' }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Deutsch/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Darstellung' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Allgemein' })).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(
      screen.getByRole('button', { name: 'Sprache wechseln: Deutsch' }),
    ).toBeInTheDocument();
  });

  it('switches on to French, and back to English', async () => {
    const { user } = await openAppearance();

    await user.click(
      screen.getByRole('button', { name: 'Switch language: English' }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Français/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Apparence' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Thème')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /^Changer de langue.*Français$/ }),
    );
    await user.click(screen.getByRole('menuitem', { name: /English/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Appearance' }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('reads in the language the browser remembered', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderSettings({ at: '/settings/appearance' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Darstellung' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Dieses Gerät' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Diese Einstellungen werden auf diesem Gerät gespeichert und gelten sofort.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Hell, dunkel oder wie dein System.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: 'Design wechseln' }),
    ).toBeInTheDocument();
  });
});

describe('Appearance page: accessibility', () => {
  it('has no violations, with the language menu closed and open', async () => {
    const view = await openAppearance();
    await checkAccessibility(view);

    await view.user.click(
      screen.getByRole('button', { name: 'Switch language: English' }),
    );
    await checkAccessibility(view);
  });

  it('has no violations on a phone', async () => {
    const view = await openAppearance('phone');
    await checkAccessibility(view);
  });

  it('keeps the labels of both rows with their controls', async () => {
    await openAppearance();
    const themeRow = screen.getByRole('group', { name: 'Theme' });
    expect(within(themeRow).getByRole('radiogroup')).toBeInTheDocument();
    expect(themeRow).toHaveAccessibleDescription(
      'Light, dark, or the same as your system.',
    );
    const languageRow = screen.getByRole('group', { name: 'Language' });
    expect(within(languageRow).getByRole('button')).toBeInTheDocument();
  });

  it('does not change a thing about the app’s data', async () => {
    const { api } = installSettingsApi();
    const { user } = await openAppearance();
    await user.click(option('Dark'));
    await act(async () => {});
    expect(api.callsTo('PATCH /settings')).toHaveLength(0);
  });
});
