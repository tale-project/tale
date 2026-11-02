import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/settings');
});

import { SettingsPagesList } from './settings-pages-list';

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('SettingsPagesList', () => {
  it('links to every page, General first, each with a few words on what it holds', () => {
    renderApp(<SettingsPagesList />);

    const list = screen.getByRole('navigation', { name: 'Settings' });
    const rows = within(list).getAllByRole('link');
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/settings/general',
      '/settings/appearance',
      '/settings/ai-access',
    ]);
    expect(rows[0]).toHaveTextContent('GeneralStart page and version.');
    expect(rows[1]).toHaveTextContent('AppearanceTheme and language.');
    expect(rows[2]).toHaveTextContent(
      'AI accessLet AI assistants use Session Manager.',
    );
  });

  it('is reached with the keyboard, a row after the other', async () => {
    const { user } = renderApp(<SettingsPagesList />);

    await user.tab();
    expect(screen.getByRole('link', { name: /General/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: /Appearance/ })).toHaveFocus();
  });

  it('reads in German', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderApp(<SettingsPagesList />);

    const rows = within(
      screen.getByRole('navigation', { name: 'Einstellungen' }),
    ).getAllByRole('link');
    expect(rows.map((row) => row.textContent)).toEqual([
      'AllgemeinStartseite und Version.',
      'DarstellungDesign und Sprache.',
      'KI-ZugriffErlaube KI-Assistenten, Session Manager zu nutzen.',
    ]);
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(<SettingsPagesList />);
    await checkAccessibility(view);
  });
});
