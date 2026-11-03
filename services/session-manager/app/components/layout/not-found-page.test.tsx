import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/nowhere/at/all');
});

import { NotFoundPage } from './not-found-page';

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

/** The page in the frame that gives it the `main` landmark. */
function show() {
  return renderApp(
    <main>
      <NotFoundPage />
    </main>,
  );
}

describe('NotFoundPage', () => {
  it('says that the page was not found, under the one heading of the page', () => {
    show();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
  });

  it('says what may be wrong, in a sentence', () => {
    show();
    expect(
      screen.getByText(
        "The page you're looking for doesn't exist or may have been moved.",
      ),
    ).toBeVisible();
  });

  it('titles the tab with what the page is, then the name of the app', () => {
    show();
    expect(document.title).toBe('Page not found - Session Manager');
  });

  it('offers the way back to the sessions, as a link', () => {
    show();
    expect(
      screen.getByRole('link', { name: 'Back to sessions' }),
    ).toHaveAttribute('href', '/sessions');
  });

  it('speaks German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    show();
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Seite nicht gefunden',
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Die gesuchte Seite existiert nicht oder wurde möglicherweise verschoben.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Zurück zu den Sitzungen' }),
    ).toHaveAttribute('href', '/sessions');
    await waitFor(() =>
      expect(document.title).toBe('Seite nicht gefunden - Session Manager'),
    );
  });

  it('speaks French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    show();
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Page introuvable',
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "La page que tu cherches n'existe pas ou a peut-être été déplacée.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Retour aux sessions' }),
    ).toHaveAttribute('href', '/sessions');
  });

  it('has no accessibility violations', async () => {
    const view = show();
    await checkAccessibility(view);
  });
});
