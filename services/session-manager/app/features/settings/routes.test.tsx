import { ThemeProvider } from '@tale/ui/theme';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '@/app/routeTree.gen';
import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { createTestQueryClient, renderApp } from '@/tests/utils/render';
import { installSettingsApi } from '@/tests/utils/settings-api';
import { stubViewport } from '@/tests/utils/viewport';

/*
 * The Settings routes as the app has them: the generated route tree, under the
 * real root route and shell. This is what proves the route files wire the right
 * page to the right path, redirect on a computer only, and title the document;
 * the layout and the pages are tested on a tree of their own in their files.
 */

function renderAt(path: string, viewport: 'phone' | 'desktop' = 'desktop') {
  const screenSize = stubViewport(viewport);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // The client the routes' loaders fill is the one the pages read.
  const queryClient = createTestQueryClient();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  const view = renderApp(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
    { queryClient },
  );
  return { ...view, router, resize: screenSize.resize };
}

beforeEach(() => {
  installSettingsApi();
});

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('the Settings routes', () => {
  it('open Settings on General on a computer', async () => {
    const { router } = renderAt('/settings');

    await screen.findByRole('heading', { level: 1, name: 'General' });
    expect(router.state.location.pathname).toBe('/settings/general');
    expect(
      await screen.findByRole('textbox', { name: 'Start page' }),
    ).toBeInTheDocument();
  });

  it('list the pages on a phone, which has no panel', async () => {
    const { router } = renderAt('/settings', 'phone');

    await screen.findByRole('navigation', { name: 'Settings' });
    expect(router.state.location.pathname).toBe('/settings');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Settings' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['/settings/general', 'General', 'Start page'],
    ['/settings/appearance', 'Appearance', 'Switch theme'],
    ['/settings/ai-access', 'AI access', 'Allow AI assistants to connect'],
  ])('show %s with its own content', async (path, title, control) => {
    renderAt(path);

    await screen.findByRole('heading', { level: 1, name: title });
    expect(await screen.findByLabelText(control)).toBeInTheDocument();
  });

  it.each([
    ['/settings/general', 'General settings - Session Manager'],
    ['/settings/appearance', 'Appearance - Session Manager'],
    ['/settings/ai-access', 'AI access - Session Manager'],
  ])('title the document of %s', async (path, title) => {
    renderAt(path);
    await waitFor(() => expect(document.title).toBe(title));
  });

  it('word the title again when the language is switched on the Appearance page', async () => {
    const { user } = renderAt('/settings/appearance');
    await waitFor(() =>
      expect(document.title).toBe('Appearance - Session Manager'),
    );

    await user.click(
      screen.getByRole('button', { name: 'Switch language: English' }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Deutsch/ }));

    await waitFor(() =>
      expect(document.title).toBe('Darstellung - Session Manager'),
    );
  });

  it('keep the rail on the Settings section for every page', async () => {
    renderAt('/settings/appearance');
    await screen.findByRole('heading', { level: 1, name: 'Appearance' });

    const rail = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(
      within(rail).getByRole('link', { name: 'Settings' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(
        screen.getByRole('navigation', { name: 'Settings pages' }),
      ).getByRole('link', { name: 'Appearance' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('move from the list of a phone to a page and back', async () => {
    const { user, router } = renderAt('/settings', 'phone');
    const list = await screen.findByRole('navigation', { name: 'Settings' });

    await user.click(within(list).getByRole('link', { name: /AI access/ }));
    await screen.findByRole('heading', { level: 1, name: 'AI access' });
    await user.click(screen.getByRole('button', { name: 'Back' }));

    await screen.findByRole('navigation', { name: 'Settings' });
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('open the pages from the tab bar of a phone: Settings always opens the list', async () => {
    const { user, router } = renderAt('/settings/general', 'phone');
    await screen.findByRole('heading', { level: 1, name: 'General' });

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    await screen.findByRole('navigation', { name: 'Settings' });
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('send the person to General when the rail’s Settings is clicked on a computer', async () => {
    const { user, router } = renderAt('/settings/ai-access');
    await screen.findByRole('heading', { level: 1, name: 'AI access' });

    await user.click(
      within(
        screen.getByRole('navigation', { name: 'Main navigation' }),
      ).getByRole('link', {
        name: 'Settings',
      }),
    );

    await screen.findByRole('heading', { level: 1, name: 'General' });
    expect(router.state.location.pathname).toBe('/settings/general');
  });

  it('follow the window growing from a phone to a computer', async () => {
    const { router, resize } = renderAt('/settings', 'phone');
    await screen.findByRole('navigation', { name: 'Settings' });

    act(() => resize('desktop'));

    await screen.findByRole('heading', { level: 1, name: 'General' });
    expect(router.state.location.pathname).toBe('/settings/general');
  });

  it('have no accessibility violations in the app’s shell', async () => {
    const view = renderAt('/settings/appearance');
    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    await checkAccessibility(view);
  });
});
