import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/proxies');
});

import { AppRail } from './app-rail';

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('AppRail', () => {
  it('is one sidebar, named for what it is', () => {
    renderApp(<AppRail />);
    expect(
      screen.getByRole('complementary', { name: 'Session Manager sidebar' }),
    ).toBeInTheDocument();
  });

  it('names the logo link after the app, and leads it to the first section', () => {
    renderApp(<AppRail />);
    const rail = screen.getByRole('complementary');
    // Not the name of the sidebar again: a screen reader says "Session Manager" for the link only.
    expect(
      within(rail).getByRole('link', { name: 'Session Manager' }),
    ).toHaveAttribute('href', '/sessions');
    expect(
      screen.getAllByRole('link', { name: 'Session Manager' }),
    ).toHaveLength(1);
  });

  it('lists the sections as icon links named by their label, in one navigation, Settings last', () => {
    renderApp(<AppRail />);
    const main = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(
      within(main)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual(['Sessions', 'Proxies', 'Secrets', 'Settings']);
    expect(
      within(main).getByRole('link', { name: 'Settings' }),
    ).toHaveAttribute('href', '/settings');
    // One landmark, not a second one for the single tile at the foot.
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('marks the section of the open page as the current one', () => {
    renderApp(<AppRail />);
    expect(screen.getByRole('link', { name: 'Proxies' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Sessions' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('always opens the overview of a section', () => {
    renderApp(<AppRail />);
    expect(screen.getByRole('link', { name: 'Sessions' })).toHaveAttribute(
      'href',
      '/sessions',
    );
  });

  it('speaks German and French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderApp(<AppRail />);
    expect(
      await screen.findByRole('complementary', {
        name: 'Session-Manager-Seitenleiste',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Hauptnavigation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proxies' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(<AppRail />);
    await checkAccessibility(view);
  });
});
